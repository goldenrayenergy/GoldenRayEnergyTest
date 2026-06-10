// ────────────────────────────────────────────────────────────────────────────
// PM Tool — Catalogue CSV import (labour + compliance rate-cards).
//
// Admin only. Reps cannot upload. Each import:
//   1. Validates CSV columns (sku + cost_nzd + name required; rest optional)
//   2. Captures a prev-snapshot CSV for rollback (Supabase Storage)
//   3. Upserts by SKU into labour_rate_card / compliance_rate_card
//   4. Writes a row to catalogue_csv_imports with row counts + errors[] + reason
//   5. Invalidates the in-process catalogue cache so reps see fresh prices
//
// Routes (mounted under /api/pm/admin/catalogue):
//   GET  /imports?target=labour_rate_card&limit=10
//        → audit list of recent imports
//   POST /import/labour       multipart: file=<csv>, reason=<text>
//   POST /import/compliance   multipart: file=<csv>, reason=<text>
//        → { ok, summary: { inserted, updated, unchanged, errors[] }, import_id }
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { authenticate, authorize } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { invalidateCatalogueCache } from '../../services/pm/proposalEngine/catalogue/cachedDbLoader.js';

const router = Router();
router.use(authenticate);
router.use(authorize('admin'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB; rate-cards are tiny
});

// ── CSV parsing — tiny RFC4180-ish parser, handles quoted commas/newlines ──
function parseCsv(buf) {
  const text = buf.toString('utf-8').replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // Strip fully-empty trailing rows
  while (rows.length && rows[rows.length - 1].every(x => x === '')) rows.pop();
  if (rows.length < 2) return { headers: [], records: [] };
  const headers = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, ''));
  const records = rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] ?? '').trim(); });
    return obj;
  });
  return { headers, records };
}

const ALLOWED_LABOUR_CATEGORIES = ['install','battery_install','supervisor','travel','logistics','premium','other'];
const ALLOWED_COMPLIANCE_CATEGORIES = ['design','inspection','commissioning','grid_app','certificate','survey','other'];

// Coerce / validate one record into a normalised row. Returns
// { row, error }. error is a string when the record can't be saved.
function normaliseRow(rec, target) {
  const sku = (rec.sku || '').trim();
  if (!sku) return { error: 'sku is required' };
  if (sku.length > 40) return { error: 'sku exceeds 40 chars' };

  const name = (rec.name || '').trim();
  if (!name) return { error: 'name is required' };

  const category = (rec.category || '').trim().toLowerCase();
  const allowed = target === 'labour_rate_card' ? ALLOWED_LABOUR_CATEGORIES : ALLOWED_COMPLIANCE_CATEGORIES;
  if (!allowed.includes(category)) {
    return { error: `category must be one of: ${allowed.join(', ')}` };
  }

  const cost_nzd = Number(rec.cost_nzd);
  if (!Number.isFinite(cost_nzd) || cost_nzd < 0) return { error: 'cost_nzd must be a non-negative number' };

  let margin_pct = rec.margin_pct === '' || rec.margin_pct == null ? 30 : Number(rec.margin_pct);
  if (!Number.isFinite(margin_pct) || margin_pct < 0 || margin_pct > 100) {
    return { error: 'margin_pct must be a number 0–100' };
  }

  const default_qty = rec.default_qty === '' || rec.default_qty == null ? 1 : Number(rec.default_qty);
  if (!Number.isFinite(default_qty) || default_qty < 0) return { error: 'default_qty must be a non-negative number' };

  const active = (rec.active ?? 'true').toString().trim().toLowerCase();
  const activeBool = !['false','no','0','f','n'].includes(active);

  const row = { sku, category, name, cost_nzd, margin_pct, default_qty, active: activeBool };

  if (target === 'labour_rate_card') {
    if (rec.applies_to_kw_min !== '' && rec.applies_to_kw_min != null) {
      const n = Number(rec.applies_to_kw_min);
      if (!Number.isFinite(n)) return { error: 'applies_to_kw_min must be a number' };
      row.applies_to_kw_min = n;
    }
    if (rec.applies_to_kw_max !== '' && rec.applies_to_kw_max != null) {
      const n = Number(rec.applies_to_kw_max);
      if (!Number.isFinite(n)) return { error: 'applies_to_kw_max must be a number' };
      row.applies_to_kw_max = n;
    }
    if (rec.applies_when) {
      try { row.applies_when = JSON.parse(rec.applies_when); }
      catch { return { error: 'applies_when must be valid JSON' }; }
    }
  }
  return { row };
}

async function snapshotPrevState(target) {
  // CSV-encoded snapshot of the entire rate-card table — held in memory and
  // optionally pushed to Supabase Storage for rollback. We keep it simple
  // here: return the CSV string + sha; storage upload is a TODO marked below.
  const { data, error } = await supabaseAdmin.from(target).select('*');
  if (error) throw error;
  if (!data || data.length === 0) return { csv: '', sha: '' };
  const headers = Object.keys(data[0]);
  const lines = [headers.join(',')];
  for (const r of data) {
    lines.push(headers.map(h => {
      const v = r[h];
      if (v == null) return '';
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  const csv = lines.join('\n');
  const sha = crypto.createHash('sha256').update(csv).digest('hex');
  return { csv, sha };
}

async function performImport({ target, file, reason, userId, csvFilename }) {
  if (!file) throw new Error('CSV file required (multipart field: file).');
  if (!reason || reason.trim().length < 10) {
    throw new Error('reason is required (min 10 chars) — explain why prices changed.');
  }

  const { records } = parseCsv(file.buffer);
  if (records.length === 0) throw new Error('CSV had no data rows.');

  // Pre-import snapshot for rollback
  const { sha: prevSha } = await snapshotPrevState(target);
  // TODO(P8.1): push prev-snapshot CSV to Supabase Storage and store path in
  //             prev_snapshot_storage_path. For MVP we just track the sha.

  // Fetch existing rows by SKU to classify insert/update/unchanged
  const skus = records.map(r => (r.sku || '').trim()).filter(Boolean);
  const { data: existingRows, error: exErr } = await supabaseAdmin
    .from(target).select('sku, cost_nzd, margin_pct, default_qty, active, name, category')
    .in('sku', skus);
  if (exErr) throw exErr;
  const bySku = new Map((existingRows || []).map(r => [r.sku, r]));

  const errors = [];
  const toUpsert = [];
  let unchanged = 0;
  let updated = 0;
  let inserted = 0;

  records.forEach((rec, idx) => {
    const rowNum = idx + 2; // header is row 1; first data row is row 2
    const { row, error } = normaliseRow(rec, target);
    if (error) {
      errors.push({ row_number: rowNum, sku: rec.sku || null, message: error, severity: 'error' });
      return;
    }
    const prev = bySku.get(row.sku);
    if (prev) {
      const same =
        Number(prev.cost_nzd)    === Number(row.cost_nzd) &&
        Number(prev.margin_pct)  === Number(row.margin_pct) &&
        Number(prev.default_qty) === Number(row.default_qty) &&
        prev.active === row.active &&
        prev.name === row.name &&
        prev.category === row.category;
      if (same) { unchanged++; return; }
      updated++;
    } else {
      inserted++;
    }
    toUpsert.push({
      ...row,
      last_updated_by: userId,
      updated_at: new Date().toISOString(),
    });
  });

  // Write the audit row FIRST so we can stamp last_csv_import_id on the
  // upserted rows (and keep the audit row even if the upsert errors).
  const { data: importRow, error: importErr } = await supabaseAdmin
    .from('catalogue_csv_imports')
    .insert({
      target_table: target,
      imported_by: userId,
      rows_inserted: inserted,
      rows_updated: updated,
      rows_unchanged: unchanged,
      rows_errored: errors.length,
      errors: errors.length > 0 ? errors : null,
      csv_filename: csvFilename || null,
      csv_size_bytes: file.size || file.buffer.length,
      csv_sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
      reason: reason.trim(),
      prev_snapshot_storage_path: prevSha ? `sha256:${prevSha}` : null,
    })
    .select('id')
    .single();
  if (importErr) throw importErr;

  if (toUpsert.length > 0) {
    const withImportId = toUpsert.map(r => ({ ...r, last_csv_import_id: importRow.id }));
    const { error: upErr } = await supabaseAdmin
      .from(target).upsert(withImportId, { onConflict: 'sku' });
    if (upErr) throw upErr;
  }

  invalidateCatalogueCache();

  return {
    ok: true,
    import_id: importRow.id,
    summary: { inserted, updated, unchanged, errored: errors.length, errors },
  };
}

// ── Routes ─────────────────────────────────────────────────────────────────
router.post('/import/labour', upload.single('file'), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const out = await performImport({
      target: 'labour_rate_card',
      file: req.file,
      reason: req.body?.reason || '',
      userId: req.user.id,
      csvFilename: req.file?.originalname,
    });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/import/compliance', upload.single('file'), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const out = await performImport({
      target: 'compliance_rate_card',
      file: req.file,
      reason: req.body?.reason || '',
      userId: req.user.id,
      csvFilename: req.file?.originalname,
    });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/imports', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const target = req.query.target;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    let q = supabaseAdmin.from('catalogue_csv_imports').select(
      'id, target_table, imported_by, imported_at, rows_inserted, rows_updated, rows_unchanged, rows_errored, csv_filename, reason'
    ).order('imported_at', { ascending: false }).limit(limit);
    if (target) q = q.eq('target_table', target);
    const { data, error } = await q;
    if (error) throw error;
    res.json({ imports: data || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Per-row CRUD for labour_rate_card + compliance_rate_card
// (the "Labour & Compliance" admin tab editor).
//
// Policy:
//   • cost_nzd / default_qty / active / name / category / applies_* — admin can edit freely
//   • margin_pct — requires `reason` (≥10 chars), recorded in catalogue_csv_imports audit log
//   • new row creation + deactivation also require `reason`
//   • every mutation calls invalidateCatalogueCache()
// ────────────────────────────────────────────────────────────────────────────

const TARGETS = {
  labour:     { table: 'labour_rate_card',     allowedCategories: ALLOWED_LABOUR_CATEGORIES },
  compliance: { table: 'compliance_rate_card', allowedCategories: ALLOWED_COMPLIANCE_CATEGORIES },
};

function tableFor(kind) {
  const t = TARGETS[kind];
  if (!t) { const e = new Error(`kind must be "labour" or "compliance"`); e.statusCode = 400; throw e; }
  return t;
}

// Audit one inline edit (POST / PATCH / DELETE) in catalogue_csv_imports.
// Reuses the same audit table as CSV imports — csv_filename = NULL marks it
// as an inline edit; reason captures the why.
async function logInlineEdit({ target_table, userId, action, sku, before, after, reason }) {
  await supabaseAdmin.from('catalogue_csv_imports').insert({
    target_table,
    imported_by: userId,
    rows_inserted: action === 'create' ? 1 : 0,
    rows_updated:  action === 'update' ? 1 : 0,
    rows_unchanged: 0,
    rows_errored:  0,
    errors: null,
    csv_filename: null, // marks inline-edit
    csv_size_bytes: null,
    csv_sha256: null,
    reason: reason || `Inline ${action} of ${sku}`,
    prev_snapshot_storage_path: before
      ? `inline:${JSON.stringify({ before, after }).slice(0, 800)}`
      : null,
  });
}

// GET /labour, /compliance — list current rate-card rows
router.get('/:kind(labour|compliance)', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { table } = tableFor(req.params.kind);
    const { data, error } = await supabaseAdmin
      .from(table)
      .select('*')
      .order('category', { ascending: true })
      .order('sku', { ascending: true });
    if (error) throw error;
    res.json({ rows: data || [] });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// POST /labour, /compliance — create a new rate-card row
router.post('/:kind(labour|compliance)', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { kind } = req.params;
    const { table, allowedCategories } = tableFor(kind);
    const body = req.body || {};

    if (!body.reason || String(body.reason).trim().length < 10) {
      return res.status(400).json({ error: 'reason is required (min 10 chars).' });
    }
    // Normalise via the existing row validator (same shape as CSV row)
    const { row, error } = normaliseRow({
      sku: body.sku,
      category: body.category,
      name: body.name,
      cost_nzd: String(body.cost_nzd ?? ''),
      margin_pct: body.margin_pct == null ? '' : String(body.margin_pct),
      default_qty: body.default_qty == null ? '' : String(body.default_qty),
      active: body.active == null ? 'true' : String(body.active),
      applies_to_kw_min: body.applies_to_kw_min == null ? '' : String(body.applies_to_kw_min),
      applies_to_kw_max: body.applies_to_kw_max == null ? '' : String(body.applies_to_kw_max),
      applies_when: body.applies_when ? JSON.stringify(body.applies_when) : '',
    }, table);
    if (error) return res.status(400).json({ error });

    const { data, error: insErr } = await supabaseAdmin
      .from(table)
      .insert({ ...row, last_updated_by: req.user.id, updated_at: new Date().toISOString() })
      .select('*').single();
    if (insErr) return res.status(400).json({ error: insErr.message });

    await logInlineEdit({
      target_table: table, userId: req.user.id, action: 'create',
      sku: row.sku, before: null, after: row, reason: body.reason.trim(),
    });
    invalidateCatalogueCache();
    res.json({ ok: true, row: data });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// PATCH /labour/:sku, /compliance/:sku — edit one row
// Special-cased: changing margin_pct requires `reason` (≥10 chars).
router.patch('/:kind(labour|compliance)/:sku', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { kind, sku } = req.params;
    const { table, allowedCategories } = tableFor(kind);
    const body = req.body || {};

    const { data: existing, error: getErr } = await supabaseAdmin
      .from(table).select('*').eq('sku', sku).maybeSingle();
    if (getErr) throw getErr;
    if (!existing) return res.status(404).json({ error: `${sku} not found in ${table}.` });

    const patch = {};
    if (body.name        !== undefined) patch.name        = String(body.name).trim();
    if (body.category    !== undefined) {
      const c = String(body.category).trim().toLowerCase();
      if (!allowedCategories.includes(c)) {
        return res.status(400).json({ error: `category must be one of: ${allowedCategories.join(', ')}` });
      }
      patch.category = c;
    }
    if (body.cost_nzd    !== undefined) {
      const n = Number(body.cost_nzd);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'cost_nzd must be a non-negative number.' });
      patch.cost_nzd = n;
    }
    if (body.default_qty !== undefined) {
      const n = Number(body.default_qty);
      if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: 'default_qty must be a non-negative number.' });
      patch.default_qty = n;
    }
    if (body.active      !== undefined) patch.active = !!body.active;

    if (table === 'labour_rate_card') {
      if (body.applies_to_kw_min !== undefined) {
        if (body.applies_to_kw_min === null || body.applies_to_kw_min === '') {
          patch.applies_to_kw_min = null;
        } else {
          const n = Number(body.applies_to_kw_min);
          if (!Number.isFinite(n)) return res.status(400).json({ error: 'applies_to_kw_min must be a number.' });
          patch.applies_to_kw_min = n;
        }
      }
      if (body.applies_to_kw_max !== undefined) {
        if (body.applies_to_kw_max === null || body.applies_to_kw_max === '') {
          patch.applies_to_kw_max = null;
        } else {
          const n = Number(body.applies_to_kw_max);
          if (!Number.isFinite(n)) return res.status(400).json({ error: 'applies_to_kw_max must be a number.' });
          patch.applies_to_kw_max = n;
        }
      }
      if (body.applies_when !== undefined) patch.applies_when = body.applies_when || null;
    }

    const marginChanging = body.margin_pct !== undefined &&
                           Number(body.margin_pct) !== Number(existing.margin_pct);
    if (marginChanging) {
      const n = Number(body.margin_pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: 'margin_pct must be a number 0–100.' });
      }
      if (!body.reason || String(body.reason).trim().length < 10) {
        return res.status(400).json({ error: 'Changing margin_pct requires a reason (min 10 chars).' });
      }
      patch.margin_pct = n;
    }

    if (Object.keys(patch).length === 0) {
      return res.json({ ok: true, row: existing, note: 'no changes' });
    }
    patch.last_updated_by = req.user.id;
    patch.updated_at = new Date().toISOString();

    const { data: updated, error: upErr } = await supabaseAdmin
      .from(table).update(patch).eq('sku', sku).select('*').single();
    if (upErr) return res.status(400).json({ error: upErr.message });

    // Auto-reason for non-margin edits if rep didn't supply one
    const editedFields = Object.keys(patch).filter(k => k !== 'last_updated_by' && k !== 'updated_at');
    const autoReason = `Inline edit: ${editedFields.join(', ')}`;
    await logInlineEdit({
      target_table: table, userId: req.user.id, action: 'update',
      sku, before: existing, after: updated,
      reason: marginChanging ? body.reason.trim() : (body.reason?.trim() || autoReason),
    });
    invalidateCatalogueCache();
    res.json({ ok: true, row: updated, margin_changed: marginChanging });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// DELETE /labour/:sku, /compliance/:sku — soft-deactivate (sets active=false)
router.delete('/:kind(labour|compliance)/:sku', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { kind, sku } = req.params;
    const { table } = tableFor(kind);
    const reason = req.body?.reason || req.query?.reason || '';
    if (!reason || String(reason).trim().length < 10) {
      return res.status(400).json({ error: 'reason is required (min 10 chars) for deactivation.' });
    }
    const { data: existing, error: getErr } = await supabaseAdmin
      .from(table).select('*').eq('sku', sku).maybeSingle();
    if (getErr) throw getErr;
    if (!existing) return res.status(404).json({ error: `${sku} not found in ${table}.` });

    const { data: updated, error: upErr } = await supabaseAdmin
      .from(table)
      .update({ active: false, last_updated_by: req.user.id, updated_at: new Date().toISOString() })
      .eq('sku', sku).select('*').single();
    if (upErr) return res.status(400).json({ error: upErr.message });

    await logInlineEdit({
      target_table: table, userId: req.user.id, action: 'update',
      sku, before: existing, after: updated, reason: reason.trim(),
    });
    invalidateCatalogueCache();
    res.json({ ok: true, row: updated });
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

// CSV template download — gives admins the expected column layout
router.get('/template/:kind', (req, res) => {
  const kind = req.params.kind;
  let csv;
  if (kind === 'labour') {
    csv = 'sku,category,name,cost_nzd,margin_pct,default_qty,applies_to_kw_min,applies_to_kw_max,applies_when,active\n' +
          'LAB-INS-3KW,install,Install crew up to 3kW,1200,30,1,,3,,true\n' +
          'LAB-INS-7KW,install,Install crew 3–7kW,1800,30,1,3,7,,true\n' +
          'LAB-BAT,battery_install,Battery install premium,650,30,1,,,{"has_battery":true},true\n';
  } else if (kind === 'compliance') {
    csv = 'sku,category,name,cost_nzd,margin_pct,default_qty,active\n' +
          'CMP-DSGN,design,System design,200,30,1,true\n' +
          'CMP-COMM,commissioning,Commissioning,200,30,1,true\n' +
          'CMP-ESC,certificate,Electrical Safety Certificate,120,30,1,true\n';
  } else {
    return res.status(400).json({ error: 'kind must be "labour" or "compliance"' });
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${kind}_rate_card_template.csv"`);
  res.send(csv);
});

export default router;

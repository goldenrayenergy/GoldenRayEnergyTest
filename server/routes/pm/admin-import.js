// ────────────────────────────────────────────────────────────────────────────
// PM Tool — Supplier data importer.
//
// POST /api/pm/admin/import/supplier-data
//   multipart/form-data with a 'file' field (the Goldenray_Supplier_Setup.xlsx
//   produced by server/scripts/build-supplier-setup-xlsx.js, filled in by the
//   owner after supplier conversations).
//
// Reads five sheets in this order and upserts them in dependency order:
//   1. Suppliers           → suppliers          (key: short_code)
//   2. Products            → products           (key: sku; resolves supplier_id from short_code)
//   3. Compatibility       → product_compatibility (resolves product ids from SKU pair)
//   4. Region_Defaults     → region_defaults    (key: region_name)
//   5. Cost_Defaults       → cost_defaults      (key: cost_type + applies_to)
//
// Package_Templates sheet is intentionally skipped for now — templates table
// design is part of a later phase; the 3-quote engine reads its inputs from
// the five tables above.
//
// Behaviour:
//   - "EXAMPLE" notes are accepted as-is (no special filtering — owner can clear them)
//   - Rows that fail validation are recorded in errors[] with the sheet name + row index
//   - Whole upload is best-effort per-row; one bad row doesn't fail the rest
//   - Result shape: { ok: true, summary: { Suppliers: { inserted, updated, skipped, errors:[] }, ... } }
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';

const router = Router();
router.use(authenticate);

// Excel files are small (~50 KB) — buffer in memory, no disk spool.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Utility — read a sheet as an array of normalised objects ─────────────────
// Keys are lower-cased and trimmed so spreadsheet header drift doesn't break.
function readSheet(wb, sheetName) {
  if (!wb.SheetNames.includes(sheetName)) return null;
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
  return rows.map(r => {
    const out = {};
    for (const [k, v] of Object.entries(r)) {
      const key = k.toString().trim().toLowerCase().replace(/[\s/]+/g, '_').replace(/[^a-z0-9_]/g, '');
      out[key] = typeof v === 'string' ? v.trim() : v;
    }
    return out;
  });
}

// Coerce blank strings / undefined to null; everything else passes through.
const blankToNull = v => (v === '' || v === undefined ? null : v);
const toNum   = v => (v === '' || v == null ? null : Number(v));
const toInt   = v => (v === '' || v == null ? null : parseInt(v, 10));
const toBool  = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  return ['true', 'yes', 'y', '1'].includes(s);
};
const toDate  = v => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

// ── 1. Suppliers ────────────────────────────────────────────────────────────
// Sheet headers (lowercased + normalised):
//   supplier_name · short_code · category_focus · tier · contract_status ·
//   contract_start · contract_renewal_date · min_volume_target_yearly ·
//   volume_unit · marketing_cofund_pct · rep_name · rep_email · rep_phone · notes
async function importSuppliers(rows) {
  const result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  if (!rows?.length) return result;

  // Pre-fetch by short_code for upsert
  const { data: existing, error: exErr } = await supabaseAdmin
    .from('suppliers')
    .select('id, short_code');
  if (exErr) throw exErr;
  const idByCode = new Map((existing || []).map(s => [s.short_code, s.id]));

  for (const [i, r] of rows.entries()) {
    try {
      const short = (r.short_code || '').toString().trim().toUpperCase();
      const name  = (r.supplier_name || '').toString().trim();
      if (!short || !name) { result.skipped++; continue; }

      const record = {
        name,
        short_code:                short,
        category_focus:            blankToNull(r.category_focus),
        tier:                      blankToNull(r.tier) || 't2_volume',
        contract_status:           blankToNull(r.contract_status) || 'active',
        contract_start_date:       toDate(r.contract_start),
        contract_renewal_date:     toDate(r.contract_renewal_date),
        min_volume_target_yearly:  toInt(r.min_volume_target_yearly),
        volume_unit:               blankToNull(r.volume_unit),
        marketing_cofund_pct:      toNum(r.marketing_cofund_pct) ?? 0,
        rep_name:                  blankToNull(r.rep_name),
        rep_email:                 blankToNull(r.rep_email),
        rep_phone:                 blankToNull(r.rep_phone),
        notes:                     blankToNull(r.notes),
      };

      if (idByCode.has(short)) {
        const { error } = await supabaseAdmin.from('suppliers').update(record).eq('id', idByCode.get(short));
        if (error) throw error;
        result.updated++;
      } else {
        const { data, error } = await supabaseAdmin.from('suppliers').insert(record).select('id').single();
        if (error) throw error;
        idByCode.set(short, data.id);
        result.inserted++;
      }
    } catch (e) {
      result.errors.push({ row: i + 2, error: e.message });   // +2 because row 1 is header
    }
  }
  return { result, idByCode };
}

// ── 2. Products ─────────────────────────────────────────────────────────────
// Sheet headers (lowercased + normalised):
//   sku · product_name · category · supplier_short_code · model_number ·
//   wattage_w · kw_rating · kwh_capacity · phase ·
//   wholesale_cost_nzd · rrp_nzd · margin_target_pct · lead_time_days ·
//   datasheet_url · notes
async function importProducts(rows, supplierIdByCode) {
  const result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  if (!rows?.length) return result;

  // Pre-fetch by sku (where present) for upsert
  const { data: existing, error: exErr } = await supabaseAdmin
    .from('products')
    .select('id, sku');
  if (exErr) throw exErr;
  const idBySku = new Map((existing || []).filter(p => p.sku).map(p => [p.sku, p.id]));

  for (const [i, r] of rows.entries()) {
    try {
      const name = (r.product_name || '').toString().trim();
      if (!name) { result.skipped++; continue; }

      const sku   = blankToNull(r.sku);
      const short = (r.supplier_short_code || '').toString().trim().toUpperCase();
      const supplierId = short && supplierIdByCode.has(short) ? supplierIdByCode.get(short) : null;

      // Pack technical specs into the specs JSONB so query is uniform
      const specs = {};
      if (r.wattage_w   != null && r.wattage_w   !== '') specs.wattage_w   = toNum(r.wattage_w);
      if (r.kw_rating   != null && r.kw_rating   !== '') specs.kw_rating   = toNum(r.kw_rating);
      if (r.kwh_capacity != null && r.kwh_capacity !== '') specs.kwh_capacity = toNum(r.kwh_capacity);
      if (r.phase       != null && r.phase       !== '') specs.phase       = String(r.phase).trim();
      if (r.model_number != null && r.model_number !== '') specs.model_number = String(r.model_number).trim();

      const record = {
        sku,
        name,
        category:           blankToNull(r.category),
        brand:              short || null,                     // brand carries the supplier short code for legacy compatibility
        supplier_id:        supplierId,
        wholesale_cost_nzd: toNum(r.wholesale_cost_nzd),
        cost_nzd:           toNum(r.wholesale_cost_nzd),       // legacy mirror — used by quotes today
        default_margin_pct: toNum(r.margin_target_pct) ?? 30,
        margin_target_pct:  toNum(r.margin_target_pct),
        lead_time_days:     toInt(r.lead_time_days),
        datasheet_url:      blankToNull(r.datasheet_url),
        specs:              Object.keys(specs).length ? specs : null,
      };

      if (sku && idBySku.has(sku)) {
        const { error } = await supabaseAdmin.from('products').update(record).eq('id', idBySku.get(sku));
        if (error) throw error;
        result.updated++;
      } else {
        const { data, error } = await supabaseAdmin.from('products').insert(record).select('id').single();
        if (error) throw error;
        if (sku) idBySku.set(sku, data.id);
        result.inserted++;
      }
    } catch (e) {
      result.errors.push({ row: i + 2, error: e.message });
    }
  }
  return { result, idBySku };
}

// ── 3. Product Compatibility ────────────────────────────────────────────────
// Sheet headers:
//   pairing_type · product_a_sku · product_a_name · product_b_sku · product_b_name ·
//   string_min · string_max · voltage_range · verified_by · verified_date · notes
async function importCompatibility(rows, productIdBySku) {
  const result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  if (!rows?.length) return result;

  // Compatibility rows are de-duped by (pairing_type, product_a_id, product_b_id).
  // Pull existing into a set so re-running the import is idempotent.
  const { data: existing, error: exErr } = await supabaseAdmin
    .from('product_compatibility')
    .select('id, pairing_type, product_a_id, product_b_id');
  if (exErr) throw exErr;
  const sigToId = new Map((existing || []).map(c => [`${c.pairing_type}|${c.product_a_id}|${c.product_b_id}`, c.id]));

  for (const [i, r] of rows.entries()) {
    try {
      const aId = productIdBySku.get(blankToNull(r.product_a_sku));
      const bId = productIdBySku.get(blankToNull(r.product_b_sku));
      const ptype = blankToNull(r.pairing_type);
      if (!aId || !bId || !ptype) {
        result.errors.push({ row: i + 2, error: `Skipped — missing product or pairing_type (a_sku=${r.product_a_sku}, b_sku=${r.product_b_sku})` });
        continue;
      }
      const sig = `${ptype}|${aId}|${bId}`;
      const record = {
        pairing_type:  ptype,
        product_a_id:  aId,
        product_b_id:  bId,
        string_min:    toInt(r.string_min),
        string_max:    toInt(r.string_max),
        voltage_range: blankToNull(r.voltage_range),
        verified_by:   blankToNull(r.verified_by),
        verified_at:   toDate(r.verified_date),
        notes:         blankToNull(r.notes),
      };
      if (sigToId.has(sig)) {
        const { error } = await supabaseAdmin.from('product_compatibility').update(record).eq('id', sigToId.get(sig));
        if (error) throw error;
        result.updated++;
      } else {
        const { error } = await supabaseAdmin.from('product_compatibility').insert(record);
        if (error) throw error;
        result.inserted++;
      }
    } catch (e) {
      result.errors.push({ row: i + 2, error: e.message });
    }
  }
  return { result };
}

// ── 4. Region_Defaults ──────────────────────────────────────────────────────
// Sheet headers:
//   region_name · postcode_prefix · sun_hours_daily · avg_household_kwh_yearly ·
//   avg_monthly_bill_nzd · typical_self_consumption_pct ·
//   with_battery_self_consumption_pct · irradiance_kwh_m2_yearly · notes
async function importRegionDefaults(rows) {
  const result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  if (!rows?.length) return result;

  const { data: existing, error: exErr } = await supabaseAdmin
    .from('region_defaults')
    .select('id, region_name');
  if (exErr) throw exErr;
  const idByName = new Map((existing || []).map(r => [r.region_name, r.id]));

  for (const [i, r] of rows.entries()) {
    try {
      const name = (r.region_name || '').toString().trim();
      if (!name) { result.skipped++; continue; }

      const record = {
        region_name:                       name,
        postcode_prefix:                   blankToNull(r.postcode_prefix),
        sun_hours_daily:                   toNum(r.sun_hours_daily),
        avg_household_kwh_yearly:          toInt(r.avg_household_kwh_yearly),
        avg_monthly_bill_nzd:              toNum(r.avg_monthly_bill_nzd),
        typical_self_consumption_pct:      toNum(r.typical_self_consumption_pct),
        with_battery_self_consumption_pct: toNum(r.with_battery_self_consumption_pct),
        irradiance_kwh_m2_yearly:          toInt(r.irradiance_kwh_m2_yearly),
        notes:                             blankToNull(r.notes),
      };

      if (!record.sun_hours_daily) {
        result.errors.push({ row: i + 2, error: `sun_hours_daily is required` });
        continue;
      }

      if (idByName.has(name)) {
        const { error } = await supabaseAdmin.from('region_defaults').update(record).eq('id', idByName.get(name));
        if (error) throw error;
        result.updated++;
      } else {
        const { error } = await supabaseAdmin.from('region_defaults').insert(record);
        if (error) throw error;
        result.inserted++;
      }
    } catch (e) {
      result.errors.push({ row: i + 2, error: e.message });
    }
  }
  return { result };
}

// ── 5. Cost_Defaults ────────────────────────────────────────────────────────
// Sheet headers:
//   cost_type · cost_nzd · unit · applies_to · notes
async function importCostDefaults(rows) {
  const result = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  if (!rows?.length) return result;

  // Composite key for upsert
  const { data: existing, error: exErr } = await supabaseAdmin
    .from('cost_defaults')
    .select('id, cost_type, applies_to');
  if (exErr) throw exErr;
  const idByKey = new Map((existing || []).map(c => [`${c.cost_type}|${c.applies_to || 'all'}`, c.id]));

  for (const [i, r] of rows.entries()) {
    try {
      const ctype  = (r.cost_type || '').toString().trim();
      const cost   = toNum(r.cost_nzd);
      const unit   = (r.unit || '').toString().trim();
      const apply  = (r.applies_to || 'all').toString().trim();
      if (!ctype || cost == null || !unit) { result.skipped++; continue; }

      const record = {
        cost_type:  ctype,
        cost_nzd:   cost,
        unit,
        applies_to: apply,
        notes:      blankToNull(r.notes),
      };
      const key = `${ctype}|${apply}`;
      if (idByKey.has(key)) {
        const { error } = await supabaseAdmin.from('cost_defaults').update(record).eq('id', idByKey.get(key));
        if (error) throw error;
        result.updated++;
      } else {
        const { error } = await supabaseAdmin.from('cost_defaults').insert(record);
        if (error) throw error;
        result.inserted++;
      }
    } catch (e) {
      result.errors.push({ row: i + 2, error: e.message });
    }
  }
  return { result };
}

// ── Main route ──────────────────────────────────────────────────────────────
router.post('/import/supplier-data', upload.single('file'), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    if (!req.file)       return res.status(400).json({ error: 'No file uploaded (field name: file).' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheets = wb.SheetNames;

    const summary = {};

    // 1. Suppliers — must run first so we can resolve supplier_id for Products
    const supplierRows = readSheet(wb, 'Suppliers');
    const supSeed      = await importSuppliers(supplierRows || []);
    summary.Suppliers  = supSeed.result;
    const supplierIdByCode = supSeed.idByCode || new Map();

    // 2. Products — must run before Compatibility so we can resolve SKU → id
    const productRows = readSheet(wb, 'Products');
    const prodSeed    = await importProducts(productRows || [], supplierIdByCode);
    summary.Products  = prodSeed.result;
    const productIdBySku = prodSeed.idBySku || new Map();

    // 3. Compatibility
    const compatRows = readSheet(wb, 'Compatibility');
    const compatSeed = await importCompatibility(compatRows || [], productIdBySku);
    summary.Compatibility = compatSeed.result;

    // 4. Region defaults
    const regionRows = readSheet(wb, 'Region_Defaults');
    const regionSeed = await importRegionDefaults(regionRows || []);
    summary.Region_Defaults = regionSeed.result;

    // 5. Cost defaults
    const costRows = readSheet(wb, 'Cost_Defaults');
    const costSeed = await importCostDefaults(costRows || []);
    summary.Cost_Defaults = costSeed.result;

    // Package_Templates intentionally skipped (different table not in 019).
    const skippedSheets = sheets.filter(s => !['Suppliers', 'Products', 'Compatibility', 'Region_Defaults', 'Cost_Defaults', 'README'].includes(s));

    res.json({
      ok: true,
      filename:        req.file.originalname,
      sheets_found:    sheets,
      sheets_skipped:  skippedSheets,
      summary,
    });
  } catch (e) {
    console.error('Supplier data import failed:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;

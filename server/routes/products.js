import { Router } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(authenticate);

// In-memory file upload — Excel files are tiny (~50KB) so no need to spool to disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },  // 5 MB ceiling — generous for an Excel
});

const GST_RATE = 0.15;

// Compute sell prices on the fly so they're never stored stale
const enrich = (p) => {
  if (!p) return p;
  const cost = parseFloat(p.cost_nzd) || 0;
  const margin = parseFloat(p.default_margin_pct) || 0;
  const sellExcl = +(cost * (1 + margin / 100)).toFixed(2);
  const sellIncl = +(sellExcl * (1 + GST_RATE)).toFixed(2);
  return { ...p, sell_excl_gst: sellExcl, sell_incl_gst: sellIncl };
};

// ── List products with filters and pagination ───────────────────────────────
router.get('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const {
      q,
      category, brand, stock_status,
      is_active = 'true',
      limit = '100', offset = '0',
    } = req.query;

    let query = supabaseAdmin
      .from('products')
      .select('id, sku, category, subcategory, brand, name, description, cost_nzd, default_margin_pct, unit, stock_status, qty_available, moq, availability_notes, available_from, website_category, image_url, datasheet_url, specs, needs_review, source, is_active, created_at, updated_at', { count: 'exact' })
      .order('updated_at', { ascending: false });

    if (is_active === 'true') query = query.eq('is_active', true);
    else if (is_active === 'false') query = query.eq('is_active', false);

    if (category)     query = query.eq('category', category);
    if (brand)        query = query.eq('brand', brand);
    if (stock_status) query = query.eq('stock_status', stock_status);

    if (q) {
      // simple ILIKE search across name + description + brand + sku
      query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%,brand.ilike.%${q}%,sku.ilike.%${q}%`);
    }

    const lim = Math.min(parseInt(limit) || 100, 500);
    const off = parseInt(offset) || 0;
    query = query.range(off, off + lim - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({
      products: (data || []).map(enrich),
      total: count ?? data?.length ?? 0,
      limit: lim,
      offset: off,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Distinct categories + brands for filter dropdowns ───────────────────────
router.get('/facets', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('category, brand, stock_status')
      .eq('is_active', true);
    if (error) throw error;

    const categories = [...new Set(data.map(r => r.category).filter(Boolean))].sort();
    const brands     = [...new Set(data.map(r => r.brand).filter(Boolean))].sort();
    const statuses   = [...new Set(data.map(r => r.stock_status).filter(Boolean))].sort();
    res.json({ categories, brands, stock_statuses: statuses });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Single product detail ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json(enrich(data));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Fields the UI is allowed to write — keeps id/created_at/updated_at safe
const WRITABLE = [
  'sku', 'category', 'subcategory', 'brand', 'name', 'description',
  'cost_nzd', 'default_margin_pct', 'unit',
  'stock_status', 'qty_available', 'moq', 'availability_notes', 'available_from',
  'website_category', 'image_url', 'datasheet_url', 'specs',
  'needs_review', 'is_active',
];
const pickWritable = (body) => {
  const out = {};
  for (const k of WRITABLE) if (k in body) out[k] = body[k];
  return out;
};

// ── Create ──────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const fields = pickWritable(req.body || {});
    if (!fields.name) return res.status(400).json({ error: 'name is required' });
    fields.source ??= 'manual';
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert(fields)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(enrich(data));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Update ──────────────────────────────────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const fields = pickWritable(req.body || {});
    if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const { data, error } = await supabaseAdmin
      .from('products')
      .update(fields)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(enrich(data));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Soft delete (sets is_active=false; preserves history) ───────────────────
router.delete('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('products')
      .update({ is_active: false })
      .eq('id', req.params.id)
      .select('id, is_active')
      .single();
    if (error) throw error;
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Bulk import from Excel (the products_merged.xlsx output of the merge script) ──
//
// Expected columns (case-insensitive, in any order):
//   sku, category, subcategory, brand, name, description,
//   cost_nzd, default_margin_pct, unit, stock_status,
//   qty_available, moq, availability_notes, available_from,
//   website_category, wattage_w, source, needs_review
//
// Behaviour:
//   - Rows WITH a SKU upsert by SKU (existing → update, new → insert).
//   - Rows WITHOUT a SKU always insert a new row (long-tail items).
//   - wattage_w (if present) goes into specs.wattage_w.
//   - Returns counts: { inserted, updated, skipped, errors }
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    if (!req.file)       return res.status(400).json({ error: 'No file uploaded (field name: file)' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheetName = wb.SheetNames.includes('products') ? 'products' : wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null });
    if (rows.length === 0) return res.status(400).json({ error: 'No rows in spreadsheet' });

    let inserted = 0, updated = 0, skipped = 0;
    const errors = [];

    for (const [i, row] of rows.entries()) {
      try {
        // Normalise keys to lowercase, trim values
        const r = {};
        for (const [k, v] of Object.entries(row)) {
          r[k.toString().trim().toLowerCase()] = typeof v === 'string' ? v.trim() : v;
        }

        if (!r.name) { skipped++; continue; }

        const specs = {};
        if (r.wattage_w != null && r.wattage_w !== '') specs.wattage_w = Number(r.wattage_w);

        const record = {
          sku:                r.sku || null,
          category:           r.category || null,
          subcategory:        r.subcategory || null,
          brand:              r.brand || null,
          name:               r.name,
          description:        r.description || null,
          cost_nzd:           r.cost_nzd != null && r.cost_nzd !== '' ? Number(r.cost_nzd) : null,
          default_margin_pct: r.default_margin_pct != null && r.default_margin_pct !== '' ? Number(r.default_margin_pct) : 30,
          unit:               r.unit || 'EA',
          stock_status:       r.stock_status || 'unknown',
          qty_available:      r.qty_available != null && r.qty_available !== '' ? parseInt(r.qty_available) : 0,
          moq:                r.moq != null && r.moq !== '' ? parseInt(r.moq) : 1,
          availability_notes: r.availability_notes || null,
          available_from:     r.available_from
                                ? (r.available_from instanceof Date
                                    ? r.available_from.toISOString().slice(0, 10)
                                    : String(r.available_from))
                                : null,
          website_category:   r.website_category || null,
          specs,
          needs_review:       r.needs_review || null,
          source:             r.source || 'import',
          is_active:          true,
        };

        if (record.sku) {
          // Upsert by SKU — existing row updated, otherwise inserted
          const { data: existing } = await supabaseAdmin
            .from('products')
            .select('id')
            .eq('sku', record.sku)
            .maybeSingle();
          if (existing) {
            const { error } = await supabaseAdmin
              .from('products')
              .update(record)
              .eq('id', existing.id);
            if (error) throw error;
            updated++;
          } else {
            const { error } = await supabaseAdmin
              .from('products')
              .insert(record);
            if (error) throw error;
            inserted++;
          }
        } else {
          // No SKU → match by exact name among other un-SKU'd rows so
          // re-imports are idempotent. Once an admin assigns a real SKU
          // through the UI, that row joins the SKU'd upsert path above.
          const { data: existing } = await supabaseAdmin
            .from('products')
            .select('id')
            .is('sku', null)
            .eq('name', record.name)
            .maybeSingle();
          if (existing) {
            const { error } = await supabaseAdmin
              .from('products')
              .update(record)
              .eq('id', existing.id);
            if (error) throw error;
            updated++;
          } else {
            const { error } = await supabaseAdmin.from('products').insert(record);
            if (error) throw error;
            inserted++;
          }
        }
      } catch (rowErr) {
        errors.push({ row: i + 2 /* +2 because row 1 is header in spreadsheet */, error: rowErr.message });
      }
    }

    res.json({ inserted, updated, skipped, errors, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

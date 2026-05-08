import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
const GST_RATE = 0.15;

// Helper: enrich a package with its items + computed totals.
// Computes from_price live from products + margins so re-importing the
// supplier price list ripples into package displays automatically.
async function enrichPackage(pkg, opts = { withItems: true }) {
  if (!pkg) return pkg;

  let items = [];
  if (opts.withItems) {
    const { data, error } = await supabaseAdmin
      .from('package_items')
      .select(`
        id, qty, position, notes, created_at,
        product:products (id, sku, name, brand, category, cost_nzd, default_margin_pct,
                          stock_status, qty_available, moq, available_from, image_url, specs, is_active)
      `)
      .eq('package_id', pkg.id)
      .order('position', { ascending: true });
    if (error) throw error;
    items = (data || []).map(it => {
      const p = it.product || {};
      const cost = parseFloat(p.cost_nzd) || 0;
      const margin = parseFloat(p.default_margin_pct) || 0;
      const unitSellExcl = +(cost * (1 + margin / 100)).toFixed(2);
      const unitSellIncl = +(unitSellExcl * (1 + GST_RATE)).toFixed(2);
      return {
        ...it,
        unit_sell_excl_gst: unitSellExcl,
        unit_sell_incl_gst: unitSellIncl,
        line_total_incl_gst: +(unitSellIncl * it.qty).toFixed(2),
      };
    });
  }

  // Computed price = sum of items' line totals; override wins if set
  const computedPrice = items.reduce((sum, it) => sum + (it.line_total_incl_gst || 0), 0);
  const fromPrice = pkg.from_price_override != null
    ? Number(pkg.from_price_override)
    : +computedPrice.toFixed(2);

  // Availability rolls up from items: backorder if any item is, with the
  // latest available_from across backordered items. Inactive products flag.
  let availability = 'in_stock';
  let availableFrom = null;
  let hasInactive = false;
  for (const it of items) {
    const p = it.product || {};
    if (p.is_active === false) hasInactive = true;
    if (p.stock_status === 'backorder') {
      availability = 'backorder';
      if (p.available_from && (!availableFrom || p.available_from > availableFrom)) {
        availableFrom = p.available_from;
      }
    } else if (p.stock_status === 'discontinued') {
      availability = 'discontinued';
    } else if (p.stock_status === 'unknown' && availability === 'in_stock') {
      availability = 'unknown';
    }
  }

  return {
    ...pkg,
    items,
    computed_price_incl_gst: +computedPrice.toFixed(2),
    from_price: fromPrice,
    availability,
    available_from: availableFrom,
    has_inactive_products: hasInactive,
  };
}

// ──────────── PUBLIC endpoints ────────────────────────────────────────────

// List active packages — no auth, used by /solar-packages public page.
router.get('/public', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('packages')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    const enriched = await Promise.all((data || []).map(p => enrichPackage(p, { withItems: true })));
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Single package by slug — no auth, used by /solar-packages/:slug detail page.
router.get('/public/:slug', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('packages')
      .select('*')
      .eq('slug', req.params.slug)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Package not found' });
    res.json(await enrichPackage(data, { withItems: true }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──────────── ADMIN endpoints (auth required) ─────────────────────────────
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { is_active = '' } = req.query;
    let query = supabaseAdmin.from('packages').select('*').order('sort_order').order('created_at');
    if (is_active === 'true')  query = query.eq('is_active', true);
    if (is_active === 'false') query = query.eq('is_active', false);
    const { data, error } = await query;
    if (error) throw error;
    const enriched = await Promise.all((data || []).map(p => enrichPackage(p, { withItems: true })));
    res.json(enriched);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('packages').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    res.json(await enrichPackage(data, { withItems: true }));
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

const WRITABLE = [
  'slug', 'name', 'tier', 'badge', 'description', 'long_description',
  'hero_image_url', 'system_kw', 'battery_kwh',
  'estimated_annual_savings', 'estimated_payback_years',
  'from_price_override', 'prefill', 'is_active', 'sort_order',
];
const pickWritable = (body) => {
  const out = {};
  for (const k of WRITABLE) if (k in (body || {})) out[k] = body[k];
  return out;
};

router.post('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const fields = pickWritable(req.body);
    if (!fields.slug || !fields.name)
      return res.status(400).json({ error: 'slug and name are required' });
    const { data, error } = await supabaseAdmin.from('packages').insert(fields).select().single();
    if (error) throw error;
    res.status(201).json(await enrichPackage(data, { withItems: false }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const fields = pickWritable(req.body);
    if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const { data, error } = await supabaseAdmin
      .from('packages').update(fields).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(await enrichPackage(data, { withItems: true }));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Soft delete (mirrors products pattern)
router.delete('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('packages').update({ is_active: false }).eq('id', req.params.id).select('id, is_active').single();
    if (error) throw error;
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Items management ─────────────────────────────────────────────────────
router.post('/:id/items', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const items = req.body?.items;
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'items array is required' });

    // Find current max position
    const { data: lastRow } = await supabaseAdmin
      .from('package_items').select('position')
      .eq('package_id', req.params.id)
      .order('position', { ascending: false }).limit(1).maybeSingle();
    let nextPos = (lastRow?.position ?? -1) + 1;

    const records = items.map(i => ({
      package_id: req.params.id,
      product_id: i.product_id,
      qty: Math.max(1, parseInt(i.qty) || 1),
      notes: i.notes || null,
      position: nextPos++,
    }));

    // upsert by composite to avoid breaking the unique index when re-adding the same product
    const { data, error } = await supabaseAdmin
      .from('package_items')
      .upsert(records, { onConflict: 'package_id,product_id' })
      .select();
    if (error) throw error;
    res.status(201).json({ items: data || [] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.patch('/:id/items/:itemId', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const fields = {};
    for (const k of ['qty', 'notes', 'position']) if (k in (req.body || {})) fields[k] = req.body[k];
    if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const { data, error } = await supabaseAdmin
      .from('package_items').update(fields)
      .eq('id', req.params.itemId).eq('package_id', req.params.id)
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { error } = await supabaseAdmin
      .from('package_items').delete()
      .eq('id', req.params.itemId).eq('package_id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;

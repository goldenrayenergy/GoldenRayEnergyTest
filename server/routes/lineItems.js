import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router({ mergeParams: true });
router.use(authenticate);

const GST_RATE = 0.15;

// Compute display prices on the fly from snapshotted cost + margin.
const enrich = (li) => {
  if (!li) return li;
  const cost = parseFloat(li.unit_cost_nzd) || 0;
  const margin = parseFloat(li.margin_pct) || 0;
  const unitSellExcl = +(cost * (1 + margin / 100)).toFixed(2);
  const unitSellIncl = +(unitSellExcl * (1 + GST_RATE)).toFixed(2);
  const lineTotalExcl = +(unitSellExcl * li.qty).toFixed(2);
  const lineTotalIncl = +(unitSellIncl * li.qty).toFixed(2);
  return {
    ...li,
    unit_sell_excl_gst: unitSellExcl,
    unit_sell_incl_gst: unitSellIncl,
    line_total_excl_gst: lineTotalExcl,
    line_total_incl_gst: lineTotalIncl,
  };
};

// Roll-up totals for a project, returned alongside the line items list
const totals = (items) => {
  let costSubtotal = 0, sellExcl = 0;
  for (const i of items) {
    costSubtotal += (parseFloat(i.unit_cost_nzd) || 0) * i.qty;
    sellExcl     += i.line_total_excl_gst;
  }
  costSubtotal = +costSubtotal.toFixed(2);
  sellExcl     = +sellExcl.toFixed(2);
  const gst        = +(sellExcl * GST_RATE).toFixed(2);
  const sellIncl   = +(sellExcl + gst).toFixed(2);
  return {
    cost_subtotal:    costSubtotal,
    sell_excl_gst:    sellExcl,
    gst,
    sell_incl_gst:    sellIncl,
    margin_dollars:   +(sellExcl - costSubtotal).toFixed(2),
    line_count:       items.length,
  };
};

// ── List line items for a project + roll-up totals ─────────────────────────
router.get('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('quote_line_items')
      .select('*')
      .eq('project_id', req.params.projectId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    const items = (data || []).map(enrich);
    res.json({ items, totals: totals(items) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Add line items in bulk (one or many at once from the picker) ───────────
// Body: { items: [{ product_id?, name, sku?, qty, notes? }, ...] }
//   - For product_id rows, snapshots cost + margin from the product table.
//   - For ad-hoc rows (no product_id), caller may supply unit_cost_nzd + margin_pct.
router.post('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const body = req.body?.items;
    if (!Array.isArray(body) || body.length === 0)
      return res.status(400).json({ error: 'items array is required' });

    // Pre-fetch the products being referenced so we can snapshot in one shot
    const productIds = [...new Set(body.map(i => i.product_id).filter(Boolean))];
    let productMap = new Map();
    if (productIds.length) {
      const { data: products, error: prodErr } = await supabaseAdmin
        .from('products')
        .select('id, sku, name, cost_nzd, default_margin_pct')
        .in('id', productIds);
      if (prodErr) throw prodErr;
      productMap = new Map((products || []).map(p => [p.id, p]));
    }

    // Find current max position so new lines append at the bottom
    const { data: lastRow } = await supabaseAdmin
      .from('quote_line_items')
      .select('position')
      .eq('project_id', req.params.projectId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    let nextPos = (lastRow?.position ?? -1) + 1;

    const records = body.map(i => {
      const p = i.product_id ? productMap.get(i.product_id) : null;
      return {
        project_id:     req.params.projectId,
        product_id:     i.product_id || null,
        name:           i.name        ?? p?.name ?? 'Untitled item',
        sku:            i.sku         ?? p?.sku  ?? null,
        unit_cost_nzd:  i.unit_cost_nzd ?? p?.cost_nzd ?? null,
        margin_pct:     i.margin_pct  ?? p?.default_margin_pct ?? 30,
        qty:            Math.max(1, parseInt(i.qty) || 1),
        notes:          i.notes || null,
        position:       nextPos++,
      };
    });

    const { data: inserted, error } = await supabaseAdmin
      .from('quote_line_items')
      .insert(records)
      .select();
    if (error) throw error;

    res.status(201).json({ items: (inserted || []).map(enrich) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Update a single line item ──────────────────────────────────────────────
const WRITABLE = ['name', 'sku', 'qty', 'unit_cost_nzd', 'margin_pct', 'notes', 'position'];
router.patch('/:itemId', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const fields = {};
    for (const k of WRITABLE) if (k in (req.body || {})) fields[k] = req.body[k];
    if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'No fields to update' });

    const { data, error } = await supabaseAdmin
      .from('quote_line_items')
      .update(fields)
      .eq('id', req.params.itemId)
      .eq('project_id', req.params.projectId)
      .select()
      .single();
    if (error) throw error;
    res.json(enrich(data));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Remove a line item ─────────────────────────────────────────────────────
router.delete('/:itemId', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { error } = await supabaseAdmin
      .from('quote_line_items')
      .delete()
      .eq('id', req.params.itemId)
      .eq('project_id', req.params.projectId);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;

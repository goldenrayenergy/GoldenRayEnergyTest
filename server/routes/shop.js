import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
const GST_RATE = 0.15;

// Compute display prices on the fly (same logic as products route)
const enrichProduct = (p) => {
  if (!p) return p;
  const cost = parseFloat(p.cost_nzd) || 0;
  const margin = parseFloat(p.default_margin_pct) || 0;
  const sellExcl = +(cost * (1 + margin / 100)).toFixed(2);
  const sellIncl = +(sellExcl * (1 + GST_RATE)).toFixed(2);
  return { ...p, sell_excl_gst: sellExcl, sell_incl_gst: sellIncl };
};

// ──────────── PUBLIC catalogue browse ────────────────────────────────────

// Fields exposed to the public — deliberately omits cost_nzd, margin etc.
// so we never leak our cost basis to customers via the JSON.
const PUBLIC_FIELDS =
  'id, sku, category, subcategory, brand, name, description, ' +
  'cost_nzd, default_margin_pct, ' +    // needed temporarily for enrich; stripped before send
  'unit, stock_status, qty_available, moq, availability_notes, available_from, ' +
  'website_category, image_url, datasheet_url, specs';

const stripCost = (p) => {
  if (!p) return p;
  const { cost_nzd, default_margin_pct, ...rest } = p;
  return rest;
};

router.get('/products', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { q, category, brand, stock_status, limit = '60', offset = '0' } = req.query;

    let query = supabaseAdmin
      .from('products')
      .select(PUBLIC_FIELDS, { count: 'exact' })
      .eq('is_active', true)
      .order('brand', { ascending: true })
      .order('name', { ascending: true });

    if (category)     query = query.eq('website_category', category);
    if (brand)        query = query.eq('brand', brand);
    if (stock_status) query = query.eq('stock_status', stock_status);
    if (q) query = query.or(`name.ilike.%${q}%,description.ilike.%${q}%,brand.ilike.%${q}%,sku.ilike.%${q}%`);

    const lim = Math.min(parseInt(limit) || 60, 200);
    const off = parseInt(offset) || 0;
    query = query.range(off, off + lim - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    res.json({
      products: (data || []).map(p => stripCost(enrichProduct(p))),
      total: count ?? 0,
      limit: lim,
      offset: off,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/products/:sku', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('products')
      .select(PUBLIC_FIELDS)
      .eq('sku', req.params.sku)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Product not found' });
    res.json(stripCost(enrichProduct(data)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Distinct facets for the shop's filter dropdowns
router.get('/facets', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('website_category, brand, stock_status')
      .eq('is_active', true);
    if (error) throw error;
    const categories = [...new Set(data.map(r => r.website_category).filter(Boolean))].sort();
    const brands     = [...new Set(data.map(r => r.brand).filter(Boolean))].sort();
    const statuses   = [...new Set(data.map(r => r.stock_status).filter(Boolean))].sort();
    res.json({ categories, brands, stock_statuses: statuses });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ──────────── PUBLIC: submit a Request-a-Quote ──────────────────────────
//
// Body: {
//   businessName, contactName, email, phone?, gstNumber?, deliveryAddress?, notes?,
//   items: [{ product_id, qty }, ...]   // server re-fetches product data + recomputes prices
// }
//
// Side-effects: trade_quote_requests row + contacts row + tasks row + activity feed entry.
router.post('/request-quote', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const body = req.body || {};
    const { businessName, contactName, email, phone, gstNumber, deliveryAddress, notes, items } = body;

    if (!businessName || !contactName || !email) {
      return res.status(400).json({ error: 'Business name, contact name, and email are required.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty — add products before requesting a quote.' });
    }

    // Re-fetch the products from DB so users can't tamper with prices via the request
    const productIds = [...new Set(items.map(i => i.product_id).filter(Boolean))];
    const { data: products, error: prodErr } = await supabaseAdmin
      .from('products')
      .select('id, sku, name, brand, cost_nzd, default_margin_pct, is_active')
      .in('id', productIds);
    if (prodErr) throw prodErr;
    const productMap = new Map((products || []).map(p => [p.id, p]));

    // Build snapshot items + roll-up totals
    let subtotalExcl = 0;
    const snap = items.map(i => {
      const p = productMap.get(i.product_id);
      if (!p || !p.is_active) return null;
      const qty = Math.max(1, parseInt(i.qty) || 1);
      const cost = parseFloat(p.cost_nzd) || 0;
      const margin = parseFloat(p.default_margin_pct) || 0;
      const unitSellExcl = +(cost * (1 + margin / 100)).toFixed(2);
      const unitSellIncl = +(unitSellExcl * (1 + GST_RATE)).toFixed(2);
      subtotalExcl += unitSellExcl * qty;
      return {
        product_id: p.id,
        sku: p.sku,
        name: p.name,
        brand: p.brand,
        qty,
        unit_cost_at_request: cost,
        unit_sell_excl_at_request: unitSellExcl,
        unit_sell_incl_at_request: unitSellIncl,
      };
    }).filter(Boolean);

    if (snap.length === 0) return res.status(400).json({ error: 'No valid products in cart.' });

    subtotalExcl = +subtotalExcl.toFixed(2);
    const gstAmount = +(subtotalExcl * GST_RATE).toFixed(2);
    const totalIncl = +(subtotalExcl + gstAmount).toFixed(2);

    // 1. Create or find the contact (electricians browse anonymously, we
    //    de-dupe by email so multiple requests from the same buyer collapse)
    let contactId = null;
    const { data: existingContact } = await supabaseAdmin
      .from('contacts').select('id').eq('email', email).maybeSingle();
    if (existingContact) {
      contactId = existingContact.id;
      await supabaseAdmin.from('contacts').update({
        last_activity: 'Trade quote request submitted',
        notes: businessName ? `Trade buyer: ${businessName}` : undefined,
      }).eq('id', contactId);
    } else {
      const { data: contact, error: cErr } = await supabaseAdmin.from('contacts').insert({
        name:           contactName,
        email,
        phone:          phone || null,
        type:           'commercial',
        system_type:    'on-grid',
        location:       deliveryAddress || null,
        stage:          'new',
        source:         'trade_shop',
        lead_source:    'other',
        lifecycle:      'subscriber',
        last_activity:  'Trade quote request submitted',
        notes:          `Trade buyer: ${businessName}${gstNumber ? ` · GST ${gstNumber}` : ''}`,
      }).select('id').single();
      if (cErr) throw cErr;
      contactId = contact.id;
    }

    // 2. Insert the quote request itself
    const { data: tqr, error: tqrErr } = await supabaseAdmin
      .from('trade_quote_requests')
      .insert({
        business_name:     businessName,
        contact_name:      contactName,
        email,
        phone:             phone || null,
        gst_number:        gstNumber || null,
        delivery_address:  deliveryAddress || null,
        notes:             notes || null,
        items:             snap,
        subtotal_excl_gst: subtotalExcl,
        gst_amount:        gstAmount,
        total_incl_gst:    totalIncl,
        contact_id:        contactId,
      })
      .select('id')
      .single();
    if (tqrErr) throw tqrErr;

    // 3. Sales follow-up task — high priority, due today
    await supabaseAdmin.from('tasks').insert({
      title:       `Trade quote request — ${businessName}`,
      description: `${snap.length} item${snap.length > 1 ? 's' : ''} · subtotal ${subtotalExcl.toLocaleString('en-NZ')} excl GST. Reply within 1 business day.`,
      contact_id:  contactId,
      due_date:    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      priority:    'high',
      status:      'todo',
      task_type:   'call',
      assignee_id: null,
    });

    // 4. Activity feed entry
    await supabaseAdmin.from('activities').insert({
      type:        'system',
      description: `Trade quote request: ${businessName} — ${snap.length} items, $${totalIncl.toLocaleString('en-NZ')} incl GST`,
      contact_id:  contactId,
      metadata: {
        trade_quote_request_id: tqr.id,
        item_count:    snap.length,
        total_incl_gst: totalIncl,
        source:        'trade_shop',
      },
    });

    res.status(201).json({ success: true, id: tqr.id, contact_id: contactId });
  } catch (e) {
    console.error('Trade quote request failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;

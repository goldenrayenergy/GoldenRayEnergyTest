import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(authenticate);

// List trade quote requests (newest first) for the sales inbox
router.get('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { status } = req.query;
    let query = supabaseAdmin
      .from('trade_quote_requests')
      .select('id, business_name, contact_name, email, phone, items, subtotal_excl_gst, gst_amount, total_incl_gst, status, contact_id, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Detail
router.get('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('trade_quote_requests')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(404).json({ error: e.message });
  }
});

// Update status (new → contacted → quoted → won/lost)
router.patch('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { status, notes } = req.body || {};
    const fields = {};
    if (status) fields.status = status;
    if (notes !== undefined) fields.notes = notes;
    if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'No fields to update' });
    const { data, error } = await supabaseAdmin
      .from('trade_quote_requests')
      .update(fields)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;

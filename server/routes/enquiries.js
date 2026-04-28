import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { calculateSolar } from '../services/calcService.js';

const router = Router();
router.use(authenticate);

const deriveSystemType = (e) => {
  if (e.installation_type === 'commercial') return 'on-grid';
  if (e.installation_type === 'off-grid')   return 'off-grid';
  if (e.installation_type === 'ppa')        return 'ppa';
  return e.battery_option === 'with-battery' ? 'hybrid' : 'on-grid';
};

// List — newest first, slim columns for the inbox table
router.get('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('website_enquiries')
      .select('id, created_at, first_name, last_name, email, phone, address, installation_type, battery_option, monthly_bill, system_size_kw, total_cost, monthly_savings, payback_years, roi_percent, lead_score, status')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Detail — returns raw row + a freshly-computed full calculation for display
router.get('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('website_enquiries')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;

    const calculation = data.monthly_bill
      ? calculateSolar({
          monthlyBill: data.monthly_bill,
          electricityRate: 0.32,
          systemType: deriveSystemType(data),
          batteryOption: data.battery_option,
        })
      : null;

    res.json({ enquiry: data, calculation });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update status (new → contacted → qualified → won / lost)
router.patch('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    const { data, error } = await supabaseAdmin
      .from('website_enquiries')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

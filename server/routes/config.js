import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/solar-pricing', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('system_config')
      .select('value')
      .eq('key', 'solar_pricing')
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json(data?.value || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/solar-pricing', authorize('admin'), async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('system_config')
      .update({ value: req.body, updated_by: req.user.id })
      .eq('key', 'solar_pricing');
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/pipeline-stages', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('pipeline_stages')
      .select('*')
      .eq('is_active', true)
      .order('sort_order');
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

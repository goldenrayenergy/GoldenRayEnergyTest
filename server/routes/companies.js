import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const { data: companies, error } = await supabaseAdmin
      .from('companies')
      .select(`*, owner:users!owner_id ( name )`)
      .order('name');
    if (error) throw error;

    // Get contact/deal counts per company
    const results = await Promise.all((companies || []).map(async (co) => {
      const [contacts, deals] = await Promise.all([
        supabaseAdmin.from('contacts').select('id', { count: 'exact', head: true }).eq('company_id', co.id),
        supabaseAdmin.from('deals').select('id, amount', { count: 'exact' }).eq('company_id', co.id),
      ]);
      return {
        ...co,
        owner_name: co.owner?.name || null,
        contact_count: contacts.count || 0,
        deal_count: deals.count || 0,
        total_deal_value: (deals.data || []).reduce((s, d) => s + Number(d.amount || 0), 0),
      };
    }));

    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('companies')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('companies')
      .insert(req.body)
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('companies')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('companies').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

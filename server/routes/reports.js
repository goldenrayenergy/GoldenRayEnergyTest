import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/dashboard', async (req, res) => {
  try {
    const [contactsRes, dealsRes, campaignsRes] = await Promise.all([
      supabaseAdmin.from('contacts').select('stage, estimated_value'),
      supabaseAdmin.from('deals').select('stage, amount, probability'),
      supabaseAdmin.from('campaigns').select('leads_generated, revenue_attributed, spent'),
    ]);

    const contacts = contactsRes.data || [];
    const deals = dealsRes.data || [];
    const campaigns = campaignsRes.data || [];

    // Aggregate contacts
    const totalContacts = contacts.length;
    const wonContacts = contacts.filter(c => c.stage === 'won').length;

    // Aggregate deals
    const wonRevenue = deals.filter(d => d.stage === 'closed_won').reduce((s, d) => s + Number(d.amount || 0), 0);
    const pipeline = deals.filter(d => !['closed_won', 'closed_lost'].includes(d.stage)).reduce((s, d) => s + Number(d.amount || 0), 0);

    // Pipeline breakdown
    const pipelineMap = {};
    deals.forEach(d => {
      if (!pipelineMap[d.stage]) pipelineMap[d.stage] = { stage: d.stage, count: 0, value: 0 };
      pipelineMap[d.stage].count++;
      pipelineMap[d.stage].value += Number(d.amount || 0);
    });

    // Sources
    const sourceMap = {};
    contacts.forEach(c => { const s = c.source || 'other'; sourceMap[s] = (sourceMap[s] || 0) + 1; });

    // Campaign totals
    const campTotals = {
      total: campaigns.length,
      leads: campaigns.reduce((s, c) => s + Number(c.leads_generated || 0), 0),
      revenue: campaigns.reduce((s, c) => s + Number(c.revenue_attributed || 0), 0),
      spent: campaigns.reduce((s, c) => s + Number(c.spent || 0), 0),
    };

    res.json({
      contacts: { total: totalContacts, won: wonContacts },
      deals: { total: deals.length, won_revenue: wonRevenue, pipeline },
      pipeline: Object.values(pipelineMap),
      sources: Object.entries(sourceMap).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
      campaigns: campTotals,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/team', async (req, res) => {
  try {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, name, role')
      .neq('role', 'admin')
      .eq('is_active', true);

    const results = await Promise.all((users || []).map(async (u) => {
      const { data: leads } = await supabaseAdmin
        .from('contacts')
        .select('stage, estimated_value')
        .eq('assigned_to', u.id);

      const total = (leads || []).length;
      const won = (leads || []).filter(l => l.stage === 'won');

      return {
        id: u.id,
        name: u.name,
        total_leads: total,
        won_leads: won.length,
        won_value: won.reduce((s, l) => s + Number(l.estimated_value || 0), 0),
      };
    }));

    res.json(results.sort((a, b) => b.won_value - a.won_value));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

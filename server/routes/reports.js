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

// At-risk projects feed for the dashboard banner. Surfaces:
//   - SLA-overdue first calls (lead came in >24h ago, still untouched in New)
//   - Stages aging beyond a threshold (stuck-in-stage)
//   - Sent proposals with no view
//   - Maintenance projects without a 6-month visit task on file
router.get('/at-risk', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const now = new Date();
    const sevenDaysAgo  = new Date(now.getTime() - 7  * 86400000).toISOString();
    const fiveDaysAgo   = new Date(now.getTime() - 5  * 86400000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString();

    // 1) SLA overdue: project in New, no first-call ticked, due time in the past
    const { data: sla } = await supabaseAdmin
      .from('projects')
      .select(`id, code, sla_first_call_due_at, owner_id, customer_id,
               contacts:customer_id ( name, email ),
               users:owner_id ( name )`)
      .eq('stage', 'new')
      .is('sub_status', null)
      .lt('sla_first_call_due_at', now.toISOString())
      .limit(50);
    const slaOverdue = (sla || []).filter(p => p.sla_first_call_due_at);

    // 2) Stuck in stage — not advanced for >7 days (Design / Selling) or
    //    >14 days (Installation). Tunable.
    const { data: stuck } = await supabaseAdmin
      .from('projects')
      .select(`id, code, stage, stage_entered_at, owner_id, customer_id,
               contacts:customer_id ( name ),
               users:owner_id ( name )`)
      .in('stage', ['design', 'selling', 'installation'])
      .is('sub_status', null)
      .lt('stage_entered_at', sevenDaysAgo)
      .limit(50);
    const stuckInStage = (stuck || []).filter(p => {
      if (p.stage === 'installation') return p.stage_entered_at < fourteenDaysAgo;
      return true;
    });

    // 3) Proposals sent >5 days ago, never viewed. Only include ones linked
    //    to a real project — otherwise the dashboard link goes nowhere.
    const { data: ghosted } = await supabaseAdmin
      .from('proposals')
      .select(`id, version, sent_at, project_id, contact:contacts!contact_id ( name )`)
      .eq('status', 'sent')
      .is('viewed_at', null)
      .not('project_id', 'is', null)
      .lt('sent_at', fiveDaysAgo)
      .limit(50);

    res.json({
      slaOverdue:     slaOverdue || [],
      stuckInStage:   stuckInStage || [],
      ghostedProposals: ghosted || [],
      generatedAt: now.toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Per-user "today's queue" + team workload for the dashboard widgets.
// One round-trip; queries are intentionally narrow to stay free-tier-cheap.
router.get('/dashboard-extras', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    // Today's queue: tasks due today, assigned to the current user, still todo
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay   = new Date(); endOfDay.setHours(23, 59, 59, 999);

    const todaysQueueP = supabaseAdmin
      .from('tasks')
      .select(`id, title, description, task_type, priority, due_date, status, project_id, contact_id,
               project:projects!project_id ( id, code, contacts:customer_id ( name ) ),
               contact:contacts!contact_id ( id, name )`)
      .eq('assignee_id', req.user.id)
      .eq('status', 'todo')
      .lte('due_date', endOfDay.toISOString().slice(0, 10))
      .order('priority', { ascending: false })
      .order('due_date', { ascending: true })
      .limit(50);

    // Team workload: projects grouped by owner + stage. Only count active
    // projects (sub_status null) so paused/lost don't inflate workload.
    const workloadP = supabaseAdmin
      .from('projects')
      .select('owner_id, stage, owner:users!owner_id ( id, name, role )')
      .is('sub_status', null)
      .not('owner_id', 'is', null)
      .not('stage', 'eq', 'exit');

    const [todaysQueueRes, workloadRes] = await Promise.all([todaysQueueP, workloadP]);

    // Roll up workload: { user_id, name, stages: {new: 3, design: 1, ...}, total }
    const grouped = {};
    (workloadRes.data || []).forEach(p => {
      if (!p.owner_id || !p.owner) return;
      const role = p.owner.role;
      if (role !== 'sales_exec' && role !== 'sales_mgr') return;
      const k = p.owner_id;
      if (!grouped[k]) grouped[k] = { id: k, name: p.owner.name, role, stages: {}, total: 0 };
      grouped[k].stages[p.stage] = (grouped[k].stages[p.stage] || 0) + 1;
      grouped[k].total += 1;
    });
    const teamWorkload = Object.values(grouped).sort((a, b) => b.total - a.total);

    res.json({
      todaysQueue: todaysQueueRes.data || [],
      teamWorkload,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lightweight counts for sidebar badges. Called frequently — kept tiny.
router.get('/sidebar-counts', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const now = new Date().toISOString();
    const sevenDaysAgo  = new Date(Date.now() - 7  * 86400000).toISOString();
    const fiveDaysAgo   = new Date(Date.now() - 5  * 86400000).toISOString();

    // Pending override requests — admins see all, others see only theirs
    let overrideQ = supabaseAdmin
      .from('override_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (req.user?.role !== 'admin') overrideQ = overrideQ.eq('requested_by', req.user.id);
    const { count: pendingOverrides } = await overrideQ;

    // At-risk: SLA overdue + stuck in stage + ghosted proposals (linked only)
    const [slaRes, stuckRes, ghostedRes] = await Promise.all([
      supabaseAdmin.from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('stage', 'new').is('sub_status', null).lt('sla_first_call_due_at', now),
      supabaseAdmin.from('projects')
        .select('id', { count: 'exact', head: true })
        .in('stage', ['design', 'selling']).is('sub_status', null).lt('stage_entered_at', sevenDaysAgo),
      supabaseAdmin.from('proposals')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'sent').is('viewed_at', null).not('project_id', 'is', null).lt('sent_at', fiveDaysAgo),
    ]);

    res.json({
      pendingOverrides: pendingOverrides || 0,
      atRisk: (slaRes.count || 0) + (stuckRes.count || 0) + (ghostedRes.count || 0),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

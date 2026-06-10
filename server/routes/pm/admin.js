// ────────────────────────────────────────────────────────────────────────────
// PM Tool — Admin config endpoints.
//   GET  /api/pm/admin/settings         → current company_settings (single row)
//   PATCH /api/pm/admin/settings        → update company_settings
//
//   GET  /api/pm/admin/financing        → list financing_options (active first)
//   POST /api/pm/admin/financing        → add option
//   PATCH /api/pm/admin/financing/:id   → update option
//   DELETE /api/pm/admin/financing/:id  → soft-delete (sets is_active=false)
//
//   GET  /api/pm/admin/terms            → list proposal_terms versions
//   GET  /api/pm/admin/terms/current    → current version only
//   POST /api/pm/admin/terms            → add new version (auto-flips is_current)
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';

const router = Router();
router.use(authenticate);

// ── company_settings ──────────────────────────────────────────────────────
router.get('/settings', async (_req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin.from('company_settings').select('*').eq('id', 1).single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/settings', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const allowed = [
      'legal_name','trading_name','contact_phone','contact_email','support_phone',
      'bank_account_name','bank_account_number','bank_name','bank_reference_template',
      'signer_name','signer_title','signer_email','logo_url',
      'crew_capacity_per_week','proposal_validity_days_stage1','proposal_validity_days_stage2',
      'default_deposit_pct','default_progress_pct',
      'faq_json','why_us_json','closing_statement','email_from_address',
    ];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No valid fields' });
    const { data, error } = await supabaseAdmin
      .from('company_settings').update(patch).eq('id', 1).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── financing_options ─────────────────────────────────────────────────────
router.get('/financing', async (_req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('financing_options')
      .select('*')
      .order('is_active', { ascending: false })
      .order('display_order', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/financing', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const fields = ['name','bank','base_rate_pct','promo_rate_pct','promo_years',
                    'term_years','max_amount_nzd','notes','is_active','display_order'];
    const insert = {};
    for (const k of fields) if (k in req.body) insert[k] = req.body[k];
    if (!insert.name) return res.status(400).json({ error: 'name required' });
    const { data, error } = await supabaseAdmin.from('financing_options').insert(insert).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/financing/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const fields = ['name','bank','base_rate_pct','promo_rate_pct','promo_years',
                    'term_years','max_amount_nzd','notes','is_active','display_order'];
    const patch = {};
    for (const k of fields) if (k in req.body) patch[k] = req.body[k];
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No valid fields' });
    const { data, error } = await supabaseAdmin
      .from('financing_options').update(patch).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/financing/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { error } = await supabaseAdmin
      .from('financing_options').update({ is_active: false }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── proposal_terms ────────────────────────────────────────────────────────
router.get('/terms', async (_req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('proposal_terms')
      .select('*')
      .order('effective_from', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/terms/current', async (_req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('proposal_terms').select('*').eq('is_current', true).single();
    if (error && error.code !== 'PGRST116') throw error;
    res.json(data || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/terms', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { version, effective_from, terms_json, notes } = req.body;
    if (!version || !effective_from || !terms_json) {
      return res.status(400).json({ error: 'version, effective_from, terms_json required' });
    }
    // Flip current to false on existing rows
    await supabaseAdmin.from('proposal_terms').update({ is_current: false }).eq('is_current', true);
    // Insert new version as current
    const { data, error } = await supabaseAdmin.from('proposal_terms').insert({
      version, effective_from, terms_json, notes, is_current: true,
      created_by: req.user?.id || null,
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── labour_rates ──────────────────────────────────────────────────────────
//   GET    /api/pm/admin/labour-rates       → list all (active first)
//   POST   /api/pm/admin/labour-rates       → add rate
//   PATCH  /api/pm/admin/labour-rates/:id   → update rate
//   DELETE /api/pm/admin/labour-rates/:id   → soft-delete (is_active=false)
//   GET    /api/pm/admin/labour-rates/match → preview rates that match a system
//                                            ?system_kw=10.45&has_battery=true
router.get('/labour-rates', async (_req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('labour_rates')
      .select('*')
      .order('is_active', { ascending: false })
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/labour-rates/match', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const systemKw = parseFloat(req.query.system_kw);
    if (!isFinite(systemKw)) return res.status(400).json({ error: 'system_kw is required' });
    const hasBattery = req.query.has_battery === 'true';

    const { data, error } = await supabaseAdmin
      .from('labour_rates').select('*').eq('is_active', true);
    if (error) throw error;

    const matched = data.filter(r =>
      (r.applies_to_kw_min == null || systemKw >= r.applies_to_kw_min) &&
      (r.applies_to_kw_max == null || systemKw <= r.applies_to_kw_max) &&
      (r.requires_battery  == null || r.requires_battery === hasBattery)
    );
    const total = matched.reduce((s, r) => s + Number(r.amount_nzd || 0), 0);
    res.json({ system_kw: systemKw, has_battery: hasBattery, total_nzd: +total.toFixed(2), matched });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/labour-rates', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { code, name, category, applies_to_kw_min, applies_to_kw_max,
            requires_battery, amount_nzd, notes, sort_order } = req.body;
    if (!code || !name || !category || amount_nzd == null) {
      return res.status(400).json({ error: 'code, name, category, amount_nzd required' });
    }
    const { data, error } = await supabaseAdmin.from('labour_rates').insert({
      code, name, category,
      applies_to_kw_min: applies_to_kw_min ?? null,
      applies_to_kw_max: applies_to_kw_max ?? null,
      requires_battery:  requires_battery  ?? null,
      amount_nzd, notes: notes ?? null,
      sort_order: sort_order ?? 0,
      updated_by: req.user?.id || null,
    }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/labour-rates/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const fields = ['code','name','category','applies_to_kw_min','applies_to_kw_max',
                    'requires_battery','amount_nzd','notes','sort_order','is_active'];
    const patch = {};
    for (const k of fields) if (k in req.body) patch[k] = req.body[k];
    if (!Object.keys(patch).length) return res.status(400).json({ error: 'No valid fields' });
    patch.updated_by = req.user?.id || null;
    const { data, error } = await supabaseAdmin
      .from('labour_rates').update(patch).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/labour-rates/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { error } = await supabaseAdmin
      .from('labour_rates').update({ is_active: false }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

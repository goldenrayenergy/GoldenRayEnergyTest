import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// ── Public: submit finance application ────────────────────────────────
// Mirrors the data flow of the website quote form: writes to
// finance_applications + contacts + activities so leads land in the CRM.
router.post('/apply', async (req, res) => {
  try {
    const f = req.body || {};
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    if (!f.firstName && !f.lastName && !f.email && !f.phone)
      return res.status(400).json({ error: 'Please provide at least a name, email, or phone number.' });
    if (!f.product)     return res.status(400).json({ error: 'Please choose a finance product.' });
    if (!f.loanAmount)  return res.status(400).json({ error: 'Please enter how much you want to finance.' });

    const fullName = [f.firstName, f.lastName].filter(Boolean).join(' ').trim() || 'Finance Applicant';

    // ── 1. Create a CRM contact so this lead appears in the employee portal ──
    let contactId = null;
    try {
      const { data: contact, error: cErr } = await supabaseAdmin
        .from('contacts')
        .insert({
          name:            fullName,
          email:           f.email || null,
          phone:           f.phone || null,
          location:        f.address || null,
          type:            'residential',
          system_type:     'on-grid',
          stage:           'new',
          source:          'website_finance',
          lifecycle:       'lead',
          estimated_value: Number(f.loanAmount) || null,
          lead_score:      70,
          last_activity:   `Finance application — ${f.product}`,
          notes:           `Finance enquiry: ${f.product}, $${Number(f.loanAmount).toLocaleString()} over ${f.termYears || 5}yr`,
        })
        .select('id')
        .single();
      if (cErr) console.warn('Contact mirror failed:', cErr.message);
      else contactId = contact.id;
    } catch (e) { console.warn('Contact mirror error:', e.message); }

    // ── 2. Save finance application ──────────────────────────────────────
    const { data: app, error } = await supabaseAdmin
      .from('finance_applications')
      .insert({
        first_name:          f.firstName || null,
        last_name:           f.lastName  || null,
        email:               f.email     || null,
        phone:               f.phone     || null,
        address:             f.address   || null,
        product:             f.product,
        loan_amount:         Number(f.loanAmount),
        term_years:          Number(f.termYears) || 5,
        estimated_monthly:   f.estimatedMonthly != null ? Number(f.estimatedMonthly) : null,
        home_ownership:      f.homeOwnership     || null,
        monthly_income_band: f.monthlyIncomeBand || null,
        employment_type:     f.employmentType    || null,
        existing_bank:       f.existingBank      || null,
        credit_consent:      !!f.creditConsent,
        contact_id:          contactId,
        status:              'submitted',
        notes:               f.notes || null,
      })
      .select('id, created_at, status')
      .single();
    if (error) throw error;

    // ── 3. Log activity for dashboard Recent Activity feed ──────────────
    try {
      await supabaseAdmin.from('activities').insert({
        type:        'system',
        description: `Finance application — ${fullName} — ${f.product} — $${Number(f.loanAmount).toLocaleString()}`,
        contact_id:  contactId,
        metadata: {
          finance_application_id: app.id,
          product:                f.product,
          loan_amount:            f.loanAmount,
          term_years:             f.termYears,
          estimated_monthly:      f.estimatedMonthly,
          source:                 'website_finance_form',
        },
      });
    } catch (e) { console.warn('Activity log failed:', e.message); }

    res.status(201).json({ success: true, id: app.id, contact_id: contactId, status: app.status });
  } catch (e) {
    console.error('Finance apply error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Authenticated endpoints below (employee portal) ───────────────────
router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    let q = supabaseAdmin
      .from('finance_applications')
      .select(`*, contact:contacts!contact_id ( name, email, phone ), assignee:users!assigned_to ( name )`)
      .order('created_at', { ascending: false });

    if (req.query.status)  q = q.eq('status', req.query.status);
    if (req.query.product) q = q.eq('product', req.query.product);

    const { data, error } = await q;
    if (error) throw error;
    res.json((data || []).map(a => ({
      ...a,
      contact_name: a.contact?.name || null,
      assignee_name: a.assignee?.name || null,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('finance_applications').select('*').eq('id', req.params.id).single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('finance_applications').update(req.body).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('finance_applications').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

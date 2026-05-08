import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { generateProposalPDF } from '../services/pdfService.js';
import { sendQuoteEmail } from '../services/emailService.js';
import { calculateSolar } from '../services/calcService.js';
import { uploadProposalPDF } from '../services/storageService.js';

const router = Router();
router.use(authenticate);

// Fetch the project's line items so the PDF can include a Bill of Materials.
// Returns [] for proposals without a project_id (legacy / standalone) so the
// PDF cleanly falls back to the bag-of-numbers summary.
async function fetchLineItems(projectId) {
  if (!projectId) return [];
  const { data } = await supabaseAdmin
    .from('quote_line_items')
    .select('id, name, sku, qty, unit_cost_nzd, margin_pct, position')
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  return data || [];
}

// Public: solar calc helper (already used by the quote calculator)
router.post('/calculate', async (req, res) => {
  try { res.json(calculateSolar(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// List proposals for a project — used by both Online + PDF Proposal tabs
router.get('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    let q = supabaseAdmin
      .from('proposals')
      .select(`*, contact:contacts!contact_id ( id, name, email, phone, location )`)
      .order('created_at', { ascending: false });
    if (req.query.project_id) q = q.eq('project_id', req.query.project_id);
    if (req.query.contact_id) q = q.eq('contact_id', req.query.contact_id);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generate a new proposal record. If the request includes a project_id,
// pull the project's customer + system specs and create a proposal scoped to it.
router.post('/generate', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    let { project_id, contact_id, deal_id, ...overrides } = req.body || {};

    // If we got a project_id, look up its data and use it as the source.
    let project = null;
    if (project_id) {
      const { data, error } = await supabaseAdmin
        .from('projects')
        .select('*, contacts:customer_id ( id, name, email, monthly_bill )')
        .eq('id', project_id)
        .single();
      if (error || !data) return res.status(404).json({ error: 'Project not found' });
      project = data;
      contact_id = data.customer_id || contact_id;
    }

    // Build calculator inputs — prefer project specs, fall back to body.
    const calcInput = {
      monthlyBill:    project?.contacts?.monthly_bill || overrides.monthlyBill || 300,
      systemType:     project?.system_type || overrides.systemType || 'on-grid',
      batteryOption:  (project?.battery_kwh > 0 || overrides.batteryOption === 'with-battery') ? 'with-battery' : 'without-battery',
      electricityRate: overrides.electricityRate || 0.32,
    };
    const calc = calculateSolar(calcInput);

    // Bump version if a previous proposal exists for this project.
    let version = 1;
    if (project_id) {
      const { count } = await supabaseAdmin
        .from('proposals')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project_id);
      version = (count || 0) + 1;
    }

    // Mode: a proposal can only be "final" if a site visit has been completed
    // on the parent project. Otherwise it's "preliminary" and the UI/PDF
    // explicitly label it as such so the customer doesn't lock in an estimate
    // that may shift after site survey.
    const mode = (project?.site_visit_done_at) ? 'final' : 'preliminary';

    const { data, error } = await supabaseAdmin
      .from('proposals')
      .insert({
        project_id:      project_id || null,
        contact_id:      contact_id || null,
        deal_id:         deal_id || null,
        version,
        mode,
        system_size_kw:  calc.systemSize,
        panel_count:     calc.panels,
        battery_kwh:     calc.batteryKwh,
        total_cost:      calc.totalCost,
        monthly_savings: calc.monthlySavings,
        annual_savings:  calc.annualSavings,
        payback_years:   calc.paybackYears,
        roi_percent:     calc.roi,
        co2_tons_year:   calc.co2TonsYear,
        status:          'draft',
      })
      .select()
      .single();
    if (error) throw error;

    // Activity feed entry
    await supabaseAdmin.from('activities').insert({
      type:        'system',
      description: `Proposal v${version} generated (${mode}) — ${calc.systemSize} kW · $${Math.round(calc.totalCost).toLocaleString()}`,
      project_id:  project_id || null,
      contact_id:  contact_id || null,
      user_id:     req.user?.id || null,
      metadata:    { proposal_id: data.id, version, mode, calc },
    });

    // Generating a proposal satisfies the design.system checklist item. We
    // auto-tick it so the rep doesn't have to do it manually. The stage move
    // is no longer auto-fired — the client watches checklist completion and
    // shows an acknowledgment modal once all 4 design items are ticked.
    if (project_id) {
      try {
        const currentProgress = project?.stage_progress || {};
        if (!currentProgress['design.system']) {
          await supabaseAdmin
            .from('projects')
            .update({ stage_progress: { ...currentProgress, 'design.system': true } })
            .eq('id', project_id);
        }
      } catch (e) {
        console.error('Auto-tick design.system failed (non-fatal):', e.message);
      }
    }

    res.status(201).json({ proposal: data, calculation: calc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// View a single proposal — also marks viewed_at on first read.
router.get('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .select(`*, contact:contacts!contact_id ( name, email, phone, location )`)
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    if (data && !data.viewed_at) {
      await supabaseAdmin
        .from('proposals')
        .update({ viewed_at: new Date().toISOString(), status: data.status === 'sent' ? 'viewed' : data.status })
        .eq('id', req.params.id);
    }
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generate (and download) PDF for a proposal
router.post('/:id/pdf', async (req, res) => {
  try {
    const { data: proposal, error } = await supabaseAdmin
      .from('proposals')
      .select(`*, contact:contacts!contact_id ( name, email, location )`)
      .eq('id', req.params.id)
      .single();
    if (error || !proposal) return res.status(404).json({ error: 'Proposal not found' });

    const lineItems = await fetchLineItems(proposal.project_id);
    const flat = { ...proposal, name: proposal.contact?.name, email: proposal.contact?.email, location: proposal.contact?.location, lineItems };
    const pdfBuffer = await generateProposalPDF(flat);

    const fileName = `quote-${(flat.name || 'customer').replace(/\s+/g, '-')}-v${proposal.version || 1}-${Date.now()}.pdf`;
    const publicUrl = await uploadProposalPDF(fileName, pdfBuffer);
    if (publicUrl) {
      await supabaseAdmin.from('proposals').update({ pdf_url: publicUrl }).eq('id', req.params.id);
    }

    // Generating the PDF satisfies the selling.proposal_pdf checklist item.
    // The online_link item is also implicitly satisfied — every proposal has
    // a shareable in-app preview as soon as it's generated.
    if (proposal.project_id) {
      try {
        const { data: parent } = await supabaseAdmin
          .from('projects')
          .select('stage, stage_progress')
          .eq('id', proposal.project_id)
          .single();
        if (parent?.stage === 'selling') {
          const next = { ...(parent.stage_progress || {}) };
          next['selling.proposal_pdf'] = true;
          next['selling.online_link']  = true;
          await supabaseAdmin
            .from('projects')
            .update({ stage_progress: next })
            .eq('id', proposal.project_id);
        }
      } catch (e) {
        console.error('Auto-tick selling checklist failed (non-fatal):', e.message);
      }
    }

    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fileName}"` });
    res.send(pdfBuffer);
  } catch (e) {
    console.error('PDF generation failed:', e.message);
    res.status(500).json({ error: 'PDF generation failed: ' + e.message });
  }
});

// Email the PDF to the customer. Builds the PDF on the fly so the email
// always carries the current proposal contents.
router.post('/:id/send', async (req, res) => {
  try {
    const { data: proposal, error } = await supabaseAdmin
      .from('proposals')
      .select(`*, contact:contacts!contact_id ( name, email, phone )`)
      .eq('id', req.params.id)
      .single();
    if (error || !proposal) return res.status(404).json({ error: 'Proposal not found' });

    const customer = proposal.contact || {};
    if (!customer.email) return res.status(400).json({ error: 'Customer has no email on file.' });

    // Generate the PDF
    const lineItems = await fetchLineItems(proposal.project_id);
    const flat = { ...proposal, name: customer.name, email: customer.email, lineItems };
    let pdfBuffer = null;
    try {
      pdfBuffer = await generateProposalPDF(flat);
    } catch (e) {
      console.error('PDF generation failed during send:', e.message);
      return res.status(500).json({ error: 'PDF generation failed — email not sent. ' + e.message });
    }

    // Send via Resend (dev mode redirects to test mailbox automatically)
    const calc = {
      systemSize:      proposal.system_size_kw,
      panels:          proposal.panel_count,
      totalCost:       proposal.total_cost,
      annualSavings:   proposal.annual_savings,
      paybackYears:    proposal.payback_years,
      lifetimeSavings: (proposal.annual_savings || 0) * 25,
    };
    const fileName = `${(customer.name || 'customer').replace(/\s+/g, '-')}-Proposal-v${proposal.version || 1}.pdf`;
    await sendQuoteEmail(customer, calc, pdfBuffer, fileName);

    await supabaseAdmin
      .from('proposals')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', req.params.id);

    // Sending the proposal by email satisfies the selling.send_email
    // checklist item. Auto-tick it for the project.
    if (proposal.project_id) {
      try {
        const { data: parent } = await supabaseAdmin
          .from('projects')
          .select('stage, stage_progress')
          .eq('id', proposal.project_id)
          .single();
        if (parent?.stage === 'selling') {
          const next = { ...(parent.stage_progress || {}), 'selling.send_email': true };
          await supabaseAdmin
            .from('projects')
            .update({ stage_progress: next })
            .eq('id', proposal.project_id);
        }
      } catch (e) {
        console.error('Auto-tick selling.send_email failed (non-fatal):', e.message);
      }
    }

    await supabaseAdmin.from('activities').insert({
      type:        'email',
      description: `Proposal v${proposal.version || 1} emailed to ${customer.email}`,
      project_id:  proposal.project_id || null,
      contact_id:  proposal.contact_id || null,
      user_id:     req.user?.id || null,
      metadata:    { proposal_id: proposal.id, version: proposal.version || 1 },
    });

    res.json({ success: true, message: `Proposal sent (dev mode redirects to test mailbox).` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Trigger 3: customer accepted the proposal. Marks the proposal accepted and
// (if the parent project is still in Selling) advances it to Installation +
// seeds 5 starter tasks. Gated by the selling-stage checklist — non-admins
// must complete proposal_pdf, online_link, send_email, followup before they
// can accept. Admins may override via { override: true } in the request body.
const SELLING_REQUIRED = ['selling.proposal_pdf', 'selling.online_link', 'selling.send_email', 'selling.followup'];
const SELLING_LABELS = {
  'selling.proposal_pdf': 'Generate proposal PDF',
  'selling.online_link':  'Share online proposal link',
  'selling.send_email':   'Send proposal by email',
  'selling.followup':     'Schedule follow-up call',
};

router.post('/:id/accept', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    // Load the proposal + parent project + customer in one round trip
    const { data: proposal, error } = await supabaseAdmin
      .from('proposals')
      .select(`*, contact:contacts!contact_id ( name, email )`)
      .eq('id', req.params.id)
      .single();
    if (error || !proposal) return res.status(404).json({ error: 'Proposal not found' });
    if (proposal.status === 'accepted') {
      return res.status(409).json({ error: 'Proposal is already accepted.' });
    }

    // Gate: if linked to a project in Selling stage, the selling checklist
    // must be complete unless the caller is an admin who passed override.
    if (proposal.project_id) {
      const { data: parent } = await supabaseAdmin
        .from('projects')
        .select('stage, stage_progress')
        .eq('id', proposal.project_id)
        .single();
      if (parent?.stage === 'selling') {
        const progress = parent.stage_progress || {};
        const missingIds = SELLING_REQUIRED.filter(id => progress[id] !== true);
        const isAdmin = req.user?.role === 'admin';
        if (missingIds.length > 0 && !(isAdmin && req.body?.override)) {
          return res.status(409).json({
            error: 'Selling-stage checklist is incomplete. Complete the items below before accepting, or ask an admin to force-accept.',
            missing: missingIds.map(id => ({ id, label: SELLING_LABELS[id] })),
            requires_override: true,
          });
        }
      }
    }

    // Mark the proposal accepted
    await supabaseAdmin
      .from('proposals')
      .update({ status: 'accepted' })
      .eq('id', req.params.id);

    // Activity entry for the acceptance itself. Suffix and metadata note
    // when an admin force-accepted past missing checklist items.
    const overrideUsed = !!req.body?.override && req.user?.role === 'admin';
    await supabaseAdmin.from('activities').insert({
      type:        'system',
      description: `Proposal v${proposal.version || 1} accepted by customer${overrideUsed ? ' (admin override)' : ''}`,
      project_id:  proposal.project_id || null,
      contact_id:  proposal.contact_id || null,
      user_id:     req.user?.id || null,
      metadata:    { proposal_id: proposal.id, version: proposal.version || 1, override: overrideUsed },
    });

    // If linked to a project that's still in Selling, auto-advance to Installation
    let advancedTo = null;
    if (proposal.project_id) {
      const { data: project } = await supabaseAdmin
        .from('projects')
        .select('stage, stage_progress, owner_id, customer_id, code')
        .eq('id', proposal.project_id)
        .single();

      if (project && project.stage === 'selling') {
        // Selling checklist items intentionally NOT bypassed here — the
        // gate above already ensured they're complete (or admin override
        // is logged). Preserving the un-ticked state on override is useful
        // for compliance audits later.
        await supabaseAdmin
          .from('projects')
          .update({
            stage: 'installation',
            stage_entered_at: new Date().toISOString(),
          })
          .eq('id', proposal.project_id);

        await supabaseAdmin.from('activities').insert({
          type:        'system',
          description: `Project stage changed to installation${overrideUsed ? ' (admin override)' : ''}`,
          project_id:  proposal.project_id,
          contact_id:  proposal.contact_id || null,
          user_id:     req.user?.id || null,
          metadata:    { trigger: 'proposal_accepted', from_stage: 'selling', to_stage: 'installation', override: overrideUsed },
        });

        // Seed 5 starter tasks aligned with the installation checklist
        const dueDate = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
        const customerName = project ? (proposal.contact?.name || 'customer') : 'customer';
        const starterTasks = [
          { title: `Confirm deposit received — ${project.code}`,         desc: 'Verify the deposit invoice is paid before scheduling the install.', due: 3,  priority: 'high' },
          { title: `Schedule installation — ${project.code}`,            desc: `Call ${customerName} to confirm an install date.`,                  due: 5,  priority: 'high' },
          { title: `Assign install crew lead — ${project.code}`,         desc: 'Pick the crew lead and confirm availability for the install date.', due: 7,  priority: 'medium' },
          { title: `Generate single-line diagram — ${project.code}`,     desc: 'Produce SLD for council consent and electrical inspector.',         due: 10, priority: 'medium' },
          { title: `Order panels + inverter — ${project.code}`,          desc: 'Place supplier order matching proposal spec.',                       due: 12, priority: 'medium' },
        ];
        await supabaseAdmin.from('tasks').insert(starterTasks.map(t => ({
          title:       t.title,
          description: t.desc,
          assignee_id: project.owner_id || null,
          contact_id:  project.customer_id || null,
          project_id:  proposal.project_id,
          due_date:    dueDate(t.due),
          priority:    t.priority,
          status:      'todo',
          task_type:   'admin',
        })));

        advancedTo = 'installation';
      }
    }

    res.json({
      success: true,
      proposal_id: proposal.id,
      project_advanced_to: advancedTo,
      message: advancedTo
        ? `Proposal accepted. Project advanced to Installation with 5 starter tasks created.`
        : `Proposal accepted.`,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

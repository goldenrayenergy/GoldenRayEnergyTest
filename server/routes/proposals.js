import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { generateProposalPDF } from '../services/pdfService.js';
import { sendQuoteEmail } from '../services/emailService.js';
import { calculateSolar } from '../services/calcService.js';
import { uploadProposalPDF } from '../services/storageService.js';

const router = Router();
router.use(authenticate);

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

    const { data, error } = await supabaseAdmin
      .from('proposals')
      .insert({
        project_id:      project_id || null,
        contact_id:      contact_id || null,
        deal_id:         deal_id || null,
        version,
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
      description: `Proposal v${version} generated — ${calc.systemSize} kW · $${Math.round(calc.totalCost).toLocaleString()}`,
      project_id:  project_id || null,
      contact_id:  contact_id || null,
      user_id:     req.user?.id || null,
      metadata:    { proposal_id: data.id, version, calc },
    });

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

    const flat = { ...proposal, name: proposal.contact?.name, email: proposal.contact?.email, location: proposal.contact?.location };
    const pdfBuffer = await generateProposalPDF(flat);

    const fileName = `quote-${(flat.name || 'customer').replace(/\s+/g, '-')}-v${proposal.version || 1}-${Date.now()}.pdf`;
    const publicUrl = await uploadProposalPDF(fileName, pdfBuffer);
    if (publicUrl) {
      await supabaseAdmin.from('proposals').update({ pdf_url: publicUrl }).eq('id', req.params.id);
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
    const flat = { ...proposal, name: customer.name, email: customer.email };
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

export default router;

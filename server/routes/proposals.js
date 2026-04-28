import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { generateProposalPDF } from '../services/pdfService.js';
import { sendProposalEmail } from '../services/emailService.js';
import { calculateSolar } from '../services/calcService.js';
import { uploadProposalPDF } from '../services/storageService.js';

const router = Router();
router.use(authenticate);

router.post('/calculate', async (req, res) => {
  try { res.json(calculateSolar(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/generate', async (req, res) => {
  try {
    const calc = calculateSolar(req.body);
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .insert({
        contact_id: req.body.contact_id,
        deal_id: req.body.deal_id || null,
        system_size_kw: calc.systemSize,
        panel_count: calc.panels,
        battery_kwh: calc.batteryKwh,
        total_cost: calc.totalCost,
        monthly_savings: calc.monthlySavings,
        annual_savings: calc.annualSavings,
        payback_years: calc.paybackYears,
        roi_percent: calc.roi,
        co2_tons_year: calc.co2TonsYear,
        status: 'draft',
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json({ proposal: data, calculation: calc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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

    // Upload to Supabase Storage
    const fileName = `quote-${flat.name?.replace(/\s+/g, '-')}-${Date.now()}.pdf`;
    const publicUrl = await uploadProposalPDF(fileName, pdfBuffer);

    if (publicUrl) {
      await supabaseAdmin.from('proposals').update({ pdf_url: publicUrl }).eq('id', req.params.id);
    }

    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename=${fileName}` });
    res.send(pdfBuffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/send', async (req, res) => {
  try {
    const { data: proposal, error } = await supabaseAdmin
      .from('proposals')
      .select(`*, contact:contacts!contact_id ( name, email )`)
      .eq('id', req.params.id)
      .single();
    if (error || !proposal) return res.status(404).json({ error: 'Proposal not found' });

    const flat = { ...proposal, name: proposal.contact?.name, email: proposal.contact?.email };
    await sendProposalEmail(flat);
    await supabaseAdmin.from('proposals').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', req.params.id);
    res.json({ success: true, message: 'Proposal sent' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

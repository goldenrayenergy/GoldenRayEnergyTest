import { Router } from 'express';
import { calculateSolar } from '../services/calcService.js';
import { generateQuotePDF } from '../services/quotePdfService.js';
import { sendQuoteEmail, sendTeamNewLeadEmail, sendCustomerAckEmail } from '../services/emailService.js';
import { supabaseAdmin } from '../config/supabase.js';

// Multi-touch follow-up cadence created at enquiry time. Sales rep ticks
// each off as they happen; remaining ones cancel naturally if the lead
// converts (we don't auto-cancel — the rep marks them done). Adjust
// timing here in one place if business rules change.
const CADENCE = [
  { offsetDays: 0,  title: 'First call within 1 hour', priority: 'high',   task_type: 'call' },
  { offsetDays: 1,  title: 'Day 1: text + email follow-up', priority: 'medium', task_type: 'call' },
  { offsetDays: 3,  title: 'Day 3: phone check-in',         priority: 'medium', task_type: 'call' },
  { offsetDays: 7,  title: 'Day 7: email follow-up',         priority: 'low',    task_type: 'email' },
  { offsetDays: 14, title: 'Day 14: final follow-up',        priority: 'low',    task_type: 'call' },
];

const router = Router();

// Derive backend systemType from landing-page installationType + batteryOption
const deriveSystemType = (form) => {
  if (form.installationType === 'commercial') return 'on-grid';
  if (form.installationType === 'off-grid')   return 'off-grid';
  if (form.installationType === 'ppa')        return 'ppa';
  return form.batteryOption === 'with-battery' ? 'hybrid' : 'on-grid';
};

// Public endpoint — saves to website_enquiries + contacts (CRM) + activities (dashboard feed)
router.post('/submit', async (req, res) => {
  try {
    const { form } = req.body;
    if (!form) return res.status(400).json({ error: 'Form data is required.' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    if (!form.firstName && !form.lastName && !form.email && !form.phone)
      return res.status(400).json({ error: 'Please provide at least a name, email, or phone number.' });

    // Friend referrals must include who referred them — required for the rewards program
    if (form.leadSource === 'friend_referral' && (!form.referrerName || !form.referrerPhone))
      return res.status(400).json({ error: 'Please tell us who referred you (name + phone).' });

    // Calculate server-side so landing page doesn't need a pre-calc step
    const calculation = form.monthlyBill
      ? calculateSolar({
          monthlyBill: form.monthlyBill,
          electricityRate: form.electricityRate || 0.32,
          systemType: deriveSystemType(form),
          batteryOption: form.batteryOption,
        })
      : null;

    // Lead score based on form completeness
    let score = 10;
    if (form.firstName && form.lastName)  score += 10;
    if (form.email)                        score += 15;
    if (form.phone)                        score += 15;
    if (form.address)                      score += 10;
    if (form.monthlyBill)                  score += 10;
    if (form.installationType)             score += 10;
    if (form.roofType)                     score += 5;
    if (form.callToDiscuss === 'yes')      score += 15;
    if (calculation?.totalCost)            score += 10;
    const leadScore = Math.min(score, 100);

    // ── 1. Save full form data to website_enquiries ──────────────────────────
    const { data: enquiry, error: enqError } = await supabaseAdmin
      .from('website_enquiries')
      .insert({
        first_name:             form.firstName             || null,
        last_name:              form.lastName              || null,
        email:                  form.email                 || null,
        phone:                  form.phone                 || null,
        address:                form.address               || null,
        owns_home:              form.ownsHome              || null,
        floors:                 form.floors ? parseInt(form.floors) : null,
        roof_type:              form.roofType              || null,
        installation_type:      form.installationType      || null,
        battery_option:         form.batteryOption         || null,
        lead_source:            form.leadSource            || null,
        lead_source_other:      form.leadSourceOther       || null,
        referrer_name:          form.referrerName          || null,
        referrer_phone:         form.referrerPhone         || null,
        street:                 form.addressStreet         || null,
        suburb:                 form.addressSuburb         || null,
        city:                   form.addressCity           || null,
        postcode:               form.addressPostcode       || null,
        call_to_discuss:        form.callToDiscuss         || null,
        installation_timeframe: form.installationTimeframe || null,
        monthly_bill:           form.monthlyBill ? parseFloat(form.monthlyBill) : null,
        system_size_kw:         calculation?.systemSize    || null,
        total_cost:             calculation?.totalCost     || null,
        monthly_savings:        calculation?.monthlySavings || null,
        annual_savings:         calculation?.annualSavings || null,
        payback_years:          calculation?.paybackYears  || null,
        roi_percent:            calculation?.roi           || null,
        panels:                 calculation?.panels        || null,
        battery_kwh:            calculation?.batteryKwh    || null,
        lead_score: leadScore,
        status:     'new',
      })
      .select('id')
      .single();
    if (enqError) throw enqError;

    // ── 2. Create CRM contact so lead appears in employee portal ─────────────
    const name = [form.firstName, form.lastName].filter(Boolean).join(' ').trim() || 'Website Enquiry';
    const systemType = deriveSystemType(form);
    // contacts.system_type CHECK only allows on-grid/off-grid/hybrid — collapse ppa
    const contactSystemType = systemType === 'ppa' ? 'on-grid' : systemType;
    const notes = [
      form.installationType      && `Installation: ${form.installationType}`,
      form.ownsHome              && `Owns home: ${form.ownsHome}`,
      form.floors                && `Floors: ${form.floors}`,
      form.roofType              && `Roof type: ${form.roofType}`,
      form.batteryOption         && `Battery: ${form.batteryOption}`,
      form.callToDiscuss         && `Call to discuss: ${form.callToDiscuss}`,
      form.installationTimeframe && `Timeframe: ${form.installationTimeframe}`,
    ].filter(Boolean).join(' | ') || null;

    const { data: contact, error: contactError } = await supabaseAdmin
      .from('contacts')
      .insert({
        name,
        email:           form.email                                            || null,
        phone:           form.phone                                            || null,
        location:        form.address                                          || null,
        type:            form.installationType === 'commercial' ? 'commercial' : 'residential',
        system_type:     contactSystemType,
        monthly_bill:    form.monthlyBill ? parseFloat(form.monthlyBill)       : null,
        stage:           'new',
        source:          form.leadSource || 'website',
        lead_source:        form.leadSource       || null,
        lead_source_other:  form.leadSourceOther  || null,
        referrer_name:      form.referrerName     || null,
        referrer_phone:     form.referrerPhone    || null,
        street:             form.addressStreet    || null,
        suburb:             form.addressSuburb    || null,
        city:               form.addressCity      || null,
        postcode:           form.addressPostcode  || null,
        lifecycle:       'subscriber',
        estimated_value: calculation?.totalCost                                || null,
        lead_score:      leadScore,
        last_activity:   'Website enquiry submitted',
        notes,
      })
      .select('id')
      .single();
    if (contactError) throw contactError;

    // NOTE: We deliberately do NOT create a project here. Projects are
    // operational records for confirmed customers. Sales reps qualify the
    // lead through the cadence below, then promote the contact to a project
    // when the customer commits (POST /api/leads/:id/promote-to-project).
    // Until then the contact lives in /portal/pipeline only.

    // ── 3. Create the multi-touch follow-up cadence ─────────────────────────
    const baseDescription = [
      `New website enquiry${form.monthlyBill ? ` — $${form.monthlyBill}/mo bill` : ''}.`,
      form.installationType      && `Installation: ${form.installationType}.`,
      form.batteryOption         && `Battery: ${form.batteryOption}.`,
      form.installationTimeframe && `Timeframe: ${form.installationTimeframe}.`,
      form.callToDiscuss === 'yes' && 'Customer requested a callback.',
      calculation?.systemSize && `Est. system: ${calculation.systemSize} kW, $${Math.round(calculation.totalCost).toLocaleString()}.`,
    ].filter(Boolean).join(' ');

    const cadenceTasks = CADENCE.map(step => ({
      title:       `${step.title} — ${name}`,
      description: baseDescription,
      contact_id:  contact.id,
      due_date:    new Date(Date.now() + step.offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      priority:    form.callToDiscuss === 'yes' && step.offsetDays === 0 ? 'high' : step.priority,
      status:      'todo',
      task_type:   step.task_type,
      assignee_id: null,
    }));
    await supabaseAdmin.from('tasks').insert(cadenceTasks);

    // ── 4. Log activity so it appears in dashboard Recent Activity feed ─────
    await supabaseAdmin.from('activities').insert({
      type:        'system',
      description: `New website lead: ${name}${form.monthlyBill ? ` — $${form.monthlyBill}/mo bill` : ''}${calculation?.totalCost ? ` — est. $${Math.round(calculation.totalCost).toLocaleString()}` : ''}`,
      contact_id:  contact.id,
      metadata: {
        enquiry_id:   enquiry.id,
        monthly_bill: form.monthlyBill || null,
        system_size:  calculation?.systemSize || null,
        total_cost:   calculation?.totalCost  || null,
        lead_score:   leadScore,
        source:       'website_form',
      },
    });

    // ── 5. Notify the team + send customer acknowledgment in parallel.
    //      Both non-fatal — we never block the API response on email problems.
    Promise.all([
      (async () => {
        try {
          const { data: admins } = await supabaseAdmin
            .from('users')
            .select('email')
            .eq('role', 'admin')
            .eq('is_active', true);
          const recipients = (admins || []).map(u => u.email).filter(Boolean);
          await sendTeamNewLeadEmail({ form, calculation, leadScore, recipients });
        } catch (e) { console.error('Team notification email failed (non-fatal):', e.message); }
      })(),
      (async () => {
        try {
          await sendCustomerAckEmail({ form });
        } catch (e) { console.error('Customer ack email failed (non-fatal):', e.message); }
      })(),
    ]);

    res.status(201).json({ success: true, id: enquiry.id, contact_id: contact.id });
  } catch (e) {
    console.error('Submit enquiry error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Public endpoint — no auth required
router.post('/calculate', (req, res) => {
  try {
    const calc = calculateSolar(req.body);
    res.json(calc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generate PDF and return as download
router.post('/pdf', async (req, res) => {
  try {
    const { customer, calculation } = req.body;
    if (!customer || !calculation) return res.status(400).json({ error: 'customer and calculation data required' });

    const pdfBuffer = await generateQuotePDF(customer, calculation);
    const fileName = `GoldenRay-Quote-${(customer.name || 'Customer').replace(/\s+/g, '-')}-${Date.now()}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': pdfBuffer.length,
    });
    res.send(pdfBuffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send quote via email
router.post('/send-email', async (req, res) => {
  try {
    const { customer, calculation } = req.body;
    if (!customer?.email) return res.status(400).json({ error: 'Customer email is required' });
    if (!calculation) return res.status(400).json({ error: 'Calculation data is required' });

    const pdfBuffer = await generateQuotePDF(customer, calculation);
    const fileName = `GoldenRay-Quote-${(customer.name || 'Customer').replace(/\s+/g, '-')}.pdf`;

    await sendQuoteEmail(customer, calculation, pdfBuffer, fileName);
    res.json({ success: true, message: `Quote sent to ${customer.email}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Generate WhatsApp share link with quote summary
router.post('/whatsapp-link', (req, res) => {
  try {
    const { customer, calculation } = req.body;
    if (!customer?.phone) return res.status(400).json({ error: 'Customer phone is required' });

    const fmt = n => '$' + Number(n).toLocaleString('en-NZ', { maximumFractionDigits: 0 });
    const phone = customer.phone.replace(/[\s\-\(\)]/g, '').replace(/^\+/, '');

    const message = [
      `☀️ *GOLDENRAY ENERGY NZ — Solar Quote*`,
      `_Powering a Sustainable Future_`,
      ``,
      `Hi ${customer.name || 'there'},`,
      `Here's your personalized solar quote:`,
      ``,
      `📊 *System Details*`,
      `• System Size: ${calculation.systemSize} kW`,
      `• Solar Panels: ${calculation.panels} panels`,
      calculation.batteryKwh > 0 ? `• Battery: ${calculation.batteryKwh} kWh` : null,
      `• System Type: ${customer.systemType || 'On-Grid'}`,
      ``,
      `💰 *Cost Breakdown*`,
      `• Panel Cost: ${fmt(calculation.panelCost)}`,
      `• Inverter: ${fmt(calculation.inverterCost)}`,
      `• Installation: ${fmt(calculation.laborCost)}`,
      calculation.batteryCost > 0 ? `• Battery: ${fmt(calculation.batteryCost)}` : null,
      `• *Total: ${fmt(calculation.totalCost)}* (incl. GST)`,
      ``,
      `💚 *Your Savings*`,
      `• Monthly Savings: ${fmt(calculation.monthlySavings)}`,
      `• Annual Savings: ${fmt(calculation.annualSavings)}`,
      `• Traditional Electricity Cost: ${fmt(calculation.traditionalCost)}/yr`,
      `• Cost Reduction: ${calculation.costReduction}%`,
      `• Payback Period: ${calculation.paybackYears} years`,
      `• ROI: ${calculation.roi}%`,
      `• 25-Year Savings: ${fmt(calculation.lifetimeSavings)}`,
      ``,
      `🌿 *Environmental Impact*`,
      `• CO₂ Reduced: ${calculation.co2TonsYear} tonnes/year`,
      `• Equivalent to ${calculation.treesEquivalent} trees planted`,
      `• Lifetime CO₂ Saved: ${calculation.lifetimeCo2} tonnes`,
      ``,
      `📞 Call us: +64 21 839 356`,
      `📧 Email: hello@goldenrayenergy.co.nz`,
      ``,
      `_Quote valid for 30 days._`,
    ].filter(Boolean).join('\n');

    const whatsappUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    res.json({ success: true, url: whatsappUrl, message });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

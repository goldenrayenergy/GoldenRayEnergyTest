import { Router } from 'express';
import { calculateSolar } from '../services/calcService.js';
import { generateQuotePDF } from '../services/quotePdfService.js';
import { sendQuoteEmail, sendTeamNewLeadEmail, sendCustomerAckEmail } from '../services/emailService.js';
import { supabaseAdmin } from '../config/supabase.js';
import { validateQuoteForm } from '../utils/validators.js';

// Multi-touch follow-up cadence created at enquiry time. Sales rep ticks
// each off as they happen; remaining ones cancel naturally if the lead
// converts (we don't auto-cancel — the rep marks them done).
//
// Cadence varies by customer type (Phase 7.3):
//   residential — fast cadence (1h / 1d / 3d / 7d / 14d). B2C sales cycles
//                 are short; speed-to-lead matters most.
//   off-grid    — medium cadence (1d / 3d / 7d / 14d / 30d). Site survey
//                 is the first concrete step, not a phone call.
//   commercial  — slow cadence (1d / 5d / 14d / 30d / 60d). B2B procurement
//                 cycles run 3-12 months; chasing too hard burns goodwill.
//   ppa         — slowest cadence (2d / 7d / 21d / 45d / 90d). Multi-month
//                 contract negotiations with finance + legal involvement.
const CADENCE_BY_TYPE = {
  residential: [
    { offsetDays: 0,  title: 'First call within 1 hour',        priority: 'high',   task_type: 'call' },
    { offsetDays: 1,  title: 'Day 1: text + email follow-up',    priority: 'medium', task_type: 'call' },
    { offsetDays: 3,  title: 'Day 3: phone check-in',            priority: 'medium', task_type: 'call' },
    { offsetDays: 7,  title: 'Day 7: email follow-up',           priority: 'low',    task_type: 'email' },
    { offsetDays: 14, title: 'Day 14: final follow-up',          priority: 'low',    task_type: 'call' },
  ],
  'off-grid': [
    { offsetDays: 0,  title: 'Off-grid: initial call within 1 business day',     priority: 'high',   task_type: 'call' },
    { offsetDays: 3,  title: 'Off-grid: schedule on-site survey',                 priority: 'high',   task_type: 'call' },
    { offsetDays: 7,  title: 'Off-grid: confirm survey date + site access',       priority: 'medium', task_type: 'call' },
    { offsetDays: 14, title: 'Off-grid: deliver custom design + quote',           priority: 'medium', task_type: 'email' },
    { offsetDays: 30, title: 'Off-grid: 30-day proposal follow-up',               priority: 'low',    task_type: 'call' },
  ],
  commercial: [
    { offsetDays: 0,  title: 'Commercial: initial call within 1 business day',    priority: 'high',   task_type: 'call' },
    { offsetDays: 5,  title: 'Commercial: schedule on-site survey + tariff review', priority: 'high', task_type: 'call' },
    { offsetDays: 14, title: 'Commercial: deliver proposal + IRR / depreciation', priority: 'medium', task_type: 'email' },
    { offsetDays: 30, title: 'Commercial: stakeholder follow-up call',            priority: 'medium', task_type: 'call' },
    { offsetDays: 60, title: 'Commercial: 60-day proposal check-in',              priority: 'low',    task_type: 'call' },
  ],
  ppa: [
    { offsetDays: 1,  title: 'PPA: initial finance call within 2 business days',  priority: 'high',   task_type: 'call' },
    { offsetDays: 7,  title: 'PPA: site survey + tariff modelling kicked off',    priority: 'high',   task_type: 'call' },
    { offsetDays: 21, title: 'PPA: deliver contract draft + per-kWh rate',        priority: 'medium', task_type: 'email' },
    { offsetDays: 45, title: 'PPA: legal / board review follow-up',               priority: 'medium', task_type: 'call' },
    { offsetDays: 90, title: 'PPA: 90-day decision check-in',                     priority: 'low',    task_type: 'call' },
  ],
};

// Resolve which cadence to apply. Accept either the new `customerType` or
// the legacy `installationType` field. Fall back to residential.
function pickCadence(form) {
  const key = form.customerType || form.installationType;
  return CADENCE_BY_TYPE[key] || CADENCE_BY_TYPE.residential;
}

// Human-readable team label for the activity description — surfaces in
// the CRM so the right team picks the lead up.
function teamForCustomerType(form) {
  const key = form.customerType || form.installationType;
  if (key === 'off-grid')   return 'Off-grid specialist';
  if (key === 'commercial') return 'Commercial team';
  if (key === 'ppa')        return 'PPA / Finance team';
  return 'Sales';
}

const router = Router();

// Derive backend systemType from landing-page installationType + batteryOption
const deriveSystemType = (form) => {
  if (form.installationType === 'commercial') return 'on-grid';
  if (form.installationType === 'off-grid')   return 'off-grid';
  if (form.installationType === 'ppa')        return 'ppa';
  return form.batteryOption === 'with-battery' ? 'hybrid' : 'on-grid';
};

// Public endpoint — saves to website_enquiries + contacts (CRM) + activities (dashboard feed).
//
// Two modes:
//   (1) New lead  — no enquiry_id in form → INSERT path (original behaviour).
//   (2) Wizard completion of a QR partial — form.enquiry_id + form.contact_id
//       present → UPDATE the existing 'partial' row to 'new' and enrich with
//       full wizard data, then create the follow-up cadence. Skips the team
//       notification email (it was already sent when the partial was captured).
router.post('/submit', async (req, res) => {
  try {
    const { form } = req.body;
    if (!form) return res.status(400).json({ error: 'Form data is required.' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    // UPDATE path is taken when the wizard was preceded by /submit-partial
    // (QR visitor) and we're now enriching the existing row rather than
    // creating a duplicate.
    const isUpdate = !!(form.enquiry_id && form.contact_id);

    // Centralised validation (migration 020) — friendly messages BEFORE the
    // DB rejects with a CHECK constraint violation. Covers email/phone format,
    // postcode 4-digit, monetary fields non-negative, and the referrer rule.
    const validationErrors = validateQuoteForm(form);
    if (validationErrors.length) {
      return res.status(400).json({
        error: validationErrors[0],   // primary error for legacy UIs
        errors: validationErrors,     // full list for new UIs that handle multiple
      });
    }

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

    // ── 0. Pull UTM + QR-scan attribution from the form body ───────────────
    // These are echoed by the /get-quote frontend from URL params set by the
    // /qr/:slug redirect. Empty/undefined when the visitor came in directly
    // (no QR scan, no campaign URL).
    const utmSource   = form.utm_source   ? String(form.utm_source).slice(0, 50)   : null;
    const utmMedium   = form.utm_medium   ? String(form.utm_medium).slice(0, 50)   : null;
    const utmCampaign = form.utm_campaign ? String(form.utm_campaign).slice(0, 80) : null;
    // qr_scan_id is a UUID; validate loosely to avoid SQL errors on garbage values.
    const qrScanId = (form.qr_scan_id && /^[0-9a-f-]{36}$/i.test(form.qr_scan_id))
      ? form.qr_scan_id : null;

    // ── 1. Save full form data to website_enquiries ──────────────────────────
    // INSERT for fresh leads; UPDATE when this completes a previously-captured
    // QR partial (promotes status 'partial' → 'new', enriches with full data).
    const enquiryFields = {
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
      utm_source:   utmSource,
      utm_medium:   utmMedium,
      utm_campaign: utmCampaign,
      qr_scan_id:   qrScanId,
    };

    let enquiry;
    if (isUpdate) {
      const { data, error: updError } = await supabaseAdmin
        .from('website_enquiries')
        .update(enquiryFields)
        .eq('id', form.enquiry_id)
        .select('id')
        .single();
      if (updError) throw updError;
      enquiry = data;
    } else {
      const { data, error: enqError } = await supabaseAdmin
        .from('website_enquiries')
        .insert(enquiryFields)
        .select('id')
        .single();
      if (enqError) throw enqError;
      enquiry = data;
    }

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

    const contactFields = {
      name,
      email:           form.email                                            || null,
      phone:           form.phone                                            || null,
      location:        form.address                                          || null,
      type:            form.installationType === 'commercial' ? 'commercial' : 'residential',
      system_type:     contactSystemType,
      monthly_bill:    form.monthlyBill ? parseFloat(form.monthlyBill)       : null,
      stage:           'new',
      // If the lead came from a QR campaign, source = utm_source (e.g. "card"/"flyer"/"show");
      // otherwise fall back to the form-supplied leadSource or generic "website".
      source:          utmSource || form.leadSource || 'website',
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
      last_activity:   isUpdate ? 'Wizard completed (QR partial promoted)' : 'Website enquiry submitted',
      notes,
      utm_source:   utmSource,
      utm_medium:   utmMedium,
      utm_campaign: utmCampaign,
      qr_scan_id:   qrScanId,
    };

    let contact;
    if (isUpdate) {
      const { data, error: cUpdError } = await supabaseAdmin
        .from('contacts')
        .update(contactFields)
        .eq('id', form.contact_id)
        .select('id')
        .single();
      if (cUpdError) throw cUpdError;
      contact = data;
    } else {
      const { data, error: contactError } = await supabaseAdmin
        .from('contacts')
        .insert(contactFields)
        .select('id')
        .single();
      if (contactError) throw contactError;
      contact = data;
    }

    // ── 2b. Back-link the scan event to the lead it generated ──────────────
    // Best-effort — failure here doesn't block the lead flow.
    if (qrScanId) {
      try {
        await supabaseAdmin
          .from('qr_scans')
          .update({ lead_enquiry_id: enquiry.id, lead_contact_id: contact.id })
          .eq('id', qrScanId);
      } catch (e) {
        console.warn('qr_scans back-link failed (non-fatal):', e.message);
      }
    }

    // NOTE: We deliberately do NOT create a project here. Projects are
    // operational records for confirmed customers. Sales reps qualify the
    // lead through the cadence below, then promote the contact to a project
    // when the customer commits (POST /api/leads/:id/promote-to-project).
    // Until then the contact lives in /portal/pipeline only.

    // ── 3. Create the multi-touch follow-up cadence (Phase 7.3 type-aware) ──
    const team = teamForCustomerType(form);
    const cadence = pickCadence(form);

    const baseDescription = [
      `[${team}]`,
      `New website enquiry${form.monthlyBill ? ` — $${form.monthlyBill}/mo bill` : ''}.`,
      form.customerType          && `Customer type: ${form.customerType}.`,
      form.installationType      && form.installationType !== form.customerType && `Installation: ${form.installationType}.`,
      form.wizardIntent          && `Wizard intent: ${form.wizardIntent}.`,
      form.phoneVerified === true  && '✓ Phone OTP-verified.',
      form.phoneVerified === false && '⚠ Phone NOT verified (passers-by risk).',
      form.businessType          && `Business type: ${form.businessType}.`,
      form.operatingHours        && `Hours: ${form.operatingHours}.`,
      form.dailyKwh              && `Daily kWh need: ${form.dailyKwh}.`,
      form.autonomyDays          && `Autonomy days: ${form.autonomyDays}.`,
      form.offGridReason         && `Off-grid reason: ${form.offGridReason}.`,
      form.contractLength        && `Contract length: ${form.contractLength} yrs.`,
      form.decisionMakers        && `Decision-makers: ${form.decisionMakers}.`,
      form.batteryOption         && `Battery: ${form.batteryOption}.`,
      form.installationTimeframe && `Timeframe: ${form.installationTimeframe}.`,
      form.callToDiscuss === 'yes' && 'Customer requested a callback.',
      form.notes                 && `Customer notes: ${form.notes}`,
      calculation?.systemSize && `Est. system: ${calculation.systemSize} kW, $${Math.round(calculation.totalCost).toLocaleString()}.`,
    ].filter(Boolean).join(' ');

    // Track 2 urgency tagging: every full submit is 'high' priority on Day 0
    // (customer completed the wizard — they're serious enough to pursue).
    // For UPDATE path (partial → new), we also clear the medium-priority
    // bail-out task that was created at Step 3 so sales doesn't see stale work.
    const cadenceTasks = cadence.map(step => ({
      title:       `${step.title} — ${name}`,
      description: baseDescription,
      contact_id:  contact.id,
      due_date:    new Date(Date.now() + step.offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      priority:    step.offsetDays === 0 ? 'high' : step.priority,
      status:      'todo',
      task_type:   step.task_type,
      assignee_id: null,
    }));
    await supabaseAdmin.from('tasks').insert(cadenceTasks);

    // Promote the partial bail-out task to 'done' if this is the UPDATE path —
    // sales doesn't need to chase someone who just completed the wizard.
    if (isUpdate) {
      try {
        await supabaseAdmin
          .from('tasks')
          .update({ status: 'done', description: 'Auto-completed: customer finished the wizard.' })
          .eq('contact_id', contact.id)
          .like('title', 'Mid-flow partial — bail-out follow-up%')
          .eq('status', 'todo');
      } catch (e) { console.warn('partial-task cleanup failed (non-fatal):', e.message); }
    }

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

    // ── 5. If this lead came with an analysisId, fetch the review flag so the
    //      team email can warn sales the bills need verification before quoting.
    let reviewFlag = null;
    if (form.analysisId) {
      try {
        const { data: analysisRow } = await supabaseAdmin
          .from('bill_analyses')
          .select('id, review_required, review_reasons')
          .eq('id', form.analysisId)
          .maybeSingle();
        if (analysisRow?.review_required) {
          reviewFlag = {
            analysis_id:     analysisRow.id,
            enquiry_id:      enquiry.id,
            review_required: true,
            review_reasons:  analysisRow.review_reasons || [],
          };
        }
      } catch (e) { console.warn('Could not fetch analysis review flag (non-fatal):', e.message); }
    }

    // ── 6. Notify the team + send customer acknowledgment in parallel.
    //      Both non-fatal — we never block the API response on email problems.
    //      Skip the team email on UPDATE path (it was sent at /submit-partial).
    Promise.all([
      (async () => {
        if (isUpdate) return;   // team already notified during partial capture
        try {
          const { data: admins } = await supabaseAdmin
            .from('users')
            .select('email')
            .eq('role', 'admin')
            .eq('is_active', true);
          const recipients = (admins || []).map(u => u.email).filter(Boolean);
          await sendTeamNewLeadEmail({ form, calculation, leadScore, recipients, reviewFlag });
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

// ── Pattern B unified mid-flow capture ─────────────────────────────────────
// Public endpoint hit by Step 3 of the wizard for EVERY visitor (QR + direct,
// every intent). Captures name + email + phone — the minimum we need to keep
// the lead reachable if they bail at projection / OTP / address. The wizard's
// final /submit then promotes status 'partial' → 'new' via the ids we return.
//
// Behaviour:
//   • Required: firstName, email, phone. Everything else is optional.
//   • Idempotent on echoed enquiry_id+contact_id (back-and-forward Step 3).
//   • Priority='medium' partial follow-up task; callback intent gets 'high'.
//   • Team email is SILENT by default — review_required from the analyzer
//     and the 24h bail-out job handle notifications. Exception: callback
//     intent fires the team email immediately because the customer has
//     explicitly asked for a call.
//
// Sets status='partial' so the portal can distinguish in-progress leads from
// completed enquiries and the 24h bail-out job can target them.
router.post('/submit-partial', async (req, res) => {
  try {
    const { form } = req.body;
    if (!form) return res.status(400).json({ error: 'Form data is required.' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    // Minimum fields — name/email/phone. Pattern B keeps the ask short.
    const required = ['firstName', 'email', 'phone'];
    const missing  = required.filter(k => !form[k]);
    if (missing.length) {
      return res.status(400).json({ error: `Required fields missing: ${missing.join(', ')}` });
    }

    // Idempotency: if the Step-3 caller already has ids from an earlier
    // submission this session (e.g. customer hit Back from Step 4), reuse
    // them — UPDATE the existing rows instead of inserting duplicates.
    const reuseEnquiryId = form.enquiry_id || null;
    const reuseContactId = form.contact_id || null;

    // QR-campaign attribution rides through unchanged.
    const utmSource   = form.utm_source   ? String(form.utm_source).slice(0, 50)   : null;
    const utmMedium   = form.utm_medium   ? String(form.utm_medium).slice(0, 50)   : null;
    const utmCampaign = form.utm_campaign ? String(form.utm_campaign).slice(0, 80) : null;
    const qrScanId = (form.qr_scan_id && /^[0-9a-f-]{36}$/i.test(form.qr_scan_id))
      ? form.qr_scan_id : null;

    // Modest lead score on partial — full submit rescores.
    const partialScore = 50;
    const wizardIntent = form.wizardIntent || null;
    const customerType = form.customerType || form.installationType || 'residential';
    const isCallback   = wizardIntent === 'callback';

    const enquiryFields = {
      first_name:             form.firstName,
      last_name:              form.lastName || null,
      email:                  form.email,
      phone:                  form.phone,
      address:                form.address || null,
      monthly_bill:           form.monthlyBill ? parseFloat(form.monthlyBill) : null,
      installation_timeframe: form.installationTimeframe || null,
      installation_type:      form.installationType || null,
      lead_score:             partialScore,
      status:                 'partial',
      utm_source:             utmSource,
      utm_medium:             utmMedium,
      utm_campaign:           utmCampaign,
      qr_scan_id:             qrScanId,
    };

    // ── 1. INSERT or UPDATE website_enquiries ──
    let enquiry;
    if (reuseEnquiryId) {
      const { data, error } = await supabaseAdmin
        .from('website_enquiries')
        .update(enquiryFields)
        .eq('id', reuseEnquiryId)
        .select('id')
        .single();
      if (error) throw error;
      enquiry = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('website_enquiries')
        .insert(enquiryFields)
        .select('id')
        .single();
      if (error) throw error;
      enquiry = data;
    }

    // ── 2. INSERT or UPDATE contact (CRM mirror) ──
    const name = [form.firstName, form.lastName].filter(Boolean).join(' ').trim();
    // contacts.system_type CHECK only allows on-grid/off-grid/hybrid
    const contactSystemType =
      customerType === 'off-grid'   ? 'off-grid' :
      customerType === 'commercial' ? 'on-grid'  :
      customerType === 'ppa'        ? 'on-grid'  :
                                      'on-grid';
    const contactType = customerType === 'commercial' || customerType === 'ppa' ? 'commercial' : 'residential';

    const contactFields = {
      name,
      email:        form.email,
      phone:        form.phone,
      location:     form.address || null,
      monthly_bill: form.monthlyBill ? parseFloat(form.monthlyBill) : null,
      type:         contactType,
      system_type:  contactSystemType,
      stage:        'new',
      source:       utmSource || (wizardIntent ? `wizard_${wizardIntent}` : 'website'),
      lifecycle:    'lead',
      lead_score:   partialScore,
      last_activity: `Wizard Step 3 partial capture${wizardIntent ? ` (${wizardIntent})` : ''}`,
      utm_source:   utmSource,
      utm_medium:   utmMedium,
      utm_campaign: utmCampaign,
      qr_scan_id:   qrScanId,
    };

    let contact;
    if (reuseContactId) {
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .update(contactFields)
        .eq('id', reuseContactId)
        .select('id')
        .single();
      if (error) throw error;
      contact = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .insert(contactFields)
        .select('id')
        .single();
      if (error) throw error;
      contact = data;
    }

    // ── 3. Back-link the scan event to the lead (QR visitors only) ──
    if (qrScanId) {
      try {
        await supabaseAdmin
          .from('qr_scans')
          .update({ lead_enquiry_id: enquiry.id, lead_contact_id: contact.id })
          .eq('id', qrScanId);
      } catch (e) { console.warn('qr_scans back-link failed (non-fatal):', e.message); }
    }

    // ── 4. Follow-up task — only created on first INSERT, not re-updates ──
    // Priority: 'high' for callback intent (customer explicitly asked for a
    // call); 'medium' for everyone else (still in the wizard — let the 24h
    // job catch them if they bail).
    if (!reuseContactId) {
      try {
        await supabaseAdmin.from('tasks').insert({
          title:       `${isCallback ? 'Callback request — call within 1 hour' : 'Mid-flow partial — bail-out follow-up'} — ${name}`,
          description: `[Sales] ${isCallback ? 'Customer requested a callback' : 'Customer started the wizard'} (intent: ${wizardIntent || 'unknown'}). ${form.monthlyBill ? `Bill ~$${parseFloat(form.monthlyBill)}/mo. ` : ''}${utmSource ? `Source: ${utmSource}. ` : ''}Wizard not yet completed.`,
          contact_id:  contact.id,
          due_date:    new Date().toISOString().slice(0, 10),
          priority:    isCallback ? 'high' : 'medium',
          status:      'todo',
          task_type:   'call',
          assignee_id: null,
        });
      } catch (e) { console.warn('partial-capture task creation failed (non-fatal):', e.message); }
    }

    // ── 5. Activity feed entry ──
    if (!reuseContactId) {
      try {
        await supabaseAdmin.from('activities').insert({
          type:        'system',
          description: `Partial capture: ${name} — ${wizardIntent || 'wizard'}${form.monthlyBill ? ` — $${parseFloat(form.monthlyBill)}/mo` : ''}`,
          contact_id:  contact.id,
          metadata: {
            enquiry_id:    enquiry.id,
            source:        'partial_capture',
            wizard_intent: wizardIntent,
            utm_source:    utmSource,
            utm_campaign:  utmCampaign,
          },
        });
      } catch (e) { console.warn('partial-capture activity failed (non-fatal):', e.message); }
    }

    // ── 6. Notify team — ONLY for callback intent (high-priority, customer
    //      explicitly asked for a call). For other intents the team email is
    //      silent at partial-capture time; it'll fire when the bill analyzer
    //      flags review_required OR when the final /submit completes.
    if (isCallback && !reuseContactId) {
      (async () => {
        try {
          const { data: admins } = await supabaseAdmin
            .from('users')
            .select('email')
            .eq('role', 'admin')
            .eq('is_active', true);
          const recipients = (admins || []).map(u => u.email).filter(Boolean);
          await sendTeamNewLeadEmail({
            form: { ...form, _partial: true, _callbackRequested: true },
            calculation: null,
            leadScore: partialScore,
            recipients,
          });
        } catch (e) { console.error('Partial team email failed (non-fatal):', e.message); }
      })();
    }

    return res.status(201).json({
      success:     true,
      enquiry_id:  enquiry.id,
      contact_id:  contact.id,
    });
  } catch (e) {
    console.error('Submit partial enquiry error:', e.message);
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

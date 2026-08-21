import { Router } from 'express';
import { calculateSolar } from '../services/calcService.js';
import { generateQuotePDF } from '../services/quotePdfService.js';
import { sendQuoteEmail, sendTeamNewLeadEmail } from '../services/emailService.js';
import { supabaseAdmin } from '../config/supabase.js';
// createOrUpdateLead was extracted from this file's /submit handler on
// 2026-08-20 (Phase A ticket A3, [[project-quote-flow-integration-plan]]).
// Old /submit now delegates to the shared service so the same write pipeline
// serves the incoming /api/quote/submit-with-design endpoint too.
import { createOrUpdateLead } from '../services/leadService.js';

const router = Router();

// NOTE 2026-08-20 (Phase A / A3): CADENCE_BY_TYPE + pickCadence +
// teamForCustomerType + deriveSystemType moved to services/leadService.js
// as part of the shared lead-write pipeline extraction. They live there now
// so both /api/quote/submit (this file) and the incoming
// /api/quote/submit-with-design endpoint can share the same behavior.

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

    // All the writes (enquiry, contact, qr back-link, roof-analysis pipeline,
    // cadence tasks, activity, review flag, team/customer emails) now live in
    // services/leadService.js — same identical behavior, just extracted into a
    // shared service so the incoming /api/quote/submit-with-design endpoint
    // can reuse the exact same write pipeline. Refactor 2026-08-20 (A3).
    const result = await createOrUpdateLead({ form });
    res.status(201).json({ success: true, id: result.enquiryId, contact_id: result.contactId });
  } catch (e) {
    // createOrUpdateLead throws err.status=400 on validation failure so the
    // wizard still gets the same friendly per-field messages it used to.
    if (e.status === 400) {
      return res.status(400).json({
        error: e.message,
        errors: e.errors,
      });
    }
    console.error('Submit enquiry error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Phase A ticket A5 (2026-08-20) — /api/quote/submit-with-design ────────
// Called by the new merged residential flow when the customer clicks
// "Get this quote" on their chosen tier. Payload = { form, design }.
//   • form   — same shape as /submit (contact + address). Wizard fields
//              like installationType, batteryOption, etc. are still accepted
//              so leadService fills in the legacy columns identically.
//   • design — the POC output the customer saw: roof analysis result + all
//              3 tier options + which tier they picked + customise sliders
//              (battery kWh, EV opt-in, km/day). Shape:
//                {
//                  chosenTierId, systemKwp, panelCount,
//                  batteryKwh, evIncluded, tierPrice, roofSource,
//                  lat, lng, fullPayload
//                }
//
// Uses the shared leadService with two flags flipped vs old /submit:
//   • skipRoofAnalysis=true — POC's /api/poc/roof/analyse already ran; we
//                             don't need the legacy Google-Solar fire-and-
//                             forget pipeline to overwrite our better result
//   • createProjectV2=true  — Phase 6.6 bundle: auto-create a projects_v2
//                             row so sales team sees the full design in the
//                             PM Tool without manual copy-paste
router.post('/submit-with-design', async (req, res) => {
  try {
    const { form, design } = req.body;
    if (!form)   return res.status(400).json({ error: 'Form data is required.' });
    if (!design) return res.status(400).json({ error: 'Design payload is required.' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const result = await createOrUpdateLead({
      form,
      design,
      skipRoofAnalysis: true,
      createProjectV2:  true,
    });

    res.status(201).json({
      success:     true,
      id:          result.enquiryId,
      contact_id:  result.contactId,
      project_id:  result.projectId,   // null in A5; populated once A7 wires projects_v2 write
      share_token: result.shareToken,  // Phase B4 — magic-link viewer /p/:token
    });
  } catch (e) {
    if (e.status === 400) {
      return res.status(400).json({
        error:  e.message,
        errors: e.errors,
      });
    }
    console.error('Submit-with-design error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Phase B2 (2026-08-20) — progressive draft capture ─────────────────────
// Called by the merged /get-quote residential wizard on:
//   • Email typed in the header progressive-capture input (I2)
//   • Tier chosen on Step 4 (B4 optimistic quote save)
// Persists whatever we know so far as a partial website_enquiries + contacts
// row. Idempotent — echoing the returned enquiry_id + contact_id upserts
// the same draft instead of creating duplicates.
//
// UNLIKE /submit-partial (which enforces firstName + email + phone), THIS
// endpoint requires ONLY email. Name defaults to 'Draft' + phone is nullable,
// so the customer can save state before they've committed contact info.
// Once the customer completes Step 5, /submit-with-design promotes the row
// to status='new' via the ids we return (same reuse pattern as /submit-partial).
router.post('/draft', async (req, res) => {
  try {
    const { form = {}, design = null, enquiry_id = null, contact_id = null } = req.body || {};
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    // Only requirement — email. Everything else is best-effort progressive.
    const email = (form.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email address is required.' });
    }
    // Fill safe defaults so the shared write pipeline (validateQuoteForm
    // inside leadService) accepts the payload without name/phone.
    const draftForm = {
      firstName:      form.firstName?.trim() || 'Draft',
      lastName:       form.lastName?.trim()  || null,
      email,
      phone:          form.phone?.trim() || null,
      address:        form.address || null,
      customerType:   form.customerType   || 'residential',
      installationType: form.installationType || 'residential',
      wizardIntent:   form.wizardIntent   || null,
      monthlyBill:    form.monthlyBill    || null,
      utm_source:     form.utm_source,
      utm_medium:     form.utm_medium,
      utm_campaign:   form.utm_campaign,
      qr_scan_id:     form.qr_scan_id,
      // Echo prior ids for upsert idempotency — matches /submit-partial's
      // Back-and-forward guarantee, so multiple debounced saves for the
      // same customer land on the same DB row.
      enquiry_id,
      contact_id,
    };
    const result = await createOrUpdateLead({
      form: draftForm,
      design,                     // may include chosenTierId + tierPrice + design summary
      skipRoofAnalysis: true,     // draft = no fire-and-forget Google Solar pipeline
      createProjectV2:  false,    // don't create PM Tool row until customer commits
      draftMode:        true,     // status='partial', skip cadence/activity/emails
    });
    return res.status(201).json({
      success:    true,
      enquiry_id: result.enquiryId,
      contact_id: result.contactId,
    });
  } catch (e) {
    if (e.status === 400) {
      return res.status(400).json({ error: e.message, errors: e.errors });
    }
    console.error('/quote/draft error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── Phase B2 I3 (2026-08-21) — resume a bailed wizard from a magic-link ──
// GET /api/quote/resume/:id
//
// Called by the client /get-quote/resume/:token route when a customer clicks
// the CTA in the bail-out follow-up email. Returns just enough server-side
// state to rehydrate the wizard without touching the customer's session:
//   • contact fields (name, email, phone) — from the enquiry row
//   • address (formattedAddress + lat/lng) — reconstructed from enquiry cols
//   • usage / bill blob — from poc_design_json (only present if they got past
//                          Step 4 tier pick; earlier bailers get NULL and the
//                          wizard falls back to Step 1 with just contact/address)
//   • chosen tier — from poc_design_json + flat migration-042 columns
//   • draftIds — echoed back so Step 5 submit UPSERTS the same row
//                (status='partial' → 'new' promotion, same idempotency as B2)
//
// Token = enquiry.id (a UUID, already unguessable). No dedicated resume_token
// column needed — same design tradeoff as projects_v2.share_token but reusing
// an existing identifier. Gated on status='partial' so once /submit-with-design
// promotes the row to 'new' the token stops working — invalidate-on-submit is
// free. Rate limiter (express-rate-limit) already caps public /quote/* routes.
//
// No auth — the UUID IS the credential, same as /api/public/p/:share_token.
router.get('/resume/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const id = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ error: 'Invalid resume token.' });
    }
    const { data: enquiry, error } = await supabaseAdmin
      .from('website_enquiries')
      .select(`
        id, status, first_name, last_name, email, phone, address,
        street, suburb, city, postcode,
        monthly_bill, coords_lat, coords_lng,
        submission_source, chosen_tier_id, system_kwp, panel_count,
        battery_kwh_chosen, ev_charger_included, tier_price, roof_source,
        poc_design_json, created_at, updated_at
      `)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[/quote/resume] db error:', error.message);
      return res.status(500).json({ error: 'Could not load your saved quote.' });
    }
    // Invalidate-on-submit: /submit-with-design promotes status to 'new'.
    // Anything other than 'partial' means the draft is either not-a-draft or
    // already been finalised — either way, no resume for you.
    if (!enquiry || enquiry.status !== 'partial') {
      return res.status(404).json({ error: 'This quote is no longer available. Start a fresh one.' });
    }

    // Look up the contact row (the wizard populates its `contact` state from
    // this). One-to-one with enquiry by email + created within the same
    // draft-save, so a bounded lookup by email is safe.
    let contactId = null;
    if (enquiry.email) {
      const { data: contactRow } = await supabaseAdmin
        .from('contacts')
        .select('id')
        .eq('email', enquiry.email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      contactId = contactRow?.id || null;
    }

    // Rehydrate address if we have enough to reconstruct it.
    const address = enquiry.address || enquiry.street || enquiry.coords_lat != null
      ? {
          formattedAddress: enquiry.address
            || [enquiry.street, enquiry.suburb, enquiry.city, enquiry.postcode].filter(Boolean).join(', ')
            || null,
          latitude:  enquiry.coords_lat  != null ? Number(enquiry.coords_lat)  : null,
          longitude: enquiry.coords_lng != null ? Number(enquiry.coords_lng) : null,
        }
      : null;

    // Rehydrate chosen tier — prefer the JSONB blob (has the full engine
    // response), fall back to flat columns.
    let chosenTier = null;
    if (enquiry.chosen_tier_id && enquiry.poc_design_json?.tier) {
      chosenTier = { id: enquiry.chosen_tier_id, tier: enquiry.poc_design_json.tier };
    } else if (enquiry.chosen_tier_id) {
      chosenTier = {
        id: enquiry.chosen_tier_id,
        tier: {
          label:              enquiry.chosen_tier_id,
          system_size_kwp:    enquiry.system_kwp,
          panels:             enquiry.panel_count,
          battery_kwh:        enquiry.battery_kwh_chosen,
          wattpilot_included: !!enquiry.ev_charger_included,
          price_inc_gst:      enquiry.tier_price,
        },
      };
    }

    // Usage — the JSONB blob is the only source of truth for the customer's
    // Step 1 bill/spend/kwh input. If it's missing, fall back to monthly_bill.
    const usage = enquiry.poc_design_json?.usage || (
      enquiry.monthly_bill
        ? { tab: 'spend', monthlySpend: Number(enquiry.monthly_bill), bill: null, annualKwh: null }
        : null
    );

    // Decide the farthest step the client should jump to based on how far
    // the customer got. Higher = further along; the wizard uses this as the
    // initial stepIdx AND the StepRail's forward-jump ceiling.
    //   0=usage, 1=house, 2=analysis, 3=system, 4=quote
    // Analysis (step 2) is never persisted — a resume ALWAYS re-runs it — so
    // we never jump past Step 2 without re-running. If we know tier they were
    // eyeing, land on Step 2 anyway so they see the roof re-analyse.
    let farthestStep = 0;
    if (usage)             farthestStep = 1;
    if (address)           farthestStep = 2;
    // Don't jump past analysis — it needs re-running. Chosen-tier is
    // rehydrated into state so if analysis succeeds, the wizard can advance
    // to Step 4 with the customer's original pick intact.

    return res.json({
      ok: true,
      resumed_at: new Date().toISOString(),
      farthest_step: farthestStep,
      form: {
        firstName: enquiry.first_name || '',
        lastName:  enquiry.last_name  || '',
        email:     enquiry.email      || '',
        phone:     enquiry.phone      || '',
      },
      address,
      usage,
      chosenTier,
      draftIds: {
        enquiryId: enquiry.id,
        contactId,
      },
      meta: {
        submission_source: enquiry.submission_source,
        created_at:        enquiry.created_at,
        updated_at:        enquiry.updated_at,
      },
    });
  } catch (e) {
    console.error('[/quote/resume] threw:', e?.message || e);
    return res.status(500).json({ error: 'Could not load your saved quote.' });
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

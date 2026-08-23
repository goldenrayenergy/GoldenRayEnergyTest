// services/leadService.js — canonical lead-write pipeline shared by:
//   • POST /api/quote/submit                (old wizard, all customer types)
//   • POST /api/quote/submit-with-design    (new merged residential flow, Phase A)
//
// Created 2026-08-20 as part of the /get-quote + /poc/quote integration
// (see [[project-quote-flow-integration-plan]]). Extracted verbatim from
// routes/quote.js so the OLD wizard's byte-for-byte behavior is preserved
// once we swap in the service call. Two new capabilities gated by flags:
//   1. skipRoofAnalysis — POC has already run analysis, don't re-fire pipeline
//   2. createProjectV2  — Phase 6.6 bundle, auto-create PM Tool project row
//
// Design principle: one main createOrUpdateLead() for the common case, plus
// composable write* / fire* pieces exported for special orchestration.

import { calculateSolar } from './calcService.js';
import {
  sendTeamNewLeadEmail,
  sendCustomerAckEmail,
  sendCustomerProposalDeliveryEmail,   // Phase B4 (2026-08-21)
  sendDraftSavedEmail,                 // Phase B2 I3-followup (2026-08-21)
} from './emailService.js';
import { supabaseAdmin } from '../config/supabase.js';
import { validateQuoteForm } from '../utils/validators.js';
import env from '../config/env.js';
import { analyseRoof } from './googleSolar/analyseRoof.js';
import { geocodeAddress } from './googleSolar/geocoder.js';
import { reserveQuota } from './googleSolar/quotaTracker.js';
import { generateProposalPDF } from './pdfService.js';                 // Phase B4
import { buildCallbackHoldIcs, formatNztLabel } from './icsService.js';// Phase B4
import { attributeReferral } from './referralService.js';              // Phase 3 (2026-08-22)

// ── Cadence catalog (moved from routes/quote.js) ───────────────────────────
// Multi-touch follow-up cadence per customer type. Residential leads convert
// fast so we chase hard on day 0-3; commercial/PPA take months so we pace out.
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
    { offsetDays: 45, title: 'PPA: legal/finance stakeholder review',             priority: 'medium', task_type: 'call' },
    { offsetDays: 90, title: 'PPA: 90-day negotiation check-in',                  priority: 'low',    task_type: 'call' },
  ],
};

function pickCadence(form) {
  const key = form.customerType || form.installationType;
  return CADENCE_BY_TYPE[key] || CADENCE_BY_TYPE.residential;
}

function teamForCustomerType(form) {
  const key = form.customerType || form.installationType;
  if (key === 'off-grid')   return 'Off-grid specialist';
  if (key === 'commercial') return 'Commercial team';
  if (key === 'ppa')        return 'PPA / Finance team';
  return 'Sales';
}

// Derive backend systemType from landing-page installationType + batteryOption.
// contacts.system_type CHECK constraint only allows on-grid/off-grid/hybrid,
// so we collapse ppa → on-grid at the contact write.
function deriveSystemType(form) {
  if (form.installationType === 'commercial') return 'on-grid';
  if (form.installationType === 'off-grid')   return 'off-grid';
  if (form.installationType === 'ppa')        return 'ppa';
  return form.batteryOption === 'with-battery' ? 'hybrid' : 'on-grid';
}

// ── Composable writes ─────────────────────────────────────────────────────

/**
 * INSERT or UPDATE website_enquiries. Returns the row id.
 */
export async function writeEnquiry(fields, { update = false, id = null } = {}) {
  if (update && !id) throw new Error('writeEnquiry: update=true requires id');
  const q = update
    ? supabaseAdmin.from('website_enquiries').update(fields).eq('id', id)
    : supabaseAdmin.from('website_enquiries').insert(fields);
  const { data, error } = await q.select('id').single();
  if (error) throw error;
  return data;
}

/**
 * INSERT or UPDATE contacts. Returns the row id.
 */
export async function writeContact(fields, { update = false, id = null } = {}) {
  if (update && !id) throw new Error('writeContact: update=true requires id');
  const q = update
    ? supabaseAdmin.from('contacts').update(fields).eq('id', id)
    : supabaseAdmin.from('contacts').insert(fields);
  const { data, error } = await q.select('id').single();
  if (error) throw error;
  return data;
}

/**
 * Best-effort back-link qr_scans → the lead it produced. Non-fatal on failure.
 */
export async function backlinkQrScan({ qrScanId, enquiryId, contactId }) {
  if (!qrScanId) return;
  try {
    await supabaseAdmin
      .from('qr_scans')
      .update({ lead_enquiry_id: enquiryId, lead_contact_id: contactId })
      .eq('id', qrScanId);
  } catch (e) {
    console.warn('qr_scans back-link failed (non-fatal):', e.message);
  }
}

/**
 * Insert the multi-touch follow-up cadence for the customer type.
 * `contactName` + `description` are used to build task titles + descriptions.
 */
export async function writeCadenceTasks(contactId, form, contactName, description) {
  const cadence = pickCadence(form);
  const cadenceTasks = cadence.map(step => ({
    title:       `${step.title} — ${contactName}`,
    description,
    contact_id:  contactId,
    due_date:    new Date(Date.now() + step.offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    priority:    step.offsetDays === 0 ? 'high' : step.priority,
    status:      'todo',
    task_type:   step.task_type,
    assignee_id: null,
  }));
  await supabaseAdmin.from('tasks').insert(cadenceTasks);
}

/**
 * On UPDATE path (partial → new), mark the mid-flow bail-out task as done so
 * sales doesn't chase someone who just finished the wizard.
 */
export async function cleanupPartialTasks(contactId) {
  try {
    await supabaseAdmin
      .from('tasks')
      .update({ status: 'done', description: 'Auto-completed: customer finished the wizard.' })
      .eq('contact_id', contactId)
      .like('title', 'Mid-flow partial — bail-out follow-up%')
      .eq('status', 'todo');
  } catch (e) {
    console.warn('partial-task cleanup failed (non-fatal):', e.message);
  }
}

/**
 * Log a dashboard Recent Activity row.
 */
export async function writeActivity({ contactId, description, metadata }) {
  await supabaseAdmin.from('activities').insert({
    type: 'system',
    description,
    contact_id: contactId,
    metadata,
  });
}

/**
 * Fetch bill-analysis review flag so team email can warn sales bills need
 * verification. Returns null if no analysisId or no review required.
 */
export async function fetchReviewFlag({ analysisId, enquiryId }) {
  if (!analysisId) return null;
  try {
    const { data: analysisRow } = await supabaseAdmin
      .from('bill_analyses')
      .select('id, review_required, review_reasons')
      .eq('id', analysisId)
      .maybeSingle();
    if (analysisRow?.review_required) {
      return {
        analysis_id:     analysisRow.id,
        enquiry_id:      enquiryId,
        review_required: true,
        review_reasons:  analysisRow.review_reasons || [],
      };
    }
  } catch (e) {
    console.warn('Could not fetch analysis review flag (non-fatal):', e.message);
  }
  return null;
}

/**
 * Fire team + customer emails in parallel. Both non-fatal — we never block
 * the API response on email problems. Team email skipped when the partial
 * capture already notified them.
 */
export function fireLeadNotifications({ form, calculation, leadScore, reviewFlag, skipTeamEmail }) {
  // Not awaited — returns a promise for orchestration to fire-and-forget.
  return Promise.all([
    (async () => {
      if (skipTeamEmail) return;
      try {
        const { data: admins } = await supabaseAdmin
          .from('users')
          .select('email')
          .eq('role', 'admin')
          .eq('is_active', true);
        const recipients = (admins || []).map(u => u.email).filter(Boolean);
        await sendTeamNewLeadEmail({ form, calculation, leadScore, recipients, reviewFlag });
      } catch (e) {
        console.error('Team notification email failed (non-fatal):', e.message);
      }
    })(),
    (async () => {
      try {
        await sendCustomerAckEmail({ form });
      } catch (e) {
        console.error('Customer ack email failed (non-fatal):', e.message);
      }
    })(),
  ]);
}

/**
 * Kick off the Google Solar roof-analysis pipeline: geocode address → analyseRoof.
 * Fire-and-forget — API response returns fast; pipeline runs on the Node event
 * loop. Errors are captured in the roof_analyses row rather than surfaced.
 * Skipped entirely when the caller passes skipRoofAnalysis=true (typically
 * because POC's own /api/poc/roof/analyse already ran and we have the id).
 */
export function fireRoofAnalysisPipeline({ enquiryId, contactId, form }) {
  Promise.resolve().then(async () => {
    const composedAddress =
      form.address ||
      [form.addressStreet, form.addressSuburb, form.addressCity].filter(Boolean).join(', ') ||
      'unknown';

    let latitude  = typeof form.latitude  === 'number' ? form.latitude  : undefined;
    let longitude = typeof form.longitude === 'number' ? form.longitude : undefined;

    const needsGeocode = latitude === undefined || longitude === undefined;
    if (env.googleSolar.enabled && needsGeocode && composedAddress !== 'unknown') {
      try {
        const reservation = await reserveQuota('geocoding');
        if (reservation.allowed) {
          const geo = await geocodeAddress(composedAddress);
          if (geo.ok) {
            latitude  = geo.latitude;
            longitude = geo.longitude;
          } else {
            console.warn(`[leadService] geocode failed for enquiry=${enquiryId} reason=${geo.reason}: ${geo.error}`);
          }
        } else {
          console.warn(`[leadService] geocode skipped for enquiry=${enquiryId} — quota exhausted (${reservation.callCount}/${reservation.quota})`);
        }
      } catch (err) {
        console.warn(`[leadService] geocode threw for enquiry=${enquiryId}: ${err?.message || err}`);
      }
    }

    await analyseRoof({
      enquiryId,
      address:   composedAddress,
      latitude,
      longitude,
      contactId,
    });
  }).catch(err => console.error('[leadService] roof analysis pipeline failed:', err?.message || err));
}

/**
 * PHASE 6.6 (2026-08-20, ticket A7) — auto-create a projects_v2 row on lead
 * submission with FULL POC design payload attached. Sales team sees the
 * project appear in the PM Tool immediately, with all the roof-analysis + tier
 * + price + hardware info intact — no manual copy-paste from the enquiry.
 *
 * Called only when createOrUpdateLead is invoked with createProjectV2=true
 * (the new /api/quote/submit-with-design endpoint and /api/poc/leads path).
 * Old wizard leads still go through the sales-rep-promotes-manually path.
 *
 * Non-fatal on failure: we don't want a projects_v2 write failure to cause
 * the customer's submit to fail — they'd re-submit and get a duplicate lead.
 * Failure is logged; caller gets projectId=null. Follow-up ticket can add a
 * retry-cron for missing project rows.
 *
 * @param {object} args
 * @param {string} args.enquiryId — website_enquiries FK (informational; the
 *                                  actual FK lives on quotes / other tables
 *                                  that reference projects_v2)
 * @param {string} args.contactId — contacts FK
 * @param {object} [args.design]  — POC design payload
 * @param {string} [args.address] — customer's confirmed address
 * @param {object} [args.customer] — { customerType }
 * @returns {Promise<{projectId} | null>}
 */
export async function writeProjectV2({ contactId, design, address, customer }) {
  try {
    const systemType = design?.batteryKwh > 0 ? 'hybrid' : 'on-grid';
    const insertRow = {
      contact_id:          contactId,
      address:             address || null,
      gps_lat:             typeof design?.lat === 'number' ? design.lat : null,
      gps_lng:             typeof design?.lng === 'number' ? design.lng : null,
      project_type:        customer?.customerType === 'commercial' ? 'commercial' : 'residential_rooftop',
      system_size_kw:      design?.systemKwp || null,
      battery_kwh:         design?.batteryKwh || null,
      panel_count:         design?.panelCount || null,
      system_type:         systemType,
      estimated_value_nzd: design?.tierPrice || null,
      // lane_status left as DEFAULT (all 5 lanes not_started). Sales lane
      // effectively starts the moment this row exists — sales team sees it
      // on the pipeline and works it. VPP fields left NULL until commissioning.
      // primary_owner_id NULL — auto-assign or sales-lead picks it up.
      notes: [
        design?.chosenTierId  && `Chosen tier: ${design.chosenTierId}`,
        design?.tierPrice     && `Quoted price: $${Math.round(design.tierPrice).toLocaleString()}`,
        design?.roofSource    && `Roof source: ${design.roofSource}`,
        design?.evIncluded    && 'Wattpilot EV charger included',
      ].filter(Boolean).join(' | ') || null,
    };

    const { data: project, error } = await supabaseAdmin
      .from('projects_v2')
      .insert(insertRow)
      .select('id, share_token')       // Phase B4 (2026-08-21) — share_token
      .single();                       // needed for magic-link customer viewer

    if (error) {
      console.error('[leadService.writeProjectV2] insert failed (non-fatal):', error.message);
      return null;
    }
    console.log(`[leadService.writeProjectV2] created projects_v2 ${project.id} for contact ${contactId}`);
    return { projectId: project.id, shareToken: project.share_token };
  } catch (e) {
    console.error('[leadService.writeProjectV2] threw (non-fatal):', e?.message || e);
    return null;
  }
}

// ── Phase B4 (2026-08-21) — customer proposal delivery ───────────────────
// Fire-and-forget. Runs AFTER the enquiry + contact + projects_v2 rows are
// written (so we have projectCode + shareToken for the magic link). Never
// blocks the API response: PDF gen takes 1-3 s (puppeteer) + Resend adds
// another ~500 ms, so awaiting these would push submit latency past the
// 3-s bar that "instant quote" implies. Any failure (Chromium unavailable,
// Resend outage, malformed tier) is logged and the customer still gets
// the fast sendCustomerAckEmail from fireLeadNotifications.
//
// Guardrails — this only fires when ALL of these are true:
//   • not draftMode          (progressive saves shouldn't email a PDF)
//   • form.email present     (nothing to send to)
//   • design.chosenTierId    (real tier picked, not just an address ping)
//   • pricing looks sane     (skip the delivery if we'd be shipping $0)
//
// The PDF is built from a small adapter that turns the merged-flow's tier
// summary into the shape pdfService.generateProposalPDF() expects — no new
// PDF renderer, we reuse the existing branded one so the customer email
// looks identical to what /api/quote/pdf produces today.
function buildProposalObjectForPdf({ form, design, tier, calculation }) {
  const priceTotal = tier?.pricing?.total_incl_gst || tier?.price || design?.tierPrice || 0;
  const panels     = tier?.panel?.count || tier?.panels || design?.panelCount || 0;
  const systemKw   = tier?.system_size_kwp || tier?.kwp || design?.systemKwp || 0;
  const paybackYrs = tier?.payback?.expected_years || tier?.payback_yrs || tier?.payback_years
                  || calculation?.paybackYears || null;
  const annualSav  = tier?.savings?.expected_annual_nzd || tier?.savings_annual
                  || calculation?.annualSavings || null;
  const monthlySav = annualSav ? Math.round(annualSav / 12) : (calculation?.monthlySavings || null);
  const roiPct     = calculation?.roi || (paybackYrs ? Math.round(100 / paybackYrs) : null);
  // Rough CO₂ per kWh in NZ grid (~0.12 kg/kWh, 2024). Annual kWh ~ 1300 * kWp
  // for Auckland avg PVGIS yield. Ship a conservative rounded estimate — the
  // real proposal page has the audited engine number.
  const annualKwh   = Math.round(systemKw * 1300);
  const co2TonsYear = Math.round((annualKwh * 0.12) / 1000 * 10) / 10;

  return {
    name:            [form.firstName, form.lastName].filter(Boolean).join(' ').trim() || 'Customer',
    email:           form.email || '',
    location:        form.address || '',
    system_size_kw:  systemKw,
    panel_count:     panels,
    total_cost:      priceTotal,
    payback_years:   paybackYrs || '—',
    monthly_savings: monthlySav || 0,
    annual_savings:  annualSav  || 0,
    co2_tons_year:   co2TonsYear || 0,
    roi_percent:     roiPct     || '—',
    mode:            'preliminary',   // matches the "site survey pending" copy
    // No lineItems — the residential quick-quote doesn't have per-SKU BoM yet.
    // The BoM block is skipped when lineItems is empty (pdfService handles).
  };
}

export function fireCustomerProposalDelivery({ form, design, calculation, projectId, shareToken }) {
  if (!form?.email)          return null;
  if (!design?.chosenTierId) return null;
  const tier = design.fullPayload?.design?.chosen_tier
            || design.fullPayload?.design?.tiers?.find(t => (t.id || t.tier_id) === design.chosenTierId)
            || design.fullPayload?.chosen_tier
            || null;
  // If we can't reconstruct the tier from the payload, fall back to the flat
  // fields on `design` so we still ship a usable PDF (system size + price).
  const tierForRender = tier || {
    label:              design.chosenTierId,
    system_size_kwp:    design.systemKwp,
    panels:             design.panelCount,
    battery_kwh:        design.batteryKwh,
    wattpilot_included: !!design.evIncluded,
    price:              design.tierPrice,
  };
  const priceTotal = tierForRender?.pricing?.total_incl_gst || tierForRender?.price || design.tierPrice || 0;
  if (!priceTotal || priceTotal < 1000) {
    console.warn('[leadService.fireCustomerProposalDelivery] price looks bogus, skipping:', priceTotal);
    return null;
  }

  const projectCode = projectId ? String(projectId).slice(0, 8) : null;

  Promise.resolve().then(async () => {
    let pdfBuffer, icsBuffer, icsMeta;
    try {
      const proposalObj = buildProposalObjectForPdf({ form, design, tier: tierForRender, calculation });
      pdfBuffer = await generateProposalPDF(proposalObj);
    } catch (e) {
      console.error('[leadService.fireCustomerProposalDelivery] PDF gen failed (email will send without PDF):', e?.message || e);
    }
    try {
      icsMeta = buildCallbackHoldIcs({
        customerName:  [form.firstName, form.lastName].filter(Boolean).join(' ').trim() || 'there',
        customerEmail: form.email,
      });
      icsBuffer = icsMeta.buffer;
    } catch (e) {
      console.error('[leadService.fireCustomerProposalDelivery] ICS build failed (email will send without hold):', e?.message || e);
    }
    try {
      await sendCustomerProposalDeliveryEmail({
        form,
        tier:          tierForRender,
        projectCode,
        shareToken,
        pdfBuffer,
        pdfFilename:   `GoldenRay-Solar-Proposal${projectCode ? '-' + projectCode : ''}.pdf`,
        icsBuffer,
        icsFilename:   icsMeta?.filename || 'goldenray-callback-hold.ics',
        callbackLabel: icsMeta ? formatNztLabel(icsMeta.startAt) : null,
      });
    } catch (e) {
      console.error('[leadService.fireCustomerProposalDelivery] Resend send failed (non-fatal):', e?.message || e);
    }
  }).catch(err => console.error('[leadService.fireCustomerProposalDelivery] top-level threw:', err?.message || err));
}

// ── Main orchestrator ──────────────────────────────────────────────────────

/**
 * createOrUpdateLead — the canonical lead-write path.
 *
 * Handles both fresh INSERT and "promote from partial" UPDATE paths.
 * Same behavior as routes/quote.js /submit today when called with the
 * `form` shape it currently accepts.
 *
 * @param {object}  args
 * @param {object}  args.form                       — legacy wizard shape (contact + address + calculation-friendly fields + UTM)
 * @param {object}  [args.design]                   — NEW: POC output when called by /api/quote/submit-with-design. Shape: { chosenTierId, systemKwp, panelCount, batteryKwh, evIncluded, tierPrice, roofSource, lat, lng, fullPayload }
 * @param {boolean} [args.skipRoofAnalysis=false]   — POC path passes true (analysis already run)
 * @param {boolean} [args.createProjectV2=false]    — Phase 6.6 flag (new endpoint only)
 * @param {boolean} [args.draftMode=false]          — Phase B2 (2026-08-20): partial progressive capture from /api/quote/draft. Sets status='partial', skips cadence tasks + activity log + team/customer email dispatch. Enquiry + contact rows still upserted so sales team sees the lead in /portal but with 'partial' status — 24h bail-out job handles chase.
 * @returns {Promise<{enquiryId, contactId, projectId, leadScore, calculation}>}
 */
export async function createOrUpdateLead({ form, design = null, skipRoofAnalysis = false, createProjectV2 = false, draftMode = false }) {
  if (!form) throw new Error('createOrUpdateLead: form is required');
  if (!supabaseAdmin) throw new Error('Database not configured.');

  // UPDATE path when the wizard was preceded by /submit-partial (QR visitor)
  // and we're now enriching the existing row rather than creating a duplicate.
  const isUpdate = !!(form.enquiry_id && form.contact_id);

  // Centralised validation — friendly messages BEFORE DB CHECK constraint fires.
  const validationErrors = validateQuoteForm(form);
  if (validationErrors.length) {
    const err = new Error(validationErrors[0]);
    err.status = 400;
    err.errors = validationErrors;
    throw err;
  }

  // Server-side solar calculation. Landing page doesn't need a pre-calc step.
  const calculation = form.monthlyBill
    ? calculateSolar({
        monthlyBill: form.monthlyBill,
        electricityRate: form.electricityRate || 0.32,
        systemType: deriveSystemType(form),
        batteryOption: form.batteryOption,
      })
    : null;

  // Lead score — 10-100 based on form completeness.
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

  // UTM + QR-scan attribution — validate qr_scan_id shape to avoid SQL errors.
  const utmSource   = form.utm_source   ? String(form.utm_source).slice(0, 50)   : null;
  const utmMedium   = form.utm_medium   ? String(form.utm_medium).slice(0, 50)   : null;
  const utmCampaign = form.utm_campaign ? String(form.utm_campaign).slice(0, 80) : null;
  const qrScanId = (form.qr_scan_id && /^[0-9a-f-]{36}$/i.test(form.qr_scan_id))
    ? form.qr_scan_id : null;

  // ── 1. website_enquiries INSERT or UPDATE ────────────────────────────────
  // Legacy columns (populated by both old wizard and new merged flow).
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
    lead_score:  draftMode ? 25 : leadScore,   // low score on partial; full submit rescores
    status:      draftMode ? 'partial' : 'new',
    utm_source:   utmSource,
    utm_medium:   utmMedium,
    utm_campaign: utmCampaign,
    qr_scan_id:   qrScanId,
  };

  // Merged-flow columns (migration 042). Populated only when `design` is
  // provided by the caller — old wizard leaves all of these NULL. The full
  // JSON blob is stored so PDFs can be regenerated later and sales can
  // audit exactly what the customer saw at submit time.
  if (design) {
    Object.assign(enquiryFields, {
      submission_source:    'get_quote_with_design',
      chosen_tier_id:       design.chosenTierId       || null,
      system_kwp:           design.systemKwp          || null,
      panel_count:          design.panelCount         || null,
      battery_kwh_chosen:   design.batteryKwh         || null,
      ev_charger_included:  typeof design.evIncluded === 'boolean' ? design.evIncluded : null,
      tier_price:           design.tierPrice          || null,
      roof_source:          design.roofSource         || null,
      coords_lat:           typeof design.lat === 'number' ? design.lat : null,
      coords_lng:           typeof design.lng === 'number' ? design.lng : null,
      poc_design_json:      design.fullPayload        || null,
      // Referral attribution (Phase 3, 2026-08-22) — raw code captured on
      // /get-quote?ref= landing. Stored even if the code fails the referral
      // lookup so we retain the breadcrumb for debugging. The authoritative
      // link is `referrals.referred_enquiry_id` inserted by attributeReferral
      // below, AFTER this enquiry row exists.
      referral_code_used:   design.referralCodeUsed   || null,
    });
  }

  const enquiry = await writeEnquiry(enquiryFields, { update: isUpdate, id: form.enquiry_id });

  // ── 2. contacts INSERT or UPDATE ─────────────────────────────────────────
  const name = [form.firstName, form.lastName].filter(Boolean).join(' ').trim() || 'Website Enquiry';
  const systemType = deriveSystemType(form);
  const contactSystemType = systemType === 'ppa' ? 'on-grid' : systemType;   // contacts.system_type CHECK
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
    lead_score:      draftMode ? 25 : leadScore,
    last_activity:   draftMode
      ? (isUpdate ? 'Draft updated (progressive capture)' : 'Draft started (email captured)')
      : (isUpdate ? 'Wizard completed (QR partial promoted)' : 'Website enquiry submitted'),
    notes,
    utm_source:   utmSource,
    utm_medium:   utmMedium,
    utm_campaign: utmCampaign,
    qr_scan_id:   qrScanId,
  };

  const contact = await writeContact(contactFields, { update: isUpdate, id: form.contact_id });

  // ── 2b. Back-link the scan event to the lead it generated ────────────────
  await backlinkQrScan({ qrScanId, enquiryId: enquiry.id, contactId: contact.id });

  // ── 2c. Google roof-analysis pipeline (fire-and-forget) ───────────────────
  if (!skipRoofAnalysis) {
    fireRoofAnalysisPipeline({ enquiryId: enquiry.id, contactId: contact.id, form });
  }

  // ── Draft-mode short-circuit — Phase B2 (2026-08-20) ─────────────────────
  // For progressive draft saves we ONLY want the enquiry + contact rows on
  // disk so the customer can be reached if they bail. No cadence tasks (would
  // spam sales with follow-ups on abandoned drafts), no activity log entry
  // (dashboard would fill with drafts that never become real leads), no
  // team/customer emails. When the customer completes Step 5, the
  // /submit-with-design endpoint promotes 'partial' → 'new' and fires all
  // of the above via a fresh createOrUpdateLead call (isUpdate=true path).
  if (draftMode) {
    // Phase B2 I3-followup (2026-08-21) — fire the "your quote is saved,
    // here's how to resume" email exactly once, on the first INSERT. On
    // subsequent debounced updates (isUpdate=true because the client echoes
    // enquiry_id + contact_id) we stay silent to avoid inbox spam.
    // Non-fatal — email failure never blocks the client's draft save.
    if (!isUpdate && form.email) {
      const publicBase = process.env.PUBLIC_BASE_URL || 'https://www.goldenrayenergy.co.nz';
      const resumeUrl  = `${publicBase}/get-quote/resume/${enquiry.id}`;
      Promise.resolve().then(async () => {
        try {
          await sendDraftSavedEmail({ form, resumeUrl });
        } catch (e) {
          console.error('[leadService] draft-saved email failed (non-fatal):', e?.message || e);
        }
      }).catch(err => console.error('[leadService] draft-saved dispatch threw:', err?.message || err));
    }
    return {
      enquiryId: enquiry.id,
      contactId: contact.id,
      projectId: null,
      leadScore: 25,
      calculation,
    };
  }

  // NOTE: We deliberately do NOT create a project row for OLD wizard submissions.
  // Sales reps qualify the lead through the cadence, then promote the contact
  // to a project when the customer commits (POST /api/leads/:id/promote-to-project).
  // The new merged flow uses createProjectV2=true to opt into Phase 6.6 behavior.
  let projectId = null;
  let shareToken = null;
  if (createProjectV2) {
    const project = await writeProjectV2({
      enquiryId: enquiry.id,
      contactId: contact.id,
      design,
      address: form.address,
      customer: { customerType: form.customerType },
    });
    projectId  = project?.projectId  || null;
    shareToken = project?.shareToken || null;
  }

  // ── Referral attribution — Phase 3 (2026-08-22) ────────────────────────
  // If the friend arrived at /get-quote?ref=CODE, the client passed the
  // code in design.referralCodeUsed. Run attribution (fraud check + cap
  // enforcement + insert into `referrals`) BUT do not block the customer's
  // submit if it fails — bad code / DB glitch / whatever, the enquiry row
  // is already durable and referral_code_used has been stored on it so an
  // admin can back-fill later. Fire-and-forget style, with the project_id
  // stitched in immediately after so the install-complete trigger can find
  // the referral by projects_v2 lookup.
  if (design?.referralCodeUsed && enquiry?.id) {
    Promise.resolve().then(async () => {
      try {
        const result = await attributeReferral(supabaseAdmin, {
          referralCodeText: design.referralCodeUsed,
          enquiryId:        enquiry.id,
          contactId:        contact.id,
        });
        if (result.attributed && projectId) {
          // Backfill the project link so the completion trigger can locate
          // this referral without a second lookup path.
          const { error: linkErr } = await supabaseAdmin
            .from('referrals')
            .update({ referred_project_id: projectId })
            .eq('id', result.id);
          if (linkErr) {
            console.warn('[leadService] referral project-link failed (non-fatal):', linkErr.message);
          }
        }
        if (!result.attributed) {
          console.log(`[leadService] referral not attributed: ${result.reason} (enquiry ${enquiry.id})`);
        } else {
          console.log(`[leadService] referral attributed (${result.status}, id=${result.id})`);
        }
      } catch (e) {
        console.error('[leadService] referral attribution threw (non-fatal):', e?.message || e);
      }
    }).catch(err => console.error('[leadService] referral dispatch threw:', err?.message || err));
  }

  // ── 3. Follow-up cadence tasks (Phase 7.3 type-aware) ────────────────────
  const team = teamForCustomerType(form);
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

  await writeCadenceTasks(contact.id, form, name, baseDescription);

  if (isUpdate) {
    await cleanupPartialTasks(contact.id);
  }

  // ── 4. Log dashboard activity ────────────────────────────────────────────
  await writeActivity({
    contactId: contact.id,
    description: `New website lead: ${name}${form.monthlyBill ? ` — $${form.monthlyBill}/mo bill` : ''}${calculation?.totalCost ? ` — est. $${Math.round(calculation.totalCost).toLocaleString()}` : ''}`,
    metadata: {
      enquiry_id:   enquiry.id,
      monthly_bill: form.monthlyBill || null,
      system_size:  calculation?.systemSize || null,
      total_cost:   calculation?.totalCost  || null,
      lead_score:   leadScore,
      source:       'website_form',
    },
  });

  // ── 5. Analysis review flag for team email context ───────────────────────
  const reviewFlag = await fetchReviewFlag({ analysisId: form.analysisId, enquiryId: enquiry.id });

  // ── 6. Team + customer emails (parallel, non-blocking) ───────────────────
  fireLeadNotifications({ form, calculation, leadScore, reviewFlag, skipTeamEmail: isUpdate });

  // ── 7. Customer proposal delivery — Phase B4 (2026-08-21) ────────────────
  // Fire-and-forget PDF proposal + .ics callback hold email. Only runs when
  // the caller provided a `design` payload with a chosen tier (i.e. the new
  // merged /get-quote flow via /submit-with-design). Old-wizard leads and
  // partial drafts fall through without a proposal email.
  if (design?.chosenTierId) {
    fireCustomerProposalDelivery({ form, design, calculation, projectId, shareToken });
  }

  return {
    enquiryId:  enquiry.id,
    contactId:  contact.id,
    projectId,
    shareToken,
    leadScore,
    calculation,
  };
}

// POC — Lead capture route (UPGRADED 2026-08-20, Phase A ticket A6).
//
// Called by /poc/quote when the customer clicks "Book my site survey" on
// QuoteStage. Was a console-log stub in POC scope; now translates the POC
// payload shape into the canonical leadService pipeline so the lead ends
// up in the same tables (website_enquiries + contacts + tasks + activities)
// as the old wizard AND writes the new POC-design columns (migration 042)
// + projects_v2 row (Phase 6.6 bundle via createProjectV2 flag).
//
// Payload shape (unchanged from POC — kept stable to not break /poc/quote):
//   {
//     contact:       { name, email, phone, preferred_time? },
//     quote_context: {
//       formatted_address, annual_kwh, recommended_tier, recommended_price,
//       payback_yrs, savings_25yr, from_manual_entry
//     }
//   }
//
// Mounted at POST /api/poc/leads (see routes/poc/index.js). Once /poc/quote
// is retired in Phase E, this route + its payload shape can be deleted —
// the new merged flow submits directly to /api/quote/submit-with-design.

import { Router } from 'express';
import { createOrUpdateLead } from '../../services/leadService.js';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Split "First Last" into { firstName, lastName }. Best-effort — anything
// after the first space becomes last name. Empty string → firstName is the
// whole input, lastName is null (contacts CHECK requires firstName not null).
function splitName(fullName) {
  const trimmed = (fullName || '').trim();
  const idx = trimmed.indexOf(' ');
  if (idx < 0) return { firstName: trimmed, lastName: null };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1).trim() || null };
}

router.post('/', async (req, res) => {
  try {
    const { contact = {}, quote_context = {} } = req.body || {};
    const { name, email, phone, preferred_time } = contact;

    // Same three required fields the /poc/quote form marks required.
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required.' });
    }
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Valid email address is required.' });
    }
    if (!phone || typeof phone !== 'string' || phone.replace(/\D/g, '').length < 6) {
      return res.status(400).json({ error: 'Valid phone number is required.' });
    }

    const { firstName, lastName } = splitName(name);

    // Map POC payload → the shape leadService.createOrUpdateLead expects.
    // `form` gets contact + address + preferred_time (as a note). `design`
    // gets the tier + price + address coords (address coords aren't in POC
    // payload today, so lat/lng are null — will be populated once /poc/quote
    // starts sending them).
    const form = {
      firstName,
      lastName,
      email:          email.trim().toLowerCase(),
      phone:          phone.trim(),
      address:        quote_context.formatted_address || null,
      installationType: 'residential',   // POC is residential-only today
      customerType:   'residential',
      callToDiscuss:  'yes',
      wizardIntent:   quote_context.from_manual_entry ? 'estimate' : 'bills',
      notes: [
        preferred_time              && `Preferred time: ${preferred_time}`,
        quote_context.annual_kwh    && `Annual kWh: ${quote_context.annual_kwh}`,
        quote_context.payback_yrs   && `Payback: ${quote_context.payback_yrs} yrs`,
        quote_context.savings_25yr  && `25-yr savings: $${quote_context.savings_25yr}`,
        quote_context.from_manual_entry && 'Customer used estimate slider (no bill).',
      ].filter(Boolean).join(' | ') || null,
    };

    const design = {
      chosenTierId: quote_context.recommended_tier  || null,
      tierPrice:    quote_context.recommended_price || null,
      // The POC payload today doesn't include roof-analysis details; leadService
      // will leave the other design columns null. /poc/quote can start sending
      // systemKwp, panelCount, batteryKwh, evIncluded, roofSource, lat/lng in
      // a follow-up client patch to fill more columns.
      fullPayload:  quote_context,
    };

    const result = await createOrUpdateLead({
      form,
      design,
      skipRoofAnalysis: true,     // POC ran its own analysis
      createProjectV2:  true,     // Phase 6.6 bundle
    });

    return res.status(201).json({
      ok:      true,
      lead_id: result.enquiryId,
      contact_id: result.contactId,
      project_id: result.projectId,
      message: 'Thanks — one of our installers will be in touch within 24 hours.',
    });
  } catch (e) {
    if (e.status === 400) {
      return res.status(400).json({ error: e.message, errors: e.errors });
    }
    console.error('[poc/leads] submit failed:', e);
    return res.status(500).json({ error: e.message || 'Lead submission failed.' });
  }
});

export default router;

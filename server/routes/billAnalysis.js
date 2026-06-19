import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { supabaseAdmin } from '../config/supabase.js';
import { parseBillPdf, parseBillImage } from '../services/billOcrService.js';
import { analyzeBills } from '../services/billAnalysisService.js';
import { normaliseFromBillAnalysis, normaliseFromEstimate } from '../services/pm/customerProfileService.js';
import { validateEstimateForm } from '../utils/validators.js';
import { sendTeamNewLeadEmail } from '../services/emailService.js';
import { parseSmartMeterCsv } from '../services/smartMeterCsvService.js';

// Track 1 + 2 — when the analyzer flags review_required AND the request came
// from a wizard visitor who'd already created a partial enquiry at Step 3,
// escalate immediately: notify the team, raise the bail-out task to 'high',
// and update the contact's last_activity so the portal shows the flag.
//
// Fully non-blocking — the response to the customer is never delayed by this.
async function escalatePartialOnReview({ contactId, enquiryId, analysisId, analysis, reqBody }) {
  if (!contactId && !enquiryId) return;
  if (!analysis?.review_required) return;

  // Best-effort updates; failures are logged but don't surface to the client.
  try {
    if (enquiryId) {
      await supabaseAdmin
        .from('website_enquiries')
        .update({ lead_score: 75 })  // bump score — flagged leads are higher priority
        .eq('id', enquiryId);
    }
    if (contactId) {
      await supabaseAdmin
        .from('contacts')
        .update({
          last_activity: `🚨 Bill analysis review required — ${(analysis.review_reasons || []).map(r => r.code).join(', ')}`,
          lead_score: 75,
        })
        .eq('id', contactId);
      // Promote the medium-priority bail-out task to 'high' urgency
      await supabaseAdmin
        .from('tasks')
        .update({
          priority: 'high',
          title: `🚨 REVIEW REQUIRED — call ASAP`,
          description: `[Sales] Bill analyzer flagged review_required. Reasons: ${(analysis.review_reasons || []).map(r => `${r.code}(${r.severity})`).join(', ')}. View analysis: /portal/enquiries/${enquiryId || ''}. Customer is mid-wizard; reach out before they bail.`,
        })
        .eq('contact_id', contactId)
        .like('title', 'Mid-flow partial — bail-out follow-up%')
        .eq('status', 'todo');
    }
  } catch (e) {
    console.warn('escalatePartialOnReview state update failed (non-fatal):', e.message);
  }

  // Fire team email — payload mimics the partial-capture flow so the email
  // template's existing review-flag rendering kicks in.
  try {
    const { data: admins } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('role', 'admin')
      .eq('is_active', true);
    const recipients = (admins || []).map(u => u.email).filter(Boolean);
    if (recipients.length === 0) return;
    await sendTeamNewLeadEmail({
      form: {
        firstName: reqBody.firstName || '(customer)',
        email:     reqBody.email      || '',
        phone:     reqBody.phone      || '',
        wizardIntent: 'bills',
        _partial: true,
        _reviewMidFlow: true,
      },
      calculation: null,
      leadScore: 75,
      recipients,
      reviewFlag: {
        analysis_id:     analysisId,
        enquiry_id:      enquiryId,
        review_required: true,
        review_reasons:  analysis.review_reasons || [],
      },
    });
  } catch (e) {
    console.error('escalatePartialOnReview email failed (non-fatal):', e.message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Split a NZ service-address string into street / suburb / city / postcode.
// Handles common formats:
//   "31A HILLVIEW AVENUE, NEW WINDSOR, AUCKLAND 0600"
//   "4/11 HATFIELD PLACE, ALBANY HEIGHTS, AUCKLAND"
//   "75 MAHIA ROAD, AUCKLAND" (no suburb)
//   "31A HILLVIEW AVENUE NEW WINDSOR AUCKLAND 0600" (no commas)
//
// Returns {street, suburb, city, postcode} with nulls for any segment that
// couldn't be confidently identified.
// NZ street-type tokens that mark the end of the street component. Order
// matters only in that we test the longer multi-word ones first ("BOULEVARD"
// before "BLVD" — actually they're checked as whole tokens so order doesn't
// matter, but kept here for documentation of the supported set).
const NZ_STREET_TYPES = new Set([
  'STREET','ST','ROAD','RD','AVENUE','AVE','LANE','LN','DRIVE','DR',
  'CRESCENT','CRES','CR','PLACE','PL','WAY','COURT','CT','TERRACE','TCE',
  'BOULEVARD','BLVD','CLOSE','CL','GROVE','GR','PARK','SQUARE','SQ',
  'GARDENS','GDNS','MEWS','PARADE','PDE','PROMENADE','QUAY','RISE','HEIGHTS','HTS',
  'PARKWAY','PKWY','CIRCLE','CIR','LOOP','TRAIL','HIGHWAY','HWY',
]);

// Known NZ cities + main metro areas. When parsing "STREET-NAME ST SUBURB CITY"
// without commas, the trailing one or two tokens are typically the city.
const NZ_CITIES = new Set([
  'AUCKLAND','WELLINGTON','CHRISTCHURCH','HAMILTON','TAURANGA','DUNEDIN',
  'NAPIER','PALMERSTON NORTH','NELSON','ROTORUA','NEW PLYMOUTH','WHANGAREI',
  'INVERCARGILL','WANGANUI','GISBORNE','TIMARU','HASTINGS','BLENHEIM',
  'MASTERTON','LEVIN','TAUPO','PUKEKOHE','HAVELOCK NORTH','UPPER HUTT',
  'LOWER HUTT','PORIRUA','PAPAKURA','MANUKAU','NORTH SHORE','WAITAKERE',
  'QUEENSTOWN','WANAKA','OAMARU','ASHBURTON',
]);

export function splitNzAddress(addr) {
  if (!addr || typeof addr !== 'string') return {};
  let cleaned = addr.replace(/\s+/g, ' ').trim();
  // Strip "NEW ZEALAND" / "AOTEAROA" / "NZ" country suffix when present —
  // otherwise the city slot picks up "ZEALAND" instead of the real city.
  cleaned = cleaned.replace(/\b(NEW ZEALAND|AOTEAROA NEW ZEALAND|AOTEAROA|NZ)\b\.?\s*$/i, '').trim();
  // Pull a trailing 4-digit postcode if present.
  let postcode = null;
  const pcMatch = cleaned.match(/\b(\d{4})\s*$/);
  let body = cleaned;
  if (pcMatch) { postcode = pcMatch[1]; body = body.slice(0, pcMatch.index).trim(); }
  // Country suffix could also come AFTER the postcode (rare). Strip again.
  body = body.replace(/\b(NEW ZEALAND|AOTEAROA NEW ZEALAND|AOTEAROA|NZ)\b\.?\s*$/i, '').trim();
  // Comma-separated case (most reliable)
  if (body.includes(',')) {
    const parts = body.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      return { street: parts[0], suburb: parts[1], city: parts[2], postcode };
    }
    if (parts.length === 2) {
      return { street: parts[0], suburb: null, city: parts[1], postcode };
    }
    if (parts.length === 1) {
      return { street: parts[0], suburb: null, city: null, postcode };
    }
  }
  // ── No-comma path (e.g. Genesis bill "31A HILLVIEW AVENUE NEW WINDSOR
  //    AUCKLAND") — detect the street-type token to split street | rest, then
  //    split rest into suburb | city using the known NZ_CITIES set. Falls
  //    through to "everything into street" only when neither heuristic fires.
  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    // Find the LAST street-type token (some addresses have e.g. "PARK AVE"
    // where PARK alone would match — taking the last match keeps street type
    // at the right boundary).
    let streetTypeIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (NZ_STREET_TYPES.has(tokens[i].toUpperCase().replace(/[.,]/g, ''))) {
        streetTypeIdx = i;
      }
    }
    if (streetTypeIdx > 0 && streetTypeIdx < tokens.length - 1) {
      const street = tokens.slice(0, streetTypeIdx + 1).join(' ');
      const rest   = tokens.slice(streetTypeIdx + 1);
      // City heuristic: longest trailing substring that matches a known city.
      // Try the last 2 tokens first ("NORTH SHORE"), then last 1 ("AUCKLAND").
      let city = null, suburb = null;
      if (rest.length >= 2 && NZ_CITIES.has(rest.slice(-2).join(' ').toUpperCase())) {
        city   = rest.slice(-2).join(' ');
        suburb = rest.slice(0, -2).join(' ') || null;
      } else if (rest.length >= 1 && NZ_CITIES.has(rest[rest.length - 1].toUpperCase())) {
        city   = rest[rest.length - 1];
        suburb = rest.slice(0, -1).join(' ') || null;
      } else {
        // Unknown trailing — assume last token is city (NZ residential default).
        city   = rest[rest.length - 1] || null;
        suburb = rest.slice(0, -1).join(' ') || null;
      }
      return { street, suburb: suburb || null, city: city || null, postcode };
    }
  }
  // Fallback: no street-type token recognised. Whole thing → street.
  return { street: body, suburb: null, city: null, postcode };
}

// ────────────────────────────────────────────────────────────────────────────
// P5 (A2) — Address write-through to contacts row.
//
// After a bill analysis successfully inserts (or links), propagate the
// detected region + postcode + street/suburb/city back to the contact's
// record. Two safety guards:
//   • Only writes when a contact_id is present
//   • SKIPS fields that are already populated on the contact — never
//     overwrites rep-entered data with parser output
// ────────────────────────────────────────────────────────────────────────────
// Bug #6 fix — placeholder detector. Loosens the "never overwrite" guard for
// values that are clearly auto-generated boilerplate (empty / "Unknown" /
// "Website Enquiry" / quote-ref-style names). Real rep-typed addresses are
// still protected.
function isPlaceholderText(s) {
  if (!s) return true;
  const t = String(s).trim();
  if (!t) return true;
  if (/^(unknown|n\/?a|null|none|-+|website enquiry)$/i.test(t)) return true;
  if (/^[A-Z]{2,4}-\d{4}/.test(t)) return true;  // e.g. "PR-KRISHAN-2026-001"
  return false;
}

async function writeAddressThroughToContact(supabaseAdmin, contactId, { region, postcode, service_address, customer_name, icp_number }) {
  if (!supabaseAdmin || !contactId) return;
  if (!region && !postcode && !service_address && !customer_name && !icp_number) return;
  try {
    const { data: existing } = await supabaseAdmin
      .from('contacts')
      .select('id, name, postcode, street, suburb, city, icp_number')
      .eq('id', contactId)
      .maybeSingle();
    if (!existing) return;
    const updates = {};
    if (postcode && isPlaceholderText(existing.postcode)) updates.postcode = postcode;
    // P5 (A2)+(A3) Customer name — capture from bill header.
    if (customer_name && isPlaceholderText(existing.name)) updates.name = customer_name;
    // Bug #6 fix — propagate ICP from bill analysis to contact.
    if (icp_number && isPlaceholderText(existing.icp_number)) updates.icp_number = icp_number;
    if (service_address) {
      const split = splitNzAddress(service_address);
      if (split.street   && isPlaceholderText(existing.street))   updates.street   = split.street;
      if (split.suburb   && isPlaceholderText(existing.suburb))   updates.suburb   = split.suburb;
      if (split.city     && isPlaceholderText(existing.city))     updates.city     = split.city;
      if (split.postcode && isPlaceholderText(existing.postcode) && !updates.postcode) updates.postcode = split.postcode;
    }
    if (Object.keys(updates).length === 0) return;
    await supabaseAdmin.from('contacts').update(updates).eq('id', contactId);
  } catch (e) {
    console.error('writeAddressThroughToContact failed (non-fatal):', e.message);
  }
}

const router = Router();

// Multipart upload — bills can be PDFs OR camera-captured photos. PDFs up
// to 5 MB; photos up to 10 MB (modern phone cameras produce larger files
// before compression). Hold in memory; we don't persist the file blob.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const ok = file.mimetype === 'application/pdf'
            || /^image\/(jpe?g|png|webp|heic|heif)$/i.test(file.mimetype)
            // Smart-meter CSVs — Mercury / Genesis / Contact / Powerswitch exports
            // Browsers report inconsistent MIME types for .csv (text/csv,
            // application/vnd.ms-excel, application/octet-stream), so fall
            // through to the .csv extension check as a backup.
            || /^(text\/csv|application\/csv|application\/vnd\.ms-excel|text\/plain|application\/octet-stream)$/i.test(file.mimetype)
            || name.endsWith('.csv');
    if (!ok) return cb(new Error(`Unsupported file type: ${file.mimetype} (expected PDF, image, or CSV)`), false);
    cb(null, true);
  },
});

// A file is "CSV-shaped" if its filename ends in .csv. We trust the extension
// because browser MIME reporting is unreliable for CSV (sometimes text/plain,
// sometimes application/octet-stream depending on OS + browser).
function isCsvFile(file) {
  if (!file?.originalname) return false;
  return file.originalname.toLowerCase().endsWith('.csv')
      || /^(text\/csv|application\/csv|application\/vnd\.ms-excel)$/i.test(file.mimetype);
}

// Dispatch one uploaded file to the right parser based on type.
// CSV files are handled separately in the upload route — this dispatcher
// covers PDF + image branches only.
async function parseUploadedFile(file) {
  if (file.mimetype === 'application/pdf') {
    return parseBillPdf(file.buffer, { fileName: file.originalname });
  }
  // image/* — camera capture
  return parseBillImage(file.buffer, { fileName: file.originalname, mimeType: file.mimetype });
}

// Convert smart-meter CSV monthly buckets into the synthesised-bill shape
// the analyzeBills() pipeline consumes. Each bucket becomes one "bill" with
// kwh_total + period dates.
//
// CSV cost handling:
//   • If the CSV has a cost column (Genesis, some Mercury exports) we use
//     the customer's actual dollars — most accurate.
//   • If only kWh data (Powerswitch, most Mercury exports) we estimate cost
//     using NZ-average residential rates ($0.30/kWh variable + $1.50/day
//     fixed). The analyser uses this for "current spend" baseline only —
//     it computes its own forward projections from retailer rate cards.
//     The estimated rows are flagged in raw_extracted_fields so sales can
//     refine later if the customer also uploads a bill.
const NZ_AVG_VARIABLE_PER_KWH_NZD = 0.30;   // ex-GST, post-discount average
const NZ_AVG_FIXED_PER_DAY_NZD    = 1.50;   // ex-GST average daily charge
function csvBucketsToBills(buckets, retailerName) {
  return buckets.map(b => {
    const [y, m] = b.month_year.split('-').map(Number);
    const periodStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay     = new Date(y, m, 0).getDate();
    const periodEnd   = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    let variableExGst, fixedExGst, gstNzd, totalNzd, costEstimated;
    if (b.usage_nzd != null) {
      // CSV included a cost column — use it as the source of truth.
      // Customer's printed usage_nzd is incl-GST; back out the ex-GST split.
      variableExGst = +(b.usage_nzd / 1.15).toFixed(2);
      fixedExGst    = +(b.days * NZ_AVG_FIXED_PER_DAY_NZD).toFixed(2);
      gstNzd        = +(b.usage_nzd - b.usage_nzd / 1.15).toFixed(2);
      totalNzd      = +b.usage_nzd.toFixed(2);
      costEstimated = false;
    } else {
      // CSV had kWh only. Estimate cost from NZ-average residential rates.
      variableExGst = +(b.kwh * NZ_AVG_VARIABLE_PER_KWH_NZD).toFixed(2);
      fixedExGst    = +(b.days * NZ_AVG_FIXED_PER_DAY_NZD).toFixed(2);
      const subtotal = variableExGst + fixedExGst;
      gstNzd        = +(subtotal * 0.15).toFixed(2);
      totalNzd      = +(subtotal + gstNzd).toFixed(2);
      costEstimated = true;
    }

    return {
      retailer:             retailerName,
      plan_name:            null,
      period_start:         periodStart,
      period_end:           periodEnd,
      days_in_period:       b.days,
      kwh_total:            b.kwh,
      kwh_peak:             null,
      kwh_off_peak:         null,
      kwh_exported:         null,
      fixed_charge_nzd:     fixedExGst,
      variable_charge_nzd:  variableExGst,
      export_credit_nzd:    null,
      gst_nzd:              gstNzd,
      total_nzd:            totalNzd,
      // CSV-from-customer = high confidence (real meter data) when cost
      // present; medium when we estimated cost ourselves.
      ocr_confidence:       costEstimated ? 0.75 : 0.95,
      file_name:            null,
      file_size_bytes:      0,
      ocr_text_excerpt:     '',
      parse_errors:         [],
      parse_method:         'smart_meter_csv',
      raw_extracted_fields: costEstimated
        ? { csv_cost_estimated_from_nz_avg_rates: true, variable_rate_used_per_kwh: NZ_AVG_VARIABLE_PER_KWH_NZD, fixed_rate_used_per_day: NZ_AVG_FIXED_PER_DAY_NZD }
        : { csv_cost_from_file: true },
    };
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

const ANON_TTL_DAYS = 90;
const ANON_TTL_MS   = ANON_TTL_DAYS * 24 * 60 * 60 * 1000;

function regionFromPostcode(postcode) {
  if (!postcode) return 'auckland';
  const code = parseInt(String(postcode).slice(0, 4), 10);
  if (!isFinite(code)) return 'auckland';
  // NZ postcode buckets — rough first-3-digit mapping to our region keys
  if (code >= 100  && code <= 1099) return 'northland';
  if (code >= 600  && code <= 2999) return 'auckland';
  if (code >= 3000 && code <= 3499) return 'waikato';
  if (code >= 3500 && code <= 3989) return 'bay_of_plenty';
  if (code >= 4000 && code <= 4499) return 'hawkes_bay';
  if (code >= 4500 && code <= 4799) return 'manawatu';
  if (code >= 5000 && code <= 6299) return 'wellington';
  if (code >= 7000 && code <= 7499) return 'tasman';
  if (code >= 7500 && code <= 8499) return 'canterbury';
  if (code >= 8500 && code <= 8989) return 'westland';
  if (code >= 9000 && code <= 9499) return 'otago';
  if (code >= 9500 && code <= 9899) return 'southland';
  return 'auckland';
}

// Map our internal analysis result onto the bill_analyses + bill_uploads
// schema for persistence.
// Bug #6 fix — most-frequent ICP across the bills in the analysis. Handles
// the (rare) landlord case where two bills carry different ICPs; tied counts
// fall back to the first-seen value.
function pickDominantIcp(bills) {
  const counts = new Map();
  for (const b of bills || []) {
    const icp = (b?.icp_number || '').trim();
    if (!icp) continue;
    counts.set(icp, (counts.get(icp) || 0) + 1);
  }
  if (counts.size === 0) return null;
  let bestIcp = null, bestN = -1;
  for (const [icp, n] of counts) {
    if (n > bestN) { bestIcp = icp; bestN = n; }
  }
  return bestIcp;
}

function buildAnalysisRow(analysis, { region, postcode, email, contactId, bills = [] }) {
  return {
    contact_id:                contactId || null,
    email:                     email || null,
    icp_number:                pickDominantIcp(bills),
    bills_uploaded:            analysis.aggregate.months_covered || 0,
    period_start:              analysis.aggregate.period_start || null,
    period_end:                analysis.aggregate.period_end || null,
    months_covered:            analysis.aggregate.months_covered || null,
    annual_kwh:                analysis.aggregate.annual_kwh,
    annual_spend_nzd:          analysis.aggregate.annual_spend_nzd,
    effective_rate_nzd:        analysis.aggregate.effective_rate_nzd,
    fixed_charge_total_nzd:    analysis.aggregate.fixed_charge_total_nzd,
    variable_charge_total_nzd: analysis.aggregate.variable_charge_total_nzd,
    retailer:                  analysis.aggregate.retailer,
    plan_name:                 analysis.aggregate.plan_name,
    region,
    postcode:                  postcode || analysis.region_postcode || null,
    patterns:                  analysis.patterns,
    scenarios:                 analysis.scenarios,
    recommended_system_kw:     analysis.recommendation.recommended_system_kw,
    recommended_battery_kwh:   analysis.recommendation.recommended_battery_kwh,
    recommended_orientation:   analysis.recommendation.recommended_orientation,
    recommended_package_slug:  analysis.recommendation.recommended_package_slug,
    switch_recommended:        !!analysis.switch_advice,
    switch_to_retailer:        analysis.switch_advice?.retailerName || null,
    switch_to_plan:            analysis.switch_advice?.planName     || null,
    switch_annual_saving:      analysis.switch_advice?.annualSaving || null,
    status:                    'completed',
    expires_at:                contactId ? null : new Date(Date.now() + ANON_TTL_MS).toISOString(),
    // v2 (migration 025) — review gate per accuracy rule-set §14
    review_required:           analysis.review_required || false,
    review_reasons:            analysis.review_reasons  || [],
    region_resolved_from:      analysis.region_resolved_from || null,
  };
}

function buildUploadRows(parsedBills, analysisId) {
  return parsedBills.map(b => ({
    analysis_id:          analysisId,
    file_name:            b.file_name,
    file_size_bytes:      b.file_size_bytes,
    file_hash:            b.file_hash || null,
    ocr_text_excerpt:     b.ocr_text_excerpt,
    ocr_confidence:       b.ocr_confidence,
    retailer:             b.retailer,
    plan_name:            b.plan_name,
    period_start:         b.period_start,
    period_end:           b.period_end,
    days_in_period:       b.days_in_period,
    kwh_total:            b.kwh_total,
    kwh_peak:             b.kwh_peak,
    kwh_off_peak:         b.kwh_off_peak,
    kwh_exported:         b.kwh_exported,
    fixed_charge_nzd:     b.fixed_charge_nzd,
    variable_charge_nzd:  b.variable_charge_nzd,
    export_credit_nzd:    b.export_credit_nzd,
    gst_nzd:              b.gst_nzd,
    total_nzd:            b.total_nzd,
    parse_errors:         b.parse_errors,
    // Per-bill cross-field validators (migration 029) — surfaces which bill in
    // a multi-bill upload tripped which check (line_items_dont_sum etc.) so
    // the team can drill into specific files instead of re-reading every PDF.
    parse_warnings:       b.parse_warnings       || [],
    // v2 (migration 025) — new extraction + per-field confidence
    service_address:      b.service_address      || null,
    icp_number:           b.icp_number           || null,
    network_distributor:  b.network_distributor  || null,
    tariff_components:    b.tariff_components    || [],
    payment_date:         b.payment_date         || null,
    due_date:             b.due_date             || null,
    raw_extracted_fields: b.raw_extracted_fields || {},
    ocr_text_full:        b.ocr_text_full        || null,
    field_confidence:     b.field_confidence     || {},
    parse_method:         b.parse_method         || null,
  }));
}

// ── PUBLIC: upload bills + run analysis ──────────────────────────────────
//
// Multipart form fields:
//   files          — 1 to 12 PDFs (multipart "files" field, repeated)
//   region         — optional override; we'll derive from postcode otherwise
//   postcode       — optional; used for regional irradiance
//   email          — optional; if provided, customer can come back to this
//                     analysis and we email the PDF report
//
// Response:
//   { id, analysis, parse_summary }
//   analysis is the full output from analyzeBills() — including
//   the transparency block.
router.post('/', upload.array('files', 12), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No bills uploaded. Drop one or more PDFs.' });
    }

    // 1. Parse each file → normalised bill objects.
    // Routes:
    //   • CSV  → smartMeterCsvService.parseSmartMeterCsv() → buckets → synthesised bills
    //   • PDF  → parseBillPdf() (text extraction + retailer parsers)
    //   • IMG  → parseBillImage() (Tesseract OCR + retailer parsers)
    //
    // Each CSV file expands into multiple synthesised bills (one per month
    // in the CSV); each PDF/image produces one. sourceFiles is parallel to
    // parsedBills only for PDF/image uploads (we don't store CSV originals
    // since the bill_uploads schema is bill-shaped, not CSV-shaped).
    const parsedBills = [];
    const sourceFiles = [];                          // parallel to parsedBills for PDF/image
    const ocrErrors = [];
    const csvSummaries = [];                         // per-CSV summary for the response
    // Within-batch dedup: hash each PDF/image and skip duplicates silently.
    // (CSV files are not deduped — they synthesise multiple bills.)
    const seenHashes = new Set();
    const skippedDuplicates = [];
    for (const f of req.files) {
      try {
        if (isCsvFile(f)) {
          const csvResult = parseSmartMeterCsv(f.buffer);
          if (csvResult.monthly_rows.length === 0) {
            ocrErrors.push({
              file: f.originalname,
              error: csvResult.warnings.map(w => w.reason).join('; ') || 'CSV had no usable rows.',
            });
            continue;
          }
          const retailerName = csvResult.retailer || 'Smart-meter CSV';
          const bills = csvBucketsToBills(csvResult.monthly_rows, retailerName);
          for (const b of bills) {
            parsedBills.push(b);
            sourceFiles.push(null);                  // CSV → no source-PDF to upload
          }
          csvSummaries.push({
            file_name:    f.originalname,
            source:       csvResult.source,
            retailer:     csvResult.retailer,
            granularity:  csvResult.granularity,
            row_count:    csvResult.row_count,
            month_count:  csvResult.monthly_rows.length,
            date_range:   csvResult.date_range,
            warnings:     csvResult.warnings,
          });
        } else {
          // Hash the file bytes for dedup + later persistence
          const fileHash = crypto.createHash('sha256').update(f.buffer).digest('hex');
          if (seenHashes.has(fileHash)) {
            skippedDuplicates.push({ file: f.originalname, file_hash: fileHash });
            continue;                                // silent skip within batch
          }
          seenHashes.add(fileHash);
          const parsed = await parseUploadedFile(f);
          parsed.file_hash = fileHash;               // surface to buildUploadRows
          parsedBills.push(parsed);
          sourceFiles.push(f);
        }
      } catch (e) {
        ocrErrors.push({ file: f.originalname, error: e.message });
      }
    }

    // Batch B #5 — Hard-fail on bills with missing critical fields.
    // A bill with no kwh_total or no total_nzd cannot produce usable
    // analysis output. Previously these were persisted to bill_uploads
    // anyway (with parse_errors) and only filtered out at aggregation
    // time, which cluttered the DB and risked leaks if aggregation logic
    // ever changes. Now: only usable bills get persisted. Rejected bills
    // are surfaced in the response with a clear reason so the rep can
    // re-upload them after fixing (or switch to manual entry).
    const billsWithSources = parsedBills.map((bill, i) => ({ bill, source: sourceFiles[i] }));
    const usable   = billsWithSources.filter(x => x.bill.kwh_total != null && x.bill.total_nzd != null);
    const rejected = billsWithSources.filter(x => !(x.bill.kwh_total != null && x.bill.total_nzd != null));
    const usableBills      = usable.map(x => x.bill);
    const usableSourceFiles = usable.map(x => x.source);
    const rejectedBills = rejected.map(x => {
      const errs = x.bill.parse_errors || [];
      const reason =
        errs.find(e => e.code === 'pdf_image_only_ocr_unavailable')?.reason ||
        errs.find(e => e.field === 'bill_type')?.reason ||
        errs.find(e => e.field === 'kwh_total')?.reason ||
        errs.find(e => e.field === 'all')?.reason ||
        'kWh or total amount could not be extracted from this bill.';
      return {
        file: x.bill.file_name || x.source?.originalname || 'unknown',
        retailer: x.bill.retailer || null,
        reason,
      };
    });

    if (usableBills.length === 0) {
      return res.status(400).json({
        error: 'Couldn\'t extract enough numbers from any of those PDFs to run the analysis. They may be image-scanned, gas bills, or use an unrecognised retailer layout.',
        rejected_bills: rejectedBills,
        ocr_errors: ocrErrors,
      });
    }

    // 2. Run the analysis
    const region = req.body.region || regionFromPostcode(req.body.postcode);
    const analysis = analyzeBills({ bills: usableBills, region });

    // 3. Persist
    // Step-3 partial ids — when present, the analysis row is linked to the
    // contact and review_required cases escalate immediately.
    const partialContactId = req.body.contact_id || null;
    const partialEnquiryId = req.body.enquiry_id || null;
    const row = buildAnalysisRow(analysis, {
      region,
      postcode: req.body.postcode,
      email:    req.body.email,
      contactId: partialContactId,
      bills:    usableBills,
    });

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('bill_analyses')
      .insert(row)
      .select('id')
      .single();
    if (insErr) throw insErr;

    // P5 (A2) + Address-writethrough v2 + Customer-name writethrough — propagate
    // region/postcode + the parsed street/suburb/city + the customer name from
    // the first usable bill back to the contact.
    writeAddressThroughToContact(supabaseAdmin, partialContactId, {
      region, postcode: req.body.postcode,
      service_address: usableBills.find(b => b.service_address)?.service_address || null,
      customer_name:   usableBills.find(b => b.customer_name)?.customer_name     || null,
      icp_number:      pickDominantIcp(usableBills),
    });

    // Fire-and-forget escalation when review_required + partial linked.
    escalatePartialOnReview({
      contactId: partialContactId,
      enquiryId: partialEnquiryId,
      analysisId: inserted.id,
      analysis,
      reqBody: req.body,
    });

    // Batch B #5 — only persist USABLE bills to bill_uploads (rejected
    // ones are surfaced in the response instead so the rep can re-upload).
    const uploadRows = buildUploadRows(usableBills, inserted.id);
    const { data: insertedUploads, error: uplErr } = await supabaseAdmin
      .from('bill_uploads')
      .insert(uploadRows)
      .select('id');
    if (uplErr) console.error('Bill uploads insert failed (non-fatal):', uplErr.message);

    // ── Store original bill PDFs/images to Supabase Storage ────────────────
    // Per business decision (Path A): store every USABLE bill so sales has
    // the source artifact when reviewing flagged bills + future re-analysis.
    // Rejected bills are NOT stored — they're returned to the rep with a
    // clear error so they can re-upload (clearer copy / different format).
    // Bucket name + setup script: server/scripts/setup-bill-storage.js.
    if (insertedUploads?.length === usableBills.length) {
      for (let i = 0; i < usableBills.length; i++) {
        const uploadId = insertedUploads[i].id;
        const file     = usableSourceFiles[i];
        // CSV-derived synthesised bills have no source-PDF/image to upload.
        if (!file) continue;
        const ext      = (file.originalname.match(/\.([a-z0-9]+)$/i)?.[1] || 'bin').toLowerCase();
        const path     = `${inserted.id}/${uploadId}.${ext}`;
        try {
          const { error: storeErr } = await supabaseAdmin.storage
            .from('customer-bills')
            .upload(path, file.buffer, {
              contentType: file.mimetype,
              upsert:      false,
            });
          if (storeErr) {
            console.warn(`Storage upload failed for ${file.originalname} (non-fatal): ${storeErr.message}`);
          } else {
            await supabaseAdmin.from('bill_uploads').update({
              file_storage_path: path,
              file_mime_type:    file.mimetype,
              file_uploaded_at:  new Date().toISOString(),
            }).eq('id', uploadId);
          }
        } catch (e) {
          console.warn(`Storage upload exception for ${file.originalname} (non-fatal): ${e.message}`);
        }
      }
    }

    // 4. Normalise into customer_profiles (Phase 1.5) — non-blocking.
    //    Only usable bills contribute (rejected bills have no values to normalise).
    const normResult = await normaliseFromBillAnalysis(inserted.id, { ...analysis, region }, usableBills);

    // source_door reflects how the data arrived — CSV uploads land in their
    // own bucket so analytics can split bill-upload customers from smart-meter
    // customers.
    const csvCount = csvSummaries.length;
    const pdfImgCount = usableBills.length - csvSummaries.reduce((s, c) => s + (c.month_count || 0), 0);
    const sourceDoor = csvCount > 0 && pdfImgCount === 0 ? 'smart_meter_csv'
                     : usableBills.length >= 6 ? 'bill_upload_12'
                     : 'bill_upload_partial';
    res.status(201).json({
      id: inserted.id,
      analysis,
      source_door: sourceDoor,
      confidence_band: normResult.profile?.confidence_band || 'medium',
      profile_normalised: normResult.ok,
      parse_summary: usableBills.map(b => ({
        retailer:        b.retailer,
        period_start:    b.period_start,
        period_end:      b.period_end,
        kwh_total:       b.kwh_total,
        total_nzd:       b.total_nzd,
        ocr_confidence:  b.ocr_confidence,
        parse_errors:    b.parse_errors,
      })),
      csv_summary: csvSummaries.length ? csvSummaries : undefined,
      ocr_errors: ocrErrors,
      skipped_duplicates: skippedDuplicates.length ? skippedDuplicates : undefined,
      // Batch B #5 — bills that couldn't be parsed (e.g. image-only PDFs, gas
      // bills, missing kWh). NOT persisted to bill_uploads. The rep should
      // re-upload these as clearer copies, or use manual entry on the quote.
      rejected_bills: rejectedBills.length ? rejectedBills : undefined,
    });
  } catch (e) {
    console.error('Bill analysis error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PUBLIC: estimate analysis from form inputs (Door B — no bill upload) ──
//
// For customers who don't have their bills handy but want the same
// 25-year projection. Takes inputs: monthly_spend, retailer (optional),
// postcode/region, household_size. Synthesizes a single bill that mimics
// what would have been parsed from a real PDF, then runs the SAME
// scenario engine the bill-upload path uses. Confidence is flagged as
// 'medium' since the inputs are user-reported, not retailer-verified.
//
// Body (JSON):
//   monthly_spend     — required, NZD
//   retailer_id       — optional, defaults to 'mercury'
//   postcode          — optional, derives region
//   region            — optional, overrides postcode
//   household_size    — optional, '1-2'/'3-4'/'5+'
//   email             — optional
import { readFileSync as fsReadFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirnameRetailers = path.dirname(fileURLToPath(import.meta.url));
const RETAILER_RATES = JSON.parse(fsReadFileSync(path.join(__dirnameRetailers, '../data/nz-retailer-rates.json'), 'utf8'));

function findRetailerRate(retailerId, region) {
  const retailer = RETAILER_RATES.retailers.find(r => r.id === retailerId)
                 || RETAILER_RATES.retailers.find(r => r.id === 'mercury');
  if (!retailer) return null;
  const planKey = retailer.default_plan;
  const plan = retailer.plans[planKey];
  if (!plan) return null;
  const regionRate = plan.regions[region] || plan.regions['auckland'];
  return {
    retailer:           retailer.name,
    plan_name:          plan.label,
    fixed_per_day_nzd:  regionRate.fixed_per_day_nzd,
    variable_per_kwh_nzd: typeof regionRate.variable_per_kwh_nzd === 'number'
                          ? regionRate.variable_per_kwh_nzd
                          : regionRate.peak_per_kwh_nzd || 0.30,
  };
}

router.post('/estimate', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    // Centralised validation
    const validationErrors = validateEstimateForm(req.body);
    if (validationErrors.length) {
      return res.status(400).json({ error: validationErrors[0], errors: validationErrors });
    }
    const monthlySpend = parseFloat(req.body.monthly_spend);

    const region    = req.body.region || regionFromPostcode(req.body.postcode);
    const retailerId = req.body.retailer_id || 'mercury';
    const rate = findRetailerRate(retailerId, region);
    if (!rate) return res.status(400).json({ error: 'Unknown retailer.' });

    // Back-compute kWh from monthly spend:
    //   monthly_spend = fixed_per_day × 30 + variable_per_kwh × kwh
    //   kwh = (monthly_spend - fixed_per_day × 30) / variable_per_kwh
    const fixedMonthly = rate.fixed_per_day_nzd * 30;
    const variableSpend = Math.max(0, monthlySpend - fixedMonthly);
    const estimatedKwh  = Math.round(variableSpend / rate.variable_per_kwh_nzd);

    if (estimatedKwh < 50) {
      return res.status(400).json({
        error: 'That monthly spend looks low for the selected retailer/region — please double-check your inputs.',
      });
    }

    // Synthesize 1 representative "bill" covering 30 days. The aggregator
    // will scale it up to annual. Confidence is medium because the
    // numbers came from form input, not a parsed retailer bill.
    const today = new Date();
    const periodEnd   = today.toISOString().slice(0, 10);
    const periodStart = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const syntheticBill = {
      retailer:             rate.retailer,
      plan_name:            rate.plan_name,
      period_start:         periodStart,
      period_end:           periodEnd,
      days_in_period:       30,
      kwh_total:            estimatedKwh,
      kwh_peak:             null,
      kwh_off_peak:         null,
      kwh_exported:         null,
      fixed_charge_nzd:     +fixedMonthly.toFixed(2),
      variable_charge_nzd:  +(variableSpend / 1.15).toFixed(2),    // pre-GST
      export_credit_nzd:    null,
      gst_nzd:              +(monthlySpend - monthlySpend / 1.15).toFixed(2),
      total_nzd:            monthlySpend,
      ocr_confidence:       0.65,                                  // medium — user-reported, not verified
      file_name:            null,
      file_size_bytes:      0,
      ocr_text_excerpt:     '',
      parse_errors:         [],
    };

    const analysis = analyzeBills({ bills: [syntheticBill], region });

    // Persist with door='estimate' marker
    const partialContactId = req.body.contact_id || null;
    const partialEnquiryId = req.body.enquiry_id || null;
    const row = buildAnalysisRow(analysis, {
      region, postcode: req.body.postcode, email: req.body.email, contactId: partialContactId,
      bills: [syntheticBill],
    });
    row.bills_uploaded = 0;  // marker: no bills uploaded for this analysis

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('bill_analyses')
      .insert(row)
      .select('id')
      .single();
    if (insErr) throw insErr;

    // P5 (A2) — write parsed region/postcode through to the contact row.
    writeAddressThroughToContact(supabaseAdmin, partialContactId,
      { region, postcode: req.body.postcode });

    escalatePartialOnReview({
      contactId: partialContactId,
      enquiryId: partialEnquiryId,
      analysisId: inserted.id,
      analysis,
      reqBody: req.body,
    });

    // Normalise into customer_profiles (Phase 1.5) — non-blocking
    const normResult = await normaliseFromEstimate(inserted.id, {
      monthly_spend:  monthlySpend,
      retailer_id:    retailerId,
      postcode:       req.body.postcode,
      household_size: req.body.household_size,
    }, { ...analysis, region });

    res.status(201).json({
      id: inserted.id,
      analysis,
      source_door: 'quote_form',
      confidence_band: 'medium',
      profile_normalised: normResult.ok,
      parse_summary: [{
        retailer: rate.retailer,
        period_start: periodStart,
        period_end: periodEnd,
        kwh_total: estimatedKwh,
        total_nzd: monthlySpend,
        ocr_confidence: 0.65,
        parse_errors: [{ field: 'all', reason: 'Estimated from form input (not parsed from a retailer bill)' }],
      }],
      ocr_errors: [],
    });
  } catch (e) {
    console.error('Bill analysis estimate error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────
// POST /api/bill-analysis/tabular  — manual rows fallback (Door D).
//
// When PDF parsing fails (image-only PDFs, unrecognised retailer, OCR low
// confidence), customers paste their bill numbers from a spreadsheet — one
// row per billing period:
//   { days, fixed_nzd, kwh, usage_nzd, total_nzd }
//
// Each row becomes a synthesised bill record with ocr_confidence=0.95
// (user-verified, higher than the 0.65 of /estimate's monthly-spend back-
// computation but slightly below a clean PDF parse). The existing scenario
// engine + normaliser run unchanged.
//
// Period dating: most-recent row first. The most-recent row's period_end
// defaults to today; we walk backward by `days` per row to assign the rest.
// Customers can optionally include a `month_year` (e.g. "2025-08") on any
// row to anchor it explicitly.
// ─────────────────────────────────────────────────────────────────────────
router.post('/tabular', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'Provide an array of bill rows in `rows`.' });
    }
    if (rows.length > 12) {
      return res.status(400).json({ error: 'Maximum 12 rows accepted (one per billing period).' });
    }

    // Validate each row — must have positive days, kwh, total. Fixed + usage
    // are recoverable from total if missing, but better to require them.
    const cleanRows = [];
    for (const [i, r] of rows.entries()) {
      const days     = Number(r.days);
      const fixed    = Number(r.fixed_nzd);
      const kwh      = Number(r.kwh);
      const usage    = Number(r.usage_nzd);
      const total    = Number(r.total_nzd);
      if (!Number.isFinite(days)  || days  <= 0 || days > 90)        return res.status(400).json({ error: `Row ${i + 1}: days must be 1-90` });
      if (!Number.isFinite(kwh)   || kwh   <= 0 || kwh > 10000)      return res.status(400).json({ error: `Row ${i + 1}: kWh must be 1-10,000` });
      if (!Number.isFinite(total) || total <= 0 || total > 10000)    return res.status(400).json({ error: `Row ${i + 1}: total must be $1-$10,000` });
      if (!Number.isFinite(fixed) || fixed <  0)                     return res.status(400).json({ error: `Row ${i + 1}: fixed charges must be ≥ 0` });
      if (!Number.isFinite(usage) || usage <  0)                     return res.status(400).json({ error: `Row ${i + 1}: usage charges must be ≥ 0` });
      cleanRows.push({ days, fixed_nzd: fixed, kwh, usage_nzd: usage, total_nzd: total, month_year: r.month_year || null });
    }

    // Walk dates backward from today (or from the latest explicit month_year).
    const anchor = new Date();
    let periodEnd = anchor;
    const bills = cleanRows.map((r, i) => {
      // If an explicit month_year is supplied, anchor period_end to that month-end.
      if (r.month_year) {
        const [y, m] = r.month_year.split('-').map(Number);
        if (y && m) periodEnd = new Date(y, m, 0);   // last day of given month
      }
      const periodEndIso  = periodEnd.toISOString().slice(0, 10);
      const periodStart   = new Date(periodEnd.getTime() - (r.days - 1) * 86400000);
      const periodStartIso = periodStart.toISOString().slice(0, 10);
      // Step back for next row (one day before this row's start)
      periodEnd = new Date(periodStart.getTime() - 86400000);

      // Variable_charge_nzd is stored ex-GST per the existing schema convention.
      const exGstUsage = +(r.usage_nzd / 1.15).toFixed(2);
      const gst        = +(r.total_nzd - r.total_nzd / 1.15).toFixed(2);

      return {
        retailer:             'Manual entry',
        plan_name:            null,
        period_start:         periodStartIso,
        period_end:           periodEndIso,
        days_in_period:       r.days,
        kwh_total:            r.kwh,
        kwh_peak:             null,
        kwh_off_peak:         null,
        kwh_exported:         null,
        fixed_charge_nzd:     +r.fixed_nzd.toFixed(2),
        variable_charge_nzd:  exGstUsage,
        export_credit_nzd:    null,
        gst_nzd:              gst,
        total_nzd:            +r.total_nzd.toFixed(2),
        ocr_confidence:       0.95,                     // user-verified — high
        file_name:            null,
        file_size_bytes:      0,
        ocr_text_excerpt:     '',
        parse_errors:         [],
      };
    });

    const region   = req.body.region || regionFromPostcode(req.body.postcode);
    const analysis = analyzeBills({ bills, region });

    const partialContactId = req.body.contact_id || null;
    const partialEnquiryId = req.body.enquiry_id || null;
    const row = buildAnalysisRow(analysis, {
      region, postcode: req.body.postcode, email: req.body.email, contactId: partialContactId,
      bills,
    });
    row.bills_uploaded = bills.length;

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('bill_analyses')
      .insert(row)
      .select('id')
      .single();
    if (insErr) throw insErr;

    escalatePartialOnReview({
      contactId: partialContactId,
      enquiryId: partialEnquiryId,
      analysisId: inserted.id,
      analysis,
      reqBody: req.body,
    });

    // Persist the synthesised bill rows so future audits can see what the
    // customer typed (and the date assumptions).
    const uploadRows = buildUploadRows(bills, inserted.id);
    if (uploadRows.length) {
      await supabaseAdmin.from('bill_uploads').insert(uploadRows);
    }

    // Normalise into customer_profiles (Phase 1.5) — non-blocking
    const normResult = await normaliseFromBillAnalysis(inserted.id, analysis).catch(() => ({ ok: false }));

    res.status(201).json({
      id:                 inserted.id,
      analysis,
      source_door:        'manual_table',
      confidence_band:    'high',
      profile_normalised: normResult.ok,
      parse_summary:      bills.map(b => ({
        retailer:       b.retailer,
        period_start:   b.period_start,
        period_end:     b.period_end,
        kwh_total:      b.kwh_total,
        total_nzd:      b.total_nzd,
        ocr_confidence: b.ocr_confidence,
        parse_errors:   [],
      })),
      ocr_errors: [],
    });
  } catch (e) {
    console.error('Bill analysis tabular error:', e.message);
    res.status(500).json({ error: e.message });
  }
});


// ── PUBLIC: fetch a saved analysis by id ─────────────────────────────────
//
// Customers can come back to a result via the URL share. Excludes the raw
// OCR text excerpt for privacy — that stays internal.
router.get('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data, error } = await supabaseAdmin
      .from('bill_analyses')
      .select('id, contact_id, email, bills_uploaded, period_start, period_end, months_covered, annual_kwh, annual_spend_nzd, effective_rate_nzd, fixed_charge_total_nzd, variable_charge_total_nzd, retailer, plan_name, region, postcode, patterns, scenarios, recommended_system_kw, recommended_battery_kwh, recommended_orientation, recommended_package_slug, switch_recommended, switch_to_retailer, switch_to_plan, switch_annual_saving, status, expires_at, created_at')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Analysis not found or expired.' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUBLIC: capture email on a previously-anonymous analysis ─────────────
//
// Used by the "email me my report" flow on the website. Setting an email
// on an anon analysis doesn't promote it to a lead — it just attaches a
// contact channel so we can email the PDF and chase up later.
router.post('/:id/email', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { email } = req.body || {};
    if (!email || !/.+@.+\..+/.test(email)) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }
    const { data, error } = await supabaseAdmin
      .from('bill_analyses')
      .update({ email })
      .eq('id', req.params.id)
      .select('id, email')
      .single();
    if (error) throw error;
    // PDF email send is best-effort and would happen here once the PDF
    // generator hook is wired (Phase 7). For now we just save the email.
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUBLIC: promote an anonymous analysis to a real lead ─────────────────
//
// Triggered when the customer clicks "Get my custom quote" after seeing
// the analysis. Side-effects:
//   - Creates a contact (if no contact already linked)
//   - Links the analysis to that contact, removes TTL
//   - Creates a sales follow-up task
//   - Logs an activity
//
// Body: { firstName, lastName, email, phone, address }
// Returns: { success, contact_id, analysis_id }
router.post('/:id/promote-to-quote', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { firstName, lastName, email, phone, address } = req.body || {};
    if (!email && !phone) {
      return res.status(400).json({ error: 'Email or phone is required.' });
    }

    // 1. Look up the analysis
    const { data: analysis, error: aErr } = await supabaseAdmin
      .from('bill_analyses')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (aErr || !analysis) return res.status(404).json({ error: 'Analysis not found.' });

    // 2. De-dupe contact by email
    let contactId = analysis.contact_id;
    if (!contactId && email) {
      const { data: existingContact } = await supabaseAdmin
        .from('contacts').select('id').eq('email', email).maybeSingle();
      contactId = existingContact?.id || null;
    }

    // 3. Create contact if not found
    const customerName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Bill-analysis lead';
    if (!contactId) {
      const { data: contact, error: cErr } = await supabaseAdmin.from('contacts').insert({
        name:          customerName,
        email:         email || null,
        phone:         phone || null,
        location:      address || null,
        type:          'residential',
        system_type:   analysis.recommended_battery_kwh > 0 ? 'hybrid' : 'on-grid',
        stage:         'new',
        source:        'bill_analysis',
        lead_source:   'online_search',
        lifecycle:     'subscriber',
        last_activity: 'Bill-analysis report converted to quote',
        notes:         `From bill analysis ${req.params.id} — ${analysis.annual_kwh} kWh/yr, ${analysis.recommended_system_kw} kW recommended.`,
        estimated_value: (analysis.scenarios.find(s => s.id === 'solar-plus-battery') || {}).upfront_cost || null,
      }).select('id').single();
      if (cErr) throw cErr;
      contactId = contact.id;
    }

    // 4. Link analysis to contact, remove TTL
    await supabaseAdmin.from('bill_analyses').update({
      contact_id: contactId,
      email: email || analysis.email,
      expires_at: null,
    }).eq('id', req.params.id);

    // P5 (A2) + Address-writethrough v2 — propagate region/postcode AND the
    // service_address captured per-bill back to the now-linked contact.
    // Pull the first non-null service_address from this analysis's bill_uploads.
    const { data: addrRow } = await supabaseAdmin
      .from('bill_uploads')
      .select('service_address')
      .eq('analysis_id', req.params.id)
      .not('service_address', 'is', null)
      .limit(1)
      .maybeSingle();
    // Bug #6 fix — also propagate ICP to the linked contact. Pull from the
    // canonical bill_analyses.icp_number we wrote at insert time.
    const { data: anaRow } = await supabaseAdmin
      .from('bill_analyses')
      .select('icp_number')
      .eq('id', req.params.id)
      .maybeSingle();
    // Customer name is not stored as a column on bill_uploads — re-extract
    // from OCR text excerpt at link time using the shared helper.
    const { data: ocrRow } = await supabaseAdmin
      .from('bill_uploads')
      .select('ocr_text_excerpt, ocr_text_full')
      .eq('analysis_id', req.params.id)
      .limit(1)
      .maybeSingle();
    let claimedCustomerName = null;
    try {
      const { default: ocrSvc } = await import('../services/billOcrService.js');
      // extractCustomerName is internal — use the parser entrypoint instead
      if (ocrRow?.ocr_text_excerpt || ocrRow?.ocr_text_full) {
        const { parseBillText } = await import('../services/billOcrService.js');
        const reparsed = parseBillText(ocrRow.ocr_text_full || ocrRow.ocr_text_excerpt);
        claimedCustomerName = reparsed.customer_name || null;
      }
    } catch (e) {
      console.warn('Customer-name re-extract failed (non-fatal):', e.message);
    }
    writeAddressThroughToContact(supabaseAdmin, contactId, {
      region: analysis.region,
      postcode: analysis.postcode,
      service_address: addrRow?.service_address || null,
      customer_name:   claimedCustomerName,
      icp_number:      anaRow?.icp_number || null,
    });

    // 5. Sales follow-up task (high priority, due tomorrow)
    await supabaseAdmin.from('tasks').insert({
      title:       `Bill-analysis lead — ${customerName}`,
      description: `Analysis estimated ${analysis.annual_kwh} kWh/yr, recommends ${analysis.recommended_system_kw} kW. View report at /bill-analysis/${req.params.id}`,
      contact_id:  contactId,
      due_date:    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      priority:    'high',
      status:      'todo',
      task_type:   'call',
    });

    // 6. Activity feed entry
    await supabaseAdmin.from('activities').insert({
      type:        'system',
      description: `Bill-analysis report promoted to lead: ${customerName} — ${analysis.annual_kwh} kWh/yr, recommends ${analysis.recommended_system_kw} kW`,
      contact_id:  contactId,
      metadata: {
        bill_analysis_id:       req.params.id,
        annual_kwh:             analysis.annual_kwh,
        recommended_system_kw:  analysis.recommended_system_kw,
        recommended_package:    analysis.recommended_package_slug,
        source:                 'bill_analysis',
      },
    });

    res.status(201).json({ success: true, contact_id: contactId, analysis_id: req.params.id });
  } catch (e) {
    console.error('Bill-analysis promote error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN: re-run the scenario engine on stored structured data ──────────
//
// Per accuracy rule 1.5 (deterministic + reproducible) and 15.11 (auditable),
// an admin should be able to re-run the analysis after the engine improves
// (e.g. better tariff handling, fixed bug, refreshed rate dataset) without
// requiring the customer to re-upload their bills. This endpoint reads the
// already-persisted bill_uploads rows + rebuilds the analysis from them.
//
// We do NOT re-OCR — the original ocr_text_full + structured parsed fields
// are what the engine reads. If we want to also re-parse, the caller can
// pass `?reparse=1` and we'll re-run parseBillText against ocr_text_full.
router.post('/:id/reanalyze', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const { id } = req.params;
    const reparse = req.query.reparse === '1';

    // 1. Pull the persisted bill_uploads for this analysis
    const { data: rows, error: fetchErr } = await supabaseAdmin
      .from('bill_uploads')
      .select('*')
      .eq('analysis_id', id);
    if (fetchErr) throw fetchErr;
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No bill_uploads found for that analysis_id.' });
    }

    // 2. Optionally re-parse from ocr_text_full
    let bills = rows;
    if (reparse) {
      const { parseBillText } = await import('../services/billOcrService.js');
      bills = rows.map(r => {
        if (!r.ocr_text_full) return r;            // can't re-parse without text
        const reparsed = parseBillText(r.ocr_text_full, { fileName: r.file_name });
        return { ...r, ...reparsed };
      });
    }

    // 3. Re-run the analyser
    const analysis = analyzeBills({ bills });

    // 4. Update the bill_analyses row with the new outputs
    const { data: existing, error: fetchAnalysisErr } = await supabaseAdmin
      .from('bill_analyses')
      .select('contact_id, email, region')
      .eq('id', id)
      .single();
    if (fetchAnalysisErr) throw fetchAnalysisErr;

    const updated = buildAnalysisRow(analysis, {
      region:    analysis.region,
      postcode:  analysis.region_postcode,
      email:     existing.email,
      contactId: existing.contact_id,
      bills,
    });
    delete updated.contact_id;        // don't overwrite who owns it
    delete updated.email;
    delete updated.expires_at;        // don't reset TTL on reanalyze

    const { error: updateErr } = await supabaseAdmin
      .from('bill_analyses')
      .update(updated)
      .eq('id', id);
    if (updateErr) throw updateErr;

    // 5. Log activity (auditability — rule 1.10, 15.11)
    try {
      await supabaseAdmin.from('activities').insert({
        type:        'system',
        description: `Bill analysis ${id} re-run by admin. Region: ${analysis.region}. Review-required: ${analysis.review_required}.`,
        contact_id:  existing.contact_id || null,
        metadata: {
          analysis_id:    id,
          reparse,
          review_required: analysis.review_required,
          review_reasons: analysis.review_reasons,
          source:         'reanalyze',
        },
      });
    } catch (e) { /* non-fatal */ }

    res.json({
      success:         true,
      analysis_id:     id,
      reparse,
      review_required: analysis.review_required,
      review_reasons:  analysis.review_reasons,
      region:          analysis.region,
      region_resolved_from: analysis.region_resolved_from,
    });
  } catch (e) {
    console.error('Reanalyze error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── PORTAL: signed URL to the original bill PDF/image ────────────────────
//
// Sales clicks "View original bill" in the PM Tool review-queue UI; this
// endpoint returns a 60-minute signed URL that lets the browser stream the
// file directly from Supabase Storage. The bucket is private so the URL
// is the only way to access the file outside the portal.
router.get('/uploads/:id/signed-url', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { data: row, error } = await supabaseAdmin
      .from('bill_uploads')
      .select('file_storage_path, file_mime_type, file_name')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!row?.file_storage_path) {
      return res.status(404).json({ error: 'No stored file for this upload.' });
    }
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('customer-bills')
      .createSignedUrl(row.file_storage_path, 3600);
    if (signErr) throw signErr;
    res.json({
      signed_url:  signed.signedUrl,
      expires_in:  3600,
      mime_type:   row.file_mime_type,
      file_name:   row.file_name,
    });
  } catch (e) {
    console.error('Signed URL error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;

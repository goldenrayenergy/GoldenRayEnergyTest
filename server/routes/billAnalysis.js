import { Router } from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../config/supabase.js';
import { parseBillPdf, parseBillImage } from '../services/billOcrService.js';
import { analyzeBills } from '../services/billAnalysisService.js';
import { normaliseFromBillAnalysis, normaliseFromEstimate } from '../services/pm/customerProfileService.js';
import { validateEstimateForm } from '../utils/validators.js';
import { sendTeamNewLeadEmail } from '../services/emailService.js';

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

const router = Router();

// Multipart upload — bills can be PDFs OR camera-captured photos. PDFs up
// to 5 MB; photos up to 10 MB (modern phone cameras produce larger files
// before compression). Hold in memory; we don't persist the file blob.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' ||
               /^image\/(jpe?g|png|webp|heic|heif)$/i.test(file.mimetype);
    if (!ok) return cb(new Error(`Unsupported file type: ${file.mimetype} (expected PDF or image)`), false);
    cb(null, true);
  },
});

// Dispatch one uploaded file to the right parser based on MIME type.
async function parseUploadedFile(file) {
  if (file.mimetype === 'application/pdf') {
    return parseBillPdf(file.buffer, { fileName: file.originalname });
  }
  // image/* — camera capture
  return parseBillImage(file.buffer, { fileName: file.originalname, mimeType: file.mimetype });
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
function buildAnalysisRow(analysis, { region, postcode, email, contactId }) {
  return {
    contact_id:                contactId || null,
    email:                     email || null,
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
    file_hash:            null,
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

    // 1. Parse each file (PDF or camera image) → normalised bill objects.
    // Keep the original buffers alongside so we can upload them to Storage
    // after the bill_uploads rows have IDs (storage path includes the upload id).
    const parsedBills = [];
    const sourceFiles = [];                          // parallel to parsedBills
    const ocrErrors = [];
    for (const f of req.files) {
      try {
        const parsed = await parseUploadedFile(f);
        parsedBills.push(parsed);
        sourceFiles.push(f);
      } catch (e) {
        ocrErrors.push({ file: f.originalname, error: e.message });
      }
    }

    // We need at least one bill with kWh + total to run the analysis
    const usableBills = parsedBills.filter(b => b.kwh_total != null && b.total_nzd != null);
    if (usableBills.length === 0) {
      return res.status(400).json({
        error: 'Couldn\'t extract enough numbers from any of those PDFs to run the analysis. They may be image-scanned or use an unrecognised retailer layout.',
        parse_summary: parsedBills.map(b => ({
          retailer: b.retailer, ocr_confidence: b.ocr_confidence, parse_errors: b.parse_errors,
        })),
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
    });

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('bill_analyses')
      .insert(row)
      .select('id')
      .single();
    if (insErr) throw insErr;

    // Fire-and-forget escalation when review_required + partial linked.
    escalatePartialOnReview({
      contactId: partialContactId,
      enquiryId: partialEnquiryId,
      analysisId: inserted.id,
      analysis,
      reqBody: req.body,
    });

    const uploadRows = buildUploadRows(parsedBills, inserted.id);
    const { data: insertedUploads, error: uplErr } = await supabaseAdmin
      .from('bill_uploads')
      .insert(uploadRows)
      .select('id');
    if (uplErr) console.error('Bill uploads insert failed (non-fatal):', uplErr.message);

    // ── Store original bill PDFs/images to Supabase Storage ────────────────
    // Per business decision (Path A): store every bill so sales has the
    // source artifact when reviewing flagged bills + future re-analysis.
    // Bucket name + setup script: server/scripts/setup-bill-storage.js.
    // Failure here is non-fatal — the analysis still completes; sales will
    // just not have the original PDF to look at for this customer.
    if (insertedUploads?.length === parsedBills.length) {
      for (let i = 0; i < parsedBills.length; i++) {
        const uploadId = insertedUploads[i].id;
        const file     = sourceFiles[i];
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

    // 4. Normalise into customer_profiles (Phase 1.5) — non-blocking
    const normResult = await normaliseFromBillAnalysis(inserted.id, { ...analysis, region }, parsedBills);

    res.status(201).json({
      id: inserted.id,
      analysis,
      source_door: parsedBills.length >= 6 ? 'bill_upload_12' : 'bill_upload_partial',
      confidence_band: normResult.profile?.confidence_band || 'medium',
      profile_normalised: normResult.ok,
      parse_summary: parsedBills.map(b => ({
        retailer:        b.retailer,
        period_start:    b.period_start,
        period_end:      b.period_end,
        kwh_total:       b.kwh_total,
        total_nzd:       b.total_nzd,
        ocr_confidence:  b.ocr_confidence,
        parse_errors:    b.parse_errors,
      })),
      ocr_errors: ocrErrors,
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
    });
    row.bills_uploaded = 0;  // marker: no bills uploaded for this analysis

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

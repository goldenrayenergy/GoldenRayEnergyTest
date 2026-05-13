import { Router } from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../config/supabase.js';
import { parseBillPdf } from '../services/billOcrService.js';
import { analyzeBills } from '../services/billAnalysisService.js';
import { normaliseFromBillAnalysis, normaliseFromEstimate } from '../services/pm/customerProfileService.js';
import { validateEstimateForm } from '../utils/validators.js';

const router = Router();

// Multipart upload — bills can be 1-12 PDFs, each up to 5 MB. Hold in
// memory; we don't persist the file blob, only the parsed numbers.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 12 },
});

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
    postcode:                  postcode || null,
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

    // 1. Parse each PDF → array of normalised bill objects
    const parsedBills = [];
    const ocrErrors = [];
    for (const f of req.files) {
      try {
        const parsed = await parseBillPdf(f.buffer, { fileName: f.originalname });
        parsedBills.push(parsed);
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
    const row = buildAnalysisRow(analysis, {
      region,
      postcode: req.body.postcode,
      email:    req.body.email,
      contactId: null,
    });

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('bill_analyses')
      .insert(row)
      .select('id')
      .single();
    if (insErr) throw insErr;

    const uploadRows = buildUploadRows(parsedBills, inserted.id);
    const { error: uplErr } = await supabaseAdmin.from('bill_uploads').insert(uploadRows);
    if (uplErr) console.error('Bill uploads insert failed (non-fatal):', uplErr.message);

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
    const row = buildAnalysisRow(analysis, {
      region, postcode: req.body.postcode, email: req.body.email, contactId: null,
    });
    row.bills_uploaded = 0;  // marker: no bills uploaded for this analysis

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('bill_analyses')
      .insert(row)
      .select('id')
      .single();
    if (insErr) throw insErr;

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

export default router;

// ────────────────────────────────────────────────────────────────────────────
// PM Tool — /api/pm/contacts/* (lookups only; CRUD lives in existing /contacts)
//
// Day-7 endpoint: latest bill analysis for a contact, so the quotes form can
// auto-prefill the Bills section instead of using hardcoded placeholders.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin as supabaseFromConfig } from '../../config/supabase.js';
import { splitNzAddress } from '../billAnalysis.js';

let _supabaseAdmin = supabaseFromConfig;
export function __setSupabaseForTests(client) { _supabaseAdmin = client; }
const sb = () => _supabaseAdmin;

const router = Router();
router.use(authenticate);

// ────────────────────────────────────────────────────────────────────────────
// GET /:id/latest-bill-analysis
//
// Returns the most recent bill_analyses row for a contact, mapped to the
// quote spec's `bills.manual_entry` shape so it can be dropped in directly.
// Returns 204 if the contact has no analyses on file.
// ────────────────────────────────────────────────────────────────────────────
router.get('/:id/latest-bill-analysis', async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    const { data, error } = await sb()
      .from('bill_analyses')
      .select(`
        id, contact_id, retailer, plan_name,
        annual_kwh, annual_spend_nzd, effective_rate_nzd,
        fixed_charge_total_nzd, variable_charge_total_nzd,
        period_start, period_end, months_covered,
        region, postcode, icp_number, status, created_at,
        recommended_system_kw, recommended_battery_kwh, recommended_orientation
      `)
      .eq('contact_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(204).end();   // no analyses for this contact

    // Bug #6 fix — pull street/suburb/city from bill_uploads.service_address
    // so the new-quote page can prefill the full address, not just postcode.
    let parsedStreet = null, parsedSuburb = null, parsedCity = null;
    try {
      const { data: addrRow } = await sb()
        .from('bill_uploads')
        .select('service_address')
        .eq('analysis_id', data.id)
        .not('service_address', 'is', null)
        .limit(1)
        .maybeSingle();
      if (addrRow?.service_address) {
        const s = splitNzAddress(addrRow.service_address);
        parsedStreet = s.street || null;
        parsedSuburb = s.suburb || null;
        parsedCity   = s.city   || null;
      }
    } catch (e) {
      console.warn('latest-bill-analysis: address parse failed (non-fatal):', e.message);
    }

    // Map analysis → quote-spec bills shape.
    //
    // Important units (verified 2026-06-11 against Abhilash Y's 4 Genesis bills):
    //   • bill_analyses.variable_charge_total_nzd is ANNUALIZED and EX-GST
    //   • bill_analyses.fixed_charge_total_nzd    is ANNUALIZED and EX-GST
    //   • bill_analyses.annual_spend_nzd          is ANNUALIZED and INC-GST (from total_nzd)
    //   • bill_analyses.annual_kwh                is ANNUALIZED
    //
    // Spec wants per-kWh and per-day rates INC GST, so we divide annualized
    // totals by 365 (NOT by months_covered * 30.4375 — that was the old bug)
    // and gross up by 15% GST.
    const annualKwh     = Number(data.annual_kwh) || 0;
    const annualSpend   = Number(data.annual_spend_nzd) || 0;
    const variableTotal = Number(data.variable_charge_total_nzd) || 0;
    const fixedTotal    = Number(data.fixed_charge_total_nzd) || 0;
    const GST_GROSSUP   = 1.15;

    // Convert region label to the engine's region key when possible.
    // bill_analyses.region carries values like 'auckland', 'wellington'
    // but the engine uses 'auckland_vector', 'wellington', etc. Best-effort map.
    const REGION_MAP = {
      auckland:     'auckland_vector',
      counties:     'counties_franklin',
      northland:    'northland',
      waikato:      'waikato',
      bay_of_plenty: 'bop_tauranga',
      tauranga:     'bop_tauranga',
      taranaki:     'taranaki',
      wairarapa:    'taranaki',
      wellington:   'wellington',
      manawatu:     'taranaki',
      canterbury:   'canterbury',
      otago:        'otago_queenstown',
      queenstown:   'otago_queenstown',
      southland:    'otago_queenstown',
    };
    const engineRegion = data.region ? REGION_MAP[data.region.toLowerCase()] || null : null;

    res.json({
      analysis_id: data.id,
      retailer: data.retailer || 'Unknown',
      plan_name: data.plan_name || null,
      period_start: data.period_start,
      period_end: data.period_end,
      months_covered: data.months_covered,
      analysed_at: data.created_at,
      region: data.region,                 // raw bill-analysis region tag
      engine_region: engineRegion,         // mapped to engine key (may be null)

      // Bug #6 — address_prefill now also carries street/suburb/city parsed
      // from bill_uploads.service_address, plus icp_number from the analysis.
      address_prefill: {
        region: engineRegion,              // engine-key region OR null
        postcode: data.postcode || null,
        street: parsedStreet,
        suburb: parsedSuburb,
        city:   parsedCity,
        icp_number: data.icp_number || null,
      },

      // P5 — system sizing from the analyser's recommendation engine.
      // recommended_system_kw / recommended_battery_kwh are computed during
      // the bill analysis from annual_kwh + regional yield + self-consumption.
      system_recommendation: {
        recommended_system_kw: data.recommended_system_kw
          ? Number(data.recommended_system_kw) : null,
        recommended_battery_kwh: data.recommended_battery_kwh
          ? Number(data.recommended_battery_kwh) : null,
        recommended_orientation: data.recommended_orientation || null,
      },

      // Bills shape — directly substitutable into spec.bills.manual_entry
      bills_prefill: {
        annual_kwh: Math.round(annualKwh),
        annual_spend: +annualSpend.toFixed(2),
        retailer: data.retailer || '',
        // Annualized ex-GST $ ÷ annualized kWh = ex-GST rate; × 1.15 → inc-GST.
        variable_rate_per_kwh_incl_gst: annualKwh > 0
          ? +(variableTotal * GST_GROSSUP / annualKwh).toFixed(4)
          : null,
        // Annualized ex-GST $ ÷ 365 days = ex-GST daily; × 1.15 → inc-GST.
        daily_fixed_charge_incl_gst:
          +(fixedTotal * GST_GROSSUP / 365).toFixed(2),
        // Buyback rate — derived from per-bill kwh_exported + export_credit_nzd
        // sums in bill_uploads. Only populated for customers who already have
        // solar; otherwise stays null and spec falls back to the engine default
        // (0.09 / Mercury current).
        buyback_rate: await deriveBuybackRate(data.id),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /:id/latest-roof-analysis
//
// Returns the most recent roof_analyses row for a contact — populated by the
// Google Solar API pipeline that fires on wizard submit (see
// server/services/googleSolar/analyseRoof.js). Used by the quote-editor
// Site Survey tab (SiteSurveySection.jsx) to display auto-analysis alongside
// the manual site-survey inputs.
//
// Returns:
//   200 + { id, status, imagery_quality, roof_segments, ... }  on any status
//   204                                                        no analysis on file
//
// The row is returned regardless of `status` so the UI can show every
// state (ok, pending, failed, skipped_quota, skipped_flag). raw_response is
// intentionally EXCLUDED from the projection — it's the full Google JSON
// blob (potentially 100KB+) and the UI only needs the parsed summary.
// ────────────────────────────────────────────────────────────────────────────
const ROOF_IMAGE_SIGNED_URL_TTL_SEC = 60 * 60;   // 1 hour — enough for typical UI session

router.get('/:id/latest-roof-analysis', async (req, res) => {
  try {
    if (!sb()) return res.status(503).json({ error: 'Database not configured.' });

    const { data, error } = await sb()
      .from('roof_analyses')
      .select(`
        id, enquiry_id, contact_id, project_id, status, api_version,
        requested_at, responded_at, address_used, latitude, longitude,
        imagery_quality, imagery_date,
        max_array_area_m2, max_array_panels_count,
        max_sunshine_hours_per_year, carbon_offset_factor_kg_per_kwh,
        roof_segments, error_message, created_at,
        roof_image_storage_bucket, roof_image_storage_path,
        roof_image_fetched_at, roof_image_error_message
      `)
      .eq('contact_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(204).end();

    // Phase 2 — if a roof image is stored, mint a short-lived signed URL
    // so the UI can render a thumbnail. Failure to sign is non-fatal:
    // response goes out without the URL (UI degrades to text-only), and
    // an error is logged for diagnosis.
    let roofImageSignedUrl = null;
    if (data.roof_image_storage_bucket && data.roof_image_storage_path) {
      try {
        const { data: signed, error: signErr } = await sb().storage
          .from(data.roof_image_storage_bucket)
          .createSignedUrl(data.roof_image_storage_path, ROOF_IMAGE_SIGNED_URL_TTL_SEC);
        if (signErr) throw signErr;
        roofImageSignedUrl = signed?.signedUrl || null;
      } catch (signErr) {
        console.warn('[pm/contacts/latest-roof-analysis] signed URL failed (non-fatal):', signErr?.message || signErr);
      }
    }

    res.json({ ...data, roof_image_signed_url: roofImageSignedUrl });
  } catch (e) {
    console.error('[pm/contacts/latest-roof-analysis] failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Derive per-customer buyback rate from per-bill solar-export totals.
// Returns null when the customer has no solar export on file (the normal case),
// so the spec falls through to the engine default.
async function deriveBuybackRate(analysisId) {
  if (!sb()) return null;
  const { data: rows, error } = await sb()
    .from('bill_uploads')
    .select('kwh_exported, export_credit_nzd')
    .eq('analysis_id', analysisId)
    .not('kwh_exported', 'is', null);
  if (error || !rows || rows.length === 0) return null;
  let kwh = 0, dollars = 0;
  for (const r of rows) {
    const k = Number(r.kwh_exported) || 0;
    const d = Number(r.export_credit_nzd) || 0;
    if (k > 0 && d > 0) { kwh += k; dollars += d; }
  }
  if (kwh <= 0 || dollars <= 0) return null;
  return +(dollars / kwh).toFixed(4);
}

export default router;

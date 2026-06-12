// ────────────────────────────────────────────────────────────────────────────
// PM Tool — /api/pm/contacts/* (lookups only; CRUD lives in existing /contacts)
//
// Day-7 endpoint: latest bill analysis for a contact, so the quotes form can
// auto-prefill the Bills section instead of using hardcoded placeholders.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin as supabaseFromConfig } from '../../config/supabase.js';

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
        region, postcode, status, created_at,
        recommended_system_kw, recommended_battery_kwh, recommended_orientation
      `)
      .eq('contact_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(204).end();   // no analyses for this contact

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

      // P5 — address fields the engine spec needs. Bill analyses only carry
      // region + postcode in structured form; street/suburb/city stay manual.
      address_prefill: {
        region: engineRegion,              // engine-key region OR null
        postcode: data.postcode || null,
        // street, suburb, city not parseable from bills — rep types manually
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

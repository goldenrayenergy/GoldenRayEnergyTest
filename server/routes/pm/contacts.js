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
    const annualKwh = Number(data.annual_kwh) || 0;
    const annualSpend = Number(data.annual_spend_nzd) || 0;
    const variableTotal = Number(data.variable_charge_total_nzd) || 0;
    const fixedTotal = Number(data.fixed_charge_total_nzd) || 0;
    const months = data.months_covered || 12;
    const days = months * 30.4375;            // average days/month

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
      months_covered: months,
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
        variable_rate_per_kwh_incl_gst: annualKwh > 0
          ? +(variableTotal / annualKwh).toFixed(4)
          : null,
        daily_fixed_charge_incl_gst: days > 0
          ? +(fixedTotal / days).toFixed(2)
          : null,
        // Buyback rate is not captured in bill_analyses — leave UI default.
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

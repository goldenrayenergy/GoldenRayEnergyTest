// ────────────────────────────────────────────────────────────────────────────
// Auto-populate 3 tiers — Option 4c rewrite.
//
// HARDCODED SKUs ARE GONE. Every tier's panel + inverter + battery + string
// layout is engine-recommended via POST /pm/proposal-engine/compose-system.
//
// Two size modes (per session decision — rep picks per quote):
//   • 'same_size'    — §2.22 default. All 3 tiers same kWp. Differ on
//                      battery / EV. Composer called 3× with same target_dc_kwp.
//   • 'tiered_sizes' — Starter / Right-size / Future-proof. Composer called
//                      3× with different target_dc_kwp (rec × multipliers).
//
// Gate for auto-populate (the "cleanly-parsed bills" rule):
//   • bill analysis exists AND recommended_system_kw > 0
//   • If !recommended_battery_kwh, Tier 2/3 still attempt a battery using
//     a fallback target derived from system size; rep can clear if undesired.
//
// Failure mode:
//   • If gate fails OR any tier composes with warnings, return tier shells
//     with source = 'empty' or 'engine_partial'. Rep sees the gap.
//
// Each tier object includes:
//   • source: 'engine_auto' | 'engine_partial' | 'empty' | 'rep_override'
//   • engine_warnings: [{ code, message }]
//   • label, system_overrides, pricing, cost_overrides, is_recommended
//
// Caller does NOT need to worry about hardcoded SKUs anywhere.
// ────────────────────────────────────────────────────────────────────────────

import { pmProposalEngineAPI } from '../services/pmQuotesApi';

// Suggested customer prices — kept as ballparks until the rep eyeballs the
// engine's per-tier margins and adjusts. The rep is more likely to negotiate
// DOWN than UP, so these err slightly high. Adjust via admin settings later.
const PRICE_PER_KW_SOLAR_ONLY          = 2700;
const PRICE_PER_KW_WITH_BATTERY        = 3400;
const PRICE_PER_KW_WITH_BATTERY_AND_EV = 3800;

const round500 = n => Math.round(n / 500) * 500;
const emptyDiscount = { applied_nzd: 0, owner_approved: false, reason: null };
const emptyCostOverrides = { labour: [], compliance: [], custom: [] };

// ── Empty tier shell — used when bills missing or compose fails ────────────
function makeEmptyTier({ label, isRecommended = false }) {
  return {
    label,
    source: 'empty',
    engine_warnings: [],
    system_overrides: null,        // null SKUs — rep clicks Recommend X or
                                   // edits dropdowns. NO hardcoded fallback.
    pricing: {
      customer_price_inc_gst: 0,
      stage: 'stage_1_estimate',
      final_mode: true,
      discount: { ...emptyDiscount },
    },
    cost_overrides: { ...emptyCostOverrides },
    is_recommended: isRecommended,
  };
}

// ── Helper: build a populated tier from a composer response ────────────────
function makeTierFromCompose({ composed, label, pricePerKw, isRecommended, includeEv }) {
  const hasWarnings = composed?.warnings?.length > 0;
  const source = composed?.panel?.sku
    ? (hasWarnings ? 'engine_partial' : 'engine_auto')
    : 'empty';

  // Derive systemKw for pricing
  const systemKw = composed?.panel?.count && composed.inputs_resolved?.target_dc_kwp
    ? composed.inputs_resolved.target_dc_kwp
    : 0;

  return {
    label,
    source,
    engine_warnings: composed?.warnings || [],
    engine_reasons:  composed?.reasons  || {},
    system_overrides: {
      panel:    composed?.panel    || null,
      inverter: composed?.inverter || null,
      battery:  composed?.battery  || null,
      string_topology: composed?.string_design?.topology || null,
      string_design:   composed?.string_design ? {
        panels_per_string: composed.string_design.panels_per_string,
        string_count:      composed.string_design.string_count,
      } : null,
      wattpilot_included: !!includeEv,
    },
    pricing: {
      customer_price_inc_gst: round500(systemKw * pricePerKw),
      stage: 'stage_1_estimate',
      final_mode: true,
      discount: { ...emptyDiscount },
    },
    cost_overrides: { ...emptyCostOverrides },
    is_recommended: isRecommended,
  };
}

// ── Helper: detect the "cleanly-parsed bills" gate ─────────────────────────
export function readyForAutoPopulate(billAnalysis) {
  return !!(
    billAnalysis &&
    Number(billAnalysis.recommended_system_kw) > 0
  );
}

// ── Main entry — async, mode-aware ──────────────────────────────────────
//
// Inputs:
//   billAnalysis    — { recommended_system_kw, recommended_battery_kwh } (or null)
//   phase           — 1 or 3 (from spec.system.phase or smart_meter)
//   sizeMode        — 'same_size' (default) | 'tiered_sizes'
//   tierSettings    — { tiered_size_multipliers, tier_labels } from API
//   region          — engine region key
//
// Returns an array of 3 tier objects (never null — always returns 3 shells).
// ────────────────────────────────────────────────────────────────────────────
export async function autoSizeThreeTiers({
  billAnalysis,
  phase = 1,
  sizeMode = 'same_size',
  tierSettings,
  region = null,
}) {
  const labels   = tierSettings?.tier_labels?.[sizeMode] || {};
  const mults    = tierSettings?.tiered_size_multipliers || {
    tier_1_starter: 0.70, tier_2_right_size: 1.00, tier_3_future_proof: 1.30,
  };

  // ── Gate: no bills → 3 empty shells ───────────────────────────────────
  if (!readyForAutoPopulate(billAnalysis)) {
    return [
      makeEmptyTier({ label: labels.tier_1 || 'Solar only',                isRecommended: false }),
      makeEmptyTier({ label: labels.tier_2 || 'Solar + battery',           isRecommended: true  }),
      makeEmptyTier({ label: labels.tier_3 || 'Solar + battery + EV-ready', isRecommended: false }),
    ];
  }

  const recKw  = Number(billAnalysis.recommended_system_kw);
  const recBat = Number(billAnalysis.recommended_battery_kwh) || null;

  // ── Per-mode kWp targets ──────────────────────────────────────────────
  const tierKwp = sizeMode === 'tiered_sizes'
    ? {
        t1: +(recKw * mults.tier_1_starter).toFixed(2),
        t2: +(recKw * mults.tier_2_right_size).toFixed(2),
        t3: +(recKw * mults.tier_3_future_proof).toFixed(2),
      }
    : { t1: recKw, t2: recKw, t3: recKw };

  // ── Tier 3 battery: rec + ~1 BYD HVM module headroom (2.76 kWh) ───────
  // (Not a hardcoded SKU — just a sizing nudge. Composer picks the actual
  //  battery SKU from catalogue. If recBat is null we use a reasonable
  //  resilience default of 14 kWh.)
  const tier2BatteryTarget = recBat || 11;     // sensible default if rec is null
  const tier3BatteryTarget = (recBat || 11) + 2.76;

  // ── Three parallel composer calls ─────────────────────────────────────
  let composes;
  try {
    composes = await Promise.all([
      pmProposalEngineAPI.composeSystem({
        target_dc_kwp: tierKwp.t1, phase,
        target_battery_usable_kwh: null, has_ev: false, region,
      }).then(r => r.data),
      pmProposalEngineAPI.composeSystem({
        target_dc_kwp: tierKwp.t2, phase,
        target_battery_usable_kwh: tier2BatteryTarget, has_ev: false, region,
      }).then(r => r.data),
      pmProposalEngineAPI.composeSystem({
        target_dc_kwp: tierKwp.t3, phase,
        target_battery_usable_kwh: tier3BatteryTarget, has_ev: true, region,
      }).then(r => r.data),
    ]);
  } catch (e) {
    // Network failure on any tier → return empty shells; rep clicks Recommend
    console.warn('autoSizeThreeTiers compose failed — returning empty tiers:', e?.message);
    return [
      makeEmptyTier({ label: labels.tier_1 || 'Solar only',                isRecommended: false }),
      makeEmptyTier({ label: labels.tier_2 || 'Solar + battery',           isRecommended: true  }),
      makeEmptyTier({ label: labels.tier_3 || 'Solar + battery + EV-ready', isRecommended: false }),
    ];
  }

  return [
    makeTierFromCompose({
      composed: composes[0],
      label: labels.tier_1 || (sizeMode === 'tiered_sizes'
        ? `Starter ${tierKwp.t1} kW`
        : 'Solar only'),
      pricePerKw: PRICE_PER_KW_SOLAR_ONLY,
      isRecommended: false,
      includeEv: false,
    }),
    makeTierFromCompose({
      composed: composes[1],
      label: labels.tier_2 || (sizeMode === 'tiered_sizes'
        ? `Right-size ${tierKwp.t2} kW`
        : `Solar + battery`),
      pricePerKw: PRICE_PER_KW_WITH_BATTERY,
      isRecommended: true,
      includeEv: false,
    }),
    makeTierFromCompose({
      composed: composes[2],
      label: labels.tier_3 || (sizeMode === 'tiered_sizes'
        ? `Future-proof ${tierKwp.t3} kW`
        : `Solar + battery + EV-ready`),
      pricePerKw: PRICE_PER_KW_WITH_BATTERY_AND_EV,
      isRecommended: false,
      includeEv: true,
    }),
  ];
}

// ── Sync fallback — used when no bill analysis exists ──────────────────
// Returns 3 empty tier shells with default labels. No SKUs.
export function autoSizeThreeTiersFromSpec() {
  return [
    makeEmptyTier({ label: 'Solar only',                isRecommended: false }),
    makeEmptyTier({ label: 'Solar + battery',           isRecommended: true  }),
    makeEmptyTier({ label: 'Solar + battery + EV-ready', isRecommended: false }),
  ];
}

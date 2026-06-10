// ────────────────────────────────────────────────────────────────────────────
// Auto-populate 3 tiers from a single bill-analysis recommendation.
//
// Stage 1 quotes default to 3 tiers (per locked rule). This util takes the
// bill analyser's `recommended_system_kw` + `recommended_battery_kwh` and
// produces three differentiated bundles that all cover the customer's full
// energy need but vary on battery / EV-readiness — per the project memory
// rule "Tier differentiation by features, not coverage".
//
//   Tier 1: Solar only — recommended kW, no battery
//   Tier 2: Solar + recommended battery — auto-flagged as RECOMMENDED
//   Tier 3: Solar + larger battery + EV-ready (Wattpilot included)
//
// Returns an array of 3 partial tier objects ready to assign to spec.tiers
// (caller adds tier_id via ensureTierIds() server-side at first persist).
//
// All three tier prices come back as suggested starting points; the rep
// adjusts after eyeballing the engine's per-tier margins.
// ────────────────────────────────────────────────────────────────────────────

import { autoSizeSystem } from './autoSizeSystem.js';

const PANEL_WATTS_DEFAULT = 595;
const HVM_KWH_PER_MODULE = 2.76;

// Cost-per-kW ballparks for setting suggested customer prices when the rep
// has no other reference. These are intentionally on the slightly-high side
// so the first save's margin shows healthy — the rep is more likely to
// negotiate DOWN to a real number than UP. Adjust later via admin settings.
const PRICE_PER_KW_SOLAR_ONLY = 2700;        // $/kW installed
const PRICE_PER_KW_WITH_BATTERY = 3400;
const PRICE_PER_KW_WITH_BATTERY_AND_EV = 3800;

export function autoSizeThreeTiers({
  recommended_system_kw,
  recommended_battery_kwh,
}) {
  if (!recommended_system_kw || recommended_system_kw <= 0) return null;

  // Base solar sizing (same panel count across all tiers — feature
  // differentiation, NOT coverage differentiation per locked rule).
  const baseSize = autoSizeSystem({
    recommended_system_kw,
    recommended_battery_kwh: 0,    // ignore for the shared base
    panelWattsDefault: PANEL_WATTS_DEFAULT,
  });
  if (!baseSize) return null;
  const systemKw = baseSize.derived_kw;

  // Tier 2 battery = analyser's recommended kWh, clamped to HVM range [3-8]
  const tier2Modules = recommended_battery_kwh
    ? Math.max(3, Math.min(8, Math.round(recommended_battery_kwh / HVM_KWH_PER_MODULE)))
    : 4;       // sensible default if analyser didn't suggest battery
  const tier2BatteryKwh = +(tier2Modules * HVM_KWH_PER_MODULE).toFixed(2);

  // Tier 3 = tier 2 + 1 module (one step larger) capped at 8
  const tier3Modules = Math.min(8, tier2Modules + 1);
  const tier3BatteryKwh = +(tier3Modules * HVM_KWH_PER_MODULE).toFixed(2);

  // Suggested customer prices — rounded to nearest $500
  const round500 = n => Math.round(n / 500) * 500;
  const price1 = round500(systemKw * PRICE_PER_KW_SOLAR_ONLY);
  const price2 = round500(systemKw * PRICE_PER_KW_WITH_BATTERY);
  const price3 = round500(systemKw * PRICE_PER_KW_WITH_BATTERY_AND_EV);

  const emptyDiscount = { applied_nzd: 0, owner_approved: false, reason: null };

  return [
    {
      label: 'Solar only',
      system_overrides: { battery: null },
      pricing: {
        customer_price_inc_gst: price1,
        stage: 'stage_1_estimate',
        final_mode: true,
        discount: { ...emptyDiscount },
      },
      cost_overrides: { labour: [], compliance: [], custom: [] },
      is_recommended: false,
    },
    {
      label: `Solar + ${tier2BatteryKwh} kWh battery`,
      system_overrides: {
        battery: { sku: 'BYD-BAT-276-HVM', module_count: tier2Modules },
      },
      pricing: {
        customer_price_inc_gst: price2,
        stage: 'stage_1_estimate',
        final_mode: true,
        discount: { ...emptyDiscount },
      },
      cost_overrides: { labour: [], compliance: [], custom: [] },
      is_recommended: true,        // ← auto-flag the middle tier
    },
    {
      label: `Solar + ${tier3BatteryKwh} kWh battery + EV-ready`,
      system_overrides: {
        battery: { sku: 'BYD-BAT-276-HVM', module_count: tier3Modules },
        wattpilot_included: true,
      },
      pricing: {
        customer_price_inc_gst: price3,
        stage: 'stage_1_estimate',
        final_mode: true,
        discount: { ...emptyDiscount },
      },
      cost_overrides: { labour: [], compliance: [], custom: [] },
      is_recommended: false,
    },
  ];
}

// Convenience: produce 3 tiers from an emptySpec()'s top-level pricing/system
// when no bill analysis is available. The rep starts from a sensible default.
export function autoSizeThreeTiersFromSpec(spec) {
  // Derive a "recommended kW" from the existing spec.system.panel.count
  const panelCount = spec.system?.panel?.count || 20;
  const recommendedSystemKw = +(panelCount * PANEL_WATTS_DEFAULT / 1000).toFixed(2);
  const recommendedBatteryKwh = spec.system?.battery?.module_count
    ? +(spec.system.battery.module_count * HVM_KWH_PER_MODULE).toFixed(2)
    : 11.04;        // sensible default = 4-module BYD HVM
  return autoSizeThreeTiers({
    recommended_system_kw: recommendedSystemKw,
    recommended_battery_kwh: recommendedBatteryKwh,
  });
}

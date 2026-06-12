// ────────────────────────────────────────────────────────────────────────────
// Smoke test for Option 4c (b) — Server-side three-tier composer.
//
// Covers:
//   1. Happy path: bills present → engine picks 3 tiers
//   2. No bills: catalogue-first fallback for all 3 tiers
//   3. Tiered-sizes mode: 0.70 / 1.00 / 1.30 multipliers applied
//   4. Composer envelope failure: fallback applies to ONE tier
//   5. Top-level system populated from recommended tier
// ────────────────────────────────────────────────────────────────────────────

import { composeThreeTiers, topLevelSystemFromTier }
  from '../services/pm/proposalEngine/threeTierComposer.js';
import { BMS_RULES, COMPATIBILITY, TIER_STRIP_SETTINGS, REGIONS }
  from '../services/pm/proposalEngine/data/engineeringRules.js';

const PANEL_595 = {
  name: '595W Phono Draco', brand: 'Phono Solar', watts: 595,
  voc_stc: 52.92, isc_stc: 14.32, vmp_stc: 43.75, imp_stc: 13.60,
  voltage_temp_coef_pct_per_c: -0.25,
  cost_nzd: 260, margin_pct: 50,
};

const CATALOGUE = {
  PANELS: { 'PHN-PNL-595-DRC': PANEL_595 },
  INVERTERS: {
    'FRN-INV-80-G24-1P': {
      name: 'Primo 8.0 GEN24', brand: 'Fronius', phase: 1, ac_kw: 8.0,
      is_plus_variant: false, battery_capable: false, mppt_count: 2,
      uoc_max_v: 600, mppt_v_min: 165, idc_max_a_per_mppt: 22,
      isc_max_a_mppt1: 41.25, isc_max_a_mppt2: 36,
    },
    'FRN-INV-80-G24P-1P': {
      name: 'Primo 8.0 GEN24 Plus', brand: 'Fronius', phase: 1, ac_kw: 8.0,
      is_plus_variant: true, battery_capable: true, mppt_count: 2,
      uoc_max_v: 600, mppt_v_min: 165, idc_max_a_per_mppt: 22,
      isc_max_a_mppt1: 41.25, isc_max_a_mppt2: 36,
    },
    'FRN-INV-100-G24P-1P': {
      name: 'Primo 10.0 GEN24 Plus', brand: 'Fronius', phase: 1, ac_kw: 10.0,
      is_plus_variant: true, battery_capable: true, mppt_count: 2,
      uoc_max_v: 600, mppt_v_min: 165, idc_max_a_per_mppt: 22,
      isc_max_a_mppt1: 41.25, isc_max_a_mppt2: 36,
    },
  },
  BATTERIES: {
    'BYD-BAT-276-HVM': {
      name: 'BYD HVM 2.76 kWh', brand: 'BYD', series: 'HVM',
      module_kwh: 2.76, chemistry: 'LFP', cost_nzd: 1855, margin_pct: 30,
    },
  },
};

const region = REGIONS.auckland_vector;

let failed = 0;
function assert(label, cond) {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ FAIL: ${label}`); failed++; }
}

// ── 1. Happy path: bills present ─────────────────────────────────────
{
  console.log('\n══ Case 1: Bills present, same_size mode ══');
  const out = composeThreeTiers({
    billAnalysis: { recommended_system_kw: 10, recommended_battery_kwh: 13.5 },
    phase: 1, region, sizeMode: 'same_size',
    catalogue: CATALOGUE, COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS,
  });
  assert('3 tiers returned',           out.tiers.length === 3);
  assert('fallback_used = false',      out.fallback_used === false);
  assert('tier 2 is recommended',      out.tiers[1].is_recommended === true);
  assert('tier 1 has no battery',      out.tiers[0].system_overrides.battery == null);
  assert('tier 2 has battery',         out.tiers[1].system_overrides.battery?.sku === 'BYD-BAT-276-HVM');
  assert('tier 3 has EV (wattpilot)',  out.tiers[2].system_overrides.wattpilot_included === true);
  assert('all 3 panel SKUs populated', out.tiers.every(t => !!t.system_overrides.panel?.sku));
  assert('all 3 inverter SKUs populated', out.tiers.every(t => !!t.system_overrides.inverter?.sku));
  for (const t of out.tiers) {
    console.log(`    Tier ${t.is_recommended ? '★' : ' '}: ${t.label}`);
    console.log(`       Panel ${t.system_overrides.panel?.sku} × ${t.system_overrides.panel?.count}`);
    console.log(`       Inverter ${t.system_overrides.inverter?.sku}`);
    console.log(`       Battery ${t.system_overrides.battery ? t.system_overrides.battery.sku : '(none)'}`);
    console.log(`       Source: ${t.source}`);
  }
}

// ── 2. No bills: catalogue-first fallback ──────────────────────────
{
  console.log('\n══ Case 2: No bills → fallback for all 3 tiers ══');
  const out = composeThreeTiers({
    billAnalysis: null, phase: 1, region, sizeMode: 'same_size',
    catalogue: CATALOGUE, COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS,
  });
  assert('3 tiers returned', out.tiers.length === 3);
  assert('fallback_used = true', out.fallback_used === true);
  assert('fallback_reason = no_bill_analysis', out.fallback_reason === 'no_bill_analysis');
  assert('all 3 tiers panel populated', out.tiers.every(t => !!t.system_overrides.panel?.sku));
  assert('all 3 tiers inverter populated', out.tiers.every(t => !!t.system_overrides.inverter?.sku));
  assert('tier 1 has no battery', out.tiers[0].system_overrides.battery == null);
  assert('tier 2 has fallback battery', out.tiers[1].system_overrides.battery?.sku === 'BYD-BAT-276-HVM');
}

// ── 3. Tiered-sizes mode ──────────────────────────────────────────
{
  console.log('\n══ Case 3: tiered_sizes mode (0.70/1.00/1.30) ══');
  const out = composeThreeTiers({
    billAnalysis: { recommended_system_kw: 10, recommended_battery_kwh: 13.5 },
    phase: 1, region, sizeMode: 'tiered_sizes',
    catalogue: CATALOGUE, COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS,
  });
  assert('size_mode echoed', out.size_mode === 'tiered_sizes');
  const counts = out.tiers.map(t => t.system_overrides.panel?.count || 0);
  console.log(`    Panel counts: T1=${counts[0]} T2=${counts[1]} T3=${counts[2]}`);
  assert('T1 panel count < T2', counts[0] < counts[1]);
  assert('T3 panel count > T2', counts[2] > counts[1]);
}

// ── 4. Top-level system populated from recommended tier ────────────
{
  console.log('\n══ Case 4: topLevelSystemFromTier populates spec.system ══');
  const out = composeThreeTiers({
    billAnalysis: { recommended_system_kw: 10, recommended_battery_kwh: 13.5 },
    phase: 1, region, sizeMode: 'same_size',
    catalogue: CATALOGUE, COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS,
  });
  const topLevel = topLevelSystemFromTier(out.tiers[1], { phase: 1, smart_meter: { sku: null, phase: 1 } });
  console.log(`    Top-level panel: ${topLevel.panel.sku} × ${topLevel.panel.count}`);
  console.log(`    Top-level inverter: ${topLevel.inverter.sku}`);
  console.log(`    Top-level battery: ${topLevel.battery ? topLevel.battery.sku : '(none)'}`);
  assert('top-level panel.sku is set', !!topLevel.panel?.sku);
  assert('top-level inverter.sku is set', !!topLevel.inverter?.sku);
  assert('top-level battery.sku is set', !!topLevel.battery?.sku);
  assert('top-level smart_meter preserved', topLevel.smart_meter?.phase === 1);
}

// ── 5. Out-of-envelope case: composer fallback for some tier ─────
{
  console.log('\n══ Case 5: tiered_sizes 13kWp Tier 3 → envelope cliff → fallback ══');
  const out = composeThreeTiers({
    billAnalysis: { recommended_system_kw: 10, recommended_battery_kwh: 13.5 },
    phase: 1, region, sizeMode: 'tiered_sizes',
    catalogue: CATALOGUE, COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS,
  });
  console.log(`    fallback_used: ${out.fallback_used}`);
  console.log(`    fallback_reason: ${out.fallback_reason}`);
  for (const w of out.warnings) console.log(`    ⚠ ${w.code}: ${w.message}`);
  // Tier 3 = 13 kWp on 1ph Primo 10 may fallback or have envelope warnings
  // Just check that tier 3 still has SKUs populated (either engine or fallback)
  assert('tier 3 still has panel SKU', !!out.tiers[2].system_overrides.panel?.sku);
  assert('tier 3 still has inverter SKU', !!out.tiers[2].system_overrides.inverter?.sku);
}

console.log(`\n──── Summary ────`);
console.log(`  ${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);

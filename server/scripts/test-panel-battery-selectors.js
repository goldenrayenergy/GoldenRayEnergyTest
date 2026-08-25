// ────────────────────────────────────────────────────────────────────────────
// Smoke test for Option 4b — Panel + Battery selectors.
//
// Run: node server/scripts/test-panel-battery-selectors.js
// ────────────────────────────────────────────────────────────────────────────

import { selectPanel } from '../services/pm/proposalEngine/panelSelector.js';
import { selectBattery } from '../services/pm/proposalEngine/batterySelector.js';
import { BMS_RULES, COMPATIBILITY } from '../services/pm/proposalEngine/data/engineeringRules.js';

// Fake catalogue (panels + batteries with realistic specs)
const CATALOGUE = {
  PANELS: {
    'PHN-PNL-475-QSR': {
      name: 'Phono Solar 475W Quasar', brand: 'Phono Solar', watts: 475,
      voc_stc: 40.11, isc_stc: 15.01, vmp_stc: 33.20, imp_stc: 14.31,
      voltage_temp_coef_pct_per_c: -0.20,
      cost_nzd: 195.00, margin_pct: 50,
    },
    'PHN-PNL-595-DRC': {
      name: 'Phono Solar 595W Draco', brand: 'Phono Solar', watts: 595,
      voc_stc: 52.92, isc_stc: 14.32, vmp_stc: 43.75, imp_stc: 13.60,
      voltage_temp_coef_pct_per_c: -0.25,
      cost_nzd: 260.00, margin_pct: 50,
    },
    // Panel with missing specs — should be filtered out
    'INC-PNL-INCOMPLETE': {
      name: 'Incomplete panel', brand: 'Test', watts: 400,
      cost_nzd: 150.00, margin_pct: 30,
    },
  },
  BATTERIES: {
    'BYD-BAT-276-HVM': {
      name: 'BYD HVM 2.76 kWh module', brand: 'BYD',
      series: 'HVM', module_kwh: 2.76, chemistry: 'LFP',
      cost_nzd: 1855.00, margin_pct: 30,
    },
    'BYD-BAT-256-HVS': {
      name: 'BYD HVS 2.56 kWh module', brand: 'BYD',
      series: 'HVS', module_kwh: 2.56, chemistry: 'LFP',
      cost_nzd: 1720.00, margin_pct: 30,
    },
    'FRN-BAT-315-RSV': {
      name: 'Fronius Reserva 3.15 kWh module', brand: 'Fronius',
      series: 'Reserva', module_kwh: 3.15, chemistry: 'LFP',
      cost_nzd: 2075.85, margin_pct: 30,
    },
  },
};

const INVERTER_GEN24P = {
  sku: 'FRN-INV-100-G24P-1P',
  name: 'Primo 10.0 GEN24 Plus', brand: 'Fronius', phase: 1, ac_kw: 10.0,
  is_plus_variant: true, battery_capable: true,
};
const INVERTER_GEN24_NONPLUS = {
  sku: 'FRN-INV-100-G24-1P',
  name: 'Primo 10.0 GEN24', brand: 'Fronius', phase: 1, ac_kw: 10.0,
  is_plus_variant: false, battery_capable: false,
};

let failed = 0;
function assert(label, cond) {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ FAIL: ${label}`); failed++; }
}

// ── Panel selector ──────────────────────────────────────────────────────────
console.log('\n══════ Panel selector ══════');

{
  console.log('\n── 10 kWp target — should pick 595W (more watts wins) ──');
  const r = selectPanel({ catalogue: CATALOGUE, targetKwp: 10 });
  console.log(`  Picked: ${r.sku} — ${r.reason_code}`);
  console.log(`  ${r.reason}`);
  console.log(`  Alternatives: ${r.alternatives.map(a => `${a.sku} (${a.watts}W, $${a.dollars_per_kwp}/kWp, ${a.panels_needed}p)`).join(' | ')}`);
  assert('picks highest-wattage panel', r.sku === 'PHN-PNL-595-DRC');
  assert('panels_needed = 17 for 10 kWp on 595W', r.panels_needed === 17);
  assert('incomplete panel excluded', !r.alternatives.find(a => a.sku === 'INC-PNL-INCOMPLETE'));
}

{
  console.log('\n── empty catalogue ──');
  const r = selectPanel({ catalogue: { PANELS: {} } });
  console.log(`  reason: ${r.reason_code}`);
  assert('no_active_panels when empty', r.reason_code === 'no_active_panels');
}

// ── Battery selector ────────────────────────────────────────────────────────
console.log('\n══════ Battery selector ══════');

{
  console.log('\n── 10 kWh usable target on GEN24 Plus ──');
  const r = selectBattery({
    targetUsableKwh: 10, inverter: INVERTER_GEN24P,
    catalogue: CATALOGUE, COMPATIBILITY, BMS_RULES,
  });
  console.log(`  Picked: ${r.sku} (${r.module_count} modules = ${r.total_usable_kwh} kWh usable)`);
  console.log(`  ${r.reason}`);
  console.log(`  Alternatives:`);
  for (const alt of r.alternatives) {
    console.log(`    • ${alt.sku} — ${alt.module_count} × ${alt.series} = ${alt.total_usable_kwh} kWh ` +
                `at $${alt.dollars_per_usable_kwh}/kWh (${alt.headroom_pct}% headroom)`);
  }
  assert('selected reason code', r.reason_code === 'selected');
  assert('module_count covers 10 kWh', r.total_usable_kwh >= 10);
}

{
  console.log('\n── 5 kWh usable target on GEN24 Plus — smaller, max headroom ──');
  const r = selectBattery({
    targetUsableKwh: 5, inverter: INVERTER_GEN24P,
    catalogue: CATALOGUE, COMPATIBILITY, BMS_RULES,
  });
  console.log(`  Picked: ${r.sku} (${r.module_count} modules = ${r.total_usable_kwh} kWh)`);
  console.log(`  ${r.reason}`);
  assert('meets 5 kWh', r.total_usable_kwh >= 5);
}

{
  console.log('\n── 18 kWh resilience target ──');
  const r = selectBattery({
    targetUsableKwh: 18, inverter: INVERTER_GEN24P,
    catalogue: CATALOGUE, COMPATIBILITY, BMS_RULES,
  });
  console.log(`  Picked: ${r.sku} (${r.module_count} modules = ${r.total_usable_kwh} kWh)`);
  console.log(`  ${r.reason}`);
  assert('meets 18 kWh', r.total_usable_kwh >= 18);
}

{
  console.log('\n── battery on non-Plus inverter → blocked ──');
  const r = selectBattery({
    targetUsableKwh: 10, inverter: INVERTER_GEN24_NONPLUS,
    catalogue: CATALOGUE, COMPATIBILITY, BMS_RULES,
  });
  console.log(`  reason: ${r.reason_code} — ${r.reason}`);
  assert('inverter_not_plus rejection', r.reason_code === 'inverter_not_plus');
}

{
  // Bug 6 fix (2026-08-24): selectBattery no longer hard-fails on oversize
  // asks. When no valid+matrix-approved module count meets the customer's
  // target, it snaps DOWN to the largest available count and flags
  // `snapped_below_target: true`. Rationale: better UX to under-shoot by
  // a couple modules than to reject the customer entirely with a scary
  // "cannot_meet_target" error and no battery info at all. The old
  // behavior left the tier with stale/null battery data (see QA bug
  // 2026-08-24: "battery capacity does not update, inverter changes but
  // battery info remains").
  console.log('\n── target > max possible (50 kWh) → snap-below-target ──');
  const r = selectBattery({
    targetUsableKwh: 50, inverter: INVERTER_GEN24P,
    catalogue: CATALOGUE, COMPATIBILITY, BMS_RULES,
  });
  console.log(`  reason_code: ${r.reason_code} · snapped: ${r.snapped_below_target} · picked: ${r.total_usable_kwh} kWh`);
  assert('50kWh oversize → selected with snapped_below_target', r.reason_code === 'selected' && r.snapped_below_target === true);
  assert('50kWh oversize → picked capacity below target', r.total_usable_kwh > 0 && r.total_usable_kwh < 50);
}

console.log(`\n──── Summary ────`);
console.log(`  ${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);

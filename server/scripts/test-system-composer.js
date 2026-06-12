// ────────────────────────────────────────────────────────────────────────────
// Smoke test for Option 4c — System composer (full chain orchestration).
//
// Verifies the composer chains panel → inverter → battery → string layout
// correctly and surfaces warnings without crashing on sub-selector failures.
// ────────────────────────────────────────────────────────────────────────────

import { composeSystem } from '../services/pm/proposalEngine/systemComposer.js';
import { BMS_RULES, COMPATIBILITY } from '../services/pm/proposalEngine/data/engineeringRules.js';

const PANEL_595 = {
  name: '595W Phono Draco', brand: 'Phono Solar', watts: 595,
  voc_stc: 52.92, isc_stc: 14.32, vmp_stc: 43.75, imp_stc: 13.60,
  voltage_temp_coef_pct_per_c: -0.25,
  cost_nzd: 260, margin_pct: 50,
};

const CATALOGUE = {
  PANELS: { 'PHN-PNL-595-DRC': PANEL_595 },
  INVERTERS: {
    'FRN-INV-50-G24P-1P': {
      name: 'Primo 5.0 Plus', brand: 'Fronius', phase: 1, ac_kw: 5.0,
      is_plus_variant: true, battery_capable: true, mppt_count: 2,
      uoc_max_v: 600, mppt_v_min: 80, idc_max_a_per_mppt: 22,
      isc_max_a_mppt1: 41.25, isc_max_a_mppt2: 36,
    },
    'FRN-INV-100-G24P-1P': {
      name: 'Primo 10.0 Plus', brand: 'Fronius', phase: 1, ac_kw: 10.0,
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

const REGION = { t_min_celsius: -10 };

let failed = 0;
function assert(label, cond) {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ FAIL: ${label}`); failed++; }
}

console.log('\n══════ Composer ══════');

// Tier 1 — 10 kWp, no battery
{
  console.log('\n── Tier 1 shape: 10 kWp, no battery, 1ph ──');
  const r = composeSystem({
    targetDcKwp: 10, phase: 1,
    targetBatteryUsableKwh: null, hasEv: false,
    region: REGION, catalogue: CATALOGUE,
    COMPATIBILITY, BMS_RULES,
  });
  console.log(`  Panel:    ${r.panel?.sku} × ${r.panel?.count}`);
  console.log(`  Inverter: ${r.inverter?.sku}`);
  console.log(`  Battery:  ${r.battery ? r.battery.sku : '(none)'}`);
  console.log(`  String:   ${r.string_design?.string_count} × ${r.string_design?.panels_per_string} ${r.string_design?.topology}`);
  console.log(`  Warnings: ${r.warnings.length}`);
  assert('panel selected', r.panel?.sku === 'PHN-PNL-595-DRC');
  assert('inverter selected', r.inverter?.sku === 'FRN-INV-100-G24P-1P');
  assert('battery null', r.battery === null);
  assert('string layout produced', r.string_design != null);
}

// Tier 2 — 10 kWp + 11 kWh battery
{
  console.log('\n── Tier 2 shape: 10 kWp + 11 kWh battery, 1ph ──');
  const r = composeSystem({
    targetDcKwp: 10, phase: 1,
    targetBatteryUsableKwh: 11, hasEv: false,
    region: REGION, catalogue: CATALOGUE,
    COMPATIBILITY, BMS_RULES,
  });
  console.log(`  Panel:    ${r.panel?.sku} × ${r.panel?.count}`);
  console.log(`  Inverter: ${r.inverter?.sku}`);
  console.log(`  Battery:  ${r.battery?.sku} × ${r.battery?.module_count} = ${r.battery?.kwh} kWh`);
  console.log(`  String:   ${r.string_design?.string_count} × ${r.string_design?.panels_per_string}`);
  assert('battery selected', r.battery?.sku === 'BYD-BAT-276-HVM');
  assert('battery covers target', r.battery?.kwh >= 11);
  assert('inverter is Plus', r.inverter?.sku === 'FRN-INV-100-G24P-1P');
}

// Tier 3 — 13 kWp + 14 kWh battery + EV (tiered_sizes mode)
{
  console.log('\n── Tier 3 shape: 13 kWp + 14 kWh battery + EV, 1ph ──');
  const r = composeSystem({
    targetDcKwp: 13, phase: 1,
    targetBatteryUsableKwh: 14, hasEv: true,
    region: REGION, catalogue: CATALOGUE,
    COMPATIBILITY, BMS_RULES,
  });
  console.log(`  Panel:    ${r.panel?.sku} × ${r.panel?.count}`);
  console.log(`  Inverter: ${r.inverter?.sku}`);
  console.log(`  Battery:  ${r.battery?.sku} × ${r.battery?.module_count}`);
  console.log(`  Wattpilot: ${r.wattpilot_included}`);
  console.log(`  Warnings: ${r.warnings.map(w => w.code).join(', ') || '(none)'}`);
  assert('wattpilot_included = true', r.wattpilot_included === true);
  assert('battery sized for 14 kWh', r.battery?.kwh >= 14);
}

// Empty catalogue — panel selection should fail gracefully
{
  console.log('\n── Empty catalogue — graceful warning ──');
  const r = composeSystem({
    targetDcKwp: 10, phase: 1,
    targetBatteryUsableKwh: null, hasEv: false,
    region: REGION,
    catalogue: { PANELS: {}, INVERTERS: {}, BATTERIES: {} },
    COMPATIBILITY, BMS_RULES,
  });
  console.log(`  Panel: ${r.panel ? r.panel.sku : '(null)'}`);
  console.log(`  Warnings: ${r.warnings.map(w => w.code).join(', ')}`);
  assert('panel null', r.panel === null);
  assert('warning surfaced', r.warnings.some(w => w.code.startsWith('panel_')));
}

console.log(`\n──── Summary ────`);
console.log(`  ${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);

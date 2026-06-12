// ────────────────────────────────────────────────────────────────────────────
// Smoke test for Option 4a — Inverter selector.
//
// Verifies the §2.8 decision tree picks the right inverter across realistic
// cases. Uses a fake catalogue covering the Fronius lineup.
//
// Run: node server/scripts/test-inverter-selector.js
// ────────────────────────────────────────────────────────────────────────────

import { selectInverter } from '../services/pm/proposalEngine/inverterSelector.js';

// Fake catalogue mirroring the live Fronius lineup
const CATALOGUE = {
  INVERTERS: {
    // 1ph Primo GEN24 (non-Plus)
    'FRN-INV-30-G24':       { name: 'Primo 3.0',  brand: 'Fronius', phase: 1, ac_kw: 3.0,  is_plus_variant: false, battery_capable: false, mppt_count: 2, uoc_max_v: 600, mppt_v_min: 80 },
    'FRN-INV-50-G24':       { name: 'Primo 5.0',  brand: 'Fronius', phase: 1, ac_kw: 5.0,  is_plus_variant: false, battery_capable: false, mppt_count: 2, uoc_max_v: 600, mppt_v_min: 80 },
    'FRN-INV-80-G24-1P':    { name: 'Primo 8.0',  brand: 'Fronius', phase: 1, ac_kw: 8.0,  is_plus_variant: false, battery_capable: false, mppt_count: 2, uoc_max_v: 600, mppt_v_min: 165 },
    'FRN-INV-100-G24-1P':   { name: 'Primo 10.0', brand: 'Fronius', phase: 1, ac_kw: 10.0, is_plus_variant: false, battery_capable: false, mppt_count: 2, uoc_max_v: 600, mppt_v_min: 165 },

    // 1ph Primo GEN24 Plus (battery-capable)
    'FRN-INV-50-G24P-1P':   { name: 'Primo 5.0 Plus',  brand: 'Fronius', phase: 1, ac_kw: 5.0,  is_plus_variant: true, battery_capable: true, mppt_count: 2, uoc_max_v: 600, mppt_v_min: 80 },
    'FRN-INV-80-G24P-1P':   { name: 'Primo 8.0 Plus',  brand: 'Fronius', phase: 1, ac_kw: 8.0,  is_plus_variant: true, battery_capable: true, mppt_count: 2, uoc_max_v: 600, mppt_v_min: 165 },
    'FRN-INV-100-G24P-1P':  { name: 'Primo 10.0 Plus', brand: 'Fronius', phase: 1, ac_kw: 10.0, is_plus_variant: true, battery_capable: true, mppt_count: 2, uoc_max_v: 600, mppt_v_min: 165 },

    // 3ph Symo GEN24
    'FRN-INV-60-SYMO':      { name: 'Symo 6.0',  brand: 'Fronius', phase: 3, ac_kw: 6.0,  is_plus_variant: false, battery_capable: false, mppt_count: 2, uoc_max_v: 1000, mppt_v_min: 165 },
    'FRN-INV-100-SYMO':     { name: 'Symo 10.0', brand: 'Fronius', phase: 3, ac_kw: 10.0, is_plus_variant: false, battery_capable: false, mppt_count: 2, uoc_max_v: 1000, mppt_v_min: 165 },

    // 3ph Symo GEN24 Plus
    'FRN-INV-100-SYMP-3P':  { name: 'Symo 10.0 Plus', brand: 'Fronius', phase: 3, ac_kw: 10.0, is_plus_variant: true, battery_capable: true, mppt_count: 2, uoc_max_v: 1000, mppt_v_min: 165 },
    'FRN-INV-120-SYMP-3P':  { name: 'Symo 12.0 Plus', brand: 'Fronius', phase: 3, ac_kw: 12.0, is_plus_variant: true, battery_capable: true, mppt_count: 2, uoc_max_v: 1000, mppt_v_min: 165 },

    // 3ph Verto Plus (commercial)
    'FRN-INV-200-VERTO-P':  { name: 'Verto 20.0 Plus', brand: 'Fronius', phase: 3, ac_kw: 20.0, is_plus_variant: true, battery_capable: true, mppt_count: 3, uoc_max_v: 1000, mppt_v_min: 240 },
  },
};

const cases = [
  // 1ph residential, no battery, 5 kW target — should pick Primo 5.0 (non-Plus is fine)
  { name: '1ph, 5 kW PV, no battery → Primo 5.0',
    args: { targetDcKwp: 5.0, phase: 1, hasBattery: false },
    expect: { sku: 'FRN-INV-50-G24', reason_code: 'selected' } },

  // 1ph residential, with battery, 8 kW target — should pick Primo 8.0 Plus
  { name: '1ph, 8 kW PV + battery → Primo 8.0 Plus',
    args: { targetDcKwp: 8.0, phase: 1, hasBattery: true },
    expect: { sku: 'FRN-INV-80-G24P-1P', reason_code: 'selected' } },

  // 1ph residential, with battery, 12 kW target — should pick Primo 10.0 Plus (DC/AC 1.20 OK)
  { name: '1ph, 12 kW PV + battery → Primo 10.0 Plus (DC/AC 1.20)',
    args: { targetDcKwp: 12.0, phase: 1, hasBattery: true },
    expect: { sku: 'FRN-INV-100-G24P-1P' } },

  // 1ph, big array no inverter big enough — 18 kW on 10 kW max → DC/AC 1.80 over envelope
  { name: '1ph, 18 kW PV — exceeds available inverters',
    args: { targetDcKwp: 18.0, phase: 1, hasBattery: false },
    expect: { reason_code: 'dc_ac_out_of_envelope' } },

  // 3ph commercial, big array — should pick Verto 20 Plus
  { name: '3ph, 20 kW PV + battery → Symo or Verto',
    args: { targetDcKwp: 20.0, phase: 3, hasBattery: true },
    expect_passes: true },

  // 1ph residential, no Plus needed at all
  { name: '1ph, 8 kW PV, no battery → Primo 8.0 (non-Plus saves cost)',
    args: { targetDcKwp: 8.0, phase: 1, hasBattery: false },
    expect: { sku: 'FRN-INV-80-G24-1P' } },

  // 1ph battery + EV: should prefer headroom for Wattpilot
  { name: '1ph, 6 kW PV + battery + EV → Primo 10.0 Plus (EV headroom)',
    args: { targetDcKwp: 6.0, phase: 1, hasBattery: true, hasEv: true },
    expect_passes: true },

  // 3ph with battery — should NOT pick non-Plus Symo
  { name: '3ph, 8 kW PV + battery → Symo 10 Plus (skips non-Plus)',
    args: { targetDcKwp: 8.0, phase: 3, hasBattery: true },
    expect: { sku: 'FRN-INV-100-SYMP-3P' } },
];

let failed = 0;

for (const tc of cases) {
  console.log(`\n──── ${tc.name} ────`);
  const out = selectInverter({ ...tc.args, catalogue: CATALOGUE });
  console.log(`  Picked: ${out.sku || 'NONE'} — ${out.reason_code}`);
  console.log(`  Target AC: ${out.target_ac_kw} kW · DC/AC: ${out.dc_ac_ratio}`);
  console.log(`  ${out.reason}`);
  if (out.alternatives?.length > 0) {
    console.log(`  Alternatives:`);
    for (const alt of out.alternatives) {
      console.log(`    • ${alt.name} (${alt.ac_kw} kW, DC/AC ${alt.dc_ac_ratio}, score ${alt.score})`);
    }
  }

  let ok = true;
  if (tc.expect) {
    for (const [k, v] of Object.entries(tc.expect)) {
      if (out[k] !== v) {
        console.log(`  ❌ ASSERT FAIL: expected ${k}=${v}, got ${out[k]}`);
        ok = false;
      }
    }
  }
  if (tc.expect_passes && (!out.sku || out.reason_code !== 'selected')) {
    console.log(`  ❌ ASSERT FAIL: expected a selected inverter, got ${out.reason_code}`);
    ok = false;
  }
  if (ok) console.log(`  ✅ ok`);
  else failed++;
}

console.log(`\n──── Summary ────`);
console.log(`  ${cases.length - failed}/${cases.length} cases pass.`);
process.exit(failed === 0 ? 0 : 1);

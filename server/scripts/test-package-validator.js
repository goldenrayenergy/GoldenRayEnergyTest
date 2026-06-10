// Demonstrates packageCompatService + packageValidatorService against live data.
//
// USAGE:
//   node server/scripts/test-package-validator.js

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const { validatePackage } = await import('../services/packageValidatorService.js');
const {
  compatibleBatteriesFor, compatibleInvertersFor,
  componentsOf, priceBatterySystem,
} = await import('../services/packageCompatService.js');

const cases = [
  {
    label: 'Saliya R3 — 6 kW + Reserva 6.3 (Option 2)',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 13, inverter_sku: 'FRN-INV-60-G24P-1P', battery_system_sku: 'FR-RES-6.3' },
  },
  {
    label: 'Saliya R3 — 6 kW solar only (Option 1)',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 13, inverter_sku: 'FRN-INV-60-G24P-1P' },
  },
  {
    label: 'Battery with non-hybrid (base GEN24) — should fail',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 11, inverter_sku: 'FRN-INV-50-G24', battery_system_sku: 'FR-RES-6.3' },
  },
  {
    label: 'DC oversized — 20 × 475W into Primo 5.0 (9.5 kW DC into 5 kW inverter)',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 20, inverter_sku: 'FRN-INV-50-G24P-1P' },
  },
  {
    label: 'Battery size outside compat range — Reserva 6.3 with Primo 5.0 PLUS (needs ≥ 9.5)',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 11, inverter_sku: 'FRN-INV-50-G24P-1P', battery_system_sku: 'FR-RES-6.3' },
  },
  {
    label: 'Unknown SKU',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 11, inverter_sku: 'FRN-INV-999-FAKE' },
  },

  // ── Phase consistency ──
  {
    label: 'Phase mismatch — 3-phase inverter on single-phase site',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 24, inverter_sku: 'FRN-INV-100-SYMO', site_phase: 1 },
  },
  {
    label: 'Phase imbalance — single-phase inverter on 3-phase site',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 11, inverter_sku: 'FRN-INV-50-G24P-1P', site_phase: 3 },
  },

  // ── Smart meter pairing ──
  {
    label: 'Meter missing — Primo 5.0 PLUS solar-only with no meter',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 11, inverter_sku: 'FRN-INV-50-G24P-1P' },
  },
  {
    label: 'Correct meter pairing — Primo 5.0 + FRN-MTR-63-S1P',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 10, inverter_sku: 'FRN-INV-50-G24P-1P', smart_meter_sku: 'FRN-MTR-63-S1P' },
  },
  {
    label: 'Wrong-phase meter — single-phase inverter with 3-phase meter',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 10, inverter_sku: 'FRN-INV-50-G24P-1P', smart_meter_sku: 'FRN-MTR-63-T3P' },
  },

  // ── Racking BOM ──
  {
    label: 'Racking missing — 13-panel array with no racking_items',
    pkg: { panel_sku: 'PHN-PNL-475-QSR', panel_qty: 13, inverter_sku: 'FRN-INV-60-G24P-1P', roof_type: 'metal' },
  },
  {
    label: 'Racking under-supplied — 13 panels but only 2 rails + 4 clamps',
    pkg: {
      panel_sku: 'PHN-PNL-475-QSR', panel_qty: 13, inverter_sku: 'FRN-INV-60-G24P-1P', roof_type: 'metal',
      racking_items: [
        { sku: 'HOP-RCK-4700-S', qty: 2 },
        { sku: 'HOP-RCK-CLP-FECS', qty: 4 },
      ],
    },
  },
  {
    label: 'Racking complete — 13 panels with right kit',
    pkg: {
      panel_sku: 'PHN-PNL-475-QSR', panel_qty: 13, inverter_sku: 'FRN-INV-60-G24P-1P', roof_type: 'metal',
      racking_items: [
        { sku: 'HOP-RCK-4700-S', qty: 7 },
        { sku: 'HOP-RCK-CLP-FECS', qty: 4 },
        { sku: 'HOP-RCK-CLP-FICS', qty: 22 },
        { sku: 'HOP-RCK-FOT-TRBB', qty: 16 },
        { sku: 'HOP-RCK-EAR-LUG', qty: 1 },
        { sku: 'HOP-RCK-EAR-PLT', qty: 7 },
      ],
    },
  },
];

function fmt(v) { return v === null || v === undefined ? '—' : String(v); }

function printResult(label, res) {
  console.log(`\n${'─'.repeat(72)}`);
  console.log(`▸ ${label}`);
  console.log(`${'─'.repeat(72)}`);
  console.log(`  Status: ${res.ok ? '✅ VALID' : '❌ INVALID'} (${res.errors.length} errors, ${res.warnings.length} warnings)`);
  const s = res.summary;
  if (s.panel) console.log(`  Panel:    ${s.panel.sku.padEnd(20)} ${s.panel.qty} × ${s.panel.wattage_w}W = ${s.total_dc_kw} kW DC`);
  if (s.inverter) {
    console.log(`  Inverter: ${s.inverter.sku.padEnd(20)} rated ${fmt(s.inverter.rated_kw)} kW · max DC ${fmt(s.inverter.max_dc_kw)} kW · ${fmt(s.inverter.mppts)} MPPTs · ${fmt(s.inverter.phase)}-phase · hybrid=${fmt(s.inverter.hybrid_ready)} (${fmt(s.inverter.hybrid_status)})`);
  }
  if (s.dc_max_ratio !== undefined) console.log(`  DC/MaxDC: ${(s.dc_max_ratio * 100).toFixed(1)}% of inverter max DC capacity`);
  if (s.dc_ac_ratio  !== undefined) console.log(`  DC/AC:    ${s.dc_ac_ratio.toFixed(3)}×`);
  if (s.min_panels_per_mppt) console.log(`  Per MPPT: ${s.min_panels_per_mppt} panels (max allowed ${fmt(s.inverter.panels_per_mppt_max)} @ ${fmt(s.inverter.panels_per_mppt_assumption_w)}W default)`);
  if (s.battery) {
    console.log(`  Battery:  ${s.battery.system_sku.padEnd(20)} ${s.battery.display_name} · ${s.battery.capacity_kwh} kWh capacity`);
    if (s.compat) console.log(`  Compat:   range ${s.compat.min_battery_kwh}-${s.compat.max_battery_kwh} kWh · charge ${s.compat.charge_kw} kW · full_backup=${s.compat.full_backup}`);
  }
  if (s.site_phase !== undefined) console.log(`  Site:     ${s.site_phase}-phase`);
  if (s.smart_meter) console.log(`  Meter:    ${s.smart_meter.sku} (${s.smart_meter.phase}-phase) — ${s.smart_meter.name}`);
  if (s.recommended_smart_meter_sku && !s.smart_meter) console.log(`  Meter:    (recommended: ${s.recommended_smart_meter_sku})`);
  if (s.racking_expected) {
    const exp = s.racking_expected;
    const prov = s.racking_provided || {};
    console.log(`  Racking:  expected rails ${exp.rails}/clamps ${exp.end_clamps}E+${exp.mid_clamps}M/feet ${exp.feet}/earthing ${exp.earthing_lugs}L+${exp.earthing_plates}P  ·  provided rails ${prov.rails||0}/clamps ${prov.end_clamps||0}E+${prov.mid_clamps||0}M/feet ${prov.feet||0}/earthing ${prov.earthing_lugs||0}L+${prov.earthing_plates||0}P`);
  }
  for (const e of res.errors)   console.log(`  ✗ [${e.code}] ${e.message}`);
  for (const w of res.warnings) console.log(`  ⚠ [${w.code}] ${w.message}`);
}

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('PACKAGE VALIDATOR TEST');
console.log('═══════════════════════════════════════════════════════════════════════');
for (const c of cases) {
  const res = await validatePackage(c.pkg);
  printResult(c.label, res);
}

// ── Compat helper demos ─────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('COMPAT HELPER DEMOS');
console.log('═══════════════════════════════════════════════════════════════════════');

console.log('\n▸ compatibleBatteriesFor("FRN-INV-60-G24P-1P")');
const bats = await compatibleBatteriesFor('FRN-INV-60-G24P-1P');
for (const b of bats) {
  console.log(`  ${b.battery_system_sku.padEnd(16)} → range ${b.min_battery_kwh}-${b.max_battery_kwh} kWh · charge ${b.charge_kw} kW · full_backup=${b.full_backup}`);
}

console.log('\n▸ compatibleInvertersFor("FR-RES-9.5")');
const invs = await compatibleInvertersFor('FR-RES-9.5');
for (const i of invs) {
  console.log(`  ${i.inverter_sku.padEnd(24)} ${i.inverter?.name || ''}`);
}

console.log('\n▸ componentsOf("FR-RES-6.3")');
const comps = await componentsOf('FR-RES-6.3');
for (const c of comps) {
  const p = c.product;
  console.log(`  ${c.qty} × ${c.sku.padEnd(20)} ${p ? p.name + '  $' + p.cost_nzd : '(missing in catalogue)'}`);
}

console.log('\n▸ priceBatterySystem("FR-RES-6.3")  (with GST)');
const price = await priceBatterySystem('FR-RES-6.3', { applyGst: true });
console.log(`  Cost total:     $${price.cost_total.toLocaleString()}`);
console.log(`  Sell excl GST:  $${price.sell_excl_gst.toLocaleString()}`);
console.log(`  Sell incl GST:  $${price.sell_incl_gst.toLocaleString()}`);

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('DONE');
console.log('═══════════════════════════════════════════════════════════════════════\n');

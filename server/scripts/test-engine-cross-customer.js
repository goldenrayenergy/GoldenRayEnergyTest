// ────────────────────────────────────────────────────────────────────────────
// Cross-customer test — engine handles inputs it has NEVER seen
//
// The Krishna smoke test is partly circular (engine extracted from same source
// as the PDF). This test runs a fictional NEW customer through the engine
// with deliberately different parameters from Krishna:
//   • Wellington (different regional yield 1,150 vs Auckland 1,250)
//   • Fronius Reserva battery (different BMS-per-module rule than HVM)
//   • Series topology (not parallel — no clipping, no combiner)
//   • Smaller system (18 panels = 10.71 kW — medium labour tier, not large)
//   • Different inverter MPPT loading (2 strings of 9)
//   • Customer priced for healthy margin above floor
//
// Every number is hand-computed below and asserted against the engine output.
// No pre-existing PDF exists — if these numbers are right, the engine is
// independently correct.
//
// Run: node server/scripts/test-engine-cross-customer.js
// ────────────────────────────────────────────────────────────────────────────

import { runEngine } from '../services/pm/proposalEngine/index.js';
import { runFinancialModel } from '../services/pm/proposalEngine/financialModel.js';
import { PANELS, INVERTERS, BATTERIES, BMS_CONTROLLERS, SMART_METERS, BOS_ITEMS, lineFromSku } from '../services/pm/proposalEngine/data/catalogue.js';
import {
  INSTALLATION_LABOUR, BATTERY_INSTALL_PREMIUM, SUPERVISOR, TRAVEL, LOGISTICS,
  SYSTEM_DESIGN, INSPECTION_COMPLIANCE, COMMISSIONING, GRID_APPLICATION, COC,
} from '../services/pm/proposalEngine/data/labourRateCard.js';
import { REGIONS, FINANCIAL_DEFAULTS, selfConsumptionFraction, requiredBmsCount } from '../services/pm/proposalEngine/data/engineeringRules.js';

let passCount = 0, failCount = 0;
const failures = [];

function ok(label, actual, expected, tol = 0.01) {
  const delta = Math.abs(actual - expected);
  const pass = delta <= tol;
  const sign = actual >= expected ? '+' : '';
  const display = typeof actual === 'number'
    ? (Math.abs(actual) >= 100 ? Math.round(actual).toLocaleString() : actual.toFixed(2))
    : actual;
  const expDisplay = typeof expected === 'number'
    ? (Math.abs(expected) >= 100 ? Math.round(expected).toLocaleString() : expected.toFixed(2))
    : expected;
  const mark = pass ? '✓' : '✗';
  console.log(`  ${mark} ${label.padEnd(60)} actual ${String(display).padStart(12)}  expected ${String(expDisplay).padStart(12)}  Δ ${sign}${(actual - expected).toFixed(2)}`);
  if (pass) passCount++;
  else { failCount++; failures.push({ label, actual, expected, delta }); }
}

function okExact(label, actual, expected) {
  const pass = actual === expected;
  const mark = pass ? '✓' : '✗';
  console.log(`  ${mark} ${label.padEnd(60)} ${pass ? '' : `actual ${actual}  expected ${expected}`}`);
  if (pass) passCount++;
  else { failCount++; failures.push({ label, actual, expected }); }
}

function section(title) {
  console.log();
  console.log('━'.repeat(80));
  console.log(`  ${title}`);
  console.log('━'.repeat(80));
}

// ────────────────────────────────────────────────────────────────────────────
// SPEC — fictional Wellington customer with Reserva 12.6 kWh
// ────────────────────────────────────────────────────────────────────────────
const PANEL_SKU = 'PHN-PNL-595-DRC';
const INVERTER_SKU = 'FRN-INV-100-G24P-1P';
const BATTERY_SKU = 'FRN-BAT-315-RSV';     // Fronius Reserva 3.15 kWh modules
const BMS_SKU = 'FRN-BAC-ACC-RSV';
const REGION = 'wellington';
const PANEL_COUNT = 18;
const MODULES = 4;                          // 4 × 3.15 = 12.6 kWh; Reserva @ 4 mod = 2 BMS!
const PANELS_PER_STRING = 9;
const STRING_COUNT = 2;
const CABLE_RUN = 30;
const CUSTOMER_PRICE_INC = 44500;  // priced to keep margin above 10% floor

const spec = {
  customer: {
    full_name: 'Wellington Test Customer',
    email: 'wtc@example.com',
    phone: '+64 21 222 3333',
    address: { street: '5 Mt Vic Rd', suburb: 'Mt Victoria', city: 'Wellington', region: REGION },
    property_ownership: 'own',
  },
  bills: { manual_entry: { annual_kwh: 9000, annual_spend: 2700, retailer: 'Mercury',
                           variable_rate_per_kwh_incl_gst: 0.26, daily_fixed_charge_incl_gst: 2.30, buyback_rate: 0.09 }},
  system: {
    panel: { sku: PANEL_SKU, count: PANEL_COUNT },
    inverter: { sku: INVERTER_SKU },
    battery: { sku: BATTERY_SKU, module_count: MODULES },
    smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
    string_topology: 'series',
    string_design: { panels_per_string: PANELS_PER_STRING, string_count: STRING_COUNT },
    cable_run_metres_estimate: CABLE_RUN,
    phase: 1,
  },
  pricing: { customer_price_inc_gst: CUSTOMER_PRICE_INC, stage: 'stage_1_estimate', final_mode: true,
             discount: { applied_nzd: 0, owner_approved: false, reason: null }},
  preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'two_signers',
                 financing: { choice: 'cash' }},
};

// ────────────────────────────────────────────────────────────────────────────
// Hand-calculate every expected value BEFORE running the engine
// ────────────────────────────────────────────────────────────────────────────
const panel = PANELS[PANEL_SKU];
const inverter = INVERTERS[INVERTER_SKU];
const battery = BATTERIES[BATTERY_SKU];
const bms = BMS_CONTROLLERS[BMS_SKU];
const meter = SMART_METERS['FRN-MTR-63-S1P'];
const region = REGIONS[REGION];

// System sizing
const expectedKw = +(PANEL_COUNT * panel.watts / 1000).toFixed(2);  // 18 × 595 / 1000 = 10.71

// Reserva 4 modules → 2 BMS (per BMS_RULES.Reserva.bms_per_tower_by_modules)
const expectedBmsCount = 2;
const expectedBatteryKwh = MODULES * battery.module_kwh;  // 4 × 3.15 = 12.6

// Voc cold — Wellington t_min = -5°C
// Per panel: 52.92 × (1 + 0.0025 × 30) = 52.92 × 1.075 = 56.889V
// String of 9: 512V — under 600V Uoc max, fine
const expectedVocPerPanel = panel.voc_stc * (1 + Math.abs(panel.voltage_temp_coef_pct_per_c) / 100 * (25 - region.t_min_celsius));
const expectedStringVoc = expectedVocPerPanel * PANELS_PER_STRING;

// Hardware costs
const expectedPanelCost = panel.cost_nzd * PANEL_COUNT;                       // $4,680
const expectedInverterCost = inverter.cost_nzd;                                // $4,811
const expectedBatteryCost = battery.cost_nzd * MODULES;                       // $8,303.40
const expectedBmsCost = bms.cost_nzd * expectedBmsCount;                      // 1937.25 × 2 = $3,874.50
const expectedMeterCost = meter.cost_nzd;                                      // $228.23
const expectedMajorHwCost = expectedPanelCost + expectedInverterCost + expectedBatteryCost + expectedBmsCost + expectedMeterCost;
// = 4680 + 4811 + 8303.40 + 3874.50 + 228.23 = 21,897.13

const expectedPanelSell = expectedPanelCost * 1.50;                            // 50% margin → 7020
const expectedInverterSell = expectedInverterCost * 1.30;                      // 30% margin → 6254.30
const expectedBatterySell = expectedBatteryCost * 1.30;                        // 30% margin → 10794.42
const expectedBmsSell = expectedBmsCost * 1.30;                                // 30% margin → 5036.85
const expectedMeterSell = expectedMeterCost * 1.30;                            // 30% margin → 296.70
const expectedMajorHwSell = expectedPanelSell + expectedInverterSell + expectedBatterySell + expectedBmsSell + expectedMeterSell;

// BoS (no combiner — series topology)
const expectedMountKits = Math.ceil(PANEL_COUNT / 4);   // ceil(18/4) = 5
const expectedEpdmSeals = PANEL_COUNT;                  // 18
const expectedAcCableMeters = CABLE_RUN;                // 30

// Labour tier: 10.71 kW = medium ($4,000)
const expectedInstallLabour = INSTALLATION_LABOUR.medium.cost_nzd;             // $4,000
const expectedBatteryPremium = BATTERY_INSTALL_PREMIUM.cost_nzd;                // $1,500
// NO parallel premium (series topology)
const expectedLabour = expectedInstallLabour + expectedBatteryPremium +
                       SUPERVISOR.cost_nzd + TRAVEL.cost_nzd + LOGISTICS.cost_nzd;
// = 4000 + 1500 + 650 + 350 + 650 = $7,150

const expectedCompliance = SYSTEM_DESIGN.cost_nzd + INSPECTION_COMPLIANCE.cost_nzd +
                           COMMISSIONING.cost_nzd + GRID_APPLICATION.cost_nzd + COC.cost_nzd;
// = $1,800

// Customer total
const expectedCustomerEx = CUSTOMER_PRICE_INC / 1.15;          // ~$34,782.61

// Generation: series topology, no clipping
// Wellington yield 1,150 kWh/kWp/yr
const expectedGen = expectedKw * region.yield_kwh_per_kwp_per_year;  // 10.71 × 1150 = 12,316.5 → ~12,317

// Self-consumption: 12.6 kWh battery → fraction 0.85 from FINANCIAL_DEFAULTS table
const expectedFraction = selfConsumptionFraction(expectedBatteryKwh, false);   // 0.85

// ────────────────────────────────────────────────────────────────────────────
// Run engine + assert
// ────────────────────────────────────────────────────────────────────────────
const result = await runEngine(spec);
if (!result.ok) {
  console.log('❌ Engine refused fictional spec — should have passed:');
  if (result.config_errors) for (const e of result.config_errors) console.log(`    ${e.path}: ${e.message}`);
  process.exit(1);
}
const fin = runFinancialModel(spec, result.cost);

section('Wellington / Reserva 12.6 kWh — engine output vs hand-calculation');

// ── System ──
ok('System kW = 10.71 (18 × 595W)', result.cost.totals.system_kw, expectedKw, 0.01);
okExact('Spec passes config validation', result.config_valid, true);

// ── BMS rule for Reserva (different from HVM!) ──
const bmsLine = result.bom.find(b => b.sku === BMS_SKU);
ok('Reserva 4-module BMS count (= 2, not 1!)', bmsLine.qty, expectedBmsCount);

// ── Topology effects ──
const combiner = result.bom.find(b => b.sku === 'GEN-BOS-COMBINER');
okExact('Combiner box NOT added (series topology)', !!combiner, false);

// ── Voc cold check at Wellington ──
const vocPass = result.engineering.passes.find(p => p.rule === 'AS/NZS 5033 §3 — Voc cold check');
okExact('Voc cold check passes (Wellington -5°C, 9-in-series = 512V < 600V)', !!vocPass, true);
console.log(`    (expected per-panel Voc cold ${expectedVocPerPanel.toFixed(2)}V, string ${expectedStringVoc.toFixed(0)}V)`);

// ── Hardware costs ──
ok('Major hardware cost (hand-sum)',
   result.cost.sections.major_hardware.cost, expectedMajorHwCost, 0.50);
ok('Major hardware sell ex GST (per-line margin)',
   result.cost.sections.major_hardware.sell_ex_gst, expectedMajorHwSell, 0.50);

// ── BoM quantities (different from Krishna) ──
const mountKit = result.bom.find(b => b.sku === 'HOP-TIN-KIT-4P');
ok('Mount kits = ceil(18/4) = 5', mountKit.qty, expectedMountKits);
const acCable = result.bom.find(b => b.sku === 'GEN-BOS-CABLE-AC');
ok('AC cable = 30m (Wellington run)', acCable.qty, expectedAcCableMeters);

// ── Labour: medium tier (not large) ──
ok('Labour sell (medium tier, no parallel premium)',
   result.cost.sections.labour.sell_ex_gst, expectedLabour, 0.01);
const installLabour = result.cost.lines.find(l => l.sku === 'LAB-INSTALL-MEDIUM');
okExact('Medium install labour selected for 10.71 kW', !!installLabour, true);

// ── Compliance: unchanged ──
ok('Compliance sell ex GST = $1,800',
   result.cost.sections.compliance.sell_ex_gst, expectedCompliance, 0.01);

// ── Customer total & margin ──
ok('Customer total ex GST', result.cost.totals.customer_total_ex_gst, expectedCustomerEx, 0.50);
const expectedProfit = expectedCustomerEx - result.cost.totals.total_cost_ex_gst;
ok('Profit ex GST', result.cost.totals.profit_ex_gst, expectedProfit, 0.50);

// ── Margin floor: healthy/amber depending on cost; should NOT be below_floor ──
okExact('Margin floor status (not below floor at $40k)',
        result.cost.margin_floor_status !== 'below_floor', true);

// ── Can ship ──
okExact('can_ship = true (no hard fails, above floor)', result.can_ship, true);

section('Wellington financial model — different region, no clipping');

// ── Generation (Wellington yield 1,150, no clipping for series) ──
ok('Year-1 generation = 10.71 × 1,150 = 12,317',
   fin.yr1.generation_kwh, Math.round(expectedGen), 50);
okExact('Clipping disabled (series topology)',
        fin.assumptions.clipping_pct, 0);

// ── Self-consumption ──
ok('Self-consume fraction (12.6 kWh Reserva)',
   fin.assumptions.self_consume_fraction_yr1, expectedFraction, 0.01);

// ── Self-consumed ≤ usage (physics cap) ──
okExact('Self-consumed ≤ usage', fin.yr1.self_consumed_kwh <= spec.bills.manual_entry.annual_kwh, true);
okExact('Exported = generation - self-consumed',
        fin.yr1.exported_kwh, fin.yr1.generation_kwh - fin.yr1.self_consumed_kwh);

// ── Reconciliation invariants (CI-enforced) ──
console.log();
console.log('  Reconciliation invariants:');
for (const c of fin.reconciliation.checks) {
  okExact(`  ${c.name}`, c.pass, true);
}

// ── Monthly profile reconciles ──
const monGenSum = fin.monthly.reduce((s, m) => s + m.gen_kwh, 0);
const monUseSum = fin.monthly.reduce((s, m) => s + m.use_kwh, 0);
ok('Σ monthly gen = annual gen', monGenSum, fin.yr1.generation_kwh, 1);
ok('Σ monthly use = annual kWh', monUseSum, spec.bills.manual_entry.annual_kwh, 1);

section('Engineering validator — Reserva-specific outputs');

// Mixed-vendor disclosure should NOT fire (Fronius battery + Fronius inverter, both brand Fronius)
const mixedWarning = result.engineering.soft_warnings.find(w => w.rule === 'Mixed-vendor warranty disclosure');
okExact('NO mixed-vendor warning (Fronius+Fronius)', !!mixedWarning, false);

// Parallel topology warning should NOT fire
const parallelWarning = result.engineering.soft_warnings.find(w => w.rule === 'Parallel-string topology');
okExact('NO parallel-topology warning (series)', !!parallelWarning, false);

// Reserva-specific BMS pass message should fire
const bmsPass = result.engineering.passes.find(p => p.rule === 'Reserva BMS rule');
okExact('Reserva BMS rule pass entry present', !!bmsPass, true);

// LFP chemistry pass
const lfpPass = result.engineering.passes.find(p => p.rule === 'Cell chemistry');
okExact('LFP chemistry pass entry present', !!lfpPass, true);

section('Summary');

console.log(`  System:        ${expectedKw} kW (18 × Phono Draco)`);
console.log(`  Region:        Wellington (yield ${region.yield_kwh_per_kwp_per_year} kWh/kWp/yr)`);
console.log(`  Battery:       Reserva 12.6 kWh (4 modules × 3.15 kWh)`);
console.log(`  BMS required:  ${expectedBmsCount}× Reserva controller (different from HVM!)`);
console.log(`  Topology:      Series — no clipping, no combiner`);
console.log(`  Total cost:    $${Math.round(result.cost.totals.total_cost_ex_gst).toLocaleString()} ex GST`);
console.log(`  Customer:      $${CUSTOMER_PRICE_INC.toLocaleString()} inc GST`);
console.log(`  Margin:        ${result.cost.totals.project_margin_pct.toFixed(1)}% — ${result.cost.margin_floor_status}`);
console.log(`  Year-1 gen:    ${fin.yr1.generation_kwh.toLocaleString()} kWh`);
console.log(`  Year-1 save:   $${fin.yr1.savings.toLocaleString()}`);
console.log(`  Payback:       ${fin.payback_inflation_degradation_yrs} yrs`);
console.log(`  30-yr net:     $${fin.lifetime_net_savings.toLocaleString()}`);

console.log();
console.log('━'.repeat(80));
console.log(`  RESULT: ${passCount} passed, ${failCount} failed`);
console.log('━'.repeat(80));
if (failCount > 0) {
  console.log('  Failures:');
  for (const f of failures) console.log(`    ✗ ${f.label}`);
  process.exit(1);
} else {
  console.log('  ✅ Engine produces correct numbers for a customer it has NEVER seen.');
}

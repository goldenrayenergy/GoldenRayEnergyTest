// ────────────────────────────────────────────────────────────────────────────
// First-principles test — proposal engine math
//
// Validates that each MATH STEP of the engine is correct by hand-calculating
// the expected output from raw constants and comparing to engine output.
// NOT a regression test against Krishna — this exists because that test is
// partly circular (extracted logic compared to its own source).
//
// Every assertion below uses numbers derived from:
//   • catalogue constants (panel watts, costs, margins)
//   • physics formulas (Voc cold correction, ohms/amps)
//   • spec inputs (panel count, customer price)
//   • published rules (GST 15%, margin floor 10%, regional yield)
//
// Run: node server/scripts/test-engine-first-principles.js
// ────────────────────────────────────────────────────────────────────────────

import { runEngine } from '../services/pm/proposalEngine/index.js';
import { runFinancialModel } from '../services/pm/proposalEngine/financialModel.js';
import { PANELS, INVERTERS, BATTERIES, BMS_CONTROLLERS, SMART_METERS, BOS_ITEMS, lineFromSku } from '../services/pm/proposalEngine/data/catalogue.js';
import {
  INSTALLATION_LABOUR, BATTERY_INSTALL_PREMIUM, SUPERVISOR, TRAVEL, LOGISTICS,
  SYSTEM_DESIGN, INSPECTION_COMPLIANCE, COMMISSIONING, GRID_APPLICATION, COC,
} from '../services/pm/proposalEngine/data/labourRateCard.js';
import { REGIONS, FINANCIAL_DEFAULTS, selfConsumptionFraction, requiredBmsCount } from '../services/pm/proposalEngine/data/engineeringRules.js';

// ── Assertion helpers ──────────────────────────────────────────────────────
let passCount = 0;
let failCount = 0;
const failures = [];

function ok(label, actual, expected, tol = 0.01) {
  const delta = Math.abs(actual - expected);
  const pass = delta <= tol;
  const sign = actual >= expected ? '+' : '';
  const display = (typeof actual === 'number' && Math.abs(actual) >= 100)
    ? Math.round(actual).toLocaleString()
    : (typeof actual === 'number' ? actual.toFixed(2) : actual);
  const expDisplay = (typeof expected === 'number' && Math.abs(expected) >= 100)
    ? Math.round(expected).toLocaleString()
    : (typeof expected === 'number' ? expected.toFixed(2) : expected);
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
// Reference spec — built from raw catalogue + rules, NOT Krishna's PDF
// ────────────────────────────────────────────────────────────────────────────
const PANEL_COUNT = 20;
const PANEL_SKU = 'PHN-PNL-595-DRC';
const INVERTER_SKU = 'FRN-INV-100-G24P-1P';
const BATTERY_SKU = 'BYD-BAT-276-HVM';
const BATTERY_MODULES = 5;
const STRING_TOPOLOGY = 'parallel';
const PANELS_PER_STRING = 5;
const STRING_COUNT = 4;            // 4 × 5 = 20
const REGION = 'auckland_vector';
const CABLE_RUN = 24;

const spec = {
  customer: {
    full_name: 'Test Customer',
    email: 'test@example.com',
    phone: '+64 21 000 0000',
    address: { street: '1 Test St', suburb: 'Testville', city: 'Auckland', region: REGION },
    property_ownership: 'own',
  },
  bills: { manual_entry: { annual_kwh: 10000, annual_spend: 3000, retailer: 'Mercury',
                           variable_rate_per_kwh_incl_gst: 0.25, daily_fixed_charge_incl_gst: 2.00, buyback_rate: 0.09 }},
  system: {
    panel: { sku: PANEL_SKU, count: PANEL_COUNT },
    inverter: { sku: INVERTER_SKU },
    battery: { sku: BATTERY_SKU, module_count: BATTERY_MODULES },
    smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
    string_topology: STRING_TOPOLOGY,
    string_design: { panels_per_string: PANELS_PER_STRING, string_count: STRING_COUNT },
    cable_run_metres_estimate: CABLE_RUN,
    phase: 1,
  },
  pricing: { customer_price_inc_gst: 36000, stage: 'stage_1_estimate', final_mode: true,
             discount: { applied_nzd: 0, owner_approved: false, reason: null }},
  preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo',
                 financing: { choice: 'cash' }},
};

const result = runEngine(spec);
if (!result.ok) {
  console.log('❌ Engine refused spec — first-principles tests cannot run');
  if (result.config_errors) for (const e of result.config_errors) console.log(`    ${e.path}: ${e.message}`);
  process.exit(1);
}

const fin = runFinancialModel(spec, result.cost);

// ────────────────────────────────────────────────────────────────────────────
section('TEST 1 — System sizing arithmetic');
// ────────────────────────────────────────────────────────────────────────────
const panel = PANELS[PANEL_SKU];
const expectedKw = PANEL_COUNT * panel.watts / 1000;     // 20 × 595 / 1000 = 11.90
ok('System kW = panels × watts / 1000', result.cost.totals.system_kw, expectedKw, 0.01);
okExact('Panel watts from catalogue', panel.watts, 595);
okExact('Panel SKU passes through unchanged', result.bom[0].sku, PANEL_SKU);

// ────────────────────────────────────────────────────────────────────────────
section('TEST 2 — Voc cold-temperature correction (AS/NZS 5033 §3)');
// ────────────────────────────────────────────────────────────────────────────
// Auckland t_min = -10°C. Formula: Voc_cold = Voc_stc × (1 + |Tcoef|/100 × (25 - T_min))
// Phono Draco: Voc_stc 52.92V, Tcoef -0.25%/°C
// Per panel: 52.92 × (1 + 0.0025 × 35) = 52.92 × 1.0875 = 57.5505V
// Per string (5 panels): 287.75V — well below Fronius Uoc max 600V
const tMin = REGIONS[REGION].t_min_celsius;
const expectedVocPerPanel = panel.voc_stc * (1 + Math.abs(panel.voltage_temp_coef_pct_per_c) / 100 * (25 - tMin));
const expectedStringVoc = expectedVocPerPanel * PANELS_PER_STRING;
console.log(`    (Auckland t_min = ${tMin}°C, Voc_stc = ${panel.voc_stc}V, Tcoef = ${panel.voltage_temp_coef_pct_per_c}%/°C)`);
ok('Voc per panel at cold morning', expectedVocPerPanel, 57.55, 0.05);
ok('String Voc cold (5 in series)', expectedStringVoc, 287.77, 0.05);
const vocPass = result.engineering.passes.find(p => p.rule === 'AS/NZS 5033 §3 — Voc cold check');
okExact('Engine produced Voc cold pass entry', !!vocPass, true);

// ────────────────────────────────────────────────────────────────────────────
section('TEST 3 — Single-line cost arithmetic (sanity)');
// ────────────────────────────────────────────────────────────────────────────
// Hand-calculate one panel line, compare to lineFromSku()
const oneLine = lineFromSku(PANEL_SKU, 1);
ok('Single-panel cost = $260', oneLine.line_cost, 260.00, 0.01);
ok('Single-panel sell ex GST = cost × 1.50', oneLine.sell_ex_gst, 390.00, 0.01);
ok('Single-panel margin $', oneLine.margin_dollar, 130.00, 0.01);

const twentyLine = lineFromSku(PANEL_SKU, PANEL_COUNT);
ok('20-panel line cost = $5,200', twentyLine.line_cost, 5200.00, 0.01);
ok('20-panel line sell ex GST = $7,800', twentyLine.sell_ex_gst, 7800.00, 0.01);

const invLine = lineFromSku(INVERTER_SKU, 1);
ok('Inverter Plus cost = $4,811', invLine.line_cost, 4811.00, 0.01);
ok('Inverter Plus sell ex GST = cost × 1.30', invLine.sell_ex_gst, 6254.30, 0.01);

const battLine = lineFromSku(BATTERY_SKU, BATTERY_MODULES);
ok(`5× HVM module cost`, battLine.line_cost, BATTERIES[BATTERY_SKU].cost_nzd * BATTERY_MODULES, 0.01);
ok(`5× HVM module sell ex GST`, battLine.sell_ex_gst, BATTERIES[BATTERY_SKU].cost_nzd * BATTERY_MODULES * 1.30, 0.01);

// ────────────────────────────────────────────────────────────────────────────
section('TEST 4 — BoM quantities derived from spec');
// ────────────────────────────────────────────────────────────────────────────
const bom = result.bom;
const mountKit = bom.find(b => b.sku === 'HOP-TIN-KIT-4P');
ok('Mount kits = ceil(panels / 4)', mountKit.qty, Math.ceil(PANEL_COUNT / 4));
const epdmSeals = bom.find(b => b.sku === 'GEN-RCK-SEAL-EPD-B');
ok('EPDM seals = panels (1 per panel)', epdmSeals.qty, PANEL_COUNT);
const acCable = bom.find(b => b.sku === 'GEN-BOS-CABLE-AC');
ok('AC cable metres = cable_run_metres_estimate', acCable.qty, CABLE_RUN);
const combiner = bom.find(b => b.sku === 'GEN-BOS-COMBINER');
okExact('Combiner box auto-added for parallel topology', !!combiner, true);
const bmsLine = bom.find(b => b.sku === 'GEN-BAC-ACC-HVM');
ok(`BMS count for ${BATTERY_MODULES}× HVM modules`, bmsLine.qty, requiredBmsCount('HVM', BATTERY_MODULES));
const diverter = bom.find(b => b.sku === 'CTP-ACC-DIVERTER');
okExact('Diverter NOT added (battery present)', !!diverter, false);

// ────────────────────────────────────────────────────────────────────────────
section('TEST 5 — Section subtotals reconcile');
// ────────────────────────────────────────────────────────────────────────────
// Hand-sum the major hardware lines to verify section bucket math.
const HARDWARE_SKUS = [PANEL_SKU, INVERTER_SKU, BATTERY_SKU, 'GEN-BAC-ACC-HVM', 'FRN-MTR-63-S1P'];
let handMajorCost = 0, handMajorSell = 0;
for (const item of bom.filter(b => b.group === 'hardware' && HARDWARE_SKUS.includes(b.sku))) {
  const ln = lineFromSku(item.sku, item.qty);
  handMajorCost += ln.line_cost;
  handMajorSell += ln.sell_ex_gst;
}
ok('Major hardware cost (hand-sum)', result.cost.sections.major_hardware.cost, handMajorCost, 0.50);
ok('Major hardware sell ex GST (hand-sum)', result.cost.sections.major_hardware.sell_ex_gst, handMajorSell, 0.50);

// All BoS lines (including auto-added combiner)
let handBosCost = 0, handBosSell = 0;
for (const item of bom.filter(b => b.group === 'bos')) {
  const ln = lineFromSku(item.sku, item.qty);
  handBosCost += ln.line_cost;
  handBosSell += ln.sell_ex_gst;
}
ok('BoS cost (hand-sum)', result.cost.sections.bos.cost, handBosCost, 0.50);
ok('BoS sell ex GST (hand-sum)', result.cost.sections.bos.sell_ex_gst, handBosSell, 0.50);

// Labour: 11.90 kW = medium tier ($4,000) + battery premium $1,500 + sup+travel+log + parallel $400
const expectedLabour = INSTALLATION_LABOUR.medium.cost_nzd +
                       BATTERY_INSTALL_PREMIUM.cost_nzd +
                       SUPERVISOR.cost_nzd + TRAVEL.cost_nzd + LOGISTICS.cost_nzd +
                       400; // parallel premium
ok('Labour sell ex GST (medium tier + battery + sup/travel/log + parallel)',
   result.cost.sections.labour.sell_ex_gst, expectedLabour, 0.01);
okExact('Labour cost = labour sell (no labour markup)',
        result.cost.sections.labour.cost, result.cost.sections.labour.sell_ex_gst);

// Compliance: design + inspection + commissioning + grid + CoC
const expectedCompliance = SYSTEM_DESIGN.cost_nzd + INSPECTION_COMPLIANCE.cost_nzd +
                           COMMISSIONING.cost_nzd + GRID_APPLICATION.cost_nzd + COC.cost_nzd;
ok('Compliance sell ex GST (5 line items)',
   result.cost.sections.compliance.sell_ex_gst, expectedCompliance, 0.01);
ok('Compliance total = $1,800', expectedCompliance, 1800, 0.01);

// Total ex GST = sum of all sections
const sectionSum = result.cost.sections.major_hardware.cost +
                   result.cost.sections.bos.cost +
                   result.cost.sections.labour.cost +
                   result.cost.sections.compliance.cost;
ok('Total cost ex GST = Σ sections', result.cost.totals.total_cost_ex_gst, sectionSum, 0.50);

// ────────────────────────────────────────────────────────────────────────────
section('TEST 6 — GST applied ONCE at total (not per line)');
// ────────────────────────────────────────────────────────────────────────────
const t = result.cost.totals;
ok('Customer total ex GST = inc GST / 1.15',
   t.customer_total_ex_gst, spec.pricing.customer_price_inc_gst / 1.15, 0.50);
ok('GST on customer total = inc - ex',
   t.gst_on_customer_total, t.customer_total_inc_gst - t.customer_total_ex_gst, 0.50);
const expectedGstOnCustomer = t.customer_total_ex_gst * 0.15;
ok('GST = customer ex × 0.15', t.gst_on_customer_total, expectedGstOnCustomer, 0.50);

// List inc GST = list ex × 1.15
ok('List inc GST = list ex × 1.15', t.total_list_inc_gst, t.total_list_ex_gst * 1.15, 0.50);

// ────────────────────────────────────────────────────────────────────────────
section('TEST 7 — Profit & margin from cost + customer price');
// ────────────────────────────────────────────────────────────────────────────
const expectedProfit = t.customer_total_ex_gst - t.total_cost_ex_gst;
ok('Profit ex GST = customer ex - cost ex', t.profit_ex_gst, expectedProfit, 0.50);
const expectedMarginPct = (expectedProfit / t.customer_total_ex_gst) * 100;
ok('Project margin % = profit / customer ex × 100', t.project_margin_pct, expectedMarginPct, 0.10);

// ────────────────────────────────────────────────────────────────────────────
section('TEST 8 — Margin floor classification');
// ────────────────────────────────────────────────────────────────────────────
// Above 12% should be 'healthy'; 10-12% 'amber'; below 10% 'below_floor'
const mfp = t.project_margin_pct;
const expectedStatus = mfp >= 12 ? 'healthy' : (mfp >= 10 ? 'amber' : 'below_floor');
okExact(`Floor status at ${mfp.toFixed(1)}% margin`, result.cost.margin_floor_status, expectedStatus);

// ────────────────────────────────────────────────────────────────────────────
section('TEST 9 — Year-1 generation formula');
// ────────────────────────────────────────────────────────────────────────────
// Regional yield 1,250 (PR-baked-in for Auckland). Only clipping applies.
// Expected: 11.90 × 1,250 × 0.96 = 14,280 kWh
const expectedGen = expectedKw * REGIONS[REGION].yield_kwh_per_kwp_per_year * 0.96;
ok('Year-1 generation = kW × yield × (1 - clipping)',
   fin.yr1.generation_kwh, Math.round(expectedGen), 50);

// ────────────────────────────────────────────────────────────────────────────
section('TEST 10 — Self-consumption fraction from battery table');
// ────────────────────────────────────────────────────────────────────────────
// 5 × 2.76 = 13.8 kWh battery → fraction 0.85 per FINANCIAL_DEFAULTS table
const usableKwh = BATTERY_MODULES * BATTERIES[BATTERY_SKU].module_kwh;
const expectedFraction = selfConsumptionFraction(usableKwh, false);
ok('Self-consumption fraction at 13.8 kWh battery', expectedFraction, 0.85, 0.01);
ok('Engine reported same fraction', fin.assumptions.self_consume_fraction_yr1, expectedFraction, 0.01);

// ────────────────────────────────────────────────────────────────────────────
section('TEST 11 — Monthly profile reconciliation');
// ────────────────────────────────────────────────────────────────────────────
const monthlyGenSum = fin.monthly.reduce((s, m) => s + m.gen_kwh, 0);
const monthlyUseSum = fin.monthly.reduce((s, m) => s + m.use_kwh, 0);
ok('Σ monthly gen = annual gen (±1 kWh)', monthlyGenSum, fin.yr1.generation_kwh, 1);
ok('Σ monthly use = annual kWh (±1 kWh)', monthlyUseSum, spec.bills.manual_entry.annual_kwh, 1);
okExact('All 12 months produced', fin.monthly.length, 12);

// All CI invariants from financial model
console.log();
console.log('  Financial-model reconciliation invariants:');
for (const c of fin.reconciliation.checks) {
  okExact(`  ${c.name}`, c.pass, true);
}

// ────────────────────────────────────────────────────────────────────────────
section('TEST 12 — Pure-function determinism');
// ────────────────────────────────────────────────────────────────────────────
// Same spec → same hash, same numbers, run twice
const result2 = runEngine(spec);
okExact('spec_sha256 identical across runs', result.spec_sha256, result2.spec_sha256);
okExact('Engine identical totals across runs',
        result.cost.totals.total_cost_ex_gst, result2.cost.totals.total_cost_ex_gst);

// ────────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────────
console.log();
console.log('━'.repeat(80));
console.log(`  RESULT: ${passCount} passed, ${failCount} failed`);
console.log('━'.repeat(80));
if (failCount > 0) {
  console.log('  Failures:');
  for (const f of failures) console.log(`    ✗ ${f.label}`);
  process.exit(1);
} else {
  console.log('  ✅ All first-principles assertions pass.');
}

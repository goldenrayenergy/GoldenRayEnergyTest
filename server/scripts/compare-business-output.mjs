// Business-facing before/after for the bill analysis engine.
// Shows ONLY what the customer or sales rep would see — annual kWh,
// recommended system size, savings, region used, payback, blocker flags.
// Hides all the regex/field-confidence/internal stuff.
//
// Usage:  node scripts/compare-business-output.mjs

import * as V1Ocr from './_billOcrService.v1.mjs';
import * as V1An  from './_billAnalysisService.v1.mjs';
import * as V2Ocr from '../services/billOcrService.js';
import * as V2An  from '../services/billAnalysisService.js';

const HR  = '═'.repeat(78);
const hr  = '─'.repeat(78);

function fmt$(n)   { return n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-NZ'); }
function fmtKwh(n) { return n == null ? '—' : Math.round(Number(n)).toLocaleString('en-NZ') + ' kWh'; }
function fmtKw(n)  { return n == null ? '—' : Number(n).toFixed(2) + ' kW'; }

// Quick payback estimate so we have a customer-facing number — same formula
// the proposal generator uses (inflation-adjusted, panel degradation).
function quickPayback(annualSavings, systemCostHigh) {
  if (!annualSavings || !systemCostHigh) return null;
  const r = (1 + 0.05) * (1 - 0.005) - 1; // 5% inflation × 0.5% degradation
  const n = Math.log(1 + systemCostHigh * r / annualSavings) / Math.log(1 + r);
  return Math.round(n);
}

// Pluck the recommended solar+battery scenario for headline savings
function pickSolarBatteryScenario(analysis) {
  if (!analysis?.scenarios) return null;
  return analysis.scenarios.find(s => /solar.*battery|battery/i.test(s.label || '')) ||
         analysis.scenarios.find(s => /solar/i.test(s.label || ''));
}
function pickDoNothing(analysis) {
  if (!analysis?.scenarios) return null;
  return analysis.scenarios.find(s => /do.?nothing|baseline|stay/i.test(s.label || ''))
      || analysis.scenarios[0];
}

function display(label, v1Val, v2Val, unit = '') {
  const same = String(v1Val) === String(v2Val);
  const marker = same ? '   ' : '✱  ';
  const pad = s => String(s ?? '—').padEnd(28);
  console.log(`  ${marker}${pad(label).padEnd(36)}│ ${pad(v1Val)} │ ${pad(v2Val)}`);
}

function divider() {
  console.log(`  ${'─'.repeat(36)}│${'─'.repeat(30)}│${'─'.repeat(30)}`);
}

function customerSection(name, billsTexts) {
  console.log('\n' + HR);
  console.log('  CUSTOMER SCENARIO: ' + name);
  console.log(HR);

  const v1Bills = billsTexts.map(t => V1Ocr.parseBillText(t)).filter(b => b.kwh_total && b.total_nzd);
  const v2Bills = billsTexts.map(t => V2Ocr.parseBillText(t)).filter(b => b.kwh_total && b.total_nzd);

  const v1Out = v1Bills.length ? V1An.analyzeBills({ bills: v1Bills }) : null;
  const v2Out = v2Bills.length ? V2An.analyzeBills({ bills: v2Bills }) : null;

  console.log(`  ${' '.repeat(36)}│ ${'BEFORE (v1 engine)'.padEnd(28)} │ ${'AFTER  (v2 engine)'.padEnd(28)}`);
  divider();

  // ── What got into the engine ──
  display('Bills accepted by engine', v1Bills.length, v2Bills.length);
  display('Region used', v1Out?.region || '—', v2Out?.region || '—');
  display('Region resolved how?', v1Out?.region_resolved_from || '(always Auckland default)',
                                   v2Out?.region_resolved_from || '—');

  divider();
  // ── Customer's spend picture ──
  display('Annual usage estimate',  fmtKwh(v1Out?.aggregate?.annual_kwh), fmtKwh(v2Out?.aggregate?.annual_kwh));
  display('Annual spend estimate',  fmt$(v1Out?.aggregate?.annual_spend_nzd), fmt$(v2Out?.aggregate?.annual_spend_nzd));
  display('Effective rate $/kWh',
    v1Out?.aggregate?.effective_rate_nzd ? '$' + Number(v1Out.aggregate.effective_rate_nzd).toFixed(3) : '—',
    v2Out?.aggregate?.effective_rate_nzd ? '$' + Number(v2Out.aggregate.effective_rate_nzd).toFixed(3) : '—',
  );
  display('Fixed-charge component',  fmt$(v1Out?.aggregate?.fixed_charge_total_nzd), fmt$(v2Out?.aggregate?.fixed_charge_total_nzd));
  display('Variable-charge component', fmt$(v1Out?.aggregate?.variable_charge_total_nzd), fmt$(v2Out?.aggregate?.variable_charge_total_nzd));

  divider();
  // ── Engine's recommendation ──
  display('Recommended system size',  fmtKw(v1Out?.recommendation?.recommended_system_kw),
                                       fmtKw(v2Out?.recommendation?.recommended_system_kw));
  display('Recommended battery',       fmtKwh(v1Out?.recommendation?.recommended_battery_kwh),
                                       fmtKwh(v2Out?.recommendation?.recommended_battery_kwh));
  display('Est. annual generation',    fmtKwh(v1Out?.recommendation?.annual_generation_kwh),
                                       fmtKwh(v2Out?.recommendation?.annual_generation_kwh));
  display('Recommended package',       v1Out?.recommendation?.recommended_package_slug,
                                       v2Out?.recommendation?.recommended_package_slug);

  divider();
  // ── Customer-facing savings (solar+battery scenario vs do-nothing baseline) ──
  const v1Scenario = pickSolarBatteryScenario(v1Out);
  const v2Scenario = pickSolarBatteryScenario(v2Out);
  const v1Baseline = pickDoNothing(v1Out);
  const v2Baseline = pickDoNothing(v2Out);

  const v1Yr1Savings = (v1Baseline && v1Scenario) ? v1Baseline.year_1_cost - v1Scenario.year_1_cost : null;
  const v2Yr1Savings = (v2Baseline && v2Scenario) ? v2Baseline.year_1_cost - v2Scenario.year_1_cost : null;
  const v1Net25 = v1Baseline && v1Scenario ? v1Baseline.year_25_cost - v1Scenario.year_25_cost - (v1Scenario.upfront_cost || 0) : null;
  const v2Net25 = v2Baseline && v2Scenario ? v2Baseline.year_25_cost - v2Scenario.year_25_cost - (v2Scenario.upfront_cost || 0) : null;

  display('Scenario shown to customer', v1Scenario?.label, v2Scenario?.label);
  display('Upfront system cost',         fmt$(v1Scenario?.upfront_cost),       fmt$(v2Scenario?.upfront_cost));
  display('Yr 1 bill (vs do-nothing $)',
    v1Baseline && v1Scenario ? `${fmt$(v1Scenario.year_1_cost)} (vs ${fmt$(v1Baseline.year_1_cost)})` : '—',
    v2Baseline && v2Scenario ? `${fmt$(v2Scenario.year_1_cost)} (vs ${fmt$(v2Baseline.year_1_cost)})` : '—',
  );
  display('Yr 1 savings',                 fmt$(v1Yr1Savings),                  fmt$(v2Yr1Savings));
  display('25-yr savings (net of cost)',  fmt$(v1Net25),                       fmt$(v2Net25));
  display('Payback (years)',
    v1Scenario?.payback_years ? `${v1Scenario.payback_years} yrs` : '—',
    v2Scenario?.payback_years ? `${v2Scenario.payback_years} yrs` : '—',
  );

  divider();
  // ── Safety gate ──
  display('Customer sees recommendation?',
    v1Out ? 'YES (no gate exists)' : 'NO (engine errored)',
    v2Out
      ? (v2Out.review_required ? 'NO — held for sales review' : 'YES')
      : 'NO (engine errored)',
  );
  display('Why blocked?',
    '(no gate exists)',
    v2Out?.review_reasons?.length
      ? v2Out.review_reasons.map(r => `${r.code}(${r.severity})`).join(', ').slice(0, 28)
      : '—',
  );

  if (v2Out?.review_reasons?.length) {
    console.log('\n  AFTER (v2) — full review reasons:');
    for (const r of v2Out.review_reasons) {
      console.log(`    [${r.severity}] ${r.code}: ${r.message}`);
    }
  }
}

// ── TEST CUSTOMER SCENARIOS ───────────────────────────────────────────────

const SCENARIOS = [
  {
    name: 'CASE A — Auckland customer, ONE clean single-rate Mercury bill (most common)',
    bills: [`Mercury NZ Limited
Service Address: 42 Queen Street, Newmarket, Auckland 1023
ICP Number: 0000123456AB12
Vector Limited
Homeline Standard

Billing Period: 1 Jul 2025 to 31 Jul 2025

Energy charges
  Anytime usage     1,940 kWh @ 28.9c    $560.66

Daily fixed charge   31 days @ $1.40     $43.40

GST (15%)                                 $90.61

Total amount due                         $694.67`],
  },
  {
    name: 'CASE B — Wellington customer, ONE Contact bill (region must differ from Auckland)',
    bills: [`Contact Energy
contactenergy.co.nz
Service Address: 99 Lambton Quay, Wellington 6011
Wellington Electricity
Good Nights plan

Billing period: 1 Jul 2025 to 31 Jul 2025

  Anytime  1,200 kWh @ 30.0c            $360.00
  Daily charge  31 days @ $1.50          $46.50

GST (15%)                                 $61.00

Total                                     $467.50`],
  },
  {
    name: 'CASE C — Auckland customer, multi-rate Mercury bill (price change mid-period)',
    bills: [`Mercury NZ Limited
Service Address: 42 Queen Street, Newmarket, Auckland 1023
Vector Limited
Homeline Standard

Billing Period: 28 Feb 2026 to 31 Mar 2026

ELECTRICITY

Daily Fixed Charge   4 Days x 237.00 cents     $9.48
Daily Fixed Charge  28 Days x 272.00 cents    $76.16

Anytime  85 kWh x 19.90 cents     $16.92
Anytime  593 kWh x 20.96 cents   $124.29

GST (15%)                                       $34.03
ELECTRICITY TOTAL                              $260.88`],
  },
  {
    name: 'CASE D — Auckland customer, OCR misread total ($694.67 → $1000.00)',
    bills: [`Mercury NZ Limited
Service Address: 42 Queen Street, Newmarket, Auckland 1023
Vector Limited
Homeline Standard

Billing Period: 1 Jul 2025 to 31 Jul 2025

Energy charges
  Anytime usage     1,940 kWh @ 28.9c    $560.66

Daily fixed charge   31 days @ $1.40     $43.40

GST (15%)                                 $90.61

Total amount due                         $1000.00`],
  },
  {
    name: 'CASE E — Customer uploads bills from TWO different addresses (mistake)',
    bills: [
      `Mercury NZ Limited
Service Address: 42 Queen Street, Newmarket, Auckland 1023

Billing Period: 1 Jul 2025 to 31 Jul 2025
Energy charges
  Anytime usage     1,940 kWh @ 28.9c    $560.66
Daily fixed charge   31 days @ $1.40     $43.40
GST (15%)                                 $90.61
Total amount due                         $694.67`,

      `Contact Energy
Service Address: 99 Lambton Quay, Wellington 6011
Good Nights plan

Billing period: 1 Aug 2025 to 31 Aug 2025
  Anytime  1,200 kWh @ 30.0c            $360.00
  Daily charge  31 days @ $1.50          $46.50
GST (15%)                                 $61.00
Total                                     $467.50`,
    ],
  },
];

console.log('\n' + HR);
console.log('  BUSINESS OUTPUT: BEFORE (v1 engine on HEAD) vs AFTER (v2 engine)');
console.log('  Same bill text fed to both engines. Shows what the customer would see.');
console.log(HR);

for (const s of SCENARIOS) customerSection(s.name, s.bills);

console.log('\n' + HR);
console.log('  KEY: ✱ = output differs between v1 and v2');
console.log(HR + '\n');

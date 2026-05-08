// Stress-test the bill analysis engine against a range of NZ household profiles.
// Run:  node server/scripts/test-bill-analysis.js
//
// Each profile produces synthetic but realistic bill data, runs it through
// analyzeBills, and prints a summary so we can sanity-check the outputs
// across the full spectrum of customer types.

import { analyzeBills } from '../services/billAnalysisService.js';

// ── Helpers to generate synthetic bill series ──────────────────────────────

function generateBills({ profile, retailer = 'Mercury', plan = 'Homeline Standard', startMonth = 4, startYear = 2025, dailyFixed = 1.40, variableRate = 0.289 }) {
  // profile is an array of 12 monthly kWh values (April-March, NZ financial year)
  const bills = [];
  const daysInMonth = [30, 31, 30, 31, 31, 30, 31, 30, 31, 31, 28, 31];  // Apr-Mar
  let m = startMonth - 1;
  let y = startYear;
  for (let i = 0; i < profile.length; i++) {
    const monthNum = (m % 12) + 1;
    const days = daysInMonth[i];
    const kwh = profile[i];
    const periodStart = `${y}-${String(monthNum).padStart(2, '0')}-01`;
    const lastDay = new Date(y, monthNum, 0).getDate();
    const periodEnd = `${y}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const fixed = +(dailyFixed * days).toFixed(2);
    const variable = +(kwh * variableRate).toFixed(2);
    const total = +(fixed + variable).toFixed(2);
    bills.push({
      period_start: periodStart, period_end: periodEnd,
      days_in_period: days, kwh_total: kwh,
      fixed_charge_nzd: fixed, variable_charge_nzd: variable, total_nzd: total,
      retailer, plan_name: plan,
    });
    m++;
    if (m % 12 === 0) y++;
  }
  return bills;
}

// Generic seasonal NZ shape: high winter (Jun-Aug), low summer (Dec-Feb)
const SEASONAL = i => [0.85, 1.05, 1.30, 1.45, 1.40, 1.10, 0.85, 0.65, 0.60, 0.45, 0.50, 0.85][i];

function makeSeasonal(annualKwh, options = {}) {
  // Distribute annualKwh across 12 months following the seasonal shape
  const weights = Array.from({ length: 12 }, (_, i) => SEASONAL(i));
  const sumW = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => Math.round((w / sumW) * annualKwh));
}

// ── Test profiles ──────────────────────────────────────────────────────────

const PROFILES = [
  {
    name: 'Small flat (1-2 person, Auckland)',
    annualKwh: 3500,
    region: 'auckland',
  },
  {
    name: 'Average family (Auckland)',
    annualKwh: 8000,
    region: 'auckland',
  },
  {
    name: 'Big NZ family with heat pump (Auckland)',
    annualKwh: 14500,
    region: 'auckland',
  },
  {
    name: 'Large house with pool (Christchurch)',
    annualKwh: 22000,
    region: 'canterbury',
  },
  {
    name: 'Wellington flat — wind/cooler region',
    annualKwh: 6500,
    region: 'wellington',
  },
  {
    name: 'High-rate customer (effective >32c/kWh)',
    annualKwh: 9000,
    region: 'auckland',
    dailyFixed: 1.95, variableRate: 0.330,
  },
  {
    name: 'Already on Electric Kiwi (best retailer)',
    annualKwh: 9000,
    region: 'auckland',
    retailer: 'Electric Kiwi', plan: 'MoveMaster',
    dailyFixed: 1.10, variableRate: 0.268,
  },
  {
    name: 'Holiday home — heavy summer dip',
    annualKwh: 5000,
    region: 'auckland',
    customShape: [1.0, 1.0, 1.4, 1.5, 1.4, 1.2, 1.0, 0.8, 0.7, 0.2, 0.2, 0.6],
  },
  {
    name: 'EV household — flat year-round usage',
    annualKwh: 11000,
    region: 'auckland',
    customShape: [1.0, 1.0, 1.1, 1.15, 1.15, 1.05, 0.95, 0.9, 0.9, 0.85, 0.85, 0.95],
  },
  {
    name: 'Sudden step-change (heat pump installed mid-year)',
    annualKwh: 9500,
    region: 'auckland',
    customShape: [0.6, 0.7, 0.8, 0.75, 0.65, 0.55, 0.55, 0.50, 1.20, 1.55, 1.45, 1.10], // jumps in Dec
  },
  {
    name: 'Edge — only 8 months of bills (missing data)',
    annualKwh: null, // built differently
    region: 'auckland',
    monthsOnly: 8,
  },
];

function buildBillsForProfile(p) {
  // Build the kWh shape
  let monthly;
  if (p.customShape) {
    const shape = p.customShape;
    const sumW = shape.reduce((a, b) => a + b, 0);
    monthly = shape.map(w => Math.round((w / sumW) * p.annualKwh));
  } else if (p.monthsOnly) {
    // Generate only N months at average ~700 kWh/mo
    monthly = Array(p.monthsOnly).fill(700);
  } else {
    monthly = makeSeasonal(p.annualKwh);
  }

  return generateBills({
    profile: monthly,
    retailer: p.retailer || 'Mercury',
    plan: p.plan || 'Homeline Standard',
    dailyFixed: p.dailyFixed || 1.40,
    variableRate: p.variableRate || 0.289,
  });
}

// ── Run + tabulate ─────────────────────────────────────────────────────────

function fmt$(n) { return '$' + Math.round(n).toLocaleString(); }
function pad(s, len) { s = String(s); return s + ' '.repeat(Math.max(0, len - s.length)); }
function rpad(s, len) { s = String(s); return ' '.repeat(Math.max(0, len - s.length)) + s; }

console.log('\n' + '═'.repeat(135));
console.log(' BILL ANALYSIS ENGINE — STRESS TEST');
console.log('═'.repeat(135));

const results = [];
const issues = [];

for (const p of PROFILES) {
  const bills = buildBillsForProfile(p);
  const r = analyzeBills({ bills, region: p.region });
  results.push({ profile: p, result: r });

  // Sanity checks
  const so = r.scenarios.find(s => s.id === 'solar-only');
  const sb = r.scenarios.find(s => s.id === 'solar-plus-battery');
  const dn = r.scenarios.find(s => s.id === 'do-nothing');

  if (so && so.payback_years && so.payback_years > 25) issues.push(`${p.name}: solar-only payback >25yrs (${so.payback_years})`);
  if (sb && sb.payback_years && sb.payback_years > 25) issues.push(`${p.name}: solar-battery payback >25yrs (${sb.payback_years})`);
  if (so && so.net_25yr < 0)  issues.push(`${p.name}: solar-only net 25-yr is negative (${so.net_25yr})`);
  if (sb && sb.net_25yr < 0)  issues.push(`${p.name}: solar-battery net 25-yr is negative (${sb.net_25yr})`);
  if (dn && dn.year_25_cost < 50000) issues.push(`${p.name}: do-nothing 25-yr suspiciously low (${dn.year_25_cost})`);
  if (r.recommendation.recommended_system_kw > 10) issues.push(`${p.name}: recommended >10kW residential (${r.recommendation.recommended_system_kw})`);
  if (r.recommendation.recommended_battery_kwh > 13.5) issues.push(`${p.name}: battery >13.5kWh (${r.recommendation.recommended_battery_kwh})`);
}

// ── Print summary table ───────────────────────────────────────────────────

console.log('\n' + pad('Profile', 50) + pad('kWh/yr', 9) + pad('Spend', 11) + pad('Eff/kWh', 9) + pad('Recommend', 18) + pad('Solar-only PB', 16) + pad('Sol+Bat PB', 14) + 'Best 25yr');
console.log('─'.repeat(135));

for (const { profile, result } of results) {
  const a = result.aggregate;
  const rec = result.recommendation;
  const so = result.scenarios.find(s => s.id === 'solar-only');
  const sb = result.scenarios.find(s => s.id === 'solar-plus-battery');
  const dn = result.scenarios.find(s => s.id === 'do-nothing');

  const recStr = `${rec.recommended_system_kw}kW${rec.recommended_battery_kwh ? '+' + rec.recommended_battery_kwh + 'kWh' : ''}`;
  const soPb = so ? `${so.scenario_system_kw}kW · ${so.payback_years || '—'}yrs` : '—';
  const sbPb = sb ? `${sb.payback_years || '—'}yrs` : '—';

  // Best net 25yr scenario
  const sorted = [...result.scenarios].sort((a, b) => b.net_25yr - a.net_25yr);
  const best = sorted[0];
  const bestStr = `${best.id} (${fmt$(best.net_25yr)})`;

  console.log(pad(profile.name, 50) + pad(a.annual_kwh, 9) + pad(fmt$(a.annual_spend_nzd), 11) + pad((a.effective_rate_nzd * 100).toFixed(1) + 'c', 9) + pad(recStr, 18) + pad(soPb, 16) + pad(sbPb, 14) + bestStr);
}

// ── Scenarios + patterns detail per profile ───────────────────────────────

console.log('\n\n' + '═'.repeat(135));
console.log(' DETAILS PER PROFILE');
console.log('═'.repeat(135));

for (const { profile, result } of results) {
  console.log('\n● ' + profile.name);
  console.log('  Aggregate: ' + result.aggregate.annual_kwh + ' kWh / ' + fmt$(result.aggregate.annual_spend_nzd) + ' / ' + (result.aggregate.effective_rate_nzd * 100).toFixed(1) + 'c per kWh / ' + result.aggregate.months_covered + ' mo / ' + result.aggregate.retailer);
  console.log('  Switch:    ' + (result.switch_advice ? `→ ${result.switch_advice.retailerName} ${result.switch_advice.planName} (save ${fmt$(result.switch_advice.annualSaving)}/yr)` : 'Already on best-rate retailer.'));
  console.log('  Patterns:  ' + (result.patterns.length ? result.patterns.map(x => x.code).join(', ') : 'none'));
  for (const s of result.scenarios) {
    const sys = s.scenario_system_kw ? ` (${s.scenario_system_kw}kW${s.scenario_battery_kwh ? '+' + s.scenario_battery_kwh + 'kWh' : ''})` : '';
    console.log(`    ${pad(s.id + sys, 38)} upfront ${rpad(fmt$(s.upfront_cost), 9)}  yr1 ${rpad(fmt$(s.year_1_cost), 9)}  yr25 ${rpad(fmt$(s.year_25_cost), 11)}  pb ${pad(s.payback_years === null ? 'never' : s.payback_years + 'yrs', 9)}  net ${rpad(fmt$(s.net_25yr), 11)}`);
  }
}

// ── Issues summary ─────────────────────────────────────────────────────────

console.log('\n\n' + '═'.repeat(135));
if (issues.length === 0) {
  console.log(' ✓ NO ISSUES DETECTED — engine produces sensible output across all profiles.');
} else {
  console.log(' ⚠ ISSUES DETECTED:');
  for (const i of issues) console.log('   • ' + i);
}
console.log('═'.repeat(135));

// ── Transparency block sample (first profile) ──────────────────────────────

console.log('\n' + '═'.repeat(135));
console.log(' TRANSPARENCY BLOCK (sample, from "Big NZ family with heat pump")');
console.log('═'.repeat(135));
const t = results[2].result.transparency;
const s = results[2].result.scenarios.find(s => s.id === 'solar-plus-battery');
console.log('  Data current as of:    ' + t.as_of + ' (next refresh due ' + t.next_data_refresh_due + ')');
console.log('  Confidence in inputs:  ' + t.overall_confidence);
console.log('  Why:                   ' + t.confidence_explanation);
console.log('');
console.log('  ── Sample scenario with sensitivity range ──');
console.log('  ' + s.label);
console.log('    Year-1 cost:   ' + fmt$(s.year_1_cost) + '   (range: ' + fmt$(s.year_1_cost_range.low) + ' – ' + fmt$(s.year_1_cost_range.high) + ')');
console.log('    Year-25 cost:  ' + fmt$(s.year_25_cost) + '   (range: ' + fmt$(s.year_25_cost_range.low) + ' – ' + fmt$(s.year_25_cost_range.high) + ')');
console.log('    Net 25-yr:     ' + fmt$(s.net_25yr)    + '   (range: ' + fmt$(s.net_25yr_range.low) + ' – ' + fmt$(s.net_25yr_range.high) + ')');
console.log('    Payback:       ' + s.payback_years + ' yrs  (range: ' + s.payback_years_range.low + ' – ' + s.payback_years_range.high + ' yrs)');
console.log('');
console.log('  ── Top 3 limitations surfaced ──');
for (const l of t.limitations.slice(0, 3)) console.log('    [' + l.severity + '] ' + l.label + ' — ' + l.impact.slice(0, 90) + '...');
console.log('');
console.log('  ── Disclaimer (shown in customer report + PDF) ──');
const lines = t.disclaimer.match(/.{1,130}(\s|$)/g) || [t.disclaimer];
for (const line of lines) console.log('  ' + line.trim());
console.log('═'.repeat(135));

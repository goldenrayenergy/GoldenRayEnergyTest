// Customer-folder bill analyser — one-shot recommendation memo.
// Parses every PDF in a folder, aggregates, and prints a sizing memo
// the team can use to scope a tier-3 proposal.
//
// Usage:  node server/scripts/analyze-customer-folder.js "<folder-path>"

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parseBillPdf } from '../services/billOcrService.js';
import { analyzeBills } from '../services/billAnalysisService.js';

const folder = process.argv[2];
if (!folder) { console.error('Pass a folder path containing the customer bill PDFs'); process.exit(1); }

const files = (await readdir(folder)).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
if (!files.length) { console.error(`No PDFs in ${folder}`); process.exit(1); }

console.log(`\n━━━ Parsing ${files.length} bills from ${folder} ━━━`);
const bills = [];
for (const f of files) {
  try {
    const buf  = await readFile(path.join(folder, f));
    const res  = await parseBillPdf(buf);
    res.file_name = f;
    bills.push(res);
    const flag = res.parse_suspect ? '⚠' : '✓';
    console.log(`  ${flag} ${f.padEnd(24)} ${res.retailer || '—'} · ${res.period_start || '?'}→${res.period_end || '?'} · ${res.kwh_total ?? '—'} kWh · $${res.total_nzd ?? '—'}`);
  } catch (e) {
    console.log(`  ✗ ${f}: ${e.message}`);
  }
}

const analysis = analyzeBills({ bills });

// ── Render the memo ──────────────────────────────────────────────────────
const fmt$ = n => '$' + Math.round(n).toLocaleString('en-NZ');
const pct  = n => (n * 100).toFixed(1) + '%';

console.log(`\n━━━ BILL ANALYSIS ━━━`);
console.log(`Annual usage           : ${analysis.aggregate.annual_kwh.toLocaleString()} kWh`);
console.log(`Annual spend (incl GST): ${fmt$(analysis.aggregate.annual_spend_nzd)}`);
console.log(`Effective rate         : ${(analysis.aggregate.effective_rate_nzd * 100).toFixed(1)} c/kWh`);
console.log(`Months covered         : ${analysis.aggregate.months_covered}`);
console.log(`Region                 : ${analysis.region} (from ${analysis.region_resolved_from})`);
console.log(`Retailer               : ${bills[0]?.retailer || '—'}`);

// Seasonality: split by month
const byMonth = {};
for (const b of bills) {
  if (!b.period_end || b.kwh_total == null) continue;
  const m = b.period_end.slice(5, 7);
  byMonth[m] = (byMonth[m] || 0) + b.kwh_total;
}
const winterMonths = ['05', '06', '07', '08'].reduce((s, m) => s + (byMonth[m] || 0), 0);
const summerMonths = ['11', '12', '01', '02'].reduce((s, m) => s + (byMonth[m] || 0), 0);
const seasonalRatio = summerMonths > 0 ? +(winterMonths / summerMonths).toFixed(2) : null;

console.log(`\n━━━ SEASONALITY ━━━`);
console.log(`Winter (May–Aug)       : ${Math.round(winterMonths).toLocaleString()} kWh`);
console.log(`Summer (Nov–Feb)       : ${Math.round(summerMonths).toLocaleString()} kWh`);
console.log(`Winter/summer ratio    : ${seasonalRatio || 'n/a'} ${seasonalRatio > 1.4 ? '(winter-heavy — strong battery case)' : seasonalRatio < 1.1 ? '(flat — solar-first sizing OK)' : '(moderate)'}`);

console.log(`\n━━━ SYSTEM RECOMMENDATION ━━━`);
console.log(`Recommended solar      : ${analysis.recommendation.system_kw} kW`);
console.log(`Recommended battery    : ${analysis.recommendation.battery_kwh} kWh`);
console.log(`Suggested package slug : ${analysis.recommendation.recommended_package_slug || '—'}`);

if (analysis.switch_advice?.switch_recommended) {
  console.log(`\n━━━ RETAILER SWITCH (pre-solar) ━━━`);
  console.log(`Switch to ${analysis.switch_advice.switch_to_retailer} (${analysis.switch_advice.switch_to_plan}) → saves ${fmt$(analysis.switch_advice.switch_annual_saving)}/yr`);
}

console.log(`\n━━━ REVIEW GATE ━━━`);
console.log(`review_required        : ${analysis.review_required}`);
if (Array.isArray(analysis.review_reasons) && analysis.review_reasons.length) {
  for (const r of analysis.review_reasons) console.log(`  [${r.severity}] ${r.code} — ${r.message || r.reason || ''}`);
}

console.log(`\n━━━ 25-YEAR SCENARIOS (from analyzer) ━━━`);
for (const s of (analysis.scenarios || []).slice(0, 5)) {
  console.log(`  ${s.label.padEnd(28)} · payback ${s.payback_years || '—'}yr · 25-yr net ${fmt$(s.net_25yr)}`);
}

console.log(`\nDone. Hand-off summary above — use this to scope the 3-tier proposal.`);

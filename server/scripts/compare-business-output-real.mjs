// REAL-bill before/after comparison. Loads actual customer bill PDFs from
// disk, parses them through BOTH the v1 (HEAD) engine and the v2 engine,
// and shows business outputs side-by-side.
//
// Bill source: C:/Users/ram33/Downloads/bills/bills/
//
// Usage:  node scripts/compare-business-output-real.mjs

import fs from 'node:fs';
import path from 'node:path';
import * as V1Ocr from './_billOcrService.v1.mjs';
import * as V1An  from './_billAnalysisService.v1.mjs';
import * as V2Ocr from '../services/billOcrService.js';
import * as V2An  from '../services/billAnalysisService.js';

const BILLS_ROOT = 'C:/Users/ram33/Downloads/bills/bills';
const HR = '═'.repeat(82);

function fmt$(n)   { return n == null ? '—' : '$' + Math.round(Number(n)).toLocaleString('en-NZ'); }
function fmtKwh(n) { return n == null ? '—' : Math.round(Number(n)).toLocaleString('en-NZ') + ' kWh'; }
function fmtKw(n)  { return n == null ? '—' : Number(n).toFixed(2) + ' kW'; }

// Group bills into customer cohorts by file-path prefix
function discoverCustomers() {
  const cohorts = {};
  function addToCohort(key, file) {
    if (!cohorts[key]) cohorts[key] = [];
    cohorts[key].push(file);
  }
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.toLowerCase().endsWith('.pdf')) continue;
      const rel = path.relative(BILLS_ROOT, full).replace(/\\/g, '/');
      // Heuristic cohort assignment
      if (/saliya/i.test(rel))          addToCohort('Saliya (Contact)',  full);
      else if (/p-Saliya/i.test(rel))   addToCohort('Saliya (Contact)',  full);
      else if (/Pulse/i.test(rel))      addToCohort('Khanna (Pulse)',    full);
      else if (/ContactBill/i.test(rel)) addToCohort('Contact bills (mixed)', full);
      else if (/^1003/.test(entry.name))  addToCohort('Mercury (numbered)', full);
      else                                addToCohort('Other',            full);
    }
  }
  walk(BILLS_ROOT);
  return cohorts;
}

async function processBills(files, ocrModule) {
  const parsed = [];
  for (const file of files) {
    try {
      const buf = fs.readFileSync(file);
      const result = await ocrModule.parseBillPdf(buf, { fileName: path.basename(file) });
      parsed.push(result);
    } catch (e) {
      parsed.push({ _failed: true, file: path.basename(file), error: e.message });
    }
  }
  return parsed;
}

function pickSolarBattery(analysis) {
  if (!analysis?.scenarios) return null;
  return analysis.scenarios.find(s => /solar.*battery|battery/i.test(s.label || ''))
      || analysis.scenarios.find(s => /solar/i.test(s.label || ''));
}
function pickBaseline(analysis) {
  return analysis?.scenarios?.find(s => /do.?nothing/i.test(s.label || ''))
      || analysis?.scenarios?.[0] || null;
}

function display(label, v1, v2) {
  const same = String(v1) === String(v2);
  const marker = same ? '   ' : '✱  ';
  const pad = s => String(s ?? '—').padEnd(30);
  console.log(`  ${marker}${label.padEnd(36)}│ ${pad(v1)} │ ${pad(v2)}`);
}
function divider() {
  console.log(`  ${' '.repeat(36)}├${'─'.repeat(32)}┼${'─'.repeat(32)}`);
}

async function compareCohort(name, files) {
  console.log('\n' + HR);
  console.log(`  COHORT: ${name}  —  ${files.length} bill(s)`);
  console.log(HR);
  console.log('  Files:');
  files.forEach(f => console.log(`    · ${path.basename(f)}`));

  // Parse with both engines
  const v1Parsed = await processBills(files, V1Ocr);
  const v2Parsed = await processBills(files, V2Ocr);

  // Stats
  const v1ParseOk = v1Parsed.filter(b => !b._failed && b.kwh_total != null);
  const v2ParseOk = v2Parsed.filter(b => !b._failed && b.kwh_total != null);
  const v1ParseFailed = v1Parsed.length - v1ParseOk.length;
  const v2ParseFailed = v2Parsed.length - v2ParseOk.length;

  // Analyze
  const v1Usable = v1ParseOk.filter(b => b.total_nzd != null);
  const v2Usable = v2ParseOk.filter(b => b.total_nzd != null);
  const v1Out = v1Usable.length ? V1An.analyzeBills({ bills: v1Usable }) : null;
  const v2Out = v2Usable.length ? V2An.analyzeBills({ bills: v2Usable }) : null;

  console.log('');
  console.log(`  ${' '.repeat(36)}│ ${'BEFORE (v1 / HEAD)'.padEnd(30)} │ ${'AFTER  (v2)'.padEnd(30)}`);
  divider();

  display('Bills parsed OK',         `${v1ParseOk.length} / ${v1Parsed.length}`,
                                      `${v2ParseOk.length} / ${v2Parsed.length}`);
  display('Bills usable (have total)', v1Usable.length, v2Usable.length);
  display('Region used',              v1Out?.region || '—',                v2Out?.region || '—');
  display('Region resolved how?',     v1Out?.region_resolved_from || '(default Auckland)', v2Out?.region_resolved_from || '—');

  divider();
  display('Annual usage estimate',    fmtKwh(v1Out?.aggregate?.annual_kwh), fmtKwh(v2Out?.aggregate?.annual_kwh));
  display('Annual spend estimate',    fmt$(v1Out?.aggregate?.annual_spend_nzd), fmt$(v2Out?.aggregate?.annual_spend_nzd));
  display('Months of bills covered',  v1Out?.aggregate?.months_covered ?? '—', v2Out?.aggregate?.months_covered ?? '—');
  display('Retailer detected',        v1Out?.aggregate?.retailer || '—',    v2Out?.aggregate?.retailer || '—');
  display('Plan detected',            v1Out?.aggregate?.plan_name || '—',   v2Out?.aggregate?.plan_name || '—');

  divider();
  display('Recommended system size',  fmtKw(v1Out?.recommendation?.recommended_system_kw),
                                       fmtKw(v2Out?.recommendation?.recommended_system_kw));
  display('Recommended battery',      fmtKwh(v1Out?.recommendation?.recommended_battery_kwh),
                                       fmtKwh(v2Out?.recommendation?.recommended_battery_kwh));
  display('Est. annual generation',   fmtKwh(v1Out?.recommendation?.annual_generation_kwh),
                                       fmtKwh(v2Out?.recommendation?.annual_generation_kwh));
  display('Recommended package',      v1Out?.recommendation?.recommended_package_slug || '—',
                                       v2Out?.recommendation?.recommended_package_slug || '—');

  divider();
  const v1S = pickSolarBattery(v1Out), v2S = pickSolarBattery(v2Out);
  const v1B = pickBaseline(v1Out),     v2B = pickBaseline(v2Out);
  const v1Yr1 = (v1B && v1S) ? v1B.year_1_cost - v1S.year_1_cost : null;
  const v2Yr1 = (v2B && v2S) ? v2B.year_1_cost - v2S.year_1_cost : null;
  const v1Net = (v1B && v1S) ? v1B.year_25_cost - v1S.year_25_cost - (v1S.upfront_cost || 0) : null;
  const v2Net = (v2B && v2S) ? v2B.year_25_cost - v2S.year_25_cost - (v2S.upfront_cost || 0) : null;

  display('Scenario shown',           v1S?.label || '—',                   v2S?.label || '—');
  display('Upfront system cost',      fmt$(v1S?.upfront_cost),              fmt$(v2S?.upfront_cost));
  display('Year-1 savings',           fmt$(v1Yr1),                          fmt$(v2Yr1));
  display('25-yr savings (net)',      fmt$(v1Net),                          fmt$(v2Net));
  display('Payback (years)',          v1S?.payback_years ? `${v1S.payback_years} yrs` : '—',
                                       v2S?.payback_years ? `${v2S.payback_years} yrs` : '—');

  divider();
  display('Sees recommendation?',
    v1Out ? 'YES (no gate exists)' : 'NO (engine errored)',
    v2Out
      ? (v2Out.review_required ? 'NO — review required' : 'YES')
      : 'NO (engine errored)',
  );

  if (v2Out?.review_reasons?.length) {
    console.log('\n  v2 review reasons:');
    for (const r of v2Out.review_reasons) {
      console.log(`    [${r.severity}] ${r.code}: ${r.message.slice(0, 200)}`);
    }
  }

  // Per-bill v2 extraction breakdown (the new fields)
  console.log('\n  v2 per-bill extraction (the new fields):');
  console.log(`    ${'File'.padEnd(40)} │ ${'address'.padEnd(20)} │ ${'pcode'.padEnd(5)} │ ${'distrib'.padEnd(15)} │ type     │ kWh   │ $`);
  for (const b of v2Parsed) {
    if (b._failed) { console.log(`    ${path.basename(b.file).slice(0,40).padEnd(40)} │ FAILED: ${b.error.slice(0,30)}`); continue; }
    console.log(`    ${(b.file_name || '').slice(0,40).padEnd(40)} │ ${(b.service_address || '—').slice(0,20).padEnd(20)} │ ${(b.service_postcode || '—').padEnd(5)} │ ${(b.network_distributor || '—').slice(0,15).padEnd(15)} │ ${(b.bill_type || '—').padEnd(8)} │ ${(b.kwh_total ?? '—').toString().padEnd(5)} │ ${b.total_nzd ?? '—'}`);
  }
}

// ── Main ──
console.log('\n' + HR);
console.log('  REAL-BILL BUSINESS OUTPUT COMPARISON: v1 (HEAD) vs v2 (current)');
console.log(HR);

const cohorts = discoverCustomers();
console.log('\nCohorts found:');
for (const [name, files] of Object.entries(cohorts)) {
  console.log(`  · ${name}: ${files.length} bill(s)`);
}

// Process each cohort
for (const [name, files] of Object.entries(cohorts)) {
  await compareCohort(name, files);
}

console.log('\n' + HR);
console.log('  KEY: ✱ = output differs between v1 and v2');
console.log(HR + '\n');

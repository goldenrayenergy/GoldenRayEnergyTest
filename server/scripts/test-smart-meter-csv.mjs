// Smoke runner for smartMeterCsvService (Deploy #4 / Track 6).
//
// Synthesises CSV samples for each of the four supported NZ smart-meter
// export formats + each common granularity (half-hourly / daily) and
// confirms the parser produces sensible monthly buckets.
//
// Synthesis is deterministic — every bucket targets a known annual kWh
// total so the assertion at the end can verify the round-trip is lossless.
//
// Usage:  node server/scripts/test-smart-meter-csv.mjs

import { parseSmartMeterCsv } from '../services/smartMeterCsvService.js';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else      { console.log(`  ✗ ${name} — ${detail || 'failed'}`); fail++; }
}

// ── Synth helpers ─────────────────────────────────────────────────────────
function* daysInRange(startIso, endIso) {
  const s = new Date(startIso + 'T00:00:00Z');
  const e = new Date(endIso + 'T00:00:00Z');
  for (let d = s; d <= e; d = new Date(d.getTime() + 86400000)) {
    yield d.toISOString().slice(0, 10);
  }
}
function nzSlashDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${parseInt(d,10)}/${parseInt(m,10)}/${y}`;
}
function nzMmmDash(iso) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [y, m, d] = iso.split('-');
  return `${parseInt(d,10)}-${months[parseInt(m,10)-1]}-${y}`;
}

// ─── TEST 1: Mercury half-hourly ──────────────────────────────────────────
console.log('\n[Test 1] Mercury half-hourly — Dec 2025 → 31 × 48 rows ≈ 1488 readings');
{
  const rows = ['Date,Time,Energy Used (kWh)'];
  let expectedKwh = 0;
  for (const day of daysInRange('2025-12-01', '2025-12-31')) {
    for (let i = 0; i < 48; i++) {
      const kwh = 0.5;       // 0.5 kWh per half-hour
      const hh = String(Math.floor(i / 2)).padStart(2, '0');
      const mm = i % 2 === 0 ? '00' : '30';
      rows.push(`${day},${hh}:${mm},${kwh}`);
      expectedKwh += kwh;
    }
  }
  const r = parseSmartMeterCsv(rows.join('\n'));
  check('detects Mercury source',  r.source === 'mercury', `got: ${r.source}`);
  check('detects half-hourly',     r.granularity === 'half_hourly', `got: ${r.granularity}`);
  check('row count = 1488',        r.row_count === 1488, `got: ${r.row_count}`);
  check('1 monthly bucket',        r.monthly_rows.length === 1);
  check('bucket has 31 days',      r.monthly_rows[0]?.days === 31);
  check('bucket kWh ≈ expected',   Math.abs(r.monthly_rows[0]?.kwh - expectedKwh) < 1,
                                   `got kWh=${r.monthly_rows[0]?.kwh}, expected=${expectedKwh}`);
}

// ─── TEST 2: Genesis daily DD/MM/YYYY + cost column ────────────────────────
console.log('\n[Test 2] Genesis daily — 90 days, DD/MM/YYYY, includes Cost');
{
  const rows = ['Read Date,Usage (kWh),Cost ($)'];
  let totalKwh = 0, totalCost = 0;
  for (const day of daysInRange('2025-09-01', '2025-11-29')) {
    const kwh  = 24;
    const cost = 8.4;
    rows.push(`${nzSlashDate(day)},${kwh},${cost.toFixed(2)}`);
    totalKwh  += kwh;
    totalCost += cost;
  }
  const r = parseSmartMeterCsv(rows.join('\n'));
  check('detects Genesis source',  r.source === 'genesis', `got: ${r.source}`);
  check('detects daily',           r.granularity === 'daily', `got: ${r.granularity}`);
  check('3 monthly buckets',       r.monthly_rows.length === 3);
  check('sum kWh matches',         Math.abs(r.monthly_rows.reduce((s,b) => s+b.kwh, 0) - totalKwh) < 1);
  check('cost column captured',    r.monthly_rows.every(b => b.usage_nzd != null));
  check('sum cost matches',        Math.abs(r.monthly_rows.reduce((s,b) => s+b.usage_nzd, 0) - totalCost) < 1);
}

// ─── TEST 3: Contact half-hourly DD-MMM-YYYY ──────────────────────────────
console.log('\n[Test 3] Contact half-hourly — Feb 2026, DD-MMM-YYYY dates');
{
  const rows = ['Date,Half-hour ending,Consumption (kWh)'];
  let expectedKwh = 0;
  for (const day of daysInRange('2026-02-01', '2026-02-28')) {
    for (let i = 0; i < 48; i++) {
      const kwh = 0.4;
      const hh = String(Math.floor((i + 1) / 2)).padStart(2, '0');
      const mm = i % 2 === 0 ? '30' : '00';
      rows.push(`${nzMmmDash(day)},${hh}:${mm},${kwh}`);
      expectedKwh += kwh;
    }
  }
  const r = parseSmartMeterCsv(rows.join('\n'));
  check('detects Contact source',  r.source === 'contact', `got: ${r.source}`);
  check('detects half-hourly',     r.granularity === 'half_hourly', `got: ${r.granularity}`);
  check('1 monthly bucket',        r.monthly_rows.length === 1);
  check('bucket has 28 days',      r.monthly_rows[0]?.days === 28);
  check('bucket kWh ≈ expected',   Math.abs(r.monthly_rows[0]?.kwh - expectedKwh) < 1);
}

// ─── TEST 4: Powerswitch standardised 2-column ────────────────────────────
console.log('\n[Test 4] Powerswitch standard — 12 months × ~30 days = annual data');
{
  const rows = ['Date,kWh'];
  let expectedKwh = 0;
  for (const day of daysInRange('2025-01-01', '2025-12-31')) {
    const kwh = 20;
    rows.push(`${day},${kwh}`);
    expectedKwh += kwh;
  }
  const r = parseSmartMeterCsv(rows.join('\n'));
  check('detects Powerswitch',     r.source === 'powerswitch', `got: ${r.source}`);
  check('12 monthly buckets',      r.monthly_rows.length === 12);
  check('sum kWh = expected',      Math.abs(r.monthly_rows.reduce((s,b)=>s+b.kwh,0) - expectedKwh) < 1);
  check('all months have 28-31 days', r.monthly_rows.every(b => b.days >= 28 && b.days <= 31));
}

// ─── TEST 5: Generic unknown CSV with ISO dates ───────────────────────────
console.log('\n[Test 5] Generic CSV — unknown layout, fallback to generic');
{
  const rows = ['SomeDateColumn,SomeKwhValue,Extra'];
  for (const day of daysInRange('2025-06-01', '2025-06-30')) {
    rows.push(`${day},15,whatever`);
  }
  const r = parseSmartMeterCsv(rows.join('\n'));
  check('detects generic source',  r.source === 'generic', `got: ${r.source}`);
  check('parses 30 days',          r.row_count === 30);
  check('1 monthly bucket',        r.monthly_rows.length === 1);
  check('kWh = 30 × 15 = 450',     r.monthly_rows[0]?.kwh === 450);
}

// ─── TEST 6: Empty / malformed CSVs ───────────────────────────────────────
console.log('\n[Test 6] Edge cases — empty, header-only, no dates');
{
  const empty    = parseSmartMeterCsv('');
  const headerOnly = parseSmartMeterCsv('Date,kWh');
  const badDates = parseSmartMeterCsv('Date,kWh\nblah,15\nblah,16');
  check('empty CSV reports warning',     empty.warnings.some(w => w.code === 'empty_csv'));
  check('header-only reports warning',   headerOnly.warnings.some(w => w.code === 'empty_csv' || w.code === 'no_monthly_buckets' || w.code === 'unknown_date_format'));
  check('bad dates reports warning',     badDates.warnings.some(w => w.code === 'unknown_date_format' || w.code === 'no_monthly_buckets'));
}

// ─── TEST 7: BOM-prefixed CSV (Excel export) ──────────────────────────────
console.log('\n[Test 7] Excel-exported CSV with UTF-8 BOM');
{
  const csv = '﻿Date,kWh\n2025-01-01,18\n2025-01-02,19\n2025-01-03,20';
  const r = parseSmartMeterCsv(csv);
  check('BOM stripped, parses cleanly', r.row_count === 3, `row_count: ${r.row_count}`);
}

// ─── Summary ──────────────────────────────────────────────────────────────
console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━`);
if (fail > 0) process.exit(1);

// Before-vs-after comparison: pre-v2 bill analysis engine vs the v2 changes
// (migration 025 work). Loads both versions side-by-side and runs the same
// test bills through both. Prints field extraction, validators fired,
// region resolution, and review_required for each scenario.
//
// Usage:  node scripts/compare-v1-vs-v2.mjs

import * as V1Ocr from './_billOcrService.v1.mjs';
import * as V1An  from './_billAnalysisService.v1.mjs';
import * as V2Ocr from '../services/billOcrService.js';
import * as V2An  from '../services/billAnalysisService.js';

const HR = '─'.repeat(78);
const COL_W = 36;

function pad(s, w = COL_W) {
  s = String(s ?? '');
  if (s.length > w) return s.slice(0, w - 1) + '…';
  return s.padEnd(w);
}
function row(label, v1, v2) {
  const same = JSON.stringify(v1) === JSON.stringify(v2);
  const marker = same ? '  ' : '🟡';
  const v1Str = v1 === null || v1 === undefined ? '—' : Array.isArray(v1) ? `[${v1.length}] ${v1.slice(0,2).map(x=>typeof x==='object'?x.code||JSON.stringify(x).slice(0,20):String(x)).join(', ')}${v1.length>2?'…':''}` : typeof v1 === 'object' ? JSON.stringify(v1).slice(0,COL_W-1) : String(v1);
  const v2Str = v2 === null || v2 === undefined ? '—' : Array.isArray(v2) ? `[${v2.length}] ${v2.slice(0,2).map(x=>typeof x==='object'?x.code||JSON.stringify(x).slice(0,20):String(x)).join(', ')}${v2.length>2?'…':''}` : typeof v2 === 'object' ? JSON.stringify(v2).slice(0,COL_W-1) : String(v2);
  console.log(`  ${marker} ${pad(label, 28)} │ ${pad(v1Str)} │ ${pad(v2Str)}`);
}

function header(title) {
  console.log('\n' + HR);
  console.log('  ' + title);
  console.log(HR);
  console.log(`  ${pad(' ', 28)}   ${pad('BEFORE (v1)')} │ ${pad('AFTER  (v2)')}`);
  console.log(`  ${pad(' ', 28)}   ${pad('─'.repeat(COL_W-2))} │ ${pad('─'.repeat(COL_W-2))}`);
}

// ── TEST SAMPLES ──────────────────────────────────────────────────────────

const SAMPLES = [
  {
    name: 'CLEAN — Mercury bill, Auckland postcode, valid GST + sum',
    text: `Mercury NZ Limited
Account: 12345678
Service Address: 42 Queen Street, Newmarket, Auckland 1023
ICP Number: 0000123456AB12
Vector Limited
Homeline Standard

Billing Period: 1 Jul 2025 to 31 Jul 2025

Energy charges
  Anytime usage     1,940 kWh @ 28.9c    $560.66

Daily fixed charge   31 days @ $1.40     $43.40

GST (15%)                                 $90.61

Total amount due                         $694.67`,
  },
  {
    name: 'BAD GST — same bill but GST is $45 instead of $90.61 (parser bug or OCR error)',
    text: `Mercury NZ Limited
Account: 12345678
Service Address: 42 Queen Street, Newmarket, Auckland 1023
ICP Number: 0000123456AB12
Vector Limited
Homeline Standard

Billing Period: 1 Jul 2025 to 31 Jul 2025

Energy charges
  Anytime usage     1,940 kWh @ 28.9c    $560.66

Daily fixed charge   31 days @ $1.40     $43.40

GST (15%)                                 $45.00

Total amount due                         $649.06`,
  },
  {
    name: 'BAD SUM — line items don\'t add up to total (OCR misread on total)',
    text: `Mercury NZ Limited
Service Address: 42 Queen Street, Newmarket, Auckland 1023
Vector Limited
Homeline Standard

Billing Period: 1 Jul 2025 to 31 Jul 2025

Energy charges
  Anytime usage     1,940 kWh @ 28.9c    $560.66

Daily fixed charge   31 days @ $1.40     $43.40

GST (15%)                                 $90.61

Total amount due                         $1000.00`,
  },
  {
    name: 'BAD DATES — billing end before start',
    text: `Mercury NZ Limited
Service Address: 42 Queen Street, Newmarket, Auckland 1023
Homeline Standard

Billing Period: 31 Jul 2025 to 1 Jul 2025

Energy charges
  Anytime usage     1,940 kWh @ 28.9c    $560.66

Daily fixed charge   31 days @ $1.40     $43.40

GST (15%)                                 $90.61

Total amount due                         $694.67`,
  },
  {
    name: 'WELLINGTON — Contact bill, postcode 6011 (should use Wellington irradiance)',
    text: `Contact Energy
contactenergy.co.nz
Service Address: 99 Lambton Quay, Wellington 6011
Wellington Electricity
Good Nights plan

Billing period: 1 Jul 2025 to 31 Jul 2025

  Anytime  1,200 kWh @ 30.0c            $360.00
  Daily charge  31 days @ $1.50          $46.50

GST (15%)                                 $61.00

Total                                     $467.50`,
  },
  {
    name: 'UNKNOWN RETAILER — generic fallback (no irradiance hint either)',
    text: `Some Energy Retailer NZ
PO Box 1234, Anywhere

Period: 1 Jul 2025 to 31 Jul 2025
Usage 800 kWh
Total $250.00`,
  },
  {
    name: 'MERCURY MULTI-RATE — price change mid-period (the real-world WIP case)',
    text: `Mercury NZ Limited
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
ELECTRICITY TOTAL                              $260.88`,
  },
];

// ── Compare bills ─────────────────────────────────────────────────────────

console.log('\nBEFORE = HEAD billOcrService.js + billAnalysisService.js (no migration 025)');
console.log('AFTER  = current uncommitted v2 code (extractors + validators + region + gate)');

for (const sample of SAMPLES) {
  header(sample.name);

  const v1 = V1Ocr.parseBillText(sample.text);
  const v2 = V2Ocr.parseBillText(sample.text);

  // Parser output
  row('retailer',              v1.retailer,              v2.retailer);
  row('plan_name',             v1.plan_name,             v2.plan_name);
  row('period_start',          v1.period_start,          v2.period_start);
  row('period_end',            v1.period_end,            v2.period_end);
  row('kwh_total',             v1.kwh_total,             v2.kwh_total);
  row('total_nzd',             v1.total_nzd,             v2.total_nzd);
  row('fixed_charge_nzd',      v1.fixed_charge_nzd,      v2.fixed_charge_nzd);
  row('variable_charge_nzd',   v1.variable_charge_nzd,   v2.variable_charge_nzd);
  row('gst_nzd',               v1.gst_nzd,               v2.gst_nzd);

  // NEW v2 fields (won't exist in v1 — show as "—")
  row('service_address',       v1.service_address,       v2.service_address);
  row('service_postcode',      v1.service_postcode,      v2.service_postcode);
  row('icp_number',            v1.icp_number,            v2.icp_number);
  row('network_distributor',   v1.network_distributor,   v2.network_distributor);

  // Bill type + rate row counts (v2 only)
  row('bill_type',             v1.bill_type || '(not tracked)',          v2.bill_type);
  row('rate_rows {f,v}',       v1.rate_rows ? `f=${v1.rate_rows.fixed},v=${v1.rate_rows.variable}` : '(not tracked)',
                                v2.rate_rows ? `f=${v2.rate_rows.fixed},v=${v2.rate_rows.variable}` : '—');

  // Confidence + validators
  row('ocr_confidence',        v1.ocr_confidence,        v2.ocr_confidence);
  row('field_confidence keys', v1.field_confidence ? Object.keys(v1.field_confidence).length : '—',
                                v2.field_confidence ? Object.keys(v2.field_confidence).length : '—');
  row('parse_warnings count',  (v1.parse_warnings || []).length,
                                (v2.parse_warnings || []).length);
  row('parse_warnings codes',  (v1.parse_warnings || []).map(w => w.code || w.field),
                                (v2.parse_warnings || []).map(w => w.code || w.field));
  row('parse_suspect',         v1.parse_suspect,         v2.parse_suspect);

  // Run analysis through both engines to see region + gate
  const v1Analysis = V1An.analyzeBills({ bills: [v1] });
  const v2Analysis = V2An.analyzeBills({ bills: [v2] });

  row('region',                v1Analysis.region,                v2Analysis.region);
  row('region_resolved_from',  v1Analysis.region_resolved_from || '(not tracked)',
                                v2Analysis.region_resolved_from);
  row('recommended_kw',        v1Analysis.recommendation.recommended_system_kw,
                                v2Analysis.recommendation.recommended_system_kw);
  row('review_required',       v1Analysis.review_required ?? '(not present)',
                                v2Analysis.review_required);
  row('review_reasons',        (v1Analysis.review_reasons || []).map(r => r.code),
                                (v2Analysis.review_reasons || []).map(r => r.code));
}

// ── Multi-address (separate test — needs 2 bills) ─────────────────────────
header('MULTIPLE ADDRESSES — two bills, different supply addresses (should NEVER be merged)');
const billA = V2Ocr.parseBillText(SAMPLES[0].text);
const billB = V2Ocr.parseBillText(SAMPLES[4].text);  // Wellington bill

const v1MultiAnalysis = V1An.analyzeBills({ bills: [
  V1Ocr.parseBillText(SAMPLES[0].text),
  V1Ocr.parseBillText(SAMPLES[4].text),
]});
const v2MultiAnalysis = V2An.analyzeBills({ bills: [billA, billB] });

row('bill A address',   billA.service_address, billA.service_address);
row('bill B address',   billB.service_address, billB.service_address);
row('annual_kwh merged?', v1MultiAnalysis.aggregate.annual_kwh + ' (silently merged)',
                          v2MultiAnalysis.aggregate.annual_kwh);
row('review_required',    v1MultiAnalysis.review_required ?? '(not present)',
                          v2MultiAnalysis.review_required);
row('review_reasons',     (v1MultiAnalysis.review_reasons || []).map(r => r.code),
                          (v2MultiAnalysis.review_reasons || []).map(r => r.code));

console.log('\n' + HR);
console.log('  KEY: 🟡 = field differs between v1 and v2');
console.log(HR + '\n');

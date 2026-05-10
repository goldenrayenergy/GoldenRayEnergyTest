// Diagnostic — extract raw text from real bill PDFs and run them through
// the parser to see what's missing.

import { readFileSync } from 'node:fs';
import { PDFParse } from 'pdf-parse';
import { parseBillText } from '../services/billOcrService.js';

const BILLS = [
  // Contact Energy — most recent (Feb 2026)
  'C:\\Users\\ram33\\Downloads\\bills\\bills\\01-Feb-2026-ContactBill.pdf',
  // Contact Energy — older (Aug 2025) — sanity check
  'C:\\Users\\ram33\\Downloads\\bills\\bills\\26-Aug-2025-ContactBill.pdf',
  // Pulse Energy — most recent
  'C:\\Users\\ram33\\Downloads\\bills\\bills\\13131638_Pulse Energy_9088775198.pdf',
  // Pulse Energy — older
  'C:\\Users\\ram33\\Downloads\\bills\\bills\\12861942_Pulse Energy_9088775198.pdf',
  // Genesis Energy — commercial w/ Capricorn (Mar 2026)
  'C:\\Users\\ram33\\Downloads\\bills\\bills\\1003976024_352526765_05032026-003555.pdf',
  // Genesis Energy — older (Feb 2026)
  'C:\\Users\\ram33\\Downloads\\bills\\bills\\1003050939_352288831_19022026-008967.pdf',
  // Mercury — KHAN (Mar 2026, dual-fuel elec+gas)
  'C:\\Users\\ram33\\Downloads\\bills\\bills\\MCYST_5077166682_1.pdf',
  // Mercury — KHAN (Dec 2025, original test)
  'C:\\Users\\ram33\\Downloads\\bills\\bills\\MCYST_5074875709_1.pdf',
  // Mercury — TAZIB (Mar 2026, electricity-only)
  'C:\\Users\\ram33\\Downloads\\bills\\bills\\MCYST_5077137242_1.pdf',
];

function fmt$(n) { return n == null ? '—' : '$' + n.toFixed(2); }

for (const path of BILLS) {
  const fileName = path.split('\\').pop();
  console.log('\n' + '═'.repeat(110));
  console.log(' FILE: ' + fileName);
  console.log('═'.repeat(110));

  let buf;
  try { buf = readFileSync(path); }
  catch (e) { console.log('  ✗ Could not read file: ' + e.message); continue; }

  const parser = new PDFParse({ data: buf });
  const { text } = await parser.getText();

  console.log('\n--- RAW TEXT (first 3500 chars) ---');
  console.log(text.slice(0, 3500));
  console.log('--- end raw text ---\n');

  const r = parseBillText(text, { fileName });
  console.log('  Retailer:        ' + r.retailer);
  console.log('  Confidence:      ' + (r.ocr_confidence * 100).toFixed(0) + '%');
  console.log('  Plan:            ' + (r.plan_name || '—'));
  console.log('  Period:          ' + (r.period_start || '—') + ' → ' + (r.period_end || '—') + ' (' + (r.days_in_period || '—') + ' days)');
  console.log('  kWh total:       ' + (r.kwh_total ?? '—'));
  console.log('  kWh peak:        ' + (r.kwh_peak ?? '—'));
  console.log('  kWh off-peak:    ' + (r.kwh_off_peak ?? '—'));
  console.log('  Fixed charge:    ' + fmt$(r.fixed_charge_nzd));
  console.log('  Variable charge: ' + fmt$(r.variable_charge_nzd));
  console.log('  GST:             ' + fmt$(r.gst_nzd));
  console.log('  Total:           ' + fmt$(r.total_nzd));
  if (r.parse_errors.length) {
    console.log('  Warnings:');
    for (const e of r.parse_errors) console.log('    - [' + e.field + '] ' + e.reason);
  }
}

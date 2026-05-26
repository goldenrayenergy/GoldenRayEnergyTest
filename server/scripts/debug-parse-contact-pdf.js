// Debug tool — dump pdf-parse output + parser output for a single Contact PDF.
//
// Run:  node server/scripts/debug-parse-contact-pdf.js "C:\path\to\bill11.pdf"
//
// Outputs (in order):
//   1. Length of extracted text + first 500 chars (to confirm extraction worked)
//   2. The chunk pdf-parse produced around the electricity detail section
//   3. The structured parse result (kwh_total, fixed/variable, total, GST)
//   4. Any parse_errors

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseBillPdf } from '../services/billOcrService.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node server/scripts/debug-parse-contact-pdf.js <path-to-pdf>');
  process.exit(1);
}

const buffer = readFileSync(file);
const result = await parseBillPdf(buffer, { fileName: path.basename(file) });

console.log('═══════════════════════════════════════════════════════════════');
console.log(`File: ${file}`);
console.log(`Size: ${(buffer.length / 1024).toFixed(1)} KB`);
console.log('═══════════════════════════════════════════════════════════════\n');

console.log('─── EXTRACTED TEXT (first 500 chars) ───');
console.log(result.ocr_text_excerpt?.slice(0, 500) || '(empty — PDF may be image-only)');
console.log(`...\n[total text length: ${result.ocr_text_excerpt?.length ?? 0}]\n`);

// Try to locate the electricity detail block in the extracted text
const fullText = result.ocr_text_excerpt || '';
const elecHit  = fullText.search(/Electricity\s+charges/i);
if (elecHit >= 0) {
  console.log('─── ELECTRICITY DETAIL BLOCK (raw, 800 chars from match) ───');
  console.log(fullText.slice(elecHit, elecHit + 800));
  console.log('\n');
} else {
  console.log('⚠️  Could not find "Electricity charges" in extracted text');
  console.log('    First 1500 chars of full text:');
  console.log(fullText.slice(0, 1500));
  console.log('\n');
}

console.log('─── PARSER OUTPUT ───');
const fields = [
  'retailer', 'plan_name',
  'period_start', 'period_end', 'days_in_period',
  'kwh_total', 'kwh_peak', 'kwh_off_peak',
  'fixed_charge_nzd', 'variable_charge_nzd',
  'total_nzd', 'gst_nzd',
  'ocr_confidence',
];
for (const f of fields) {
  const v = result[f];
  const flag = (v == null || v === '') ? '❌' : '✅';
  console.log(`  ${flag} ${f.padEnd(22)} ${v ?? 'null'}`);
}

if (result.parse_errors?.length) {
  console.log('\n─── PARSE ERRORS ───');
  for (const e of result.parse_errors) {
    console.log(`  ⚠️  ${e.field}: ${e.reason}`);
  }
}

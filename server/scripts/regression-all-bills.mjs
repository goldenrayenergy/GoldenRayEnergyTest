// Regression runner — parses every PDF under C:/Users/ram33/Downloads/bills/
// recursively and reports retailer detection + field extraction summary.
// Used after parser changes to confirm no regressions across the full
// customer-bill corpus.
//
// Usage:  node server/scripts/regression-all-bills.mjs [--show-warnings]

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { parseBillPdf } = await import('../services/billOcrService.js');

const SHOW_WARN = process.argv.includes('--show-warnings');
const ROOT = 'C:/Users/ram33/Downloads/bills/bills';

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full));
    else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) out.push(full);
  }
  return out;
}

const files = await walk(ROOT);
console.log(`Found ${files.length} PDFs under ${ROOT}\n`);

const byRetailer = {};
const failures   = [];
const reviewFlags = [];
const validatorHits = {};

for (const f of files) {
  const rel = path.relative(ROOT, f);
  try {
    const buf = await fs.readFile(f);
    const parsed = await parseBillPdf(buf, { fileName: path.basename(f) });
    const r = parsed.retailer || '(none)';
    byRetailer[r] = byRetailer[r] || { count: 0, complete: 0, withReview: 0, files: [] };
    byRetailer[r].count++;
    byRetailer[r].files.push(rel);
    // Field completeness: kwh_total + total_nzd + period_start + period_end + days
    const complete = parsed.kwh_total != null
                  && parsed.total_nzd != null
                  && parsed.period_start
                  && parsed.period_end
                  && parsed.days_in_period != null;
    if (complete) byRetailer[r].complete++;
    if (parsed.review_required) {
      byRetailer[r].withReview++;
      reviewFlags.push(rel);
    }
    for (const w of (parsed.parse_warnings || [])) {
      validatorHits[w.code] = (validatorHits[w.code] || 0) + 1;
    }
    if (SHOW_WARN && parsed.parse_warnings?.length) {
      console.log(`  ⚠️  ${rel}  ${parsed.parse_warnings.map(w => w.code).join(', ')}`);
    }
  } catch (e) {
    failures.push({ file: rel, error: e.message });
  }
}

console.log('═══ RETAILER BREAKDOWN ═══');
const rows = Object.entries(byRetailer).sort((a, b) => b[1].count - a[1].count);
for (const [r, s] of rows) {
  const pct = ((s.complete / s.count) * 100).toFixed(0);
  console.log(`  ${r.padEnd(22)}  ${String(s.count).padStart(3)} bills  ·  ${String(s.complete).padStart(3)}/${s.count} fully-parsed (${pct}%)  ·  ${s.withReview} flagged for review`);
}
console.log();
console.log(`Total: ${files.length} PDFs · ${failures.length} parse failures · ${reviewFlags.length} review_required`);

if (Object.keys(validatorHits).length) {
  console.log('\n═══ CROSS-FIELD VALIDATOR HITS ═══');
  for (const [code, n] of Object.entries(validatorHits).sort((a,b)=>b[1]-a[1])) {
    console.log(`  ${code.padEnd(30)}  ${n} bills`);
  }
}

if (failures.length) {
  console.log('\n═══ PARSE FAILURES ═══');
  failures.forEach(f => console.log(`  ❌ ${f.file}: ${f.error}`));
}

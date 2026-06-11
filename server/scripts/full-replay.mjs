// Full systematic replay: for every distinct file in DB, run the parser fresh.
// Categorise outcomes. This gives the TRUE state of the parser today.
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBillText } from '../services/billOcrService.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

// One row per distinct file. Use ocr_text_full when available, fall back
// to ocr_text_excerpt — the older Genesis uploads only have excerpt.
const r = await c.query(`
  SELECT DISTINCT ON (COALESCE(file_name, MD5(LEFT(COALESCE(ocr_text_full, ocr_text_excerpt, ''), 200))))
         id, file_name, retailer, ocr_text_full, ocr_text_excerpt,
         fixed_charge_nzd, variable_charge_nzd, gst_nzd, total_nzd,
         kwh_total, days_in_period
    FROM bill_uploads
   WHERE LENGTH(COALESCE(ocr_text_full, ocr_text_excerpt, '')) > 100
   ORDER BY COALESCE(file_name, MD5(LEFT(COALESCE(ocr_text_full, ocr_text_excerpt, ''), 200))), id`);

// Surface how many bills only have excerpt vs full
const split = await c.query(`
  SELECT
    COUNT(*) FILTER (WHERE ocr_text_full IS NOT NULL AND LENGTH(ocr_text_full) > 100) AS has_full,
    COUNT(*) FILTER (WHERE (ocr_text_full IS NULL OR LENGTH(ocr_text_full) <= 100)
                       AND LENGTH(COALESCE(ocr_text_excerpt,'')) > 100) AS only_excerpt,
    COUNT(*) FILTER (WHERE LENGTH(COALESCE(ocr_text_full, ocr_text_excerpt, '')) <= 100) AS no_text,
    COUNT(*) AS total
   FROM bill_uploads`);
const s = split.rows[0];
console.log(`OCR text storage status across all ${s.total} bills:`);
console.log(`  has full text:      ${s.has_full}`);
console.log(`  only excerpt:       ${s.only_excerpt}  ← falling back to excerpt for these`);
console.log(`  no text at all:     ${s.no_text}  ← cannot replay\n`);

console.log(`Total DISTINCT bills to replay: ${r.rows.length}\n`);

const buckets = {
  // Fresh parse balances perfectly + no warnings: clean
  clean: [],
  // Fresh parse balances perfectly but warnings fire (likely period/kwh outlier)
  cleanWithWarnings: [],
  // Fresh parse doesn't balance + warning fires (validator working)
  brokenButFlagged: [],
  // Fresh parse doesn't balance + no warning fires (SILENT FAILURE)
  silentlyBroken: [],
  // Critical fields missing (kwh or total)
  incomplete: [],
};

for (const u of r.rows) {
  const text = u.ocr_text_full || u.ocr_text_excerpt || '';
  let fresh;
  try { fresh = parseBillText(text); }
  catch (e) { fresh = { parse_errors: [{ field: 'all', reason: 'threw: ' + e.message }] }; }

  const sum = (Number(fresh.fixed_charge_nzd)||0)
            + (Number(fresh.variable_charge_nzd)||0)
            + (Number(fresh.gst_nzd)||0);
  const total = Number(fresh.total_nzd) || 0;
  const drift = Math.abs(sum - total);
  const hasWarning = Array.isArray(fresh.parse_warnings) && fresh.parse_warnings.length > 0;
  const missingCritical = fresh.kwh_total == null || fresh.total_nzd == null;

  const summary = {
    file:  u.file_name || u.id.slice(0,8),
    retailer: fresh.retailer || u.retailer || '?',
    drift: drift.toFixed(2),
    warnings: hasWarning ? fresh.parse_warnings.map(w=>w.code).join(',') : '',
  };

  if (missingCritical) buckets.incomplete.push(summary);
  else if (drift <= 1 && !hasWarning) buckets.clean.push(summary);
  else if (drift <= 1 &&  hasWarning) buckets.cleanWithWarnings.push(summary);
  else if (drift  > 1 &&  hasWarning) buckets.brokenButFlagged.push(summary);
  else                                buckets.silentlyBroken.push(summary);
}

console.log(`\n────────────── SUMMARY ──────────────`);
console.log(`✓ clean (balances, no warnings):           ${buckets.clean.length}`);
console.log(`◐ clean with warnings (period/outlier):    ${buckets.cleanWithWarnings.length}`);
console.log(`⚠ broken but FLAGGED by validator:         ${buckets.brokenButFlagged.length}  ← validator working`);
console.log(`✗ SILENTLY BROKEN (no warning fires):      ${buckets.silentlyBroken.length}  ← URGENT`);
console.log(`✗ incomplete (kwh or total null):          ${buckets.incomplete.length}`);

// Per-retailer breakdown
const perRetailer = {};
for (const [bucket, items] of Object.entries(buckets)) {
  for (const it of items) {
    perRetailer[it.retailer] ||= { clean:0, cleanWithWarnings:0, brokenButFlagged:0, silentlyBroken:0, incomplete:0 };
    perRetailer[it.retailer][bucket]++;
  }
}
console.log(`\n────────────── BY RETAILER ──────────────`);
console.log(`Retailer            clean   warn   broken✓  SILENT✗  incomplete`);
for (const [retailer, counts] of Object.entries(perRetailer).sort()) {
  console.log(`  ${retailer.padEnd(20)} ${String(counts.clean).padStart(5)} ${String(counts.cleanWithWarnings).padStart(6)} ${String(counts.brokenButFlagged).padStart(8)} ${String(counts.silentlyBroken).padStart(8)} ${String(counts.incomplete).padStart(11)}`);
}

console.log(`\n────────────── SILENTLY BROKEN BILLS (urgent fix target) ──────────────`);
for (const it of buckets.silentlyBroken) console.log(`  ${it.retailer.padEnd(20)}  drift=$${it.drift}  ${it.file}`);

console.log(`\n────────────── INCOMPLETE BILLS (parser can't read) ──────────────`);
for (const it of buckets.incomplete.slice(0, 20)) console.log(`  ${it.retailer.padEnd(20)}  ${it.file}`);
if (buckets.incomplete.length > 20) console.log(`  ... and ${buckets.incomplete.length - 20} more`);

await c.end();

// ────────────────────────────────────────────────────────────────────────────
// Audit script — pulls every inverter row from the products table and checks
// whether it has the engineering specs the proposal engine needs.
//
// Engine-required fields for inverters (from engineeringValidator.js +
// costEngine.js + bomBuilder.js):
//   phase, ac_kw,
//   uoc_max_v, idc_max_a_per_mppt, isc_max_a_mppt1, mppt_count,
//   is_plus_variant, battery_capable,
//   max_pv_kwp_standard, max_pv_kwp_reduced, peak_efficiency_pct
//
// Run: node server/scripts/audit-inverter-specs.js
// ────────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('Missing SUPABASE_DATABASE_URL / DATABASE_URL'); process.exit(1); }
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

// Fields the engine actually reads from inverter spec data.
const REQUIRED_ENGINE_FIELDS = [
  'phase',
  'ac_kw',
  'uoc_max_v',
  'idc_max_a_per_mppt',
  'isc_max_a_mppt1',
  'mppt_count',
  'is_plus_variant',
  'battery_capable',
  'max_pv_kwp_standard',
  'max_pv_kwp_reduced',
  'peak_efficiency_pct',
];

// Helper to test whether a value is present + non-null.
const has = (v) => v !== null && v !== undefined && v !== '';

// ── 1. Categories / counts ─────────────────────────────────────────────────
console.log('━'.repeat(80));
console.log('  Inverter spec audit — live Supabase products table');
console.log('━'.repeat(80));
console.log();

const catRes = await client.query(`
  SELECT category, subcategory, COUNT(*) AS n
  FROM products
  WHERE is_active = TRUE
    AND (
      LOWER(category) LIKE '%inverter%'
      OR LOWER(subcategory) LIKE '%inverter%'
      OR LOWER(name) LIKE '%inverter%'
      OR LOWER(category) LIKE '%license%'
      OR LOWER(subcategory) LIKE '%license%'
      OR LOWER(name) LIKE '%upgrade%'
    )
  GROUP BY category, subcategory
  ORDER BY n DESC
`);

console.log('Inverter-related categories:');
for (const r of catRes.rows) {
  console.log(`  ${String(r.n).padStart(3)}  ${(r.category || '—').padEnd(35)}  ${r.subcategory || ''}`);
}

// ── 2. Pull every active inverter row ──────────────────────────────────────
const invRes = await client.query(`
  SELECT id, sku, brand, name, category, subcategory, cost_nzd, default_margin_pct, specs
  FROM products
  WHERE is_active = TRUE
    AND (
      LOWER(category) LIKE '%inverter%'
      OR LOWER(subcategory) LIKE '%inverter%'
    )
  ORDER BY brand NULLS LAST, name
`);

console.log();
console.log(`Active inverter rows found: ${invRes.rows.length}`);

// ── 3. Per-field completeness ──────────────────────────────────────────────
console.log();
console.log('Per-field completeness across all inverter rows:');
console.log('  Field' + ' '.repeat(28) + 'Present  Missing  % filled');

const stats = {};
for (const f of REQUIRED_ENGINE_FIELDS) stats[f] = { present: 0, missing: 0 };

for (const row of invRes.rows) {
  const specs = row.specs || {};
  for (const f of REQUIRED_ENGINE_FIELDS) {
    if (has(specs[f])) stats[f].present++;
    else stats[f].missing++;
  }
}

for (const f of REQUIRED_ENGINE_FIELDS) {
  const s = stats[f];
  const pct = invRes.rows.length > 0 ? Math.round(100 * s.present / invRes.rows.length) : 0;
  console.log(`  ${f.padEnd(34)} ${String(s.present).padStart(7)}  ${String(s.missing).padStart(7)}  ${String(pct).padStart(6)}%`);
}

// ── 4. Per-row report ──────────────────────────────────────────────────────
console.log();
console.log('Per-row spec coverage (first 50 rows, then full list of any with < 5 fields):');
console.log('  SKU                                 Brand            Fields present     Missing');

const fullyMissing = [];
const partiallyFilled = [];
const fullyFilled = [];

for (const row of invRes.rows) {
  const specs = row.specs || {};
  const present = REQUIRED_ENGINE_FIELDS.filter(f => has(specs[f]));
  const missing = REQUIRED_ENGINE_FIELDS.filter(f => !has(specs[f]));
  const entry = { row, present, missing };
  if (present.length === 0) fullyMissing.push(entry);
  else if (present.length < REQUIRED_ENGINE_FIELDS.length) partiallyFilled.push(entry);
  else fullyFilled.push(entry);
}

const printRow = (entry) => {
  const skuTxt = (entry.row.sku || '(no sku)').slice(0, 32).padEnd(34);
  const brandTxt = (entry.row.brand || '(no brand)').slice(0, 14).padEnd(16);
  const presentTxt = `${entry.present.length}/${REQUIRED_ENGINE_FIELDS.length}`;
  console.log(`  ${skuTxt} ${brandTxt} ${presentTxt.padEnd(18)} ${entry.missing.slice(0, 4).join(', ')}${entry.missing.length > 4 ? ' …' : ''}`);
};

console.log();
console.log(`▸ Fully filled (${REQUIRED_ENGINE_FIELDS.length}/${REQUIRED_ENGINE_FIELDS.length}):`);
if (fullyFilled.length === 0) console.log('    (none)');
for (const e of fullyFilled.slice(0, 50)) printRow(e);

console.log();
console.log(`▸ Partially filled (1–${REQUIRED_ENGINE_FIELDS.length - 1} fields):`);
if (partiallyFilled.length === 0) console.log('    (none)');
for (const e of partiallyFilled.slice(0, 50)) printRow(e);

console.log();
console.log(`▸ Empty (0/${REQUIRED_ENGINE_FIELDS.length} engine fields):`);
if (fullyMissing.length === 0) console.log('    (none)');
for (const e of fullyMissing.slice(0, 50)) printRow(e);

// ── 5. What IS in specs across all rows? ───────────────────────────────────
console.log();
console.log('All distinct keys found across the specs JSONB of every inverter row:');
const allKeys = new Set();
for (const row of invRes.rows) {
  if (row.specs && typeof row.specs === 'object') {
    for (const k of Object.keys(row.specs)) allKeys.add(k);
  }
}
const allKeysArr = [...allKeys].sort();
if (allKeysArr.length === 0) console.log('  (specs JSONB is empty on every row)');
else for (const k of allKeysArr) {
  const required = REQUIRED_ENGINE_FIELDS.includes(k);
  console.log(`  ${required ? '★' : ' '} ${k}`);
}

// ── 6. Summary line ────────────────────────────────────────────────────────
console.log();
console.log('━'.repeat(80));
console.log(`  Summary: ${invRes.rows.length} active inverter rows`);
console.log(`           ${fullyFilled.length} fully engine-ready, ${partiallyFilled.length} partial, ${fullyMissing.length} empty`);
console.log('━'.repeat(80));

await client.end();

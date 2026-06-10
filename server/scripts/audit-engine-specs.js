// ────────────────────────────────────────────────────────────────────────────
// Audit script — panels AND inverters in the live Supabase products table.
// Checks whether the engine-required JSONB spec keys (voc_stc, uoc_max_v,
// idc_max_a_per_mppt, etc.) are present.
//
// Run: node server/scripts/audit-engine-specs.js
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

const has = (v) => v !== null && v !== undefined && v !== '';

// ── Field sets the engine reads ───────────────────────────────────────────
const PANEL_FIELDS = [
  'watts',
  'voc_stc', 'isc_stc', 'vmp_stc', 'imp_stc',
  'voltage_temp_coef_pct_per_c',
  'current_temp_coef_pct_per_c',
  'power_temp_coef_pct_per_c',
];

const INVERTER_FIELDS = [
  'phase', 'ac_kw',
  'uoc_max_v', 'idc_max_a_per_mppt', 'isc_max_a_mppt1', 'mppt_count',
  'is_plus_variant', 'battery_capable',
  'max_pv_kwp_standard', 'max_pv_kwp_reduced',
  'peak_efficiency_pct',
];

async function audit({ label, where, required }) {
  console.log();
  console.log('━'.repeat(80));
  console.log(`  ${label}`);
  console.log('━'.repeat(80));

  const r = await client.query(`
    SELECT id, sku, brand, name, category, subcategory, specs
    FROM products
    WHERE is_active = TRUE AND (${where})
    ORDER BY brand NULLS LAST, name
  `);

  console.log(`Active rows: ${r.rows.length}`);
  if (r.rows.length === 0) { console.log('(no rows)'); return; }

  // Per-field completeness
  const stats = Object.fromEntries(required.map(f => [f, { p: 0, m: 0 }]));
  for (const row of r.rows) {
    const specs = row.specs || {};
    for (const f of required) {
      if (has(specs[f])) stats[f].p++; else stats[f].m++;
    }
  }

  console.log();
  console.log('Per-field completeness:');
  console.log('  Field' + ' '.repeat(36) + 'Filled   Empty  % filled');
  for (const f of required) {
    const s = stats[f];
    const pct = Math.round(100 * s.p / r.rows.length);
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
    console.log(`  ${f.padEnd(40)} ${String(s.p).padStart(5)}  ${String(s.m).padStart(5)}   ${String(pct).padStart(3)}% ${bar}`);
  }

  // Per-row bucketing
  let full = 0, partial = 0, empty = 0;
  const buckets = { full: [], partial: [], empty: [] };
  for (const row of r.rows) {
    const specs = row.specs || {};
    const present = required.filter(f => has(specs[f]));
    if (present.length === required.length)       { full++;    buckets.full.push({ row, present }); }
    else if (present.length === 0)                 { empty++;   buckets.empty.push({ row, present }); }
    else                                            { partial++; buckets.partial.push({ row, present }); }
  }
  console.log();
  console.log(`Bucketing: ${full} fully filled · ${partial} partial · ${empty} empty (engine-blind)`);

  if (buckets.partial.length > 0 && buckets.partial.length <= 10) {
    console.log();
    console.log('Partial rows (showing all):');
    for (const e of buckets.partial) {
      const missing = required.filter(f => !has((e.row.specs || {})[f]));
      console.log(`  • ${(e.row.sku || '(no sku)').padEnd(28)} ${e.present.length}/${required.length} — missing: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' …' : ''}`);
    }
  } else if (buckets.partial.length > 10) {
    console.log();
    console.log(`Partial rows (first 5 of ${buckets.partial.length}):`);
    for (const e of buckets.partial.slice(0, 5)) {
      const missing = required.filter(f => !has((e.row.specs || {})[f]));
      console.log(`  • ${(e.row.sku || '(no sku)').padEnd(28)} ${e.present.length}/${required.length} — missing: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ' …' : ''}`);
    }
  }

  if (buckets.empty.length > 0) {
    console.log();
    console.log(`Empty rows (${buckets.empty.length}):`);
    for (const e of buckets.empty.slice(0, 20)) {
      console.log(`  • ${(e.row.sku || '(no sku)').padEnd(28)} ${e.row.brand || '—'.padEnd(10)} ${e.row.name?.slice(0, 50) || ''}`);
    }
    if (buckets.empty.length > 20) console.log(`    … +${buckets.empty.length - 20} more`);
  }

  // Surface any unexpected keys present
  const allKeys = new Set();
  for (const row of r.rows) {
    if (row.specs && typeof row.specs === 'object') {
      for (const k of Object.keys(row.specs)) allKeys.add(k);
    }
  }
  const extra = [...allKeys].filter(k => !required.includes(k)).sort();
  if (extra.length) {
    console.log();
    console.log(`Other keys present in specs (not required by engine):`);
    console.log('  ' + extra.join(', '));
  }
}

// ── Run audits ────────────────────────────────────────────────────────────
console.log('━'.repeat(80));
console.log('  ENGINE-SPEC AUDIT — live Supabase products table');
console.log('━'.repeat(80));

await audit({
  label: 'PANELS',
  where: `LOWER(category) LIKE '%pv module%'
       OR LOWER(category) LIKE '%solar panel%'
       OR LOWER(category) LIKE '%panel%'
       OR LOWER(name) LIKE '%panel%'
       OR LOWER(subcategory) LIKE '%mono%'
       OR LOWER(subcategory) LIKE '%bifacial%'`,
  required: PANEL_FIELDS,
});

await audit({
  label: 'INVERTERS',
  where: `LOWER(category) LIKE '%inverter%' OR LOWER(subcategory) LIKE '%inverter%'`,
  required: INVERTER_FIELDS,
});

await client.end();
console.log();
console.log('━'.repeat(80));
console.log('  Done.');
console.log('━'.repeat(80));

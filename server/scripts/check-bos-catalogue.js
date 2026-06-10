// Probe the catalogue for any BoS items already SKU'd.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const probes = [
  'isolator', 'SPD', 'surge', 'MC4', 'cable', 'conduit', 'rail', 'mount', 'flashing',
  'earth', 'fastener', 'clamp', 'label', 'tilt', 'protect', 'BOS', 'hopergy', 'solarflex', 'flashrite',
];

for (const p of probes) {
  const r = await c.query(`
    SELECT sku, brand, name, category, cost_nzd, default_margin_pct, is_active
    FROM products
    WHERE name ILIKE $1 OR sku ILIKE $1 OR category ILIKE $1
    LIMIT 4
  `, [`%${p}%`]);
  if (r.rows.length === 0) continue;
  console.log(`\n── "${p}" — ${r.rows.length} match ──`);
  for (const row of r.rows) {
    console.log(`  ${(row.sku || '').padEnd(24)} ${row.brand || '—'.padEnd(12)} cost=$${row.cost_nzd ?? '—'} margin=${row.default_margin_pct ?? '—'}% active=${row.is_active}`);
    console.log(`    "${row.name}"`);
  }
}

console.log('\n━━━ All catalogue categories ━━━');
const cats = await c.query(`SELECT DISTINCT category, COUNT(*) FROM products WHERE is_active=true GROUP BY category ORDER BY category`);
for (const r of cats.rows) console.log(`  ${(r.category || '(uncategorized)').padEnd(40)} ${r.count} rows`);

await c.end();

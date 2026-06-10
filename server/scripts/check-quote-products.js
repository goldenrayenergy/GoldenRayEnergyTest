// Check whether the 3 quote SKUs Krishna's quote needs have cost+margin
// populated in the catalogue today.
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
  { label: 'Fronius Primo GEN24 10.0 Plus (1-phase)', sql: `(brand ILIKE 'fronius' AND name ILIKE '%primo%10%gen24%plus%')` },
  { label: 'Fronius Primo GEN24 10.0 (non-plus)',     sql: `(brand ILIKE 'fronius' AND name ILIKE '%primo%10%gen24%' AND name NOT ILIKE '%plus%')` },
  { label: 'Fronius Reserva 9.45 kWh',                sql: `(brand ILIKE 'fronius' AND name ILIKE '%reserva%' AND (name ILIKE '%9.45%' OR name ILIKE '%9.4%'))` },
  { label: 'Fronius Reserva 15.8 kWh',                sql: `(brand ILIKE 'fronius' AND name ILIKE '%reserva%' AND name ILIKE '%15.8%')` },
  { label: 'Fronius Reserva (any size)',              sql: `(brand ILIKE 'fronius' AND name ILIKE '%reserva%')` },
  { label: 'BYD HVM 13.8',                            sql: `(brand ILIKE 'byd' AND (name ILIKE '%hvm%13.8%' OR name ILIKE '%13.8%'))` },
  { label: 'BYD (any battery)',                       sql: `(brand ILIKE 'byd')` },
  { label: 'Phono 475W Quasar',                       sql: `(brand ILIKE 'phono%' AND name ILIKE '%475%')` },
];

for (const p of probes) {
  const r = await c.query(`
    SELECT sku, brand, name, category, cost_nzd, wholesale_cost_nzd, default_margin_pct, margin_target_pct, is_active
    FROM products WHERE ${p.sql} LIMIT 5
  `);
  console.log(`\n── ${p.label} (${r.rows.length} match) ──`);
  for (const row of r.rows) {
    const cost = row.cost_nzd ?? row.wholesale_cost_nzd ?? null;
    const marg = row.default_margin_pct ?? row.margin_target_pct ?? null;
    console.log(`  sku=${row.sku || 'null'}  cost=${cost ?? '—'}  margin=${marg ?? '—'}%  active=${row.is_active}`);
    console.log(`    "${row.name}"`);
  }
}

// Also dump the 6 packages
console.log('\n━━━ Existing packages (6) ━━━');
const pkg = await c.query(`SELECT slug, name, from_price_override FROM packages ORDER BY sort_order LIMIT 10`);
for (const r of pkg.rows) console.log(`  ${r.slug.padEnd(35)} from_price=${r.from_price_override ?? '—'}  "${r.name}"`);

await c.end();

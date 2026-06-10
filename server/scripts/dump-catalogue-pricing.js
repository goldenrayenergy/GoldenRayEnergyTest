// One-off: inspect what pricing/cost data lives in the products + packages
// tables today. Tells us whether the catalogue can drive a real quote
// or if we still need manual costing.
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

console.log('\n━━━ TABLES (filtering for products/packages/pricing) ━━━');
const t = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public'
    AND (table_name ILIKE '%product%' OR table_name ILIKE '%package%' OR table_name ILIKE '%price%' OR table_name ILIKE '%catalog%' OR table_name ILIKE '%supplier%' OR table_name ILIKE '%bom%')
  ORDER BY table_name
`);
for (const r of t.rows) console.log(`  ${r.table_name}`);

for (const tbl of t.rows.map(r => r.table_name)) {
  const cols = await c.query(`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [tbl]);
  const cnt = await c.query(`SELECT COUNT(*) FROM ${tbl}`);
  const priceCols = cols.rows.filter(r => /price|cost|margin|markup|nzd|amount/i.test(r.column_name)).map(r => `${r.column_name}(${r.data_type})`);
  console.log(`\n  ${tbl} — ${cnt.rows[0].count} rows`);
  if (priceCols.length) console.log(`    pricing cols: ${priceCols.join(', ')}`);
  else                  console.log(`    pricing cols: none`);
}

// If a products table exists, look for Fronius/Reserva/BYD specifically
const probe = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN ('products','products_v2','catalogue_products')
`);
for (const r of probe.rows) {
  console.log(`\n━━━ Sample rows in ${r.table_name} (Fronius / Reserva / BYD probe) ━━━`);
  try {
    const sample = await c.query(`
      SELECT * FROM ${r.table_name}
      WHERE name ILIKE '%fronius%' OR name ILIKE '%reserva%' OR name ILIKE '%byd%'
      LIMIT 8
    `);
    for (const row of sample.rows) {
      const keep = {};
      for (const k of Object.keys(row)) {
        if (/^(id|sku|name|brand|category|.*price|.*cost|.*margin|.*markup|is_active)$/i.test(k)) keep[k] = row[k];
      }
      console.log('   ', JSON.stringify(keep));
    }
  } catch (e) {
    console.log(`   (query failed: ${e.message})`);
  }
}

await c.end();

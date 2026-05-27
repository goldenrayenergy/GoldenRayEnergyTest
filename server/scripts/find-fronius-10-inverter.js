// Find the specific Fronius 10.0 Plus inverter SKU in the catalogue.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(`
  SELECT sku, name, category, brand, cost_nzd, default_margin_pct
  FROM products
  WHERE is_active
    AND (LOWER(name) LIKE '%fronius%' AND (LOWER(name) LIKE '%10%' OR LOWER(name) LIKE '%plus%'))
  ORDER BY cost_nzd
`);

console.log(`\nFronius 10.0 Plus matches (${rows.length}):\n`);
for (const r of rows) {
  const sell = r.cost_nzd ? +(r.cost_nzd * (1 + (r.default_margin_pct||30)/100) * 1.15).toFixed(2) : null;
  console.log(`  $${String(r.cost_nzd).padStart(10)}  margin ${r.default_margin_pct||30}%  →  sell incl GST $${sell}`);
  console.log(`    ${r.name}`);
  console.log(`    SKU: ${r.sku || '(none)'}  ·  cat: ${r.category || '(none)'}  ·  brand: ${r.brand || '(none)'}\n`);
}

await client.end();

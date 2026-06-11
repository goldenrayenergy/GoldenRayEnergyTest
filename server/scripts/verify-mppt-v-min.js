// Quick verification — count Fronius inverters with/without mppt_v_min set.
// Expected after MVP1_004: every active Fronius inverter has mppt_v_min populated.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const connStr = (process.env.DATABASE_URL || '').replace(/['"]/g, '')
  .replace(/[?&]sslmode=[^&]*/g, '');
const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } });

await client.connect();

const { rows: counts } = await client.query(`
  SELECT
    COUNT(*) FILTER (WHERE specs->>'mppt_v_min' IS NOT NULL) AS with_mppt,
    COUNT(*) FILTER (WHERE specs->>'mppt_v_min' IS NULL)     AS without_mppt
  FROM products
  WHERE category IN ('Inverters - Grid Tied', 'Inverters - Commercial')
    AND brand = 'Fronius'
    AND is_active = true;
`);
console.log('Fronius inverter coverage:', counts[0]);

const { rows: missing } = await client.query(`
  SELECT sku, name, specs->>'rated_kw' AS rated_kw
  FROM products
  WHERE category IN ('Inverters - Grid Tied', 'Inverters - Commercial')
    AND brand = 'Fronius'
    AND is_active = true
    AND (specs->>'mppt_v_min') IS NULL
  ORDER BY name;
`);
if (missing.length === 0) {
  console.log('✅ Every active Fronius inverter has mppt_v_min set.');
} else {
  console.log(`⚠️  ${missing.length} inverters missing mppt_v_min:`);
  missing.forEach(r => console.log(`   • ${r.sku} — ${r.name} (rated_kw=${r.rated_kw})`));
}

const { rows: distribution } = await client.query(`
  SELECT specs->>'mppt_v_min' AS mppt_v_min, COUNT(*) AS n
  FROM products
  WHERE category IN ('Inverters - Grid Tied', 'Inverters - Commercial')
    AND brand = 'Fronius'
    AND is_active = true
    AND (specs->>'mppt_v_min') IS NOT NULL
  GROUP BY 1
  ORDER BY 1;
`);
console.log('\nDistribution of mppt_v_min values:');
distribution.forEach(r => console.log(`   ${r.mppt_v_min} V → ${r.n} inverter(s)`));

await client.end();

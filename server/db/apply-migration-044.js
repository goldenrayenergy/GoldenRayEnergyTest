// Apply migration 044 — address_polygon_overrides table (Layer 3, Session 2).
// Additive-only: new table + RLS policies. Owner-manual polygon corrections
// for the ~16% of NZ addresses where Google Solar + LINZ Parcels + OSM +
// LINZ Buildings all fail to identify the right roof.
//
// Run:   node server/db/apply-migration-044.js
// Alt:   copy server/db/migrations/044_address_polygon_overrides.sql into
//        the Supabase SQL editor and run there.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('Missing SUPABASE_DATABASE_URL / DATABASE_URL'); process.exit(1); }
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const sql = readFileSync(
  path.join(__dirname, 'migrations/044_address_polygon_overrides.sql'),
  'utf8',
);

try {
  await client.query('BEGIN');
  await client.query(sql);

  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'address_polygon_overrides'
    ORDER BY ordinal_position
  `);
  const policies = await client.query(`
    SELECT policyname FROM pg_policies
    WHERE tablename = 'address_polygon_overrides'
    ORDER BY policyname
  `);
  const indexes = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'address_polygon_overrides'
    ORDER BY indexname
  `);

  await client.query('COMMIT');
  console.log('✅ Migration 044 (address_polygon_overrides) applied');
  console.log(`   • ${cols.rows.length} columns:`);
  cols.rows.forEach((r) => console.log(`     - ${r.column_name}`));
  console.log(`   • ${policies.rows.length} RLS policies:`);
  policies.rows.forEach((r) => console.log(`     - ${r.policyname}`));
  console.log(`   • ${indexes.rows.length} indexes:`);
  indexes.rows.forEach((r) => console.log(`     - ${r.indexname}`));
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration 044 failed, rolled back:', e.message);
  process.exit(1);
}

await client.end();

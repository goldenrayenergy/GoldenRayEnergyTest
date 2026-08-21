// Apply migration 042 — website_enquiries POC-design columns for the merged
// /get-quote + /poc/quote flow. Additive-only: extends website_enquiries
// with columns that the new /api/quote/submit-with-design endpoint populates.
// Old wizard leads leave the new columns NULL.
//
// Run:   node server/db/apply-migration-042.js
// Alt:   copy server/db/migrations/042_website_enquiries_poc_design.sql into
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
  path.join(__dirname, 'migrations/042_website_enquiries_poc_design.sql'),
  'utf8',
);

try {
  await client.query('BEGIN');
  await client.query(sql);

  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'website_enquiries'
      AND column_name IN (
        'submission_source', 'chosen_tier_id', 'system_kwp', 'panel_count',
        'battery_kwh_chosen', 'ev_charger_included', 'tier_price',
        'roof_source', 'coords_lat', 'coords_lng', 'poc_design_json'
      )
    ORDER BY column_name
  `);

  await client.query('COMMIT');
  console.log('✅ Migration 042 (website_enquiries POC design columns) applied');
  console.log(`   • ${cols.rows.length} / 11 expected new columns present:`);
  cols.rows.forEach((r) => console.log(`     - ${r.column_name}`));
  if (cols.rows.length !== 11) {
    console.warn('   ⚠ Column count mismatch — expected all 11.');
  }
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration 042 failed, rolled back:', e.message);
  process.exit(1);
}

await client.end();

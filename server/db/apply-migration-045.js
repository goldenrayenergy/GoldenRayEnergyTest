// Apply migration 045 — quote_rate_limits table (2026-08-31).
// Additive-only: adds a new table. No impact on existing behaviour until
// the middleware code change (separate commit) starts reading + writing it.
//
// Run:   node server/db/apply-migration-045.js
// Alt:   copy server/db/migrations/045_quote_rate_limits.sql into the
//        Supabase SQL editor and run there.

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
  path.join(__dirname, 'migrations/045_quote_rate_limits.sql'),
  'utf8',
);

try {
  await client.query('BEGIN');
  await client.query(sql);

  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'quote_rate_limits'
    ORDER BY ordinal_position
  `);
  const pk = await client.query(`
    SELECT tc.constraint_name, string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS cols
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
    WHERE tc.table_name = 'quote_rate_limits' AND tc.constraint_type = 'PRIMARY KEY'
    GROUP BY tc.constraint_name
  `);

  await client.query('COMMIT');
  console.log('✅ Migration 045 (quote_rate_limits) applied');
  console.log(`   • ${cols.rows.length} columns:`);
  cols.rows.forEach((r) => console.log(`     - ${r.column_name}`));
  console.log(`   • Primary key: ${pk.rows[0]?.cols || '(missing!)'}`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration 045 failed, rolled back:', e.message);
  process.exit(1);
}

await client.end();

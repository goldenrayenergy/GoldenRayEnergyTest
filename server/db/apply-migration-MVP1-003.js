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

const sql = readFileSync(path.join(__dirname, 'migrations/MVP1/MVP1_003_catalogue_db_driven.sql'), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✅ Migration MVP1_003 (catalogue DB-driven) applied');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration MVP1_003 failed, rolled back:', e.message);
  process.exit(1);
}

// Verify the tables + columns + status enum updates exist.
const checks = [
  ['labour_rate_card',       'table'],
  ['compliance_rate_card',   'table'],
  ['catalogue_csv_imports',  'table'],
];

console.log('\nVerifying tables:');
for (const [name] of checks) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [name]
  );
  console.log(`  ${r.rows.length ? '✓' : '✗'} ${name}`);
  if (!r.rows.length) { await client.end(); process.exit(1); }
}

// Verify the 'archived' status is accepted.
const enumCheck = await client.query(`
  SELECT consrc, conname FROM pg_constraint
  WHERE conrelid = 'quotes'::regclass AND contype = 'c' AND conname = 'quotes_status_check'
`).catch(() => ({ rows: [] }));
// pg_constraint.consrc is deprecated in PG12+; use pg_get_constraintdef instead.
const enumDef = await client.query(`
  SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
  WHERE conrelid = 'quotes'::regclass AND contype = 'c' AND conname = 'quotes_status_check'
`);
const hasArchived = (enumDef.rows[0]?.def || '').includes("'archived'");
console.log(`\n${hasArchived ? '✓' : '✗'} quotes.status accepts 'archived'`);
if (!hasArchived) { await client.end(); process.exit(1); }

// Verify archive metadata columns.
const archiveCols = ['archived_at', 'archived_by', 'archive_reason'];
console.log('\nVerifying quotes archive columns:');
for (const col of archiveCols) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name=$1`, [col]
  );
  console.log(`  ${r.rows.length ? '✓' : '✗'} quotes.${col}`);
  if (!r.rows.length) { await client.end(); process.exit(1); }
}

await client.query("NOTIFY pgrst, 'reload schema'");
console.log('\n✓ PostgREST schema reload notified');
await client.end();
console.log('\n✅ Done.');

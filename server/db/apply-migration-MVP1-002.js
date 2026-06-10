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

const sql = readFileSync(path.join(__dirname, 'migrations/MVP1/MVP1_002_lifecycle_fields.sql'), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✅ Migration MVP1_002 (lifecycle fields) applied');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration MVP1_002 failed, rolled back:', e.message);
  process.exit(1);
}

// Verify the columns Day-5 routes write to all exist now.
const required = [
  ['quote_versions', 'signed_pdf_storage_path'],
  ['quote_versions', 'signed_at'],
  ['quote_versions', 'signer_name'],
  ['quote_versions', 'counter_signed_at'],
  ['quote_versions', 'counter_signed_by'],
  ['quote_versions', 'counter_signer_name'],
  ['quotes', 'deposit_amount_nzd'],
  ['quotes', 'deposit_reference'],
  ['quotes', 'deposit_received_at'],
  ['quote_email_log', 'dry_run'],
  ['quote_run_log', 'run_kind'],
];
console.log(`\nVerifying columns (${required.length} expected):`);
for (const [tab, col] of required) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [tab, col]
  );
  console.log(`  ${r.rows.length ? '✓' : '✗'} ${tab}.${col}`);
  if (!r.rows.length) { await client.end(); process.exit(1); }
}

await client.query("NOTIFY pgrst, 'reload schema'");
console.log('\n✓ PostgREST schema reload notified');
await client.end();
console.log('\n✅ Done.');

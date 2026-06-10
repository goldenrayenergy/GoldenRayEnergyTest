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

const sql = readFileSync(path.join(__dirname, 'migrations/MVP1/MVP1_001_proposal_generator.sql'), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✅ Migration MVP1_001 (proposal generator schema) applied');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration MVP1_001 failed, rolled back:', e.message);
  process.exit(1);
}

// Verify tables exist + count
const verify = await client.query(`
  SELECT tablename
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename IN (
      'quotes', 'quote_versions', 'quote_audit_log',
      'discount_approvals', 'quote_email_log', 'quote_run_log'
    )
  ORDER BY tablename
`);
console.log(`\n✓ Tables verified (${verify.rows.length}/6):`);
for (const r of verify.rows) console.log(`  • ${r.tablename}`);

if (verify.rows.length !== 6) {
  console.error(`\n⚠ Expected 6 tables, found ${verify.rows.length}`);
  process.exit(1);
}

// Reload PostgREST schema so Supabase REST client sees new tables
await client.query("NOTIFY pgrst, 'reload schema'");
console.log('\n✓ PostgREST schema reload notified');

await client.end();
console.log('\n✅ Done.');

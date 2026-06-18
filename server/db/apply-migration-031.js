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

const sql = readFileSync(path.join(__dirname, 'migrations/031_icp_writethrough.sql'), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);

  // Verify the new columns landed (additive — safe to re-run)
  const cols = await client.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE (column_name = 'icp_number' AND table_name IN ('bill_analyses', 'contacts', 'bill_uploads'))
       OR (column_name = 'updated_at' AND table_name = 'quote_versions')
    ORDER BY table_name, column_name
  `);

  await client.query('COMMIT');
  console.log('✅ Migration 031 (icp_writethrough + quote_versions.updated_at) applied');
  for (const r of cols.rows) console.log(`   • ${r.table_name}.${r.column_name} present`);
  console.log('   • NOTE: PostgREST schema cache may need a refresh — Supabase dashboard → API → Reload schema');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration 031 failed, rolled back:', e.message);
  process.exit(1);
}

await client.end();

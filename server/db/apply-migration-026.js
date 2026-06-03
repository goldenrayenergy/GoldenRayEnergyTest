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

const sql = readFileSync(path.join(__dirname, 'migrations/026_bill_storage.sql'), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);

  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'bill_uploads'
    AND column_name IN ('file_storage_path','file_mime_type','file_uploaded_at')
  `);

  await client.query('COMMIT');
  console.log('✅ Migration 026 (bill_storage) applied');
  console.log(`   • bill_uploads: ${cols.rows.length}/3 storage columns present`);
  console.log('   • Next: run `node server/scripts/setup-bill-storage.js` to create the customer-bills bucket');
  console.log('   • NOTE: PostgREST schema cache may need a refresh — Supabase dashboard → API → Reload schema');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration 026 failed, rolled back:', e.message);
  process.exit(1);
}

await client.end();

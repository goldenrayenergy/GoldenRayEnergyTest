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

const sql = readFileSync(path.join(__dirname, 'migrations/020_data_validation_hardening.sql'), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✅ Migration 020 (data validation hardening — CHECK constraints) applied');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration 020 failed, rolled back:', e.message);
  process.exit(1);
}

await client.query("NOTIFY pgrst, 'reload schema'");
await client.end();

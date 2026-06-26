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

const sql = readFileSync(path.join(__dirname, 'migrations/033_error_reports.sql'), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);

  const tbl = await client.query(`
    SELECT table_name FROM information_schema.tables WHERE table_name = 'error_reports'
  `);

  await client.query('COMMIT');
  console.log('✅ Migration 033 (error_reports) applied');
  console.log(`   • error_reports table: ${tbl.rows.length === 1 ? 'present' : 'missing'}`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration 033 failed, rolled back:', e.message);
  process.exit(1);
}

await client.end();

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

const sql = readFileSync(path.join(__dirname, 'migrations/030_field_limits.sql'), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✅ Migration 030 (field_limits + audit) applied');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration 030 failed, rolled back:', e.message);
  process.exit(1);
}

// Verify seed
const { rows } = await client.query('SELECT path, hard_min, hard_max, typical_min, typical_max FROM field_limits ORDER BY path');
console.log(`\n${rows.length} field_limits rows seeded:`);
for (const r of rows) {
  console.log(`  ${r.path.padEnd(50)} hard ${r.hard_min}-${r.hard_max}, typical ${r.typical_min}-${r.typical_max}`);
}

await client.end();

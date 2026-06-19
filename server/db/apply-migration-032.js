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

const sql = readFileSync(path.join(__dirname, 'migrations/032_marketing_claims.sql'), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);

  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'marketing_claims'
  `);

  await client.query('COMMIT');
  console.log('✅ Migration 032 (products.marketing_claims) applied');
  console.log(`   • products.marketing_claims: ${cols.rows.length === 1 ? 'present' : 'missing'}`);
  console.log('   • Run server/scripts/seed-marketing-claims.js next to populate Fronius + BYD copy.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration 032 failed, rolled back:', e.message);
  process.exit(1);
}

await client.end();

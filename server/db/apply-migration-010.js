import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Missing SUPABASE_DATABASE_URL / DATABASE_URL in .env');
  process.exit(1);
}
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
const sql = readFileSync(path.join(__dirname, 'migrations/010_products_name_to_text.sql'), 'utf8');
await client.query(sql);
console.log('✅ Migration 010 (products.name → TEXT) applied');
await client.query("NOTIFY pgrst, 'reload schema'");
await client.end();

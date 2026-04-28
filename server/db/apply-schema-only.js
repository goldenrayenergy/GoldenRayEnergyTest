import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL in .env'); process.exit(1); }
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('✅ Connected to new Supabase');

console.log('🧹 Resetting public schema ...');
await client.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;`);
console.log('   public schema reset ✓');

console.log('🔨 Applying schema.sql ...');
await client.query('BEGIN');
try {
  await client.query(readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  await client.query('COMMIT');
  console.log('   schema.sql ✓');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
}

const migDir = path.join(__dirname, 'migrations');
const migFiles = readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
for (const f of migFiles) {
  console.log(`🔨 Applying migrations/${f} ...`);
  try {
    await client.query(readFileSync(path.join(migDir, f), 'utf8'));
    console.log(`   ${f} ✓`);
  } catch (e) {
    console.error(`   ${f} ✗  ${e.message}`);
    if (e.code) console.error(`     code: ${e.code}`);
    await client.end();
    process.exit(1);
  }
}

const { rows } = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name
`);
console.log('\n📋 Tables in new DB (' + rows.length + '):');
rows.forEach(r => console.log('   -', r.table_name));
await client.end();
console.log('\n✨ Schema applied successfully.');

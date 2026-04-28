import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('✅ Connected');

const sql = readFileSync(path.join(__dirname, 'migrations/005_new_stage_qualification.sql'), 'utf8');
await client.query(sql);
console.log('✅ Migration 005 applied');

const { rows } = await client.query(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name='projects' AND column_name IN ('quality','call_outcome','call_notes','qualified_at','website_enquiry_id')
  ORDER BY column_name
`);
console.log('New columns on projects:');
rows.forEach(r => console.log(`  ${r.column_name}  (${r.data_type})`));

await client.query("NOTIFY pgrst, 'reload schema'");
console.log('✅ PostgREST schema cache reloaded');
await client.end();

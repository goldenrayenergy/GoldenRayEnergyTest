import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const proj = await c.query(`
  SELECT code, stage, sub_status, owner_id, quality, call_outcome, qualified_at,
         stage_entered_at, stage_progress, cadence_email_ids
  FROM projects
  WHERE code = 'GR-2026-0012'
`);
console.log('=== GR-2026-0012 PROJECT STATE ===');
console.log(JSON.stringify(proj.rows[0], null, 2));

const acts = await c.query(`
  SELECT description, type, created_at, metadata
  FROM activities
  WHERE project_id IN (SELECT id FROM projects WHERE code = 'GR-2026-0012')
  ORDER BY created_at DESC
  LIMIT 15
`);
console.log('\n=== ACTIVITY LOG (most recent 15) ===');
acts.rows.forEach(a => console.log(`  [${a.created_at.toISOString().slice(0,19)}] ${a.description}`));

await c.end();

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

const cols = await c.query(`SELECT column_name FROM information_schema.columns WHERE table_name='projects' AND column_name IN ('sla_first_call_due_at','site_visit_done_at','cadence_email_ids') ORDER BY column_name`);
console.log('Columns present:');
cols.rows.forEach(x => console.log('  ✓', x.column_name));

const projs = await c.query(`SELECT code, sla_first_call_due_at, site_visit_done_at, created_at FROM projects WHERE code IN ('GR-2026-0011','GR-2026-0012') ORDER BY created_at DESC`);
console.log('\nRecent projects:');
projs.rows.forEach(x => console.log('  ' + x.code, '· SLA:', x.sla_first_call_due_at?.toISOString() || 'NULL', '· site visit:', x.site_visit_done_at?.toISOString() || 'NULL'));

await c.query("NOTIFY pgrst, 'reload schema'");
console.log('\n✅ PostgREST schema cache reloaded');
await c.end();

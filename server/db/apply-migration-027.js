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

const sql = readFileSync(path.join(__dirname, 'migrations/027_bail_followup_tracking.sql'), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);

  const col = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'website_enquiries' AND column_name = 'bail_followup_sent_at'
  `);
  const idx = await client.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'website_enquiries' AND indexname = 'idx_website_enquiries_bail_candidates'
  `);

  await client.query('COMMIT');
  console.log('✅ Migration 027 (bail_followup_tracking) applied');
  console.log(`   • bail_followup_sent_at column:    ${col.rows.length ? 'present' : 'MISSING'}`);
  console.log(`   • idx_bail_candidates partial idx: ${idx.rows.length ? 'present' : 'MISSING'}`);
  console.log('   • Next: schedule `node server/scripts/send-bail-followups.js` daily (Render Cron Job)');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration 027 failed, rolled back:', e.message);
  process.exit(1);
}

await client.end();

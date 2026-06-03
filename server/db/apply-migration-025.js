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

const sql = readFileSync(path.join(__dirname, 'migrations/025_bill_extraction_v2.sql'), 'utf8');

try {
  await client.query('BEGIN');
  await client.query(sql);

  // Verify the new columns landed (additive ADD COLUMN IF NOT EXISTS, so safe re-run)
  const upCols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'bill_uploads'
    AND column_name IN ('service_address','icp_number','network_distributor','tariff_components','payment_date','due_date','raw_extracted_fields','ocr_text_full','field_confidence','parse_method')
  `);
  const anCols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'bill_analyses'
    AND column_name IN ('review_required','review_reasons','region_resolved_from')
  `);

  await client.query('COMMIT');
  console.log('✅ Migration 025 (bill_extraction_v2) applied');
  console.log(`   • bill_uploads:  ${upCols.rows.length}/10 new columns present`);
  console.log(`   • bill_analyses: ${anCols.rows.length}/3 new columns present`);
  console.log('   • NOTE: PostgREST schema cache may need a refresh — Supabase dashboard → API → Reload schema');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ Migration 025 failed, rolled back:', e.message);
  process.exit(1);
}

await client.end();

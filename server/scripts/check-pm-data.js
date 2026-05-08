// Quick diagnostic — confirms test rows exist in projects_v2.
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

const { rows } = await client.query(
  `SELECT code, project_type, address, city, status, health,
          jsonb_object_keys(lane_status) AS lane_count_check
   FROM projects_v2
   ORDER BY created_at DESC
   LIMIT 20`
);

if (rows.length === 0) {
  console.log('❌ No rows in projects_v2.');
} else {
  // Group by code (since lane_count_check unnests)
  const codes = [...new Set(rows.map(r => r.code))];
  console.log(`✅ Found ${codes.length} project(s):`);
  for (const code of codes) {
    const r = rows.find(x => x.code === code);
    console.log(`   ${code}  ${r.project_type.padEnd(22)}  ${r.address || '(no address)'}, ${r.city || '?'}  [${r.health}/${r.status}]`);
  }
}

await client.end();

// Quick: dump raw_extracted_fields for one bill so we can see line items vs total.
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

const analysisId = '3b597cb1';
const r = await c.query(
  `SELECT id, file_name, kwh_total, fixed_charge_nzd, variable_charge_nzd,
          export_credit_nzd, gst_nzd, total_nzd, raw_extracted_fields, field_confidence
   FROM bill_uploads
   WHERE analysis_id::text LIKE $1 || '%'
   ORDER BY period_start`,
  [analysisId]
);
console.log(`\n${r.rows.length} bills under analysis ${analysisId}\n`);
console.log('file_name'.padEnd(20), 'kWh'.padStart(6), 'fixed'.padStart(8), 'variable'.padStart(10), 'export_cr'.padStart(10), 'GST'.padStart(8), 'total'.padStart(9), 'sum→total'.padStart(11), 'gst%net'.padStart(8));
console.log('—'.repeat(110));
for (const u of r.rows) {
  const f = Number(u.fixed_charge_nzd ?? 0);
  const v = Number(u.variable_charge_nzd ?? 0);
  const x = Number(u.export_credit_nzd ?? 0);
  const g = Number(u.gst_nzd ?? 0);
  const t = Number(u.total_nzd ?? 0);
  const sum = +(f + v - x + g).toFixed(2);
  const sumOk = Math.abs(sum - t) < 0.5;
  const net = +(f + v - x).toFixed(2);
  const gstPct = net > 0 ? (g / net) * 100 : 0;
  const gstOk = Math.abs(gstPct - 15) < 0.5;
  console.log(
    (u.file_name || '').slice(0, 20).padEnd(20),
    String(u.kwh_total ?? '—').padStart(6),
    `$${f.toFixed(2)}`.padStart(8),
    `$${v.toFixed(2)}`.padStart(10),
    `$${x.toFixed(2)}`.padStart(10),
    `$${g.toFixed(2)}`.padStart(8),
    `$${t.toFixed(2)}`.padStart(9),
    `${sumOk ? '✓' : '✗'} $${sum.toFixed(2)}`.padStart(11),
    `${gstOk ? '✓' : '✗'} ${gstPct.toFixed(1)}%`.padStart(8),
  );
}
await c.end();

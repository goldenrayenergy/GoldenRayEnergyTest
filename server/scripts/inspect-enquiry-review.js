// One-off diagnostic: explain why an enquiry was flagged for review.
// Usage:  node server/scripts/inspect-enquiry-review.js 73321f25
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const idPrefix = (process.argv[2] || '').trim();
if (!idPrefix) { console.error('Pass an enquiry id prefix, e.g. 73321f25'); process.exit(1); }

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const enq = await c.query(
  `SELECT id, created_at, status, email, first_name, last_name, phone,
          lead_score
   FROM website_enquiries WHERE id::text LIKE $1 LIMIT 5`,
  [`${idPrefix}%`]
);
if (!enq.rows.length) { console.log(`No enquiry id starts with ${idPrefix}`); process.exit(0); }
if (enq.rows.length > 1) {
  console.log(`Multiple matches — be more specific:`);
  for (const r of enq.rows) console.log(`  ${r.id} · ${r.email || '—'} · ${r.status}`);
  process.exit(0);
}
const e = enq.rows[0];
console.log(`\n━━━ Enquiry ${e.id} ━━━`);
console.log(`  ${[e.first_name, e.last_name].filter(Boolean).join(' ') || '—'} · ${e.email || '—'} · ${e.phone || '—'}`);
console.log(`  status=${e.status} · score=${e.lead_score}`);
console.log(`  submitted ${e.created_at.toISOString()}`);

let an = await c.query(
  `SELECT id, created_at, review_required, review_reasons,
          annual_kwh, annual_spend_nzd, months_covered, bills_uploaded,
          retailer, region, region_resolved_from,
          recommended_system_kw, recommended_battery_kwh, recommended_package_slug, email
   FROM bill_analyses
   WHERE email = $1
   ORDER BY created_at DESC LIMIT 5`,
  [e.email]
);
if (!an.rows.length) {
  console.log(`\n(no analyses by email — searching by created_at window ±2h of enquiry submit)`);
  const t0 = new Date(new Date(e.created_at).getTime() - 2*60*60*1000).toISOString();
  const t1 = new Date(new Date(e.created_at).getTime() + 2*60*60*1000).toISOString();
  an = await c.query(
    `SELECT id, created_at, review_required, review_reasons,
            annual_kwh, annual_spend_nzd, months_covered, bills_uploaded,
            retailer, region, region_resolved_from,
            recommended_system_kw, recommended_battery_kwh, recommended_package_slug, email
     FROM bill_analyses
     WHERE created_at BETWEEN $1 AND $2
     ORDER BY created_at DESC LIMIT 10`,
    [t0, t1]
  );
}
console.log(`\n━━━ Bill analyses (${an.rows.length}) ━━━`);
for (const a of an.rows) {
  console.log(`\n  Analysis ${a.id.slice(0,8)} · ${a.created_at.toISOString()} · email=${a.email || '—'}`);
  console.log(`    review_required: ${a.review_required}`);
  console.log(`    aggregate: ${a.annual_kwh || '—'} kWh/yr · ${a.annual_spend_nzd ? '$' + a.annual_spend_nzd : '—'} · ${a.months_covered || '?'} months · ${a.bills_uploaded || '?'} bills`);
  console.log(`    retailer: ${a.retailer || '—'} · region: ${a.region || '—'} (from ${a.region_resolved_from || '—'})`);
  console.log(`    recommended: ${a.recommended_system_kw || '?'}kW + ${a.recommended_battery_kwh || 0}kWh battery → ${a.recommended_package_slug || '—'}`);
  if (Array.isArray(a.review_reasons) && a.review_reasons.length) {
    console.log(`    reasons:`);
    for (const r of a.review_reasons) {
      console.log(`      [${r.severity}] ${r.code} — ${r.message || r.reason || ''}`);
    }
  }
}

const up = await c.query(
  `SELECT id, file_name, retailer, period_start, period_end,
          kwh_total, total_nzd, parse_method, parse_errors,
          service_address, network_distributor,
          field_confidence
   FROM bill_uploads WHERE analysis_id = ANY($1::uuid[]) ORDER BY created_at`,
  [an.rows.map(r => r.id)]
);
console.log(`\n━━━ Bill uploads (${up.rows.length}) ━━━`);
for (const u of up.rows) {
  console.log(`\n  ${u.file_name}`);
  console.log(`    retailer=${u.retailer || '—'} · period=${u.period_start || '?'}→${u.period_end || '?'} · kWh=${u.kwh_total || '—'} · total=$${u.total_nzd || '—'}`);
  console.log(`    parse_method=${u.parse_method || '—'} · network=${u.network_distributor || '—'}`);
  console.log(`    address=${(u.service_address || '—').slice(0, 80)}`);
  if (Array.isArray(u.parse_errors) && u.parse_errors.length) {
    console.log(`    parse_errors:`);
    for (const w of u.parse_errors) console.log(`      [${w.severity || 'warn'}] ${w.code || w} ${w.detail ? '— ' + w.detail : ''}`);
  }
  if (u.field_confidence) {
    const fc = u.field_confidence;
    const low = Object.entries(fc).filter(([_, v]) => typeof v === 'number' && v < 0.7);
    if (low.length) console.log(`    low-confidence fields: ${low.map(([k,v]) => `${k}=${(v*100).toFixed(0)}%`).join(', ')}`);
  }
}

await c.end();

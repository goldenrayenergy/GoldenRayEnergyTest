// One-off: find Abhilash Y's bills via multiple lookup paths.
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

// 1. Direct bill_uploads search by service address (most reliable)
console.log('━━━ Bills by service_address (31A Hillview) ━━━');
const directBills = await c.query(
  `SELECT id, analysis_id, service_address, period_start, period_end,
          days_in_period, kwh_total, kwh_peak, kwh_off_peak, kwh_exported,
          fixed_charge_nzd, variable_charge_nzd, export_credit_nzd, total_nzd,
          retailer, plan_name, icp_number, file_name, created_at
   FROM bill_uploads
   WHERE service_address ILIKE '%hillview%' OR service_address ILIKE '%31A%'
   ORDER BY period_start ASC NULLS LAST
   LIMIT 40`
);
console.log(`Matches: ${directBills.rows.length}`);
const analysisIds = new Set();
for (const b of directBills.rows) {
  analysisIds.add(b.analysis_id);
  console.log(`  ${b.period_start?.toISOString?.()?.slice(0,10) || '—'} → ${b.period_end?.toISOString?.()?.slice(0,10) || '—'} · ${b.days_in_period}d · ${b.kwh_total}kWh · $${b.total_nzd} · ${b.retailer || '—'} · "${b.service_address || '—'}"`);
}

// 2. Pull all analyses referenced by those bills
if (analysisIds.size > 0) {
  console.log('\n━━━ Related analyses ━━━');
  const a = await c.query(
    `SELECT id, contact_id, email, bills_uploaded, period_start, period_end, months_covered,
            annual_kwh, annual_spend_nzd, effective_rate_nzd, fixed_charge_total_nzd,
            variable_charge_total_nzd, retailer, region, postcode,
            recommended_system_kw, recommended_battery_kwh, recommended_package_slug,
            switch_recommended, switch_to_retailer, switch_annual_saving,
            review_required, review_reasons, created_at
     FROM bill_analyses WHERE id = ANY($1) ORDER BY created_at DESC`,
    [Array.from(analysisIds)]
  );
  for (const row of a.rows) {
    console.log(`\n  Analysis ${row.id.slice(0,8)} · ${row.email} · contact=${row.contact_id?.slice(0,8) || '—'}`);
    console.log(`    Period:          ${row.period_start?.toISOString?.()?.slice(0,10)} → ${row.period_end?.toISOString?.()?.slice(0,10)} (${row.months_covered} months · ${row.bills_uploaded} bills)`);
    console.log(`    Annual kWh:      ${row.annual_kwh}`);
    console.log(`    Annual spend:    $${row.annual_spend_nzd}`);
    console.log(`    Effective rate:  ${row.effective_rate_nzd} $/kWh`);
    console.log(`    Fixed total:     $${row.fixed_charge_total_nzd}`);
    console.log(`    Variable total:  $${row.variable_charge_total_nzd}`);
    console.log(`    Retailer/plan:   ${row.retailer} / —`);
    console.log(`    Region:          ${row.region} · postcode ${row.postcode}`);
    console.log(`    Recommended:     ${row.recommended_system_kw} kW + ${row.recommended_battery_kwh} kWh battery (${row.recommended_package_slug})`);
    console.log(`    Switch reco:     ${row.switch_recommended} → ${row.switch_to_retailer || '—'} (save $${row.switch_annual_saving || 0}/yr)`);
    console.log(`    Review reqd:     ${row.review_required ? 'YES — '+JSON.stringify(row.review_reasons) : 'no'}`);
  }
}

// 3. Also pull bills by Abhilash's enquiry email
console.log('\n━━━ Bills with analyses by email = grreddy.nz@gmail.com ━━━');
const baByEmail = await c.query(
  `SELECT id FROM bill_analyses WHERE email = 'grreddy.nz@gmail.com' ORDER BY created_at DESC LIMIT 20`
);
console.log(`Found ${baByEmail.rows.length} analyses for this email`);
for (const row of baByEmail.rows) {
  const bs = await c.query(
    `SELECT period_start, period_end, days_in_period, kwh_total, kwh_exported, total_nzd, retailer, service_address, file_name
     FROM bill_uploads WHERE analysis_id = $1 ORDER BY period_start ASC NULLS LAST`,
    [row.id]
  );
  console.log(`  Analysis ${row.id.slice(0,8)} → ${bs.rows.length} bills`);
  for (const b of bs.rows.slice(0,3)) {
    console.log(`    ${b.period_start?.toISOString?.()?.slice(0,10)} ${b.kwh_total}kWh · $${b.total_nzd} · ${b.retailer} · ${b.service_address || '—'} · ${b.file_name}`);
  }
}

await c.end();

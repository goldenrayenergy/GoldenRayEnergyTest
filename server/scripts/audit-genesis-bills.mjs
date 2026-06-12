// Before/after audit on every Genesis bill + bill_analysis in the system.
//
// Computes both the OLD (buggy) and NEW (fixed) derivations for each Genesis
// customer and shows the delta. Also runs sum-check validation
// (fixed + variable + gst ?= total) on every per-bill row to surface
// silent-failure issues.
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const GST = 1.15;
const F2 = n => Number(n).toFixed(2);
const F4 = n => Number(n).toFixed(4);

// 1. Every Genesis bill_analysis
const A = await client.query(`
  SELECT ba.id, ba.contact_id, c.name, c.email,
         ba.bills_uploaded, ba.months_covered,
         ba.annual_kwh, ba.annual_spend_nzd, ba.effective_rate_nzd,
         ba.fixed_charge_total_nzd, ba.variable_charge_total_nzd,
         ba.retailer, ba.plan_name, ba.region, ba.postcode,
         ba.created_at
    FROM bill_analyses ba
    LEFT JOIN contacts c ON c.id = ba.contact_id
   WHERE ba.retailer = 'Genesis'
   ORDER BY ba.created_at DESC`);

console.log(`\n════════════════════════════════════════════════════════════════════════════`);
console.log(`  GENESIS BILL_ANALYSES — BEFORE / AFTER RATE DERIVATION`);
console.log(`════════════════════════════════════════════════════════════════════════════`);
console.log(`  Found ${A.rows.length} Genesis analysis row(s).\n`);

let anyDrift = 0;
for (const a of A.rows) {
  const annualKwh = Number(a.annual_kwh) || 0;
  const variableTotal = Number(a.variable_charge_total_nzd) || 0;
  const fixedTotal = Number(a.fixed_charge_total_nzd) || 0;
  const months = a.months_covered || 12;
  const oldDays = months * 30.4375;

  // OLD derivation (what was in production before today)
  const oldVarRate = annualKwh > 0 ? variableTotal / annualKwh : null;
  const oldFixed   = oldDays > 0 ? fixedTotal / oldDays : null;

  // NEW derivation (after fix in routes/pm/contacts.js)
  const newVarRate = annualKwh > 0 ? variableTotal * GST / annualKwh : null;
  const newFixed   = fixedTotal * GST / 365;

  const varDriftPct = oldVarRate ? ((newVarRate - oldVarRate) / oldVarRate * 100) : 0;
  const fixDriftPct = oldFixed ? ((newFixed - oldFixed) / oldFixed * 100) : 0;
  if (Math.abs(varDriftPct) > 1 || Math.abs(fixDriftPct) > 1) anyDrift++;

  console.log(`──── ${a.name || '(no contact)'}  ${a.email || ''}`);
  console.log(`     analysis_id:  ${a.id}`);
  console.log(`     plan:         ${a.plan_name || '(unknown)'} · ${months}-month window · ${a.bills_uploaded} bills`);
  console.log(`     annual_kwh:   ${annualKwh}`);
  console.log(`     totals (annualized, ex-GST):  var=$${F2(variableTotal)}  fix=$${F2(fixedTotal)}`);
  console.log();
  console.log(`     OLD variable_rate_per_kwh_incl_gst: $${F4(oldVarRate)}/kWh   (÷${annualKwh.toFixed(0)} kWh, no GST)`);
  console.log(`     NEW variable_rate_per_kwh_incl_gst: $${F4(newVarRate)}/kWh   (÷${annualKwh.toFixed(0)} kWh, × 1.15 GST)   delta ${varDriftPct >= 0 ? '+' : ''}${varDriftPct.toFixed(1)}%`);
  console.log();
  console.log(`     OLD daily_fixed_charge_incl_gst:    $${F2(oldFixed)}/day    (÷ ${oldDays.toFixed(0)} days, no GST)`);
  console.log(`     NEW daily_fixed_charge_incl_gst:    $${F2(newFixed)}/day    (÷ 365 days, × 1.15 GST)   delta ${fixDriftPct >= 0 ? '+' : ''}${fixDriftPct.toFixed(1)}%`);
  console.log();
}

console.log(`════════════════════════════════════════════════════════════════════════════`);
console.log(`  ${anyDrift}/${A.rows.length} analyses show >1% drift between old and new derivation.`);
console.log(`════════════════════════════════════════════════════════════════════════════`);

// 2. Per-bill sum check on every Genesis bill_upload row
console.log(`\n\n════════════════════════════════════════════════════════════════════════════`);
console.log(`  GENESIS BILL_UPLOADS — PER-BILL SUM-CHECK (fixed + variable + gst ?= total)`);
console.log(`════════════════════════════════════════════════════════════════════════════\n`);

const U = await client.query(`
  SELECT bu.id, bu.analysis_id, bu.file_name, bu.period_start, bu.period_end,
         bu.days_in_period, bu.kwh_total,
         bu.fixed_charge_nzd, bu.variable_charge_nzd, bu.gst_nzd, bu.total_nzd,
         bu.parse_errors, bu.parse_warnings,
         c.name AS contact_name
    FROM bill_uploads bu
    LEFT JOIN bill_analyses ba ON ba.id = bu.analysis_id
    LEFT JOIN contacts c ON c.id = ba.contact_id
   WHERE bu.retailer = 'Genesis'
   ORDER BY bu.created_at DESC`);

console.log(`  Found ${U.rows.length} per-bill Genesis upload(s).\n`);

let goodSums = 0, badSums = 0, missingFields = 0;
for (const u of U.rows) {
  const fixed = Number(u.fixed_charge_nzd);
  const vari  = Number(u.variable_charge_nzd);
  const gst   = Number(u.gst_nzd);
  const tot   = Number(u.total_nzd);

  if ([fixed, vari, gst, tot].some(x => !isFinite(x))) {
    console.log(`  ⚠ MISSING FIELDS  ${u.contact_name || ''}  ${u.file_name?.slice(0, 40) || u.id}`);
    console.log(`                    fixed=${u.fixed_charge_nzd}  variable=${u.variable_charge_nzd}  gst=${u.gst_nzd}  total=${u.total_nzd}`);
    console.log(`                    parse_errors=${JSON.stringify(u.parse_errors)}`);
    missingFields++;
    continue;
  }
  const expected = fixed + vari + gst;
  const delta = tot - expected;
  const driftPct = Math.abs(delta / tot * 100);

  if (driftPct <= 1) {
    goodSums++;
  } else {
    console.log(`  ⚠ SUM CHECK FAIL  ${u.contact_name || ''}  ${u.file_name?.slice(0, 40) || u.id}`);
    console.log(`                    fixed=$${F2(fixed)} + var=$${F2(vari)} + gst=$${F2(gst)} = $${F2(expected)}   vs   total=$${F2(tot)}  (delta $${F2(delta)}, ${driftPct.toFixed(1)}%)`);
    badSums++;
  }
}
console.log(`\n  Result: ${goodSums} bills pass sum check, ${badSums} fail, ${missingFields} missing fields.`);

// 3. Address strand check — Genesis bills with service_address captured vs contacts with street
console.log(`\n\n════════════════════════════════════════════════════════════════════════════`);
console.log(`  ADDRESS WRITETHROUGH AUDIT — Genesis bills with addresses captured`);
console.log(`════════════════════════════════════════════════════════════════════════════\n`);

const ADDR = await client.query(`
  SELECT DISTINCT ON (ba.contact_id)
         ba.contact_id, c.name, c.street, c.suburb, c.city, c.postcode,
         bu.service_address, ba.postcode AS analysis_postcode
    FROM bill_analyses ba
    JOIN bill_uploads bu ON bu.analysis_id = ba.id
    LEFT JOIN contacts c ON c.id = ba.contact_id
   WHERE ba.retailer = 'Genesis'
     AND bu.service_address IS NOT NULL
     AND bu.service_address != ''
   ORDER BY ba.contact_id, ba.created_at DESC`);

let stranded = 0, written = 0;
for (const r of ADDR.rows) {
  const hasContactAddr = r.street || r.suburb || r.city || r.postcode;
  const tag = hasContactAddr ? '✓ written  ' : '⚠ stranded ';
  console.log(`  ${tag}  ${r.name || '(?)'}  parsed="${r.service_address}"  contact_addr=${[r.street, r.suburb, r.city, r.postcode].filter(Boolean).join(', ') || '(empty)'}`);
  hasContactAddr ? written++ : stranded++;
}
console.log(`\n  Result: ${written} addresses written to contact, ${stranded} stranded (parsed but never propagated).`);

await client.end();

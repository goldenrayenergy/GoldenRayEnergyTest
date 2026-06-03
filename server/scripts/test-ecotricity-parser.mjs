// Smoke runner for the new Ecotricity parser (Deploy #3 / Track 5).
//
// Runs the bill parser against all 12 real ECOT bills in
//   C:\Users\ram33\Downloads\bills\bills\ECOT_*\ECOT_*\*.pdf
// and prints the extracted fields + a sanity check on each.
//
// Sanity rules (per parser docstring):
//   • total_nzd MUST equal "Total Charges for this Period" (not "Total Amount Due")
//   • fixed + variable should be within ~5% of (total - GST) — the rest is rounding
//   • days_in_period should match a calendar month (28–31)
//   • kwh_total should equal peak + off_peak (TOU validator)
//
// Usage:  node server/scripts/test-ecotricity-parser.mjs

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { parseBillPdf } = await import('../services/billOcrService.js');

const DIR = 'C:/Users/ram33/Downloads/bills/bills/ECOT_262972_Feb2025_0001497928-_Solar_quotation_needed/ECOT_262972_Feb2025_0001497928- Solar quotation needed';

const files = (await fs.readdir(DIR)).filter(f => f.endsWith('.pdf')).sort();
console.log(`Parsing ${files.length} Ecotricity bills…\n`);

const pad = (s, w) => String(s ?? '—').padEnd(w);
const padR = (s, w) => String(s ?? '—').padStart(w);

console.log(pad('File', 38), pad('Period', 24), padR('Days', 4), padR('kWh', 7), padR('Peak', 6), padR('OffPk', 6), padR('Fixed', 7), padR('Variable', 8), padR('GST', 6), padR('Total', 8), 'Plan');
console.log('─'.repeat(180));

let totalParsed = 0, withTotal = 0, withDays = 0, withICP = 0, withAddr = 0, withDistr = 0;
const reviewFlags = [];

for (const f of files) {
  const buf = await fs.readFile(path.join(DIR, f));
  try {
    const parsed = await parseBillPdf(buf, { fileName: f });
    totalParsed++;
    if (parsed.total_nzd != null)        withTotal++;
    if (parsed.days_in_period != null)   withDays++;
    if (parsed.icp_number)               withICP++;
    if (parsed.service_address)          withAddr++;
    if (parsed.network_distributor)      withDistr++;

    console.log(
      pad(f.slice(0, 36), 38),
      pad(`${parsed.period_start ?? '?'}–${parsed.period_end ?? '?'}`, 24),
      padR(parsed.days_in_period, 4),
      padR(parsed.kwh_total != null ? parsed.kwh_total.toFixed(1) : '—', 7),
      padR(parsed.kwh_peak != null ? parsed.kwh_peak.toFixed(1) : '—', 6),
      padR(parsed.kwh_off_peak != null ? parsed.kwh_off_peak.toFixed(1) : '—', 6),
      padR(parsed.fixed_charge_nzd != null ? `$${parsed.fixed_charge_nzd}` : '—', 7),
      padR(parsed.variable_charge_nzd != null ? `$${parsed.variable_charge_nzd}` : '—', 8),
      padR(parsed.gst_nzd != null ? `$${parsed.gst_nzd}` : '—', 6),
      padR(parsed.total_nzd != null ? `$${parsed.total_nzd}` : '—', 8),
      parsed.plan_name || '—',
    );

    // ── Sanity checks ──
    const warnings = [];

    if (parsed.retailer !== 'Ecotricity') {
      warnings.push(`retailer detected as "${parsed.retailer}" not "Ecotricity"`);
    }
    if (parsed.total_nzd != null && parsed.gst_nzd != null && parsed.fixed_charge_nzd != null && parsed.variable_charge_nzd != null) {
      const subtotal = parsed.total_nzd - parsed.gst_nzd;
      const computed = parsed.fixed_charge_nzd + parsed.variable_charge_nzd;
      const diff = Math.abs(subtotal - computed);
      const pct = diff / subtotal;
      if (pct > 0.05) {
        warnings.push(`subtotal mismatch: total-GST=$${subtotal.toFixed(2)} vs fixed+variable=$${computed.toFixed(2)} (diff $${diff.toFixed(2)}, ${(pct*100).toFixed(1)}%)`);
      }
    }
    if (parsed.kwh_total != null && parsed.kwh_peak != null && parsed.kwh_off_peak != null) {
      const sumTou = parsed.kwh_peak + parsed.kwh_off_peak;
      const diff = Math.abs(sumTou - parsed.kwh_total);
      if (diff > 1) {
        warnings.push(`TOU mismatch: peak+offpeak=${sumTou.toFixed(2)} vs kwh_total=${parsed.kwh_total} (diff ${diff.toFixed(2)})`);
      }
    }
    if (parsed.days_in_period != null && (parsed.days_in_period < 27 || parsed.days_in_period > 35)) {
      warnings.push(`days_in_period ${parsed.days_in_period} outside normal monthly range`);
    }
    if (parsed.parse_warnings?.length) {
      warnings.push(`cross-field validators flagged: ${parsed.parse_warnings.map(w => w.code).join(', ')}`);
    }
    if (parsed.review_required) {
      warnings.push('review_required=true');
      reviewFlags.push(f);
    }

    if (warnings.length) {
      warnings.forEach(w => console.log(`     ⚠️  ${w}`));
    }
  } catch (e) {
    console.log(pad(f.slice(0, 36), 38), `ERROR: ${e.message}`);
  }
}

console.log('─'.repeat(180));
console.log(`\nSummary (${totalParsed} bills parsed):`);
console.log(`  total_nzd present:           ${withTotal}/${totalParsed}`);
console.log(`  days_in_period present:      ${withDays}/${totalParsed}`);
console.log(`  icp_number extracted:        ${withICP}/${totalParsed}`);
console.log(`  service_address extracted:   ${withAddr}/${totalParsed}`);
console.log(`  network_distributor:         ${withDistr}/${totalParsed}`);
console.log(`  review_required flagged:     ${reviewFlags.length}/${totalParsed}`);
if (reviewFlags.length) console.log(`    flagged: ${reviewFlags.join(', ')}`);

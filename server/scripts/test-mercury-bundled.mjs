// Regression test for the bundled Mercury bill (Krishna, 5071190360.pdf)
// where electricity + gas + mobile + broadband appear on one invoice.
//
// Before the section-scoping fix, the parser caught the page-1 summary line
// "Electricity $432.98" as the section header, so its electricity slice
// included pages 1-2 (the mobile section). The GST regex then matched the
// mobile GST credit of $16.96 instead of the real electricity GST $56.47.
//
// Expected values from the actual PDF:
//   kWh=1582, fixed=$70.08, variable=$306.43, GST=$56.47, total=$432.98
//   Net (fixed+variable)=$376.51, GST/net = 15.0% ✓

import { readFile } from 'node:fs/promises';
import { parseBillPdf } from '../services/billOcrService.js';

const path = 'C:/Users/ram33/Downloads/bills/bills/Krishna/Krishna/5071190360.pdf';
const buf = await readFile(path);
const result = await parseBillPdf(buf);

console.log(`\nParsed: ${path.split('/').pop()}`);
console.log(`  retailer        : ${result.retailer}`);
console.log(`  period          : ${result.period_start} → ${result.period_end}`);
console.log(`  kWh total       : ${result.kwh_total}`);
console.log(`  fixed_charge    : $${result.fixed_charge_nzd}`);
console.log(`  variable_charge : $${result.variable_charge_nzd}`);
console.log(`  GST             : $${result.gst_nzd}`);
console.log(`  total           : $${result.total_nzd}`);

const sum = (result.fixed_charge_nzd ?? 0) + (result.variable_charge_nzd ?? 0) + (result.gst_nzd ?? 0);
const total = result.total_nzd ?? 0;
const net = (result.fixed_charge_nzd ?? 0) + (result.variable_charge_nzd ?? 0);
const gstPct = net > 0 ? ((result.gst_nzd ?? 0) / net) * 100 : 0;

const ok = (label, cond, detail) => console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);

console.log('\nAssertions:');
ok('kWh = 1582',          result.kwh_total === 1582);
ok('fixed = $70.08',      Math.abs(result.fixed_charge_nzd - 70.08) < 0.01);
ok('variable = $306.43',  Math.abs(result.variable_charge_nzd - 306.43) < 0.01);
ok('GST = $56.47',        Math.abs((result.gst_nzd ?? 0) - 56.47) < 0.01, `got $${result.gst_nzd}`);
ok('total = $432.98',     Math.abs(result.total_nzd - 432.98) < 0.01);
ok('sum reconciles',      Math.abs(sum - total) < 0.5, `got sum=$${sum.toFixed(2)} vs total=$${total}`);
ok('GST is 15% of net',   Math.abs(gstPct - 15) < 0.5, `got ${gstPct.toFixed(1)}%`);

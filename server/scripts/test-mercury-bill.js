// Diagnostic — dump what the parser extracts from the user's actual bill PDF text.

import { parseBillText } from '../services/billOcrService.js';

const text = `
Tax Invoice 5074875709
GST Number 71-048-870
Tax Invoice Date 14 December 2025
Mercury

Hi there, here's your latest bill due 5 January 2026.
Opening balance $0.00
Current bill $300.04 includes GST of $39.13
Amount due $300.04

Current bill charges
Electricity $153.38
Gas $146.66

MR N & MRS N KHAN
150E TAYLOR STREET
BLOCKHOUSE BAY
AUCKLAND 0600
Your account number 170049841

OPENING BALANCE SUMMARY
Previous bill $354.07
11 Dec 2025 Payment Received - Thank You $354.07 credit
Opening balance total $0.00

ELECTRICITY
Location 150E TAYLOR STREET, BLOCKHOUSE BAY, AUCKLAND
ICP 1002179893LC490
Billing period 7 Nov 2025 - 4 Dec 2025
Next approximate read date 8 Jan 2026

Your total usage for the last 365 days is 3877 units (kWh).

CHARGE TYPE
Anytime 273 kWh x 20.96 cents $57.22
Daily Fixed Charge 28 Days x 272.00 cents $76.16
Subtotal $133.38
GST $20.00
ELECTRICITY TOTAL $153.38

Meter number  Previous reading  Latest reading  Multiplier  Units used
251717144     00008730 (actual) 00009003 (actual) 1         273 kWh

GAS
Location 150E TAYLOR STREET, BLOCKHOUSE BAY, AUCKLAND
ICP 1002179538QTDB2
Billing period 7 Nov 2025 - 4 Dec 2025
Next approximate read date 8 Jan 2026

Your total usage for the last 365 days is 7720 units (kWh).

CHARGE TYPE
Variable Usage Charge 550 kWh x 14.94 cents $82.17
Dual Fuel Discount 28 Days x -15.00 cents $4.20 credit
Daily Fixed Charge 28 Days x 177.00 cents $49.56
Subtotal $127.53
GST $19.13
GAS TOTAL $146.66
`;

const r = parseBillText(text, { fileName: 'MCYST_5074875709_1.pdf' });
console.log(JSON.stringify(r, null, 2));

// ── Multi-rate (price-change mid-period) regression test ──
// Reproduces the bug from the user's 13-bill batch: Mercury splits Anytime
// usage into two rows when a price change falls inside the billing period.
// Pre-fix the parser only captured the first row; post-fix it sums both.
const multiRateText = `
Mercury
Tax Invoice 5068933140 mercury.co.nz
ELECTRICITY
Billing period 28 Mar 2025 - 28 Apr 2025
Your total usage for the last 365 days is 9504 units (kWh).
CHARGE TYPE
Anytime 85 kWh x 19.90 cents $16.92
Anytime 593 kWh x 20.96 cents $124.29
Daily Fixed Charge 4 Days x 237.00 cents $9.48
Daily Fixed Charge 28 Days x 272.00 cents $76.16
Subtotal $221.83
GST $33.26
ELECTRICITY TOTAL $255.09
`;
const r2 = parseBillText(multiRateText, { fileName: 'multi-rate-regression.pdf' });
console.log('\n─── Multi-rate regression test ───');
const assertions = [
  ['kwh_total',           r2.kwh_total,           678,    'Should sum 85 + 593'],
  ['fixed_charge_nzd',    r2.fixed_charge_nzd,    85.64,  'Should sum 9.48 + 76.16'],
  ['variable_charge_nzd', r2.variable_charge_nzd, 141.21, 'Should sum 16.92 + 124.29'],
  ['annual_kwh_rolling',  r2.annual_kwh_rolling,  9504,   'Should read "365 days is 9504"'],
  ['parse_suspect',       r2.parse_suspect,       false,  'Numbers internally consistent — no warning'],
];
let pass = 0, fail = 0;
for (const [field, actual, expected, why] of assertions) {
  const ok = actual === expected;
  console.log(`  ${ok ? '✅' : '❌'}  ${field}: ${actual} (expected ${expected}) — ${why}`);
  ok ? pass++ : fail++;
}
console.log(`\nMulti-rate test: ${pass}/${pass+fail} passed`);
if (fail) process.exit(1);

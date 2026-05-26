// Unit test — Contact "Good Nights" dual-fuel (electricity + natural gas, TOU)
//
// Drives the Contact parser (via parseBillText) against synthesised text that
// matches the layout of 11 real customer bills. The PDFs themselves are not
// committed — the owner re-tests against the real PDFs locally.
//
// Run: node server/scripts/test-contact-good-nights-dual-fuel.js

import { parseBillText } from '../services/billOcrService.js';

// ──────────────────────────────────────────────────────────────────────────
// Bill text builders. Each function returns a synthesised text string that
// reproduces the layout pdf-parse would extract from a real Contact PDF.
// ──────────────────────────────────────────────────────────────────────────

// Standard single-rate bill (1 Daily Charge row, 1 peak row, 1 free row).
function singleRateBill(period, elec, gas, totalDue) {
  return `
Your bill for ${period.from} to ${period.to}
Tax Invoice/Statement
GST number 65 384 825
contact.co.nz/myaccount
Contact Energy

Mr A Haldankar
11A Revel Avenue, Mount Roskill, Auckland 1041

Previous activity                  Charges     Credits
Summary of Current activity        Charges     Credits
Electricity charges                $${elec.subtotal.toFixed(2)}
Natural gas charges                $${gas.subtotal.toFixed(2)}
GST                                $${(elec.subtotal * 0.15 + gas.subtotal * 0.15).toFixed(2)}
Total current charges              $${totalDue.toFixed(2)}
Total amount due - please pay      $${totalDue.toFixed(2)}

Energy used by 11A Revel Avenue, Mount Roskill, Auckland 1041

Electricity charges - installation connection point (ICP) 0127888020LC6D5 from ${period.from} to ${period.to} (${elec.days} days).
Daily Charge                ${elec.days} days @  ${elec.dailyRate.toFixed(3)} dollars per day      $${elec.fixed.toFixed(2)}
Charged: Midnight - 9pm   ${elec.peakKwh.toLocaleString()} kWh @  ${elec.peakRate.toFixed(3)} cents per kWh      $${elec.variable.toFixed(2)}
Free: 9pm - Midnight        ${elec.freeKwh} kWh @  0.000 cent per kWh          $0.00
                            Total Electricity charges                       $${elec.subtotal.toFixed(2)}

Natural gas charges - installation connection point (ICP) 0000154341QT268 from ${gas.from} to ${gas.to} (${gas.days} days).
Living Smart Daily Charge   ${gas.days} days @  1.848 dollars per day      $${gas.fixed.toFixed(2)}
Living Smart                ${gas.kwh} kWh @  8.710 cents per kWh           $${(gas.kwh * 0.0871).toFixed(2)}
Gas Industry Company Fees    ${gas.days} days @  2.820 cents per day          $0.85
                            Total Natural gas charges                       $${gas.subtotal.toFixed(2)}
`;
}

// Multi-rate bill (rate changed mid-period — 2 Daily Charge rows, 2 peak rows).
// Models bill2: 4 days @ old rate, 24 days @ new rate, with a "651 kWh"
// subtotal line between the peak entries that must be IGNORED by the kWh sum.
function multiRateBill(period, elec, gas, totalDue) {
  const elecSubtotal = elec.daily1.amount + elec.daily2.amount + elec.peak1.amount + elec.peak2.amount;
  return `
Your bill for ${period.from} to ${period.to}
Tax Invoice/Statement
contact.co.nz/myaccount
Contact Energy

Mr A Haldankar
11A Revel Avenue, Mount Roskill, Auckland 1041

Summary of Current activity        Charges     Credits
Electricity charges                $${elecSubtotal.toFixed(2)}
Natural gas charges                $${gas.subtotal.toFixed(2)}
Total amount due - please pay      $${totalDue.toFixed(2)}

Energy used by 11A Revel Avenue, Mount Roskill, Auckland 1041

Electricity charges - installation connection point (ICP) 0127888020LC6D5 from ${period.from} to ${period.to} (${elec.days} days).
Daily Charge                ${elec.daily1.days} days @  ${elec.daily1.rate.toFixed(3)} dollars per day      $${elec.daily1.amount.toFixed(2)}
Daily Charge               ${elec.daily2.days} days @  ${elec.daily2.rate.toFixed(3)} dollars per day      $${elec.daily2.amount.toFixed(2)}
Charged: Midnight - 9pm    ${elec.peak1.kwh} kWh @  ${elec.peak1.rate.toFixed(3)} cents per kWh    $${elec.peak1.amount.toFixed(2)}
Charged: Midnight - 9pm   ${elec.peak2.kwh} kWh @  ${elec.peak2.rate.toFixed(3)} cents per kWh   $${elec.peak2.amount.toFixed(2)}
                          ${elec.peak1.kwh + elec.peak2.kwh} kWh
Free: 9pm - Midnight      ${elec.freeKwh} kWh @  0.000 cent per kWh      $0.00
                          Total Electricity charges        $${elecSubtotal.toFixed(2)}

Natural gas charges - installation connection point (ICP) 0000154341QT268 from ${gas.from} to ${gas.to} (${gas.days} days).
Living Smart Daily Charge   ${gas.days} days @  ${gas.dailyRate?.toFixed(3) ?? '1.848'} dollars per day      $${gas.fixed.toFixed(2)}
Living Smart                ${gas.kwh} kWh @  8.710 cents per kWh           $${(gas.kwh * 0.0871).toFixed(2)}
                            Total Natural gas charges                       $${gas.subtotal.toFixed(2)}
`;
}

// ──────────────────────────────────────────────────────────────────────────
// Fixtures — numbers transcribed from the real PDFs the customer uses.
// Each row's expected.total_nzd = (fixed + variable) × 1.15 (GST-incl).
// ──────────────────────────────────────────────────────────────────────────

const FIXTURES = [
  {
    label: 'bill2 — Nov-Dec 2025 · mid-period rate change',
    text: multiRateBill(
      { from: '25 Nov 2025', to: '24 Dec 2025' },
      {
        days: 28,
        daily1: { days:  4, rate: 2.738, amount: 10.95 },
        daily2: { days: 24, rate: 2.985, amount: 71.64 },
        peak1:  { kwh:  92, rate: 26.000, amount: 23.92 },
        peak2:  { kwh: 559, rate: 28.400, amount: 158.76 },
        freeKwh: 150,
      },
      { days: 30, from: '25 Nov 25', to: '24 Dec 25', kwh: 55, fixed: 64.32, subtotal: 70.75, dailyRate: 2.218 },
      386.42
    ),
    expect: {
      retailer:            'Contact Energy',
      kwh_total:           801,                 // 92 + 559 + 150 (subtotal "651 kWh" line ignored)
      kwh_peak:            651,
      kwh_off_peak:        150,
      fixed_charge_nzd:    82.59,               // 10.95 + 71.64 — multi-rate sum
      variable_charge_nzd: 182.68,              // 23.92 + 158.76 = 265.27 - 82.59
      total_nzd:           305.06,              // 265.27 × 1.15
      gst_nzd:             39.79,
    },
  },
  {
    label: 'bill3 — Jan-Feb 2026 · single-rate (new tariff)',
    text: singleRateBill(
      { from: '24 Jan 2026', to: '27 Feb 2026' },
      { days: 31, dailyRate: 2.985, fixed: 92.54, peakKwh: 659, peakRate: 28.400, variable: 187.16, freeKwh: 212, subtotal: 279.70 },
      { days: 34, from: '24 Jan 26', to: '26 Feb 26', kwh: 66, fixed: 75.41, subtotal: 83.30 },
      417.46
    ),
    expect: { kwh_total: 871, kwh_peak: 659, kwh_off_peak: 212, fixed_charge_nzd: 92.54, variable_charge_nzd: 187.16, total_nzd: 321.66, gst_nzd: 41.96 },
  },
  {
    label: 'bill4 — Apr-May 2025',
    text: singleRateBill(
      { from: '25 Apr 2025', to: '27 May 2025' },
      { days: 32, dailyRate: 2.738, fixed: 87.62, peakKwh: 979, peakRate: 26.000, variable: 254.54, freeKwh: 267, subtotal: 342.16 },
      { days: 33, from: '25 Apr 25', to: '27 May 25', kwh: 79, fixed: 60.98, subtotal: 68.80 },
      472.60
    ),
    expect: { kwh_total: 1246, kwh_peak: 979, kwh_off_peak: 267, fixed_charge_nzd: 87.62, variable_charge_nzd: 254.54, total_nzd: 393.48, gst_nzd: 51.32 },
  },
  {
    label: 'bill5 — Feb-Mar 2026 · final bill, new tariff',
    text: singleRateBill(
      { from: '27 Feb 2026', to: '24 Mar 2026' },
      { days: 23, dailyRate: 2.985, fixed: 68.66, peakKwh: 491, peakRate: 28.400, variable: 139.44, freeKwh: 144, subtotal: 208.10 },
      { days: 26, from: '27 Feb 26', to: '24 Mar 26', kwh: 55, fixed: 57.67, subtotal: 64.19 },
      313.14
    ),
    expect: { kwh_total: 635, kwh_peak: 491, kwh_off_peak: 144, fixed_charge_nzd: 68.66, variable_charge_nzd: 139.44, total_nzd: 239.32, gst_nzd: 31.22 },
  },
  {
    label: 'bill6 — Jun-Jul 2025',
    text: singleRateBill(
      { from: '27 Jun 2025', to: '28 Jul 2025' },
      { days: 29, dailyRate: 2.738, fixed: 79.40, peakKwh: 1234, peakRate: 26.000, variable: 320.84, freeKwh: 301, subtotal: 400.24 },
      { days: 31, from: '28 Jun 25', to: '28 Jul 25', kwh: 68, fixed: 57.29, subtotal: 64.09 },
      533.98
    ),
    expect: { kwh_total: 1535, kwh_peak: 1234, kwh_off_peak: 301, fixed_charge_nzd: 79.40, variable_charge_nzd: 320.84, total_nzd: 460.28, gst_nzd: 60.04 },
  },
  {
    label: 'bill7 — Oct-Nov 2025',
    text: singleRateBill(
      { from: '25 Oct 2025', to: '26 Nov 2025' },
      { days: 33, dailyRate: 2.738, fixed: 90.35, peakKwh: 710, peakRate: 26.000, variable: 184.60, freeKwh: 225, subtotal: 274.95 },
      { days: 31, from: '25 Oct 25', to: '24 Nov 25', kwh: 67, fixed: 57.29, subtotal: 64.00 },
      389.79
    ),
    expect: { kwh_total: 935, kwh_peak: 710, kwh_off_peak: 225, fixed_charge_nzd: 90.35, variable_charge_nzd: 184.60, total_nzd: 316.19, gst_nzd: 41.24 },
  },
  {
    label: 'bill8 — Dec-Jan 2026 · post-tariff-bump',
    text: singleRateBill(
      { from: '25 Dec 2025', to: '27 Jan 2026' },
      { days: 34, dailyRate: 2.985, fixed: 101.49, peakKwh: 608, peakRate: 28.400, variable: 172.67, freeKwh: 170, subtotal: 274.16 },
      { days: 30, from: '25 Dec 25', to: '23 Jan 26', kwh: 33, fixed: 66.54, subtotal: 70.86 },
      396.77
    ),
    expect: { kwh_total: 778, kwh_peak: 608, kwh_off_peak: 170, fixed_charge_nzd: 101.49, variable_charge_nzd: 172.67, total_nzd: 315.28, gst_nzd: 41.12 },
  },
  {
    label: 'bill9 — May-Jun 2025 · 3-page bill',
    text: singleRateBill(
      { from: '27 May 2025', to: '27 Jun 2025' },
      { days: 31, dailyRate: 2.738, fixed: 84.88, peakKwh: 1204, peakRate: 26.000, variable: 313.04, freeKwh: 290, subtotal: 397.92 },
      { days: 31, from: '28 May 25', to: '27 Jun 25', kwh: 45, fixed: 57.29, subtotal: 62.09 },
      528.61
    ),
    expect: { kwh_total: 1494, kwh_peak: 1204, kwh_off_peak: 290, fixed_charge_nzd: 84.88, variable_charge_nzd: 313.04, total_nzd: 457.61, gst_nzd: 59.69 },
  },
  {
    label: 'bill10 — Aug-Sep 2025',
    text: singleRateBill(
      { from: '26 Aug 2025', to: '26 Sep 2025' },
      { days: 31, dailyRate: 2.738, fixed: 84.88, peakKwh: 978, peakRate: 26.000, variable: 254.28, freeKwh: 404, subtotal: 339.16 },
      { days: 30, from: '26 Aug 25', to: '24 Sep 25', kwh: 79, fixed: 55.44, subtotal: 63.17 },
      462.68
    ),
    expect: { kwh_total: 1382, kwh_peak: 978, kwh_off_peak: 404, fixed_charge_nzd: 84.88, variable_charge_nzd: 254.28, total_nzd: 390.03, gst_nzd: 50.87 },
  },
  {
    label: 'bill11 — Jul-Aug 2025',
    text: singleRateBill(
      { from: '26 Jul 2025', to: '26 Aug 2025' },
      { days: 32, dailyRate: 2.738, fixed: 87.62, peakKwh: 1530, peakRate: 26.000, variable: 397.80, freeKwh: 376, subtotal: 485.42 },
      { days: 28, from: '29 Jul 25', to: '25 Aug 25', kwh: 45, fixed: 51.74, subtotal: 56.46 },
      623.16
    ),
    expect: { kwh_total: 1906, kwh_peak: 1530, kwh_off_peak: 376, fixed_charge_nzd: 87.62, variable_charge_nzd: 397.80, total_nzd: 558.23, gst_nzd: 72.81 },
  },
  {
    label: 'Sep-Oct 2025',
    text: singleRateBill(
      { from: '25 Sep 2025', to: '24 Oct 2025' },
      { days: 28, dailyRate: 2.738, fixed: 76.66, peakKwh: 564, peakRate: 26.000, variable: 146.64, freeKwh: 293, subtotal: 223.30 },
      { days: 30, from: '25 Sep 25', to: '24 Oct 25', kwh: 45, fixed: 55.44, subtotal: 60.21 },
      326.04
    ),
    expect: { kwh_total: 857, kwh_peak: 564, kwh_off_peak: 293, fixed_charge_nzd: 76.66, variable_charge_nzd: 146.64, total_nzd: 256.80, gst_nzd: 33.50 },
  },
];

// ── Runner ────────────────────────────────────────────────────────────────
let total = 0, passed = 0, failed = 0;
const failures = [];

function check(label, field, actual, expected) {
  total++;
  const tol = 0.03;
  const ok = (typeof expected === 'number' && typeof actual === 'number')
    ? Math.abs(actual - expected) <= tol
    : actual === expected;
  const av = actual == null ? 'null' : (typeof actual === 'number' ? actual.toFixed(2) : String(actual));
  const ev = typeof expected === 'number' ? expected.toFixed(2) : String(expected);
  const mark = ok ? '✅' : '❌';
  console.log(`  ${mark} ${field.padEnd(22)} actual=${av.padEnd(14)} expected=${ev}`);
  if (ok) passed++; else { failed++; failures.push(`${label} · ${field}: got ${av}, expected ${ev}`); }
}

for (const f of FIXTURES) {
  console.log(`\n─── ${f.label} ───`);
  const out = parseBillText(f.text);
  check(f.label, 'retailer', out.retailer, 'Contact Energy');
  for (const [k, v] of Object.entries(f.expect)) check(f.label, k, out[k], v);
  if (out.parse_errors?.length) console.log(`  ⚠️  parse_errors:`, out.parse_errors);
}

console.log(`\n═══ Summary ═══`);
console.log(`Total assertions: ${total}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  ' + f));
}
process.exit(failed === 0 ? 0 : 1);

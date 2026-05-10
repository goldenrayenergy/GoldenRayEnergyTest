// Test bill parsing against synthetic text fragments that mimic what
// pdf-parse extracts from real NZ retailer bills. Real PDFs vary in
// exact wording — this is a sanity check on the regex patterns.

import { parseBillText } from '../services/billOcrService.js';

const SAMPLES = [
  {
    label: 'Mercury bill (Auckland, July)',
    expectRetailer: 'Mercury',
    text: `
      Mercury NZ Limited
      Account: 12345678
      Homeline Standard

      Billing Period: 1 Jul 2025 to 31 Jul 2025

      Energy charges
        Anytime usage     1,940 kWh @ 28.9c    $560.66

      Daily fixed charge   31 days @ $1.40     $43.40

      GST (15%)                                 $90.61

      Total amount due                         $694.67
    `,
  },
  {
    label: 'Genesis bill',
    expectRetailer: 'Genesis',
    text: `
      Genesis Energy
      genesisenergy.co.nz

      Go Standard plan

      Reading period: 1 Jun 2025 to 30 Jun 2025

      Total electricity used: 1,750 kWh

      Anytime rate                $507.00
      Daily charge                $43.50
      GST (15%)                   $82.58

      Amount due                  $632.50
    `,
  },
  {
    label: 'Contact Energy bill',
    expectRetailer: 'Contact Energy',
    text: `
      Contact Energy
      contactenergy.co.nz

      Standard User plan

      Period: 1 May 2025 - 31 May 2025

      Anytime    1,400 kWh

      Daily fixed fee  $43.40
      GST (15%)        $55.32
      Total to pay     $424.12
    `,
  },
  {
    label: 'Meridian Energy bill',
    expectRetailer: 'Meridian Energy',
    text: `
      Meridian Energy
      meridianenergy.co.nz

      Certainty plan

      1 Jun 2025 to 30 Jun 2025

      Total kWh: 1,706
      Daily fixed charge: $42.00

      Total this bill: $497.55
    `,
  },
  {
    label: 'Powershop bill',
    expectRetailer: 'Powershop',
    text: `
      Powershop NZ
      Period: 1 Apr 2025 - 30 Apr 2025

      1,115 kWh used

      Bill total: $341.74
    `,
  },
  {
    label: 'Unknown retailer (Trustpower style)',
    expectRetailer: 'Unknown',
    text: `
      Trustpower Limited
      Reading: 1 Jul 2025 to 31 Jul 2025

      Electricity used   1500 kWh

      $445.20 due
    `,
  },
  {
    label: 'Image-based / empty PDF',
    expectRetailer: null,
    text: '',
  },
  {
    label: 'Pulse Energy bill (Standard User, dual meter)',
    expectRetailer: 'Pulse Energy',
    text: `
      Pulse Energy Alliance LP
      pulseenergy.co.nz

      Pulse Energy Standard User Counties Power

      For the period from 27/12/2025 to 24/01/2026

      Meter Number: CN28726/1
      kWh this period: 995
      Meter Number: CN28726/2
      kWh this period: 375

      Energy
      Energy Rate - Uncontrolled Electricity   995 kWh   20.917   $208.12
      Energy Rate - Controlled Electricity     375 kWh   20.917   $78.44
      Total Energy   $286.56

      Delivery
      Metering                       29 Days   38.000   $11.02
      Network Services Fixed Daily   29 Days  200.000   $58.00
      Retailer Services              29 Days   82.000   $23.78
      Total Delivery   $204.87

      GST at 15%   $73.72
      Current Electricity Charges (including GST)   $565.15
    `,
  },
  {
    label: 'Contact Energy TOU + free off-peak (with broadband bundle)',
    expectRetailer: 'Contact Energy',
    text: `
      contact.co.nz/myaccount

      Your bill for 31 Dec 2025 to 30 Jan 2026

      Summary
      Fixed daily charges $91.45
      Variable charges $63.58
      Broadband charges $95.65
      GST $37.60
      Total amount due $288.28

      Energy used by 58B Commodore Drive
      Fixed daily charges
      Daily Charge 31 days @ 2.950 dollars per day $91.45
      Fixed charges total $91.45

      Variable charges
      Charged: Midnight - 9pm 220 kWh @ 28.900 cents per kWh $63.58
      Free: 9pm - Midnight 69 kWh @ 0.000 cent per kWh $0.00
      Variable charges total $63.58

      Broadband charges
      Max Fibre $95.65
    `,
  },
  {
    label: 'Genesis Capricorn commercial (post-discount total)',
    expectRetailer: 'Genesis',
    text: `
      Genesis Energy Limited
      genesisenergy.co.nz

      Plus Standard plan

      Covers the 30 day period from 02 Feb 2026 to 3 Mar 2026

      A Current Electricity Usage
      Plus Standard Anytime 251409757 35564 37023 Actual 1459 @ 23.5200 c/unit 343.16
      Plus Standard Daily Fixed 30 days @ 267.4900 c/day 80.25
      Sub Total 423.41
      GST 63.51
      Total Charges 486.92
      eBill Discount Elec 1% 4.86cr
      Dual Fuel Discount Elec 5% 24.35cr
      Fixed Term Discount Elec 3% 14.60cr
      Total Discounts 9% (incl GST of 5.71 cr) 43.81 cr
      TOTAL CURRENT ELECTRICITY CHARGES (INCL GST & DISCOUNTS) $ 443.11

      I Current Bottled Gas Usage
      Monthly Gas Bottle Rental 2 6.00 $/bottle 12.00
    `,
  },
  {
    label: 'Mercury bill with TOU and solar export',
    expectRetailer: 'Mercury',
    text: `
      Mercury NZ
      Anytime plan

      Period: 1 Aug 2025 to 31 Aug 2025

      Energy charges 1,200 kWh @ 28.9c   $346.80

      Solar export credit  450 kWh   $36.00

      Daily fixed charge 31 days   $43.40
      GST (15%)                   $52.53
      Total amount due            $396.73
    `,
  },
];

function fmt$(n) { return n == null ? '—' : '$' + n.toFixed(2); }
function pad(s, len) { s = String(s); return s + ' '.repeat(Math.max(0, len - s.length)); }

console.log('\n' + '═'.repeat(110));
console.log(' BILL OCR PARSER — SAMPLE BILL STRESS TEST');
console.log('═'.repeat(110));

for (const sample of SAMPLES) {
  console.log('\n● ' + sample.label);
  const result = parseBillText(sample.text);
  const retailerOk = !sample.expectRetailer || result.retailer === sample.expectRetailer;

  console.log('  Retailer detected: ' + (retailerOk ? '✓ ' : '✗ ') + result.retailer + (sample.expectRetailer ? ` (expected: ${sample.expectRetailer})` : ''));
  console.log('  Confidence:        ' + (result.ocr_confidence * 100).toFixed(0) + '%');
  console.log('  Plan:              ' + (result.plan_name || '—'));
  console.log('  Period:            ' + (result.period_start || '—') + ' → ' + (result.period_end || '—') + ' (' + (result.days_in_period || '—') + ' days)');
  console.log('  kWh total:         ' + (result.kwh_total ?? '—'));
  console.log('  Fixed charge:      ' + fmt$(result.fixed_charge_nzd));
  console.log('  Variable charge:   ' + fmt$(result.variable_charge_nzd));
  console.log('  GST:               ' + fmt$(result.gst_nzd));
  console.log('  Total:             ' + fmt$(result.total_nzd));
  if (result.kwh_exported != null) {
    console.log('  Solar export:      ' + result.kwh_exported + ' kWh / ' + fmt$(result.export_credit_nzd));
  }
  if (result.parse_errors.length) {
    console.log('  Parse warnings:');
    for (const e of result.parse_errors) console.log('    - [' + e.field + '] ' + e.reason);
  }
}

console.log('\n' + '═'.repeat(110));
console.log(' Note: real bills have varying layouts — these patterns will need tuning as customer');
console.log(' bills come in. Each retailer parser lives in billOcrService.js as a small object that');
console.log(' can be extended with new regex patterns without affecting the others.');
console.log('═'.repeat(110));

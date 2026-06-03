// Sanity-tests the v2 changes to billOcrService + billAnalysisService.
// Run from server/ with: node scripts/test-bill-v2-sanity.mjs

import { parseBillText } from '../services/billOcrService.js';
import { analyzeBills, regionFromPostcode, resolveRegion, computeReviewGate } from '../services/billAnalysisService.js';

console.log('=== Test 1: clean bill — no validators should fire ===');
const cleanText = `
Mercury NZ Limited
Account: 12345678
Service Address: 42 Queen Street, Newmarket, Auckland 1023
ICP Number: 0000123456AB12
Vector Limited (network distributor)
Homeline Standard

Billing Period: 1 Jul 2025 to 31 Jul 2025

Energy charges
  Anytime usage     1,940 kWh @ 28.9c    $560.66

Daily fixed charge   31 days @ $1.40     $43.40

GST (15%)                                 $90.61

Total amount due                         $694.67
`;
const r1 = parseBillText(cleanText);
console.log('  retailer:           ', r1.retailer);
console.log('  service_address:    ', r1.service_address);
console.log('  service_postcode:   ', r1.service_postcode);
console.log('  icp_number:         ', r1.icp_number);
console.log('  network_distributor:', r1.network_distributor);
console.log('  ocr_confidence:     ', r1.ocr_confidence);
console.log('  field_confidence:   ', JSON.stringify(r1.field_confidence));
console.log('  parse_warnings:     ', r1.parse_warnings.map(w => w.code));
console.log('  parse_suspect:      ', r1.parse_suspect);

console.log('\n=== Test 2: bill with wrong GST — gst_not_15pct validator ===');
const badGstText = cleanText.replace('$90.61', '$45.00');
const r2 = parseBillText(badGstText);
const gstWarn = r2.parse_warnings.find(w => w.code === 'gst_not_15pct');
console.log('  gst_not_15pct fired:', !!gstWarn);
if (gstWarn) console.log('  reason:', gstWarn.reason);

console.log('\n=== Test 3: line items dont sum — line_items_dont_sum validator ===');
const badSumText = cleanText.replace('Total amount due             $694.67', 'Total amount due             $1000.00');
const r3 = parseBillText(badSumText);
const sumWarn = r3.parse_warnings.find(w => w.code === 'line_items_dont_sum');
console.log('  line_items_dont_sum fired:', !!sumWarn);
if (sumWarn) console.log('  reason:', sumWarn.reason);

console.log('\n=== Test 4: end_before_start validator ===');
const badDatesText = cleanText.replace('1 Jul 2025 to 31 Jul 2025', '31 Jul 2025 to 1 Jul 2025');
const r4 = parseBillText(badDatesText);
const dateWarn = r4.parse_warnings.find(w => w.code === 'end_before_start');
console.log('  end_before_start fired:', !!dateWarn);

console.log('\n=== Test 5: postcode→region resolver ===');
console.log('  1023 (Auckland):    ', regionFromPostcode('1023'));
console.log('  6011 (Wellington):  ', regionFromPostcode('6011'));
console.log('  8024 (Christchurch):', regionFromPostcode('8024'));
console.log('  9300 (Dunedin):     ', regionFromPostcode('9300'));
console.log('  3200 (Hamilton):    ', regionFromPostcode('3200'));
console.log('  4112 (Hawkes Bay):  ', regionFromPostcode('4112'));
console.log('  9810 (Southland):   ', regionFromPostcode('9810'));
console.log('  invalid "abc":      ', regionFromPostcode('abc'));

console.log('\n=== Test 6: resolveRegion with bills ===');
const billsInWgtn = [{ ...r1, service_postcode: '6011' }];
console.log('  Wellington bill:   ', resolveRegion({ bills: billsInWgtn }));
console.log('  No bills:          ', resolveRegion({ bills: [] }));

console.log('\n=== Test 7: review gate — clean bill, should NOT require review ===');
const agg7 = { months_covered: 12, annual_kwh: 12000, annual_spend_nzd: 3500 };
const gate7 = computeReviewGate({ bills: [r1], aggregate: agg7, recommendation: {}, regionInfo: resolveRegion({ bills: [r1] }) });
console.log('  review_required:  ', gate7.review_required);
console.log('  reasons:          ', gate7.review_reasons.map(r => r.code));
console.log('  overall_field_conf:', gate7.overall_field_confidence);

console.log('\n=== Test 8: review gate — suspect bill (bad sum), SHOULD require review ===');
const gate8 = computeReviewGate({ bills: [r3], aggregate: agg7, recommendation: {}, regionInfo: resolveRegion({ bills: [r3] }) });
console.log('  review_required:', gate8.review_required);
console.log('  reason codes:   ', gate8.review_reasons.map(r => `${r.code}(${r.severity})`));

console.log('\n=== Test 9: review gate — bills from 2 different addresses ===');
const mixed = [
  { ...r1, service_address: '42 Queen St, Auckland 1023', service_postcode: '1023' },
  { ...r1, service_address: '99 Lambton Quay, Wellington 6011', service_postcode: '6011' },
];
const gate9 = computeReviewGate({ bills: mixed, aggregate: agg7, recommendation: {}, regionInfo: resolveRegion({ bills: mixed }) });
console.log('  review_required:', gate9.review_required);
console.log('  reasons:        ', gate9.review_reasons.map(r => `${r.code}(${r.severity})`));

console.log('\n=== Test 10: full analyzeBills end-to-end with new fields ===');
const out = analyzeBills({
  bills: [{
    ...r1,
    kwh_total: 1940, total_nzd: 694.67, days_in_period: 31,
    period_start: '2025-07-01', period_end: '2025-07-31',
    service_postcode: '1023',
  }],
});
console.log('  region:               ', out.region);
console.log('  region_resolved_from: ', out.region_resolved_from);
console.log('  region_postcode:      ', out.region_postcode);
console.log('  review_required:      ', out.review_required);
console.log('  review_reasons:       ', out.review_reasons.map(r => r.code));
console.log('  overall_field_conf:   ', out.overall_field_confidence);
console.log('  recommended_kw:       ', out.recommendation.recommended_system_kw);

console.log('\n=== Test 11: analyzeBills with Wellington bill — should use Wellington irradiance ===');
const wgtnOut = analyzeBills({
  bills: [{
    ...r1,
    kwh_total: 1500, total_nzd: 500, days_in_period: 31,
    period_start: '2025-07-01', period_end: '2025-07-31',
    service_postcode: '6011',
  }],
});
console.log('  region:               ', wgtnOut.region, '(expected: wellington)');
console.log('  region_resolved_from: ', wgtnOut.region_resolved_from);

console.log('\nAll tests complete.');

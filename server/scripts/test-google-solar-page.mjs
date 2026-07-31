// ────────────────────────────────────────────────────────────────────────────
// test-google-solar-page.mjs
//
// Unit tests for the customer-facing proposal page:
//   server/services/pm/proposalEngine/htmlTemplates/pages/siteAnalysis.js
//
// Verifies the page's drop-out behaviour (returns '' when data missing or
// status != 'ok') and its rendered content when status = 'ok'.
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import { pageSiteAnalysis } from '../services/pm/proposalEngine/htmlTemplates/pages/siteAnalysis.js';

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}

console.log('test-google-solar-page\n');

// Minimal `d` shape the page reads from. Includes fields pageHead and
// pageFoot dereference (surname / consultant / logo_data_uri) so the
// page renders end-to-end without crashing.
function mkD(roofAnalysis) {
  return {
    meta: {
      quote_ref: 'PR-TEST-2026-001',
      quote_date: '31 July 2026',
      logo_data_uri: null,  // brandMark falls back to text "G" logo
      consultant: {
        name:   'Test Consultant',
        phone:  '+64 21 000 0000',
        office: 'Auckland',
        email:  'test@goldenrayenergy.nz',
      },
    },
    customer: {
      name:             'Test Customer',
      surname:          'Customer',
      address_one_line: '1 Queen St, Auckland',
      icp:              '1000123',
    },
    roof_analysis: roofAnalysis,
  };
}

// ── Drop-out cases: page returns '' when data absent or wrong status ───────
{
  assert('null roof_analysis → ""',   pageSiteAnalysis(mkD(null), 1, 5) === '');
  assert('undef roof_analysis → ""',  pageSiteAnalysis(mkD(undefined), 1, 5) === '');
  assert('status=pending → ""',       pageSiteAnalysis(mkD({ status: 'pending' }), 1, 5) === '');
  assert('status=failed → ""',        pageSiteAnalysis(mkD({ status: 'failed', error_message: 'x' }), 1, 5) === '');
  assert('status=skipped_flag → ""',  pageSiteAnalysis(mkD({ status: 'skipped_flag' }), 1, 5) === '');
  assert('status=skipped_quota → ""', pageSiteAnalysis(mkD({ status: 'skipped_quota' }), 1, 5) === '');
}

// ── Happy path: status=ok with full data renders expected content ──────────
{
  const okAnalysis = {
    status: 'ok',
    imagery_quality: 'HIGH',
    imagery_date: '2024-05-15',
    max_array_area_m2: 82.4,
    max_array_panels_count: 42,
    max_sunshine_hours_per_year: 1650.5,
    roof_segments: [
      { pitchDegrees: 22.3, azimuthDegrees: 0,   stats: { areaMeters2: 41.2 } },
      { pitchDegrees: 22.3, azimuthDegrees: 180, stats: { areaMeters2: 30.0 } },
    ],
  };
  const html = pageSiteAnalysis(mkD(okAnalysis), 3, 12);
  assert('happy path returns non-empty', html.length > 0);
  assert('renders "roof assessment" heading', /roof assessment/i.test(html));
  assert('renders panel count 42', html.includes('>42<'));
  assert('renders area 82.4', html.includes('82.4'));
  assert('renders sunshine hours rounded (1651)', html.includes('>1651<'));
  assert('renders segment count 2', html.includes('>2<'));
  assert('quality translated to "high-resolution"', html.includes('high-resolution'));
  assert('best segment N compass', html.includes('<b>N</b>'));
  assert('section num rendered', html.includes('3'));      // sectionNum
  assert('sections total rendered', html.includes('12'));  // sectionsTotal
  assert('customer name in customer-strip', html.includes('Test Customer'));
  assert('quote ref in customer-strip', html.includes('PR-TEST-2026-001'));
}

// ── Sparse data: missing optional fields still render with fallbacks ──────
{
  const sparse = {
    status: 'ok',
    // all optional fields null / undefined
    imagery_quality: 'LOW',
    imagery_date: null,
    max_array_area_m2: null,
    max_array_panels_count: null,
    max_sunshine_hours_per_year: null,
    roof_segments: [],
  };
  const html = pageSiteAnalysis(mkD(sparse), 1, 5);
  assert('sparse: still non-empty', html.length > 0);
  assert('sparse: LOW → "aerial"', html.includes('aerial'));
  assert('sparse: three em-dash fallbacks', (html.match(/>—</g) || []).length >= 3);
  assert('sparse: segment count 0', html.includes('>0<'));
  assert('sparse: no imagery-date phrase leaks',  !html.includes('captured '));
  assert('sparse: no best-orientation line',      !html.includes('most productive facing'));
}

// ── Compass conversion boundary cases ───────────────────────────────────────
{
  // Directly test compass conversion via the exported page — build minimal
  // segment with a specific azimuth and check the rendered compass letter.
  const cases = [
    { azimuth: 0,   expected: '<b>N</b>' },
    { azimuth: 45,  expected: '<b>NE</b>' },
    { azimuth: 90,  expected: '<b>E</b>' },
    { azimuth: 135, expected: '<b>SE</b>' },
    { azimuth: 180, expected: '<b>S</b>' },
    { azimuth: 225, expected: '<b>SW</b>' },
    { azimuth: 270, expected: '<b>W</b>' },
    { azimuth: 315, expected: '<b>NW</b>' },
    { azimuth: 359, expected: '<b>N</b>' },      // wraps around to N
  ];
  for (const c of cases) {
    const html = pageSiteAnalysis(mkD({
      status: 'ok', imagery_quality: 'HIGH', max_array_panels_count: 1, max_array_area_m2: 1, max_sunshine_hours_per_year: 1,
      roof_segments: [{ pitchDegrees: 22, azimuthDegrees: c.azimuth, stats: { areaMeters2: 10 } }],
    }), 1, 5);
    assert(`azimuth ${c.azimuth}° → ${c.expected}`, html.includes(c.expected));
  }
}

// ── Best segment picks the largest area, not the first ─────────────────────
{
  const analysis = {
    status: 'ok', imagery_quality: 'HIGH', max_array_panels_count: 1, max_array_area_m2: 1, max_sunshine_hours_per_year: 1,
    roof_segments: [
      { pitchDegrees: 30, azimuthDegrees: 90,  stats: { areaMeters2: 10 } },   // East, small
      { pitchDegrees: 20, azimuthDegrees: 180, stats: { areaMeters2: 50 } },   // South, LARGEST
      { pitchDegrees: 25, azimuthDegrees: 0,   stats: { areaMeters2: 30 } },   // North, medium
    ],
  };
  const html = pageSiteAnalysis(mkD(analysis), 1, 5);
  assert('picks largest segment → S compass', html.includes('<b>S</b>'));
  assert('picks largest segment → 20° pitch', html.includes('20° pitch'));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

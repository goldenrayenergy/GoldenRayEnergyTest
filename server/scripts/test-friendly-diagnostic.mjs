// Unit tests for friendlyDiagnostic — the roof-analysis error→copy mapper
// used by SiteSurveyFallback in Step3Analysis.jsx. Verifies P4 fix
// 2026-08-31 for rural addresses (Hira etc.) that hit LiDAR coverage gaps
// which surface as raw HTTP `{error: "N points above..."}` responses with
// no diagnostics payload.

import { friendlyDiagnostic } from '../../client/src/pages/quote/friendlyDiagnostic.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};

console.log('\n── friendlyDiagnostic: raw-error patterns (P4 fix, no diagnostics) ──');
{
  // 29 Macs Road Hira — real Hira response text.
  {
    const raw = 'No solar imagery from Google AND LiDAR fallback failed: Only 0 points above local ground level — building may be single-storey too close to the ground threshold, or the address pin may be off-roof.';
    const out = friendlyDiagnostic(null, raw);
    assert(out !== null && /rural/i.test(out),
      "29 Macs Rd Hira raw error → rural coverage copy");
  }

  // 794 Hira Road — same class, different point count.
  {
    const raw = 'No solar imagery from Google AND LiDAR fallback failed: Only 7 points above local ground level — building may be single-storey too close to the ground threshold, or the address pin may be off-roof.';
    const out = friendlyDiagnostic(null, raw);
    assert(out !== null && /site visit/i.test(out),
      "794 Hira Rd raw error → site-visit copy");
  }

  // RANSAC failure message variant.
  {
    const raw = 'LiDAR: RANSAC detected no roof planes above the parcel [HTTP 502]';
    const out = friendlyDiagnostic(null, raw);
    assert(out !== null && /rural/i.test(out),
      "RANSAC no-planes raw error → rural copy");
  }

  // Unrelated error → null (caller shows generic fallback).
  {
    const raw = 'Something else entirely blew up';
    const out = friendlyDiagnostic(null, raw);
    assert(out === null,
      'unmatched raw error → null (generic fallback fires)');
  }
}

console.log('\n── friendlyDiagnostic: diagnostics-driven paths (regression) ──');
{
  // Rate-limit path (existing behaviour).
  {
    const out = friendlyDiagnostic({ fallback_reason: 'daily_quote_limit', quotes_used_today: 4 }, null);
    assert(out !== null && /4 different addresses today/.test(out),
      'daily_quote_limit → rate-limit copy including used count');
  }

  // Missing-building copy (existing).
  {
    const out = friendlyDiagnostic({
      fallback_reason: 'both_pipelines_failed',
      building_source: null,
      building_candidates: { osm: 0, linz: 0 },
    }, null);
    assert(out !== null && /reference maps/i.test(out),
      'both_pipelines_failed + no OSM/LINZ → missing-building copy');
  }

  // Rural via diagnostics.lidar_error (existing behaviour, unchanged).
  {
    const out = friendlyDiagnostic({
      fallback_reason: 'both_pipelines_failed',
      lidar_error: 'Only 0 points above local ground level',
    }, null);
    assert(out !== null && /rural/i.test(out),
      'both_pipelines_failed + lidar_error points-above → rural copy');
  }

  // Stale-google fallback path (existing).
  {
    const out = friendlyDiagnostic({ fallback_reason: 'lidar_failed_reverted_to_stale_google' }, null);
    assert(out !== null && /Google’s older imagery/i.test(out),
      'lidar_failed_reverted_to_stale_google → stale-imagery copy');
  }
}

console.log('\n── friendlyDiagnostic: null / empty inputs ──');
{
  assert(friendlyDiagnostic(null, null) === null, 'null d + null raw → null');
  assert(friendlyDiagnostic(null, '') === null, 'null d + empty raw → null');
  assert(friendlyDiagnostic({}, null) === null, 'empty d + null raw → null');
  assert(friendlyDiagnostic({ fallback_reason: 'unknown_reason' }, null) === null,
    'unknown fallback_reason → null (generic fallback fires)');

  // Raw error takes precedence over diagnostics — if BOTH are set and
  // raw matches a rural pattern, rural copy wins even if d has a
  // different rule.
  {
    const out = friendlyDiagnostic(
      { fallback_reason: 'daily_quote_limit', quotes_used_today: 4 },
      'Only 0 points above local ground level',
    );
    assert(out !== null && /rural/i.test(out),
      'raw rural pattern PRECEDES daily_quote_limit diagnostic (informational)');
  }
}

console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);

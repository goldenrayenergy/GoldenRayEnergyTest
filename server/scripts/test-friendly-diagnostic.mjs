// Unit tests for errorCopy — the roof-analysis error→copy mapper used by
// Step3Analysis and SiteSurveyFallback. Verifies the 4 error classes each
// return the correct { class, title, subtitle } trio so the customer sees
// cause-appropriate copy instead of a generic "we couldn't analyse this
// roof" message that reads as a technical glitch.

import { errorCopy } from '../../client/src/pages/quote/friendlyDiagnostic.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};

// ── Class 1: rate-limit (the P0 bug fix that drove this refactor) ──────
console.log('\n── errorCopy: rate-limit class ──');
{
  // Server responds with the exact rate-limit string.
  {
    const raw = "You've explored 3 different addresses today. Ready to talk to a real person about your best option? [HTTP 429]";
    const out = errorCopy(null, raw);
    assert(out.class === 'rate-limit', `raw string match → class='rate-limit' (got ${out.class})`);
    assert(/free quotes/i.test(out.title), 'title mentions "free quotes"');
    assert(/site survey/i.test(out.subtitle), 'subtitle drives to site survey');
    assert(/tomorrow/i.test(out.subtitle), 'subtitle mentions coming back tomorrow');
  }

  // HTTP 429 marker alone (no message body) still catches it.
  {
    const out = errorCopy(null, 'Something [HTTP 429]');
    assert(out.class === 'rate-limit', 'HTTP 429 marker alone → rate-limit');
  }

  // Diagnostics-driven signal (server sends fallback_reason).
  {
    const out = errorCopy({ fallback_reason: 'daily_quote_limit' }, null);
    assert(out.class === 'rate-limit', 'fallback_reason=daily_quote_limit → rate-limit');
  }
}

// ── Class 2: rural coverage gap ────────────────────────────────────────
console.log('\n── errorCopy: rural class ──');
{
  // 29 Macs Road Hira — real Hira response text.
  {
    const raw = 'No solar imagery from Google AND LiDAR fallback failed: Only 0 points above local ground level — building may be single-storey too close to the ground threshold, or the address pin may be off-roof.';
    const out = errorCopy(null, raw);
    assert(out.class === 'rural', `Hira "N points above" → class='rural' (got ${out.class})`);
    assert(/engineers/i.test(out.title), 'title positions engineers as the fix');
    assert(/free/i.test(out.subtitle), 'subtitle emphasises FREE (competitive lever)');
  }

  // RANSAC no-planes variant.
  {
    const out = errorCopy(null, 'LiDAR: RANSAC detected no roof planes above the parcel');
    assert(out.class === 'rural', 'RANSAC no-planes → rural');
  }

  // Diagnostics-driven signal (server categorised the error).
  {
    const out = errorCopy({
      fallback_reason: 'both_pipelines_failed',
      lidar_error: 'Only 3 points above local ground level',
    }, null);
    assert(out.class === 'rural', 'diagnostics.lidar_error points-above → rural');
  }
}

// ── Class 3: missing building (new subdivision) ────────────────────────
console.log('\n── errorCopy: missing-building class ──');
{
  const out = errorCopy({
    fallback_reason: 'both_pipelines_failed',
    building_source: null,
    building_candidates: { osm: 0, linz: 0 },
  }, null);
  assert(out.class === 'missing-building', `no OSM/LINZ candidates → missing-building (got ${out.class})`);
  assert(/new build/i.test(out.title), 'title reads as reassuring not blaming');
  assert(/in person/i.test(out.title) || /free site survey/i.test(out.subtitle),
    'copy positions surveyor visit as the fix');
}

// ── Class 4: genuine-failure (default fallback) ────────────────────────
console.log('\n── errorCopy: genuine-failure default ──');
{
  // Unrecognised diagnostics + generic error → falls through to default.
  {
    const out = errorCopy(null, 'Something else entirely blew up');
    assert(out.class === 'genuine-failure', `unmatched → genuine-failure (got ${out.class})`);
    assert(/read this roof/i.test(out.title), 'title uses "read this roof" (accurate for a real fail)');
    assert(/free site survey/i.test(out.subtitle), 'subtitle still drives to free site survey');
  }

  // Truly empty inputs.
  {
    const out = errorCopy(null, null);
    assert(out.class === 'genuine-failure', 'null + null → genuine-failure');
  }
  {
    const out = errorCopy({}, '');
    assert(out.class === 'genuine-failure', 'empty diag + empty raw → genuine-failure');
  }

  // Unknown fallback_reason → default.
  {
    const out = errorCopy({ fallback_reason: 'unknown_reason' }, null);
    assert(out.class === 'genuine-failure', 'unknown fallback_reason → genuine-failure');
  }
}

// ── Shape guarantees (all classes return the same trio) ────────────────
console.log('\n── errorCopy: shape guarantees ──');
{
  const cases = [
    [{ fallback_reason: 'daily_quote_limit' }, null, 'rate-limit'],
    [null, 'Only 0 points above local ground level', 'rural'],
    [{ fallback_reason: 'both_pipelines_failed', building_source: null, building_candidates: { osm: 0, linz: 0 } }, null, 'missing-building'],
    [null, null, 'genuine-failure'],
  ];
  for (const [d, raw, expected] of cases) {
    const out = errorCopy(d, raw);
    assert(out.class === expected, `${expected}: class assigned correctly`);
    assert(typeof out.title === 'string' && out.title.length > 0, `${expected}: title is a non-empty string`);
    assert(typeof out.subtitle === 'string' && out.subtitle.length > 0, `${expected}: subtitle is a non-empty string`);
    assert(!out.title.includes('undefined') && !out.subtitle.includes('undefined'),
      `${expected}: no "undefined" leaks into user-visible copy`);
  }
}

// ── Precedence: raw string patterns beat diagnostics when both apply ──
console.log('\n── errorCopy: raw pattern precedence ──');
{
  // Rate limit is checked FIRST so it wins even if diagnostics has an
  // unrelated fallback_reason (safety net — server shouldn't send both,
  // but if it does, the rate-limit friendly wording still fires).
  const out = errorCopy(
    { fallback_reason: 'both_pipelines_failed', lidar_error: 'Only 3 points above' },
    'You\'ve explored 3 different addresses today. [HTTP 429]',
  );
  assert(out.class === 'rate-limit',
    'rate-limit string precedes rural diagnostics when both are set');
}

console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);

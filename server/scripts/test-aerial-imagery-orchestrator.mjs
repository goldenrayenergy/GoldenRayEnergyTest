// ────────────────────────────────────────────────────────────────────────────
// test-aerial-imagery-orchestrator.mjs
//
// Unit tests for server/services/aerialImagery.js — verifies the LINZ-first
// / Google-Solar-fallback selection behaviour with mocked providers.
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import { createAerialImageryOrchestrator } from '../services/aerialImagery.js';

let pass = 0, fail = 0;
const failures = [];
function assert(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}
console.log('test-aerial-imagery-orchestrator\n');

// Recording fetcher — captures calls + returns configurable result
function recFetcher(result) {
  const state = { calls: 0 };
  return {
    state,
    fetcher: {
      async fetchAndStoreRoofImage(args) {
        state.calls++;
        state.lastArgs = args;
        if (result.throw) throw result.throw;
        return result;
      },
    },
  };
}

const OK_LINZ   = { ok: true, storagePath: 'e1/rgb.png', storageBucket: 'roof-images', sizeBytes: 100, radiusMeters: 15, zoom: 21, source: 'linz' };
const OK_GOOGLE = { ok: true, storagePath: 'e1/rgb.png', storageBucket: 'roof-images', sizeBytes: 200, radiusMeters: 15, imageryQuality: 'MEDIUM' };
const FAIL_RET  = { ok: false, reason: 'tile-fetch-429', error: '429 rate limit' };

// ── Boundary validation ──────────────────────────────────────────────────
{
  console.log('\n▸ createOrchestrator — boundary checks');
  let thrown = false;
  try { createAerialImageryOrchestrator({}); } catch (e) { thrown = /googleFetcher.*required/.test(e.message); }
  assert('no googleFetcher → throws', thrown);
}

// ── LINZ present + succeeds → LINZ used, Google untouched ────────────────
{
  console.log('\n▸ LINZ succeeds → LINZ used, Google untouched');
  const linz   = recFetcher(OK_LINZ);
  const google = recFetcher(OK_GOOGLE);
  const o = createAerialImageryOrchestrator({ linzFetcher: linz.fetcher, googleFetcher: google.fetcher });
  const r = await o.fetchAndStoreRoofImage({ enquiryId: 'e1', latitude: -36.9, longitude: 174.7, radiusMeters: 15 });
  assert('ok=true', r.ok === true);
  assert('source=linz', r.source === 'linz');
  assert('linz was called', linz.state.calls === 1);
  assert('google was NOT called', google.state.calls === 0);
  assert('linz got the args', linz.state.lastArgs?.enquiryId === 'e1');
}

// ── LINZ fails → Google fallback used ────────────────────────────────────
{
  console.log('\n▸ LINZ fails → Google fallback');
  const linz   = recFetcher(FAIL_RET);
  const google = recFetcher(OK_GOOGLE);
  const o = createAerialImageryOrchestrator({
    linzFetcher: linz.fetcher, googleFetcher: google.fetcher,
    logger: { warn: () => {} },
  });
  const r = await o.fetchAndStoreRoofImage({ enquiryId: 'e2', latitude: -36.9, longitude: 174.7, radiusMeters: 15 });
  assert('ok=true (Google succeeded)', r.ok === true);
  assert('source=google_solar (fallback marker)', r.source === 'google_solar');
  assert('linz was called first', linz.state.calls === 1);
  assert('google was called as fallback', google.state.calls === 1);
}

// ── LINZ throws → Google fallback still used ─────────────────────────────
{
  console.log('\n▸ LINZ throws → Google fallback');
  const linz   = recFetcher({ throw: new Error('network unreachable') });
  const google = recFetcher(OK_GOOGLE);
  const o = createAerialImageryOrchestrator({
    linzFetcher: linz.fetcher, googleFetcher: google.fetcher,
    logger: { warn: () => {} },
  });
  const r = await o.fetchAndStoreRoofImage({ enquiryId: 'e3', latitude: -36.9, longitude: 174.7, radiusMeters: 15 });
  assert('ok=true', r.ok === true);
  assert('source=google_solar', r.source === 'google_solar');
  assert('linz still called', linz.state.calls === 1);
  assert('google called after linz throw', google.state.calls === 1);
}

// ── LINZ disabled (null fetcher) → Google used directly ──────────────────
{
  console.log('\n▸ LINZ disabled → Google used directly');
  const google = recFetcher(OK_GOOGLE);
  const o = createAerialImageryOrchestrator({ linzFetcher: null, googleFetcher: google.fetcher });
  const r = await o.fetchAndStoreRoofImage({ enquiryId: 'e4', latitude: -36.9, longitude: 174.7, radiusMeters: 15 });
  assert('ok=true', r.ok === true);
  assert('source=google_solar', r.source === 'google_solar');
  assert('google called once', google.state.calls === 1);
}

// ── Both fail → orchestrator returns all-providers-failed with attempts ──
{
  console.log('\n▸ Both providers fail → aggregated error');
  const linz   = recFetcher({ ok: false, reason: 'tile-fetch-500', error: 'linz down' });
  const google = recFetcher({ ok: false, reason: 'datalayers-503', error: 'google down' });
  const o = createAerialImageryOrchestrator({
    linzFetcher: linz.fetcher, googleFetcher: google.fetcher,
    logger: { warn: () => {} },
  });
  const r = await o.fetchAndStoreRoofImage({ enquiryId: 'e5', latitude: -36.9, longitude: 174.7, radiusMeters: 15 });
  assert('ok=false', r.ok === false);
  assert('reason mentions all-providers-failed', r.reason === 'all-providers-failed');
  assert('attempts.linz present', r.attempts?.linz?.reason === 'tile-fetch-500');
  assert('attempts.google present', r.attempts?.google?.reason === 'datalayers-503');
}

// ── Both throw → same aggregated shape ───────────────────────────────────
{
  console.log('\n▸ Both providers throw → still aggregated');
  const linz   = recFetcher({ throw: new Error('linz-boom') });
  const google = recFetcher({ throw: new Error('google-boom') });
  const o = createAerialImageryOrchestrator({
    linzFetcher: linz.fetcher, googleFetcher: google.fetcher,
    logger: { warn: () => {} },
  });
  const r = await o.fetchAndStoreRoofImage({ enquiryId: 'e6', latitude: -36.9, longitude: 174.7, radiusMeters: 15 });
  assert('ok=false', r.ok === false);
  assert('linz throw captured', /linz-boom/.test(r.attempts.linz.error));
  assert('google throw captured', /google-boom/.test(r.attempts.google.error));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

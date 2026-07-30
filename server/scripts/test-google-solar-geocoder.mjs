// ────────────────────────────────────────────────────────────────────────────
// test-google-solar-geocoder.mjs
//
// Offline unit tests for server/services/googleSolar/geocoder.js.
// No live Google calls — all fetches mocked via createGeocoder({ fetchFn }).
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import { createGeocoder } from '../services/googleSolar/geocoder.js';

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}

async function assertThrows(label, fn, expectedSubstring) {
  try { await fn(); fail++; failures.push({ label, detail: 'expected throw' }); console.log(`  ✗ ${label}  ← expected throw`); }
  catch (err) {
    const msg = err?.message || String(err);
    if (!expectedSubstring || msg.includes(expectedSubstring)) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; failures.push({ label, detail: `wrong msg: ${msg}` }); console.log(`  ✗ ${label}  ← wrong msg: ${msg}`); }
  }
}

console.log('test-google-solar-geocoder\n');

// ── Case 1: Dev fallback (no apiKey) returns Auckland CBD mock ──────────────
{
  const geo = createGeocoder({ apiKey: null });
  const r = await geo.geocode('1 Queen St, Auckland');
  assert('dev-fallback returns ok:true', r.ok === true);
  assert('dev-fallback source is "mock"', r.source === 'mock');
  assert('dev-fallback lat is Auckland-ish', r.latitude === -36.848461);
  assert('dev-fallback lng is Auckland-ish', r.longitude === 174.763336);
  assert('dev-fallback formattedAddress includes input', r.formattedAddress.includes('1 Queen St'));
  assert('dev-fallback marks quality APPROXIMATE', r.quality === 'APPROXIMATE');
}

// ── Case 2: Invalid input throws ────────────────────────────────────────────
{
  const geo = createGeocoder({ apiKey: 'test-key', fetchFn: async () => { throw new Error('should not be called'); } });
  await assertThrows('empty string throws', () => geo.geocode(''), 'address');
  await assertThrows('whitespace-only throws', () => geo.geocode('   '), 'address');
  await assertThrows('non-string throws', () => geo.geocode(42), 'address');
  await assertThrows('undefined throws', () => geo.geocode(undefined), 'address');
}

// ── Case 3: Real-mode successful geocode ────────────────────────────────────
{
  let capturedUrl = null;
  const mockFetch = async (url) => {
    capturedUrl = url.toString();
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: 'OK',
        results: [{
          formatted_address: '1 Queen Street, Auckland CBD, Auckland 1010, New Zealand',
          geometry: { location: { lat: -36.848461, lng: 174.763336 }, location_type: 'ROOFTOP' },
        }],
      }),
    };
  };
  const geo = createGeocoder({ apiKey: 'test-key-abc', fetchFn: mockFetch });
  const r = await geo.geocode('1 Queen St, Auckland');
  assert('real-mode returns ok:true', r.ok === true);
  assert('real-mode source is "live"', r.source === 'live');
  assert('real-mode lat parsed', r.latitude === -36.848461);
  assert('real-mode lng parsed', r.longitude === 174.763336);
  assert('real-mode formattedAddress from Google', r.formattedAddress.includes('New Zealand'));
  assert('real-mode quality ROOFTOP', r.quality === 'ROOFTOP');
  assert('URL includes address', capturedUrl.includes('address=1+Queen+St'));
  assert('URL includes key', capturedUrl.includes('key=test-key-abc'));
  assert('URL includes region=nz bias', capturedUrl.includes('region=nz'));
}

// ── Case 4: Trims whitespace in input ───────────────────────────────────────
{
  let capturedUrl = null;
  const mockFetch = async (url) => {
    capturedUrl = url.toString();
    return { ok: true, status: 200, json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: 0, lng: 0 }, location_type: 'APPROXIMATE' } }] }) };
  };
  const geo = createGeocoder({ apiKey: 'k', fetchFn: mockFetch });
  await geo.geocode('   1 Queen St   ');
  assert('trims leading/trailing whitespace', capturedUrl.includes('1+Queen+St') && !capturedUrl.includes('+++'));
}

// ── Case 5: ZERO_RESULTS ────────────────────────────────────────────────────
{
  const mockFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ status: 'ZERO_RESULTS', results: [] }),
  });
  const geo = createGeocoder({ apiKey: 'k', fetchFn: mockFetch });
  const r = await geo.geocode('somewhere off the map');
  assert('zero-results returns ok:false', r.ok === false);
  assert('zero-results reason "zero-results"', r.reason === 'zero-results');
  assert('zero-results status = ZERO_RESULTS', r.status === 'ZERO_RESULTS');
}

// ── Case 6: OVER_QUERY_LIMIT + REQUEST_DENIED + INVALID_REQUEST ────────────
{
  for (const [gStatus, expectedReason] of [
    ['OVER_QUERY_LIMIT', 'over-query-limit'],
    ['REQUEST_DENIED',   'request-denied'],
    ['INVALID_REQUEST',  'invalid-request'],
    ['UNKNOWN_ERROR',    'unknown-error'],
  ]) {
    const mockFetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ status: gStatus, results: [], error_message: `Google says ${gStatus}` }),
    });
    const geo = createGeocoder({ apiKey: 'k', fetchFn: mockFetch });
    const r = await geo.geocode('test');
    assert(`${gStatus} → ok:false`, r.ok === false);
    assert(`${gStatus} → reason "${expectedReason}"`, r.reason === expectedReason);
    assert(`${gStatus} → error message preserved`, r.error?.includes(gStatus));
  }
}

// ── Case 7: HTTP 500 ─────────────────────────────────────────────────────────
{
  const mockFetch = async () => ({
    ok: false, status: 500, statusText: 'Internal Server Error',
    text: async () => 'server oops',
  });
  const geo = createGeocoder({ apiKey: 'k', fetchFn: mockFetch });
  const r = await geo.geocode('anything');
  assert('500 returns ok:false', r.ok === false);
  assert('500 reason "http-500"', r.reason === 'http-500');
  assert('500 preserves body', r.error === 'server oops');
}

// ── Case 8: Network error ───────────────────────────────────────────────────
{
  const mockFetch = async () => { throw new Error('ECONNRESET'); };
  const geo = createGeocoder({ apiKey: 'k', fetchFn: mockFetch });
  const r = await geo.geocode('anything');
  assert('network err returns ok:false', r.ok === false);
  assert('network err reason "network"', r.reason === 'network');
  assert('network err message preserved', r.error.includes('ECONNRESET'));
}

// ── Case 9: Bad JSON in 200 ─────────────────────────────────────────────────
{
  const mockFetch = async () => ({
    ok: true, status: 200,
    json: async () => { throw new Error('Unexpected token'); },
  });
  const geo = createGeocoder({ apiKey: 'k', fetchFn: mockFetch });
  const r = await geo.geocode('x');
  assert('bad json returns ok:false', r.ok === false);
  assert('bad json reason "bad-json"', r.reason === 'bad-json');
}

// ── Case 10: OK but missing geometry (defensive parse) ─────────────────────
{
  const mockFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ status: 'OK', results: [{ formatted_address: 'x' }] }),  // no geometry
  });
  const geo = createGeocoder({ apiKey: 'k', fetchFn: mockFetch });
  const r = await geo.geocode('x');
  assert('missing geometry returns ok:false', r.ok === false);
  assert('missing geometry reason "zero-results"', r.reason === 'zero-results');
}

// ── Case 11: quality defaults when Google omits location_type ──────────────
{
  const mockFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ status: 'OK', results: [{ geometry: { location: { lat: 1, lng: 2 } } }] }),  // no location_type
  });
  const geo = createGeocoder({ apiKey: 'k', fetchFn: mockFetch });
  const r = await geo.geocode('x');
  assert('missing location_type → quality APPROXIMATE', r.quality === 'APPROXIMATE');
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

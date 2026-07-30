// ────────────────────────────────────────────────────────────────────────────
// test-google-solar-client.mjs
//
// Offline unit tests for server/services/googleSolar/client.js.
// No live Google calls — all fetches mocked via createClient({ fetchFn }).
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import { createClient } from '../services/googleSolar/client.js';

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push({ label, detail });
    console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`);
  }
}

async function assertThrows(label, fn, expectedSubstring) {
  try {
    await fn();
    fail++;
    failures.push({ label, detail: 'expected throw, none thrown' });
    console.log(`  ✗ ${label}  ← expected throw, none thrown`);
  } catch (err) {
    const msg = err?.message || String(err);
    if (!expectedSubstring || msg.includes(expectedSubstring)) {
      pass++;
      console.log(`  ✓ ${label}`);
    } else {
      fail++;
      failures.push({ label, detail: `wrong message: ${msg}` });
      console.log(`  ✗ ${label}  ← wrong message: ${msg}`);
    }
  }
}

console.log('test-google-solar-client\n');

// ── Case 1: Dev fallback (no apiKey) returns mock data ──────────────────────
{
  const client = createClient({ apiKey: null });
  const res = await client.buildingInsights({ latitude: -36.85, longitude: 174.76 });
  assert('dev-fallback returns ok:true', res.ok === true);
  assert('dev-fallback source is "mock"', res.source === 'mock');
  assert('dev-fallback has imageryQuality', res.data?.imageryQuality === 'HIGH');
  assert('dev-fallback has 2 roof segments', res.data?.solarPotential?.roofSegmentStats?.length === 2);
  assert('dev-fallback echoes input lat/lng in center',
    res.data?.center?.latitude === -36.85 && res.data?.center?.longitude === 174.76);
}

// ── Case 2: Invalid latitude throws ─────────────────────────────────────────
{
  const client = createClient({ apiKey: 'test-key', fetchFn: async () => { throw new Error('should not be called'); } });
  await assertThrows('missing latitude throws',
    () => client.buildingInsights({ longitude: 174.76 }),
    'latitude');
  await assertThrows('latitude > 90 throws',
    () => client.buildingInsights({ latitude: 999, longitude: 174.76 }),
    'latitude');
  await assertThrows('longitude > 180 throws',
    () => client.buildingInsights({ latitude: -36.85, longitude: 999 }),
    'longitude');
  await assertThrows('non-numeric latitude throws',
    () => client.buildingInsights({ latitude: 'oops', longitude: 174.76 }),
    'latitude');
}

// ── Case 3: Real-mode successful fetch ──────────────────────────────────────
{
  let capturedUrl = null;
  const mockFetch = async (url, opts) => {
    capturedUrl = url.toString();
    return {
      ok: true,
      status: 200,
      json: async () => ({ imageryQuality: 'MEDIUM', solarPotential: { maxArrayPanelsCount: 30 } }),
    };
  };
  const client = createClient({ apiKey: 'test-key-abc', fetchFn: mockFetch });
  const res = await client.buildingInsights({ latitude: -36.85, longitude: 174.76 });
  assert('real-mode returns ok:true on 200', res.ok === true);
  assert('real-mode source is "live"', res.source === 'live');
  assert('real-mode data passed through', res.data?.imageryQuality === 'MEDIUM');
  assert('URL includes latitude', capturedUrl.includes('location.latitude=-36.85'));
  assert('URL includes longitude', capturedUrl.includes('location.longitude=174.76'));
  assert('URL includes API key', capturedUrl.includes('key=test-key-abc'));
  assert('URL includes requiredQuality default HIGH', capturedUrl.includes('requiredQuality=HIGH'));
}

// ── Case 4: Real-mode 404 (no coverage) returns ok:false ────────────────────
{
  const mockFetch = async () => ({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    text: async () => '{"error":{"code":404,"message":"No building found."}}',
  });
  const client = createClient({ apiKey: 'test-key', fetchFn: mockFetch });
  const res = await client.buildingInsights({ latitude: 0, longitude: 0 });
  assert('404 returns ok:false', res.ok === false);
  assert('404 status is 404', res.status === 404);
  assert('404 error body is included', res.error.includes('No building found'));
}

// ── Case 5: Real-mode 5xx returns ok:false ──────────────────────────────────
{
  const mockFetch = async () => ({
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    text: async () => '',
  });
  const client = createClient({ apiKey: 'test-key', fetchFn: mockFetch });
  const res = await client.buildingInsights({ latitude: -36.85, longitude: 174.76 });
  assert('503 returns ok:false', res.ok === false);
  assert('503 status is 503', res.status === 503);
  assert('503 falls back to statusText when body empty', res.error === 'Service Unavailable');
}

// ── Case 6: Network error returns ok:false with status 0 ────────────────────
{
  const mockFetch = async () => { throw new Error('ECONNREFUSED'); };
  const client = createClient({ apiKey: 'test-key', fetchFn: mockFetch });
  const res = await client.buildingInsights({ latitude: -36.85, longitude: 174.76 });
  assert('network error returns ok:false', res.ok === false);
  assert('network error status is 0 (no HTTP response)', res.status === 0);
  assert('network error message includes ECONNREFUSED', res.error.includes('ECONNREFUSED'));
}

// ── Case 7: Bad JSON in 200 response returns ok:false ───────────────────────
{
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new Error('Unexpected token'); },
  });
  const client = createClient({ apiKey: 'test-key', fetchFn: mockFetch });
  const res = await client.buildingInsights({ latitude: -36.85, longitude: 174.76 });
  assert('bad JSON returns ok:false', res.ok === false);
  assert('bad JSON error prefixed "bad-json:"', res.error.startsWith('bad-json:'));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

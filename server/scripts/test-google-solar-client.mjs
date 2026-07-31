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

// ── Case 8: dataLayers dev-fallback returns mock URLs ──────────────────────
{
  const client = createClient({ apiKey: null });
  const res = await client.dataLayers({ latitude: -36.85, longitude: 174.76 });
  assert('dataLayers dev-fallback returns ok:true', res.ok === true);
  assert('dataLayers dev-fallback source is "mock"', res.source === 'mock');
  assert('dataLayers dev-fallback has rgbUrl', typeof res.data?.rgbUrl === 'string' && res.data.rgbUrl.startsWith('https://'));
  assert('dataLayers dev-fallback has imageryDate', res.data?.imageryDate?.year === 2024);
  assert('dataLayers dev-fallback has imageryQuality', res.data?.imageryQuality === 'HIGH');
}

// ── Case 9: dataLayers invalid latitude throws ─────────────────────────────
{
  const client = createClient({ apiKey: 'test-key', fetchFn: async () => { throw new Error('should not be called'); } });
  await assertThrows('dataLayers missing latitude throws',
    () => client.dataLayers({ longitude: 174.76 }), 'latitude');
  await assertThrows('dataLayers longitude > 180 throws',
    () => client.dataLayers({ latitude: -36.85, longitude: 999 }), 'longitude');
}

// ── Case 10: dataLayers real-mode URL construction + successful fetch ──────
{
  let capturedUrl = null;
  const mockFetch = async (url) => {
    capturedUrl = url.toString();
    return {
      ok: true, status: 200,
      json: async () => ({ rgbUrl: 'https://mock-rgb', imageryQuality: 'MEDIUM' }),
    };
  };
  const client = createClient({ apiKey: 'test-key-abc', fetchFn: mockFetch });
  const res = await client.dataLayers({ latitude: -36.85, longitude: 174.76, radiusMeters: 100 });
  assert('dataLayers real-mode ok:true', res.ok === true);
  assert('dataLayers real-mode data passed through', res.data?.rgbUrl === 'https://mock-rgb');
  assert('URL calls dataLayers:get', capturedUrl.includes('/dataLayers:get'));
  assert('URL includes radiusMeters=100', capturedUrl.includes('radiusMeters=100'));
  assert('URL defaults view=IMAGERY_LAYERS', capturedUrl.includes('view=IMAGERY_LAYERS'));
  assert('URL defaults requiredQuality=LOW', capturedUrl.includes('requiredQuality=LOW'));
  assert('URL includes API key', capturedUrl.includes('key=test-key-abc'));
}

// ── Case 11: dataLayers 404 (no imagery at location) returns ok:false ─────
{
  const mockFetch = async () => ({
    ok: false, status: 404, statusText: 'Not Found',
    text: async () => '{"error":{"code":404,"message":"No imagery at requested quality."}}',
  });
  const client = createClient({ apiKey: 'test-key', fetchFn: mockFetch });
  const res = await client.dataLayers({ latitude: 0, longitude: 0 });
  assert('dataLayers 404 ok:false', res.ok === false);
  assert('dataLayers 404 status=404', res.status === 404);
  assert('dataLayers 404 error preserved', res.error.includes('No imagery'));
}

// ── Case 12: fetchTileBuffer dev-fallback returns tiny PNG buffer ─────────
{
  const client = createClient({ apiKey: null });
  const res = await client.fetchTileBuffer('https://solar.googleapis.com/v1/geoTiff:get?id=xyz');
  assert('fetchTileBuffer dev-fallback ok:true', res.ok === true);
  assert('fetchTileBuffer dev-fallback source=mock', res.source === 'mock');
  assert('fetchTileBuffer dev-fallback returns a Buffer', Buffer.isBuffer(res.buffer));
  assert('fetchTileBuffer dev-fallback buffer non-empty', res.buffer.length > 0);
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  assert('fetchTileBuffer dev-fallback is valid PNG magic', res.buffer[0] === 0x89 && res.buffer[1] === 0x50);
}

// ── Case 13: fetchTileBuffer invalid URL throws ────────────────────────────
{
  const client = createClient({ apiKey: 'test-key', fetchFn: async () => { throw new Error('should not be called'); } });
  await assertThrows('fetchTileBuffer non-string throws', () => client.fetchTileBuffer(42), 'url');
  await assertThrows('fetchTileBuffer non-http throws', () => client.fetchTileBuffer('ftp://x'), 'url');
  await assertThrows('fetchTileBuffer undefined throws', () => client.fetchTileBuffer(undefined), 'url');
}

// ── Case 14: fetchTileBuffer appends API key to URL ────────────────────────
{
  let capturedUrl = null;
  const mockFetch = async (url) => {
    capturedUrl = String(url);
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const client = createClient({ apiKey: 'test-key-abc', fetchFn: mockFetch });
  await client.fetchTileBuffer('https://solar.googleapis.com/v1/geoTiff:get?id=xyz');
  assert('fetchTileBuffer appends &key=... to existing querystring', capturedUrl.includes('&key=test-key-abc'));
}

// ── Case 15: fetchTileBuffer doesn't double-append key when already present ──
{
  let capturedUrl = null;
  const mockFetch = async (url) => {
    capturedUrl = String(url);
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const client = createClient({ apiKey: 'test-key-abc', fetchFn: mockFetch });
  await client.fetchTileBuffer('https://solar.googleapis.com/v1/geoTiff:get?id=xyz&key=existing');
  const keyOccurrences = (capturedUrl.match(/key=/g) || []).length;
  assert('fetchTileBuffer preserves URL when key already present (no double-append)', keyOccurrences === 1);
}

// ── Case 16: fetchTileBuffer 404 returns ok:false ──────────────────────────
{
  const mockFetch = async () => ({
    ok: false, status: 404, statusText: 'Not Found',
    text: async () => 'tile-not-found',
  });
  const client = createClient({ apiKey: 'test-key', fetchFn: mockFetch });
  const res = await client.fetchTileBuffer('https://solar.googleapis.com/v1/geoTiff:get?id=missing');
  assert('fetchTileBuffer 404 ok:false', res.ok === false);
  assert('fetchTileBuffer 404 status=404', res.status === 404);
  assert('fetchTileBuffer 404 error preserved', res.error === 'tile-not-found');
}

// ── Case 17: fetchTileBuffer real-mode wraps arrayBuffer into Buffer ──────
{
  const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x00, 0x11, 0x22, 0x33]);
  const mockFetch = async () => ({
    ok: true, status: 200,
    arrayBuffer: async () => bytes.buffer,
  });
  const client = createClient({ apiKey: 'test-key', fetchFn: mockFetch });
  const res = await client.fetchTileBuffer('https://solar.googleapis.com/v1/geoTiff:get?id=x');
  assert('fetchTileBuffer real-mode ok:true', res.ok === true);
  assert('fetchTileBuffer real-mode source=live', res.source === 'live');
  assert('fetchTileBuffer real-mode returns Buffer', Buffer.isBuffer(res.buffer));
  assert('fetchTileBuffer real-mode preserves bytes', res.buffer[0] === 0x89 && res.buffer[7] === 0x33);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

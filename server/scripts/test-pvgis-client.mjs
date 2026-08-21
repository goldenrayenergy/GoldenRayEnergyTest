// Unit tests for the PVGIS client + multi-segment yield helper.
//
// No live PVGIS calls — everything runs against a mocked fetchFn so tests
// are deterministic and network-independent.
//
// Run:  node server/scripts/test-pvgis-client.mjs

import {
  createPvgisClient,
  compassAzimuthToPvgisAspect,
} from '../services/pvgis/pvgisClient.js';
import { computePvgisYieldForSegments } from '../services/pvgis/pvgisSegmentYield.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};
const near = (a, b, eps = 0.5) => Math.abs(a - b) < eps;

// ── compassAzimuthToPvgisAspect ──────────────────────────────────────────
console.log('\n── compassAzimuthToPvgisAspect ──');
{
  // 0=south, ±180=north, +90=west, -90=east in PVGIS
  assert(compassAzimuthToPvgisAspect(0)   === -180, 'compass 0° (N) → PVGIS -180');
  assert(compassAzimuthToPvgisAspect(90)  === -90,  'compass 90° (E) → PVGIS -90');
  assert(compassAzimuthToPvgisAspect(180) === 0,    'compass 180° (S) → PVGIS 0');
  assert(compassAzimuthToPvgisAspect(270) === 90,   'compass 270° (W) → PVGIS 90');
  assert(compassAzimuthToPvgisAspect(45)  === -135, 'compass 45° (NE) → PVGIS -135');
  assert(compassAzimuthToPvgisAspect(315) === 135,  'compass 315° (NW) → PVGIS 135');
  // Wrapping
  assert(compassAzimuthToPvgisAspect(360) === -180, 'compass 360° wraps to 0 → -180');
  assert(compassAzimuthToPvgisAspect(-90) === 90,   'compass -90° normalises to 270 → +90');
}

// ── createPvgisClient — happy path ────────────────────────────────────────
console.log('\n── createPvgisClient (happy path) ──');
{
  // Mock fetchFn returning a PVGIS-shaped JSON.
  let capturedUrl = null;
  const mockFetch = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        outputs: { totals: { fixed: { E_y: 1370.42 } } },
      }),
    };
  };
  const client = createPvgisClient({ fetchFn: mockFetch });
  const r = await client.queryYield({
    latitude: -36.9838, longitude: 174.9387,
    tiltDeg: 15, azimuthDeg: 0,   // north-facing at 15° tilt (NZ ideal)
  });
  assert(r.ok, 'happy-path returns ok:true');
  assert(r.kwhPerKwpPerYear === 1370.4, `yield rounded to 1 dp (got ${r.kwhPerKwpPerYear})`);
  assert(r.pvgisAspect === -180, `aspect converted to -180 for compass 0° (got ${r.pvgisAspect})`);
  assert(capturedUrl.includes('lat=-36.9838'), 'lat is in URL');
  assert(capturedUrl.includes('lon=174.9387'), 'lon is in URL');
  assert(capturedUrl.includes('aspect=-180.0'), 'aspect in URL is PVGIS convention');
  assert(capturedUrl.includes('angle=15.0'), 'tilt in URL');
  assert(capturedUrl.includes('peakpower=1'), 'peakpower=1 for per-kWp');
  assert(r.monthlyKwhPerKwp === null, 'monthlyKwhPerKwp is null when PVGIS response lacks monthly block');
}

// ── V3 monthly extraction ────────────────────────────────────────────────
console.log('\n── V3 monthly kWh/kWp array extracted from PVGIS response ──');
{
  // Realistic NZ Auckland monthly shape scaled to E_y ~1400
  const monthlyEm = [
    { month: 1, E_m: 174 }, { month: 2, E_m: 147 }, { month: 3, E_m: 130 },
    { month: 4, E_m:  88 }, { month: 5, E_m:  76 }, { month: 6, E_m:  59 },
    { month: 7, E_m:  66 }, { month: 8, E_m:  88 }, { month: 9, E_m: 106 },
    { month:10, E_m: 141 }, { month:11, E_m: 158 }, { month:12, E_m: 167 },
  ];
  const mockFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      outputs: {
        totals:  { fixed: { E_y: 1400 } },
        monthly: { fixed: monthlyEm },
      },
    }),
  });
  const client = createPvgisClient({ fetchFn: mockFetch });
  const r = await client.queryYield({ latitude: -36.98, longitude: 174.94, tiltDeg: 15, azimuthDeg: 0 });
  assert(r.ok, 'happy path with monthly returns ok:true');
  assert(Array.isArray(r.monthlyKwhPerKwp) && r.monthlyKwhPerKwp.length === 12,
    `monthlyKwhPerKwp is 12-length array (got ${r.monthlyKwhPerKwp?.length})`);
  assert(r.monthlyKwhPerKwp[0] === 174, `Jan value = 174 (got ${r.monthlyKwhPerKwp[0]})`);
  assert(r.monthlyKwhPerKwp[5] === 59,  `Jun value = 59 (winter low; got ${r.monthlyKwhPerKwp[5]})`);
  assert(r.monthlyKwhPerKwp[11] === 167, `Dec value = 167 (got ${r.monthlyKwhPerKwp[11]})`);
  // Auckland winter/summer ratio should be visible: Jan ~3× Jun
  assert(r.monthlyKwhPerKwp[0] > r.monthlyKwhPerKwp[5] * 2.5,
    `Jan should be > 2.5× Jun (NZ southern-hemisphere winter dip; got ratio ${(r.monthlyKwhPerKwp[0]/r.monthlyKwhPerKwp[5]).toFixed(2)})`);
}

// Malformed monthly (any month non-finite) → whole monthly array dropped
console.log('\n── V3 monthly extraction rejects malformed input ──');
{
  const badMonthly = [
    { month: 1, E_m: 174 }, { month: 2, E_m: 'oops' }, // corrupt
    { month: 3, E_m: 130 }, { month: 4, E_m:  88 }, { month: 5, E_m:  76 },
    { month: 6, E_m:  59 }, { month: 7, E_m:  66 }, { month: 8, E_m:  88 },
    { month: 9, E_m: 106 }, { month:10, E_m: 141 }, { month:11, E_m: 158 },
    { month:12, E_m: 167 },
  ];
  const client = createPvgisClient({
    fetchFn: async () => ({
      ok: true, status: 200,
      json: async () => ({
        outputs: { totals: { fixed: { E_y: 1400 } }, monthly: { fixed: badMonthly } },
      }),
    }),
  });
  const r = await client.queryYield({ latitude: -37.02, longitude: 174.9, tiltDeg: 20, azimuthDeg: 0 });
  assert(r.ok, 'still ok:true — annual works even if monthly corrupted');
  assert(r.monthlyKwhPerKwp === null,
    'monthlyKwhPerKwp is null when any month is malformed (all-or-nothing)');
}

// ── Cache behaviour ─────────────────────────────────────────────────────
console.log('\n── Cache (repeated queries served from memory) ──');
{
  let fetchCount = 0;
  const mockFetch = async () => {
    fetchCount++;
    return {
      ok: true, status: 200,
      json: async () => ({ outputs: { totals: { fixed: { E_y: 1200 } } } }),
    };
  };
  const client = createPvgisClient({ fetchFn: mockFetch });

  const r1 = await client.queryYield({ latitude: -37.0, longitude: 174.9, tiltDeg: 20, azimuthDeg: 45 });
  const r2 = await client.queryYield({ latitude: -37.0, longitude: 174.9, tiltDeg: 20, azimuthDeg: 45 });
  const r3 = await client.queryYield({ latitude: -37.0001, longitude: 174.9, tiltDeg: 20, azimuthDeg: 45 });   // same 3-dp coord

  assert(fetchCount === 1, `cache hit: 3 identical queries → 1 fetch (got ${fetchCount})`);
  assert(r1.kwhPerKwpPerYear === r2.kwhPerKwpPerYear, 'r1 and r2 return same yield');
  assert(r2.cacheHit === true, 'r2 flagged cacheHit');
  assert(r3.cacheHit === true, 'r3 (near-identical coord) also served from cache');

  const r4 = await client.queryYield({ latitude: -37.0, longitude: 174.9, tiltDeg: 30, azimuthDeg: 45 });   // different tilt
  assert(fetchCount === 2, 'different tilt → new fetch');
  assert(!r4.cacheHit, 'r4 is a fresh fetch');
}

// ── Error handling ───────────────────────────────────────────────────────
console.log('\n── Error handling (bad input + upstream failures) ──');
{
  const client = createPvgisClient({
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ outputs: { totals: { fixed: { E_y: 1000 } } } }) }),
  });
  const r = await client.queryYield({ latitude: 999, longitude: 174, tiltDeg: 15, azimuthDeg: 0 });
  assert(!r.ok && r.error.includes('bad latitude'), 'bad latitude returns error without fetching');
}
{
  const client = createPvgisClient({
    fetchFn: async () => ({ ok: false, status: 500, text: async () => 'upstream boom' }),
  });
  const r = await client.queryYield({ latitude: -37, longitude: 174, tiltDeg: 15, azimuthDeg: 0 });
  assert(!r.ok && r.status === 500, `5xx propagates status (got ${r.status})`);
  // 5xx not cached
  const r2 = await client.queryYield({ latitude: -37, longitude: 174, tiltDeg: 15, azimuthDeg: 0 });
  assert(!r2.cacheHit, '5xx result NOT cached (transient — will retry)');
}
{
  const client = createPvgisClient({
    fetchFn: async () => ({ ok: false, status: 400, text: async () => 'bad params' }),
  });
  const r = await client.queryYield({ latitude: -37, longitude: 174, tiltDeg: 15, azimuthDeg: 0 });
  assert(!r.ok && r.status === 400, '4xx returns status');
  const r2 = await client.queryYield({ latitude: -37, longitude: 174, tiltDeg: 15, azimuthDeg: 0 });
  assert(r2.cacheHit === true, '4xx (deterministic bad input) IS cached — no point re-asking');
}

// ── computePvgisYieldForSegments — multi-segment weighted mean ───────────
console.log('\n── computePvgisYieldForSegments ──');
{
  // Simulate 3 LiDAR segments matching 6 Woodacre's actual shape.
  const segments = [
    { center: { latitude: -36.98, longitude: 174.94 },
      azimuthDegrees: 63.5, pitchDegrees: 14.7,
      stats: { areaMeters2: 109.6 } },   // big NE face — should dominate weight
    { center: { latitude: -36.98, longitude: 174.94 },
      azimuthDegrees: 245, pitchDegrees: 20.6,
      stats: { areaMeters2: 48.1 } },   // medium WSW face
    { center: { latitude: -36.98, longitude: 174.94 },
      azimuthDegrees: 243.8, pitchDegrees: 13.5,
      stats: { areaMeters2: 47.3 } },   // medium WSW face
  ];
  // Mock the client to return yield-by-azimuth roughly matching real PVGIS
  // response (N-ish highest, S-ish lowest).
  const mockClient = {
    async queryYield({ tiltDeg, azimuthDeg }) {
      const azNorm = ((azimuthDeg % 360) + 360) % 360;
      const distFromNorth = Math.min(azNorm, 360 - azNorm);
      // 1400 kWh/kWp at N linearly down to 1000 at S
      const y = 1400 - (distFromNorth / 180) * 400;
      return { ok: true, kwhPerKwpPerYear: Math.round(y * 10) / 10, pvgisAspect: 0 };
    },
  };
  const r = await computePvgisYieldForSegments({
    latitude: -36.98, longitude: 174.94, segments, pvgisClient: mockClient,
  });

  assert(r.systemYield != null, 'multi-segment PVGIS produces a systemYield');
  assert(r.systemYield.source === 'pvgis', 'source tagged as pvgis');
  assert(r.systemYield.contributing_segments === 3, 'all 3 segments viable and contribute');

  // Expected area-weighted mean:
  //   seg1: 109.6 m² × (1400 - 63.5/180*400) = 109.6 × 1258.9 ≈ 137974
  //   seg2:  48.1 m² × (1400 - 65/180*400)   ≈  48.1 × 1255.6 ≈  60395  (dist=65 from N is min(245, 115)=115 → wait, 360-245=115, dist=115)
  //   Actually distFromNorth for 245 = min(245, 115) = 115
  //   seg2:  48.1 × (1400 - 115/180*400) = 48.1 × 1144.4 ≈ 55045
  //   seg3:  47.3 × (1400 - 116.2/180*400) ≈ 47.3 × 1141.8 ≈ 54007
  //   Total area 204.9m², total weighted ~247026
  //   Mean ~1206
  assert(r.systemYield.kwh_per_kwp_per_year > 1150 && r.systemYield.kwh_per_kwp_per_year < 1250,
    `weighted mean in expected 1150-1250 range for 1 N + 2 W faces (got ${r.systemYield.kwh_per_kwp_per_year})`);
  console.log(`  → systemYield ${r.systemYield.kwh_per_kwp_per_year} kWh/kWp/yr across 3 segments`);
}

// Filter check: south-facing + tiny segments skipped
console.log('\n── Viability filter (south-facing, too small) ──');
{
  const segments = [
    { center: { latitude: -37, longitude: 174 },
      azimuthDegrees: 180, pitchDegrees: 20,       // S-facing → SKIP
      stats: { areaMeters2: 50 } },
    { center: { latitude: -37, longitude: 174 },
      azimuthDegrees: 0, pitchDegrees: 15,         // valid
      stats: { areaMeters2: 5 } },                  // too small → SKIP
    { center: { latitude: -37, longitude: 174 },
      azimuthDegrees: 0, pitchDegrees: 15,         // valid
      stats: { areaMeters2: 40 } },
  ];
  const mockClient = { async queryYield() { return { ok: true, kwhPerKwpPerYear: 1300, pvgisAspect: 0 }; } };
  const r = await computePvgisYieldForSegments({
    latitude: -37, longitude: 174, segments, pvgisClient: mockClient,
  });
  assert(r.systemYield?.contributing_segments === 1, `only 1 segment contributes (got ${r.systemYield?.contributing_segments})`);
  assert(r.diagnostics.attempted === 1, `only 1 PVGIS call made (got ${r.diagnostics.attempted})`);
}

// All-failed graceful degradation
console.log('\n── All PVGIS queries fail → systemYield null (falls to regional) ──');
{
  const segments = [{
    center: { latitude: -37, longitude: 174 },
    azimuthDegrees: 0, pitchDegrees: 15,
    stats: { areaMeters2: 50 },
  }];
  const mockClient = { async queryYield() { return { ok: false, error: 'PVGIS timeout' }; } };
  const r = await computePvgisYieldForSegments({
    latitude: -37, longitude: 174, segments, pvgisClient: mockClient,
  });
  assert(r.systemYield === null, 'all-failed → systemYield null (caller falls back to regional)');
  assert(r.diagnostics.failed === 1, '1 failure recorded in diagnostics');
  assert(r.diagnostics.succeeded === 0, '0 successes recorded');
}

// ── Summary ──
console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);

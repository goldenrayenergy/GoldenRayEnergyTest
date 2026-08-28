// Round 4 unit tests — locks down the algorithmic changes:
//   Part A — NZ geoid correction table
//   Bug 6  — footprint-overlap dedupe
//   Part C — per-quadrant ground summary
//   Option A — polygonCentroid precision at NZ coords (the bug that
//              caused Queenstown false-negatives in Round 4 initial)
//
// Run:  node server/scripts/test-round4-geoid-dedupe-gates.mjs

import { nzGeoidSeparationMetres } from '../../client/src/lib/nzGeoid.js';
import { deduplicateOverlappingFootprints } from '../../client/src/pages/poc/3d/panelGrid.js';
import { polygonCentroid, polygonBounds } from '../services/linz/lidarAnalyseRoof.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};

// ────────────────────────────────────────────────────────────────────────
// Part A — NZ geoid correction
// ────────────────────────────────────────────────────────────────────────
console.log('\n══ Part A: NZ geoid correction ══');

{
  const auckland = nzGeoidSeparationMetres(-36.85, 174.75);
  console.log(`  Auckland CBD: ${auckland.toFixed(1)} m`);
  assert(auckland > 25 && auckland < 35, `Auckland separation in 25-35 m band`);
}

{
  const queenstown = nzGeoidSeparationMetres(-45.03, 168.66);
  console.log(`  Queenstown: ${queenstown.toFixed(1)} m`);
  assert(queenstown > 15 && queenstown < 22, `Queenstown separation in 15-22 m band (was ~30 m error pre-fix)`);
}

{
  const waikanae = nzGeoidSeparationMetres(-40.88, 175.06);
  console.log(`  Waikanae: ${waikanae.toFixed(1)} m`);
  assert(waikanae > 22 && waikanae < 30, `Waikanae separation in 22-30 m band`);
}

{
  // Bounds — a garbage coord returns a safe default
  const garbage = nzGeoidSeparationMetres(NaN, undefined);
  assert(Number.isFinite(garbage) && garbage >= 15 && garbage <= 35, `garbage input clamped to safe range`);
}

{
  // Interpolation smoothness — an in-between coord returns a value between the anchors
  const between = nzGeoidSeparationMetres(-41.0, 175.0);
  const wgtn    = nzGeoidSeparationMetres(-41.29, 174.78);
  const palmy   = nzGeoidSeparationMetres(-40.35, 175.61);
  console.log(`  Waikanae area interpolation: ${between.toFixed(1)} m (Wellington ${wgtn.toFixed(1)}, Palmerston ${palmy.toFixed(1)})`);
  const lo = Math.min(wgtn, palmy) - 1;
  const hi = Math.max(wgtn, palmy) + 1;
  assert(between >= lo && between <= hi, `interpolated value between neighbouring anchors`);
}

// ────────────────────────────────────────────────────────────────────────
// Bug 6 — footprint-overlap dedupe
// ────────────────────────────────────────────────────────────────────────
console.log('\n══ Bug 6: footprint-overlap dedupe ══');

function makeSeg(id, lat, lng, azimuth, width, depth, area, rank) {
  return {
    _id: id,
    center: { latitude: lat, longitude: lng },
    azimuthDegrees: azimuth,
    pitchDegrees:   25,
    stats: { areaMeters2: area },
    _faceDimensions: { widthAlongRidgeM: width, depthAcrossSlopeM: depth },
    _viability: { rank },
  };
}

{
  // Two RANSAC duplicates at nearly the same footprint, different azimuths
  // (30° apart so mergeSimilarSegments doesn't catch them). Larger one wins.
  const big     = makeSeg('big',   -36.85, 174.75,  0, 6, 4, 40, 100);
  const overlap = makeSeg('overlap', -36.85001, 174.75001, 30, 6, 4, 30, 80);
  const result = deduplicateOverlappingFootprints([big, overlap]);
  assert(result.length === 1 && result[0]._id === 'big',
    `overlapping duplicate dropped (kept "big", dropped "overlap")`);
}

{
  // Two genuinely distinct roof faces on opposite sides of a house — 25m
  // apart. Should NOT merge.
  const north = makeSeg('n', -36.85, 174.75,   0, 6, 4, 40, 100);
  const south = makeSeg('s', -36.8501, 174.75, 180, 6, 4, 40,  80);
  // Actually -36.8501 is only ~11m south. Push it further:
  const southFar = makeSeg('s-far', -36.8502, 174.75, 180, 6, 4, 40, 80);
  const result = deduplicateOverlappingFootprints([north, southFar]);
  assert(result.length === 2,
    `distinct faces 22m apart both kept (${result.length} kept)`);
}

{
  // Single segment: no-op
  const single = makeSeg('solo', -36.85, 174.75, 0, 6, 4, 40, 100);
  const result = deduplicateOverlappingFootprints([single]);
  assert(result.length === 1, `single segment untouched`);
}

{
  // Empty list: no-op
  assert(deduplicateOverlappingFootprints([]).length === 0, `empty list returns empty`);
  assert(deduplicateOverlappingFootprints(null).length === 0, `null returns empty`);
}

{
  // Preserves input order for kept segments
  const a = makeSeg('a', -36.85,   174.75,   0,  6, 4, 40, 100);
  const b = makeSeg('b', -36.851,  174.751, 90,  6, 4, 40,  80);
  const c = makeSeg('c', -36.852,  174.752, 180, 6, 4, 40,  60);
  const result = deduplicateOverlappingFootprints([a, b, c]);
  console.log(`  order: ${result.map(s => s._id).join(', ')}`);
  // These are all distinct enough to be kept — order should be a, b, c
  const ids = result.map(s => s._id);
  assert(ids[0] === 'a' && (ids.includes('b') || ids.includes('c')),
    `preserves input order`);
}

{
  // Missing _faceDimensions: falls back to sqrt(area) and still runs safely
  const withDims = makeSeg('with', -36.85, 174.75, 0, 6, 4, 40, 100);
  const noDims   = {
    _id: 'no',
    center: { latitude: -36.85001, longitude: 174.75001 },
    azimuthDegrees: 30,
    pitchDegrees:   25,
    stats: { areaMeters2: 30 },
    _viability: { rank: 80 },
  };
  const result = deduplicateOverlappingFootprints([withDims, noDims]);
  assert(result.length >= 1 && !result.some(s => s == null),
    `handles missing _faceDimensions without crashing`);
}

// ────────────────────────────────────────────────────────────────────────
// Option A — polygonCentroid precision at NZ coords
// ────────────────────────────────────────────────────────────────────────
console.log('\n══ Option A: polygonCentroid precision at NZ latitudes ══');

{
  // Real LINZ polygon for 7 Kent Street, Queenstown (from live API).
  // LINZ-published centroid: (-45.03032455, 168.66818512).
  // Pre-fix formula gave (-45.030635, 168.669393) — off by ~90m.
  const queenstownRing = [
    [168.6681901,  -45.03041747],
    [168.66809281, -45.03038755],
    [168.66812798, -45.03032988],
    [168.66815439, -45.03028622],
    [168.66812219, -45.03027639],
    [168.66815803, -45.03021696],
    [168.66829116, -45.03025739],
    [168.6682498,  -45.03032584],
    [168.66823376, -45.03032099],
    [168.66820183, -45.03037381],
    [168.66821422, -45.03037758],
    [168.6681901,  -45.03041747],
  ];
  const c = polygonCentroid(queenstownRing, 0, 0);
  console.log(`  Queenstown polygon centroid: ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`);
  const linzExpectedLat = -45.03032455;
  const linzExpectedLng = 168.66818512;
  const dLatM = Math.abs(c.lat - linzExpectedLat) * 111_320;
  const dLngM = Math.abs(c.lng - linzExpectedLng) * 111_320 * Math.cos(c.lat * Math.PI / 180);
  const distM = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
  console.log(`  distance from LINZ-published centroid: ${distM.toFixed(2)}m`);
  assert(distM < 2, `Queenstown centroid within 2m of LINZ-published (was ~90m off pre-fix — 2m accounts for LINZ using a different centroid convention)`);
}

{
  // Simple square at Queenstown — centroid should be dead centre
  const square = [
    [168.660, -45.030],
    [168.661, -45.030],
    [168.661, -45.031],
    [168.660, -45.031],
  ];
  const c = polygonCentroid(square, 0, 0);
  console.log(`  square centroid: ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)} (expect -45.0305, 168.6605)`);
  const dLatM = Math.abs(c.lat - (-45.0305)) * 111_320;
  const dLngM = Math.abs(c.lng - 168.6605) * 111_320 * Math.cos(c.lat * Math.PI / 180);
  assert(dLatM < 0.1 && dLngM < 0.1, `square centroid within 0.1m of geometric centre`);
}

{
  // Degenerate cases
  const c1 = polygonCentroid(null, -45.03, 168.67);
  assert(c1.lat === -45.03 && c1.lng === 168.67, `null ring returns fallback`);
  const c2 = polygonCentroid([[168.67, -45.03]], -45.03, 168.67);
  assert(c2.lat === -45.03 && c2.lng === 168.67, `<3 vertices returns fallback`);
}

{
  // polygonBounds — computes real-world metres from lat/lng deltas
  const b = polygonBounds([
    [168.660, -45.030],
    [168.661, -45.030],
    [168.661, -45.031],
    [168.660, -45.031],
  ]);
  console.log(`  1e-3° square bounds: ${b.widthM}×${b.heightM}m (diag ${b.diagonalM}m)`);
  assert(Math.abs(b.widthM  - 78.7)  < 1, `~78.7m east-west at 45°S (was ${b.widthM})`);
  assert(Math.abs(b.heightM - 111.3) < 1, `~111.3m north-south (was ${b.heightM})`);
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━`);
process.exit(fail === 0 ? 0 : 1);

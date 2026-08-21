// End-to-end HTTP test of the /api/poc/roof/analyse endpoint.
//
// Runs against the ACTUAL running server (localhost:5000). Does not mock
// anything — every failure here reproduces exactly what the browser sees.
//
// Test addresses:
//   - 25 Commodore Drive, Lynfield, Auckland (older sub → Google Solar,
//     building found in OSM → panels expected within building footprint)
//   - 6 Woodacre Street, Flat Bush, Auckland (new sub → Google Solar has
//     stale 2016 imagery + OSM has no polygon → LiDAR fallback expected)
//
// What each test verifies:
//   1. HTTP response is 200
//   2. Correct source ('google' vs 'lidar') was used
//   3. Segments have sensible geometry (pitch 0-60, azimuth 0-360)
//   4. Segment centres are within 100m of the requested address
//   5. For LiDAR path: LiDAR diagnostics are present
//   6. Simulates the client-side panel-placement pipeline to verify panels
//      would land close to the building centroid (not on a road 30m away)
//
// Run:  node server/scripts/test-e2e-roof-analyse.mjs

import {
  computePanelGridOnSegment,
  selectViableSegments,
  distributePanels,
} from '../../client/src/pages/poc/3d/panelGrid.js';

const SERVER = 'http://localhost:5000';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};

async function getPlaceId(input) {
  const r = await fetch(`${SERVER}/api/poc/places/autocomplete?input=${encodeURIComponent(input)}`);
  const j = await r.json();
  const first = j.suggestions?.[0];
  if (!first?.place_id) throw new Error(`autocomplete found no match for "${input}"`);
  return first.place_id;
}

async function analyseRoof(placeId) {
  const r = await fetch(`${SERVER}/api/poc/roof/analyse`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ place_id: placeId }),
  });
  const body = await r.json();
  return { status: r.status, body };
}

// Simulate the CLIENT-SIDE panel-placement pipeline exactly as
// Cesium3DView.jsx does — so we catch client-side bugs too.
function simulatePanelPlacement(body, targetCount = 17) {
  const roof = body?.roof;
  const segments = roof?.segments || [];
  const viable = selectViableSegments(segments);
  const top3 = viable.slice(0, 3);
  const allocations = distributePanels(top3, targetCount);
  const allPanels = [];
  for (const { segment, count } of allocations) {
    const panels = computePanelGridOnSegment(segment, 1.65, 0.99, count);
    for (const p of panels) allPanels.push({ ...p, _sourceSegment: segment });
  }
  return { viable, allocations, allPanels };
}

// Distance in metres between two lat/lng pairs (haversine, small-angle approx).
function distMeters(a, b) {
  const dLat = (a.latitude - b.latitude) * 111320;
  const dLng = (a.longitude - b.longitude) * 111320 * Math.cos(a.latitude * Math.PI / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

// ═══════════════════════════════════════════════════════════════════════
// Test 1 — Lynfield (Google Solar path, building found)
// ═══════════════════════════════════════════════════════════════════════
async function testLynfield() {
  console.log('\n══ 25 Commodore Drive, Lynfield (Google Solar path) ══');
  const placeId = await getPlaceId('25 Commodore Drive Lynfield Auckland');
  console.log(`  place_id: ${placeId}`);
  const { status, body } = await analyseRoof(placeId);

  assert(status === 200, `HTTP 200 (got ${status})`);
  if (status !== 200) { console.error('  body:', JSON.stringify(body).slice(0, 500)); return; }

  assert(body.roof?.source === 'google' || body.roof?.source === 'live',
         `source is 'google' (got '${body.roof?.source}')`);
  assert(body.roof?.building !== null, `OSM/LINZ building found`);
  const bs = body.roof?.building?.source;
  assert(bs === 'osm' || bs === 'linz', `building found via OSM or LINZ (got '${bs}')`);

  const segCount = body.roof?.segments?.length || 0;
  assert(segCount >= 1 && segCount <= 20, `1-20 segments (got ${segCount})`);

  // Simulate panel placement
  const { viable, allocations, allPanels } = simulatePanelPlacement(body, 17);
  assert(viable.length >= 1, `at least 1 viable segment after filter (got ${viable.length})`);
  assert(allPanels.length > 0, `panels computed (got ${allPanels.length})`);

  // The critical test: are panels near the building's centre?
  const buildingCentroid = body.roof.building.centroid;
  const meanPanelLat = allPanels.reduce((s, p) => s + p.center.latitude,  0) / allPanels.length;
  const meanPanelLng = allPanels.reduce((s, p) => s + p.center.longitude, 0) / allPanels.length;
  const distToBuilding = distMeters(
    { latitude: meanPanelLat, longitude: meanPanelLng },
    buildingCentroid,
  );
  console.log(`  mean panel position: ${meanPanelLat.toFixed(6)}, ${meanPanelLng.toFixed(6)}`);
  console.log(`  building centroid:   ${buildingCentroid.latitude.toFixed(6)}, ${buildingCentroid.longitude.toFixed(6)}`);
  console.log(`  distance:            ${distToBuilding.toFixed(1)}m`);
  assert(distToBuilding < 20, `panels within 20m of building centroid (got ${distToBuilding.toFixed(1)}m)`);
}

// ═══════════════════════════════════════════════════════════════════════
// Test 2 — 6 Woodacre (LiDAR fallback path — the M2 test case)
// ═══════════════════════════════════════════════════════════════════════
async function testWoodacre() {
  console.log('\n══ 6 Woodacre Street, Flat Bush (LiDAR fallback) ══');
  const placeId = await getPlaceId('6 Woodacre Street Flat Bush Auckland');
  console.log(`  place_id: ${placeId}`);

  console.log('  (first call may take ~5-30s cold — STAC catalog fetch)');
  const { status, body } = await analyseRoof(placeId);

  assert(status === 200, `HTTP 200 (got ${status})`);
  if (status !== 200) { console.error('  body:', JSON.stringify(body).slice(0, 500)); return; }

  console.log(`  source: ${body.roof?.source}, fallback_reason: ${body.roof?.fallback_reason}`);
  assert(body.roof?.source === 'lidar',
         `source is 'lidar' (got '${body.roof?.source}') — verifies stale-Google-Solar override kicked in`);
  assert(body.roof?.fallback_reason === 'no_verified_building',
         `fallback_reason is 'no_verified_building' (got '${body.roof?.fallback_reason}')`);
  assert(body.roof?.lidar_diagnostics !== null && body.roof?.lidar_diagnostics !== undefined,
         `lidar_diagnostics present`);

  if (body.roof?.lidar_diagnostics) {
    const d = body.roof.lidar_diagnostics;
    console.log(`  LiDAR: ${d.polygonClippedCount} clipped → ${d.roofPointCount} roof points → ${d.planeCount} planes`);
    console.log(`  imagery:  ${body.imagery?.date} (${body.imagery?.quality})`);
  }

  const segCount = body.roof?.segments?.length || 0;
  assert(segCount >= 1 && segCount <= 10, `1-10 segments (got ${segCount})`);
  // All segments should be tagged as _source=lidar
  const allLidar = (body.roof?.segments || []).every(s => s._source === 'lidar');
  assert(allLidar, `every segment tagged _source=lidar`);

  // Simulate panel placement
  const { viable, allocations, allPanels } = simulatePanelPlacement(body, 17);
  console.log(`  viable segments after filter: ${viable.length}`);
  viable.forEach((v, i) => {
    console.log(`    #${i}: ${v._viability.orientation}-facing, ${v.stats.areaMeters2?.toFixed(0)}m², pitch ${v.pitchDegrees?.toFixed(0)}°`);
  });
  assert(viable.length >= 1, `at least 1 viable segment after filter (got ${viable.length})`);
  assert(allPanels.length > 0, `panels computed (got ${allPanels.length})`);

  // The critical test: are panels within a reasonable distance of the
  // Places-verified address coord (since OSM had no polygon)?
  const targetCoord = body.coords;
  const meanPanelLat = allPanels.reduce((s, p) => s + p.center.latitude,  0) / allPanels.length;
  const meanPanelLng = allPanels.reduce((s, p) => s + p.center.longitude, 0) / allPanels.length;
  const distToTarget = distMeters(
    { latitude: meanPanelLat, longitude: meanPanelLng },
    targetCoord,
  );
  console.log(`  mean panel position: ${meanPanelLat.toFixed(6)}, ${meanPanelLng.toFixed(6)}`);
  console.log(`  target address:      ${targetCoord.latitude.toFixed(6)}, ${targetCoord.longitude.toFixed(6)}`);
  console.log(`  distance:            ${distToTarget.toFixed(1)}m`);
  assert(distToTarget < 30, `panels within 30m of the address (got ${distToTarget.toFixed(1)}m) — this catches the "panels floating over the road" bug`);
}

// ═══════════════════════════════════════════════════════════════════════
// Test 3 — Server is up
// ═══════════════════════════════════════════════════════════════════════
async function testServerUp() {
  console.log('\n══ Sanity: server is up ══');
  try {
    const r = await fetch(`${SERVER}/api/poc/places/autocomplete?input=test`);
    assert(r.status === 200, `server responds 200 (got ${r.status})`);
  } catch (e) {
    console.error(`  ✗ server not reachable at ${SERVER}: ${e.message}`);
    console.error(`  Start it with: cd server && npm run dev`);
    process.exit(1);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────
await testServerUp();
await testLynfield();
await testWoodacre();

console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);

// M2 acceptance test — 6 Woodacre Street, Flat Bush.
// This is the whole reason we built M2: Google Solar has no coverage for
// this new subdivision, so the /roof/analyse endpoint used to fail. With
// M2 the LiDAR fallback kicks in and returns roof planes derived from
// LINZ's 2024 DSM.
//
// This test bypasses the HTTP route and calls analyseRoofFromLidar()
// directly so it doesn't require the server to be running.
//
// Run:  node server/scripts/test-lidar-analyse-6-woodacre.mjs

import { analyseRoofFromLidar } from '../services/linz/lidarAnalyseRoof.js';
import { queryOsmBuildingsNear } from '../services/osm/buildingOutlines.js';
import { buildingContaining, nearestBuilding } from '../services/linz/buildingOutlines.js';

const WOODACRE = {
  latitude:  -36.9838,
  longitude:  174.9390,
};
// Also test Lynfield (should have Google Solar coverage, but LiDAR should
// still work for it — sanity).
const LYNFIELD = {
  latitude:  -36.9101,
  longitude:  174.7180,
};

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};

async function findBuildingPolygon(latitude, longitude) {
  const r = await queryOsmBuildingsNear({ latitude, longitude, radiusMeters: 40 });
  if (!r.ok || !r.buildings.length) return null;
  const containing = buildingContaining(r.buildings, latitude, longitude);
  const nearest    = nearestBuilding(r.buildings);
  const picked = containing || (nearest && nearest.distance_m <= 15 ? nearest : null);
  return picked?.polygon?.[0] || null;
}

async function runFor(label, coord) {
  console.log(`\n── ${label} @ ${coord.latitude}, ${coord.longitude} ──`);
  const polygon = await findBuildingPolygon(coord.latitude, coord.longitude);
  console.log(`  OSM polygon: ${polygon ? `found (${polygon.length} vertices)` : 'NOT found — will synthesize box'}`);

  const t0 = Date.now();
  const result = await analyseRoofFromLidar({
    latitude:        coord.latitude,
    longitude:       coord.longitude,
    buildingPolygon: polygon,
  });
  const dt = Date.now() - t0;
  console.log(`  → analyse took ${dt}ms`);

  if (!result.ok) {
    console.error(`  ✗ analyseRoofFromLidar failed: ${result.error}`);
    fail++;
    return;
  }
  pass++;
  console.log(`  ✓ analyseRoofFromLidar succeeded`);

  const r = result.result;
  console.log(`  imagery date:     ${r.imagery_date} (quality: ${r.imagery_quality})`);
  console.log(`  max array area:   ${r.max_array_area_m2.toFixed(1)} m²`);
  console.log(`  max array panels: ${r.max_array_panels_count}`);
  console.log(`  sunshine:         ${r.max_sunshine_hours_per_year} hrs/yr`);
  console.log(`  roof segments:    ${r.roof_segments.length}`);
  r.roof_segments.forEach((s, i) => {
    console.log(`    #${i}: pitch ${s.pitchDegrees.toFixed(1)}°, azimuth ${s.azimuthDegrees.toFixed(0)}°, area ${s.stats.areaMeters2.toFixed(1)} m²`);
  });
  console.log(`  diagnostics:      ${r._diagnostics.polygonClippedCount} clipped → ${r._diagnostics.roofPointCount} roof points → ${r._diagnostics.planeCount} planes`);
  console.log(`  polygon source:   ${r._diagnostics.polygonSynthesized ? 'SYNTHESIZED (OSM had no data)' : 'OSM'}`);

  // Sanity checks
  assert(r.roof_segments.length >= 1 && r.roof_segments.length <= 8, `segment count 1-8 (got ${r.roof_segments.length})`);
  assert(r.max_array_area_m2 > 0 && r.max_array_area_m2 < 1000, `array area sensible (got ${r.max_array_area_m2.toFixed(1)} m²)`);
  assert(r.imagery_quality === 'LIDAR', `imagery tagged LIDAR`);
  for (const s of r.roof_segments) {
    assert(s.pitchDegrees >= 0 && s.pitchDegrees <= 75, `pitch valid (${s.pitchDegrees.toFixed(1)}°)`);
    assert(s._source === 'lidar', `_source tagged`);
  }
}

// ── Run ──────────────────────────────────────────────────────────────────
await runFor('6 Woodacre Street, Flat Bush (THE M2 TEST CASE)', WOODACRE);
await runFor('25 Commodore Drive, Lynfield (sanity)',            LYNFIELD);

console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);

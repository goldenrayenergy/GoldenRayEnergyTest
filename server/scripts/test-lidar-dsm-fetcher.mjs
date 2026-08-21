// End-to-end smoke test for the LINZ DSM fetcher.
//
// This hits the real nz-elevation S3 bucket (no auth needed — open data).
// Run:  node server/scripts/test-lidar-dsm-fetcher.mjs
//
// Verifies each layer independently so failures point at the right place:
//   1. Coord transforms round-trip cleanly
//   2. STAC catalog lookup finds a COG for a known Auckland point
//   3. Windowed COG read returns sensible elevation points
//   4. Polygon clipping keeps only points inside the ring
//
// Uses two test addresses:
//   - 6 Woodacre Street, Flat Bush (new sub — the whole reason for M2)
//   - 25 Commodore Drive, Lynfield (older sub — for sanity)

import {
  wgs84ToNztm,
  nztmToWgs84,
  findDsmCogForPoint,
  readDsmWindow,
  clipPointsToPolygon,
  loadCollectionItemIndex,
} from '../services/linz/lidarDsmFetcher.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};

// ── 1. Coord transforms round-trip ───────────────────────────────────────
console.log('\n── 1. Coord transforms (WGS84 ↔ NZTM2000) ──');
{
  // Sky Tower, Auckland — well-known coord: 174.7629°E, 36.8485°S
  //   NZTM (verified via proj4): E 1,757,174  N 5,920,483
  const nztm = wgs84ToNztm(174.7629, -36.8485);
  assert(nztm.x > 1_756_000 && nztm.x < 1_758_000, `Sky Tower easting ~1757000 (got ${nztm.x.toFixed(0)})`);
  assert(nztm.y > 5_920_000 && nztm.y < 5_921_000, `Sky Tower northing ~5920500 (got ${nztm.y.toFixed(0)})`);

  const back = nztmToWgs84(nztm.x, nztm.y);
  assert(Math.abs(back.lng - 174.7629) < 0.0001, `round-trip lng (got ${back.lng.toFixed(6)})`);
  assert(Math.abs(back.lat - -36.8485) < 0.0001, `round-trip lat (got ${back.lat.toFixed(6)})`);
}

// ── 2. STAC catalog lookup ───────────────────────────────────────────────
console.log('\n── 2. STAC catalog lookup ──');
console.log('(This will fetch ~150 item.json files from S3 on cold cache — 15-30s)');
{
  // 25 Commodore Drive Lynfield — Google Solar works here so it's a good
  // sanity check that DSM lookup also works. Older suburb, likely in the
  // 2016-2018 survey since 2024 didn't cover south Auckland fully.
  const lynfield = { latitude: -36.9101, longitude: 174.7180 };
  console.log(`  looking up DSM for Lynfield ${lynfield.latitude}, ${lynfield.longitude}`);
  const t0 = Date.now();
  const hit = await findDsmCogForPoint(lynfield);
  const dt = Date.now() - t0;
  console.log(`  → took ${dt}ms`);
  assert(hit !== null, `Lynfield: COG found`);
  if (hit) {
    console.log(`  → collection: ${hit.collectionPath}`);
    console.log(`  → COG URL:    ${hit.cogUrl}`);
    console.log(`  → bbox:       ${JSON.stringify(hit.bbox)}`);
    assert(hit.cogUrl.endsWith('.tiff'), `URL ends in .tiff`);
    assert(hit.bbox[0] < 174.7180 && hit.bbox[2] > 174.7180, `bbox contains lng`);
    assert(hit.bbox[1] < -36.9101 && hit.bbox[3] > -36.9101, `bbox contains lat`);
  }

  // 6 Woodacre Street, Flat Bush — the new sub Google Solar doesn't cover.
  const flatBush = { latitude: -36.9838, longitude: 174.9390 };
  console.log(`  looking up DSM for Flat Bush ${flatBush.latitude}, ${flatBush.longitude}`);
  const t1 = Date.now();
  const hit2 = await findDsmCogForPoint(flatBush);
  const dt2 = Date.now() - t1;
  console.log(`  → took ${dt2}ms (cached collections should make this fast)`);
  assert(hit2 !== null, `Flat Bush: COG found (THE 6 Woodacre test case)`);
  if (hit2) {
    console.log(`  → collection: ${hit2.collectionPath}`);
    console.log(`  → COG URL:    ${hit2.cogUrl}`);
  }
}

// ── 3. Windowed COG read ─────────────────────────────────────────────────
console.log('\n── 3. Windowed COG read ──');
{
  // Read a 60m radius window around the Lynfield test address.
  const lynfield = { latitude: -36.9101, longitude: 174.7180 };
  const hit = await findDsmCogForPoint(lynfield);
  if (!hit) {
    console.error('  ⚠ skipping window read — no COG for Lynfield');
  } else {
    console.log(`  reading 60m window from ${hit.cogUrl.split('/').pop()}`);
    const t0 = Date.now();
    const dsm = await readDsmWindow({
      cogUrl: hit.cogUrl,
      latitude:  lynfield.latitude,
      longitude: lynfield.longitude,
      radiusMeters: 60,
    });
    const dt = Date.now() - t0;
    console.log(`  → took ${dt}ms`);
    console.log(`  → resolution: ${dsm.resolutionM}m/px, window ${dsm.windowSize.widthPx}×${dsm.windowSize.heightPx} px`);
    console.log(`  → ${dsm.points.length} elevation points returned`);
    assert(dsm.resolutionM > 0 && dsm.resolutionM < 5, `1m resolution (got ${dsm.resolutionM})`);
    // A 120m×120m window at 1m = 14400 pixels — allow for some pixels dropped
    // as no-data.
    assert(dsm.points.length > 10_000, `enough points for a 120m×120m window (got ${dsm.points.length})`);

    // Statistical sanity: Lynfield is inland, ridge ~80m. Points should span
    // roughly 40-100m elevations.
    const zs = dsm.points.map(p => p.z);
    const zMin = Math.min(...zs);
    const zMax = Math.max(...zs);
    const zMedian = zs.sort((a, b) => a - b)[Math.floor(zs.length / 2)];
    console.log(`  → elevation range: min ${zMin.toFixed(1)}m, median ${zMedian.toFixed(1)}m, max ${zMax.toFixed(1)}m`);
    assert(zMin > 0 && zMin < 200, `min elevation plausible (got ${zMin.toFixed(1)})`);
    assert(zMax < 300, `max elevation plausible (got ${zMax.toFixed(1)})`);
    assert(zMax - zMin > 2, `elevation range shows relief (roof + ground); got ${(zMax - zMin).toFixed(1)}m`);
  }
}

// ── 4. Polygon clip ──────────────────────────────────────────────────────
console.log('\n── 4. Polygon clip ──');
{
  const lynfield = { latitude: -36.9101, longitude: 174.7180 };
  const hit = await findDsmCogForPoint(lynfield);
  if (!hit) {
    console.error('  ⚠ skipping polygon clip test — no COG');
  } else {
    const dsm = await readDsmWindow({
      cogUrl: hit.cogUrl,
      latitude: lynfield.latitude, longitude: lynfield.longitude,
      radiusMeters: 60,
    });

    // Tiny 20m×20m square polygon around the centre — should keep way fewer
    // points than the full 120m×120m window.
    const centerLng = lynfield.longitude, centerLat = lynfield.latitude;
    const dLng = 0.00012, dLat = 0.00009;   // ~10m
    const square = [
      [centerLng - dLng, centerLat - dLat],
      [centerLng + dLng, centerLat - dLat],
      [centerLng + dLng, centerLat + dLat],
      [centerLng - dLng, centerLat + dLat],
      [centerLng - dLng, centerLat - dLat],   // close ring
    ];
    const inside = clipPointsToPolygon(dsm.points, square);
    console.log(`  → clipped from ${dsm.points.length} points to ${inside.length} inside a 20m×20m square`);
    assert(inside.length > 100 && inside.length < 500, `clip yields ~400 points (got ${inside.length})`);
    assert(inside.length < dsm.points.length, `polygon clip actually reduces count`);
  }
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);

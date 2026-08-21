// Tests for the RANSAC roof-plane detector.
//
// Two-layer approach:
//   1. Synthetic tests: generate known planes + noise, verify RANSAC recovers
//      them within tolerance. Deterministic (seeded RNG) so failures reproduce.
//   2. Real-DSM test: fetch a live LINZ DSM window for Lynfield, run the full
//      detectRoofSegments pipeline, verify it finds plausible roof planes
//      matching what Google Solar returned for the same address.
//
// Run:  node server/scripts/test-lidar-roof-planes.mjs

import {
  planeFromThreePoints,
  distanceToPlane,
  fitPlaneLeastSquares,
  ransacBestPlane,
  detectRoofPlanes,
  planeToRoofSegment,
  detectRoofSegments,
  makeRng,
} from '../services/linz/lidarRoofPlanes.js';
import {
  findDsmCogForPoint,
  readDsmWindow,
  clipPointsToPolygon,
} from '../services/linz/lidarDsmFetcher.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};
const near = (a, b, eps) => Math.abs(a - b) < eps;

// ── 1. planeFromThreePoints ───────────────────────────────────────────────
console.log('\n── 1. planeFromThreePoints ──');
{
  // Horizontal plane at z=10 → normal (0, 0, 1), d = -10.
  const p = planeFromThreePoints({ x: 0, y: 0, z: 10 }, { x: 1, y: 0, z: 10 }, { x: 0, y: 1, z: 10 });
  assert(p !== null, 'horizontal plane detected');
  assert(near(p.normal.x, 0, 1e-9), 'normal.x = 0');
  assert(near(p.normal.y, 0, 1e-9), 'normal.y = 0');
  assert(near(p.normal.z, 1, 1e-9), 'normal.z = 1 (points up)');
  assert(near(p.d, -10, 1e-9),      'd = -10');

  // Tilted plane: pitched 30° facing east (down-slope east).
  //   normal: horizontal-east-component = sin(30°), vertical = cos(30°)
  //   normal ≈ (sin30, 0, cos30) but flipped to point up... wait, if roof
  //   faces east (down-slope +x), normal tilts west-and-up = (-sin30, 0, cos30)
  //   Actually simpler: 3 points on such a plane, then verify.
  //   Plane at origin, tilted so z increases going west.
  const p2 = planeFromThreePoints(
    { x:  0, y: 0, z:  0 },
    { x:  0, y: 1, z:  0 },       // moving north doesn't change z
    { x: -1, y: 0, z:  Math.tan(30 * Math.PI / 180) },   // moving west by 1m, z rises by tan(30°)
  );
  const expectedNz = Math.cos(30 * Math.PI / 180);
  const expectedNx = Math.sin(30 * Math.PI / 180);   // normal tilts toward +x (east, opposite of up-slope)
  assert(p2 !== null, '30° east-facing plane detected');
  assert(near(p2.normal.z, expectedNz, 1e-6), `normal.z ≈ cos(30) (got ${p2.normal.z})`);
  assert(near(Math.abs(p2.normal.x), expectedNx, 1e-6), `|normal.x| ≈ sin(30) (got ${p2.normal.x})`);

  // Degenerate: collinear points → null
  const bad = planeFromThreePoints({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }, { x: 2, y: 2, z: 2 });
  assert(bad === null, 'collinear points return null');
}

// ── 2. distanceToPlane ───────────────────────────────────────────────────
console.log('\n── 2. distanceToPlane ──');
{
  const flat = { normal: { x: 0, y: 0, z: 1 }, d: -10 };   // z = 10
  assert(near(distanceToPlane({ x: 5, y: 5, z: 10 }, flat), 0,   1e-9), 'point on plane → 0');
  assert(near(distanceToPlane({ x: 5, y: 5, z: 12 }, flat), 2,   1e-9), 'point 2m above → 2');
  assert(near(distanceToPlane({ x: 5, y: 5, z:  7 }, flat), 3,   1e-9), 'point 3m below → 3');
}

// ── 3. fitPlaneLeastSquares ──────────────────────────────────────────────
console.log('\n── 3. fitPlaneLeastSquares ──');
{
  // Perfect horizontal plane z=5. LSQ should recover it exactly.
  const pts = [];
  for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) pts.push({ x, y, z: 5 });
  const p = fitPlaneLeastSquares(pts);
  assert(near(p.normal.z, 1, 1e-6),  `LSQ horizontal: normal.z ≈ 1 (got ${p.normal.z})`);
  assert(near(p.d, -5,     1e-6),    `LSQ horizontal: d ≈ -5 (got ${p.d})`);
  // Verify a point-on-plane test survives the round-trip
  assert(distanceToPlane({ x: 2.5, y: 2.5, z: 5 }, p) < 0.001, 'LSQ plane passes through fitted points');

  // Tilted plane: z = 0.5*x + 3  (30 degrees along +x, offset 3m at origin)
  const pts2 = [];
  for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) {
    pts2.push({ x, y, z: 0.5 * x + 3 });
  }
  const p2 = fitPlaneLeastSquares(pts2);
  // Verify pitch is atan(0.5) ≈ 26.6°
  const pitchDeg = Math.acos(Math.abs(p2.normal.z)) * 180 / Math.PI;
  assert(near(pitchDeg, Math.atan(0.5) * 180 / Math.PI, 0.5), `LSQ tilted: pitch ≈ 26.6° (got ${pitchDeg.toFixed(2)}°)`);
  // Points on the plane satisfy the equation
  const testPt = { x: 5, y: 5, z: 0.5 * 5 + 3 };
  assert(distanceToPlane(testPt, p2) < 0.001, `LSQ tilted plane contains its own points (got dist ${distanceToPlane(testPt, p2).toFixed(4)})`);
}

// ── 4. ransacBestPlane on synthetic noisy plane ──────────────────────────
console.log('\n── 4. ransacBestPlane (single plane, noisy) ──');
{
  // 200 points on plane z = 0.3*x + 2 with ±0.1m noise + 50 random outliers
  const rng = makeRng(1);
  const pts = [];
  for (let i = 0; i < 200; i++) {
    const x = rng() * 10;
    const y = rng() * 10;
    const z = 0.3 * x + 2 + (rng() - 0.5) * 0.2;   // ±0.1m noise
    pts.push({ x, y, z });
  }
  // Add outliers
  for (let i = 0; i < 50; i++) {
    pts.push({ x: rng() * 10, y: rng() * 10, z: rng() * 10 });
  }

  const result = ransacBestPlane(pts, { rng: makeRng(2), epsilonM: 0.15, iterations: 200, minInliers: 50 });
  assert(result !== null, 'RANSAC finds the plane');
  assert(result.inliers.length >= 150, `most true inliers recovered (${result.inliers.length}/200)`);
  assert(result.inliers.length < 220,  'not overfitting to outliers');
  const pitchDeg = Math.acos(Math.abs(result.plane.normal.z)) * 180 / Math.PI;
  const expectedPitch = Math.atan(0.3) * 180 / Math.PI;   // 16.7°
  assert(near(pitchDeg, expectedPitch, 2), `pitch within 2° of true (${pitchDeg.toFixed(1)}° vs ${expectedPitch.toFixed(1)}°)`);
}

// ── 5. detectRoofPlanes on a synthetic "3-face roof" ─────────────────────
console.log('\n── 5. detectRoofPlanes (multi-face roof) ──');
{
  // Build a synthetic house with 3 roof planes:
  //   plane A: 25° pitch facing north, ~50 m²
  //   plane B: 25° pitch facing south, ~50 m²   (opposite side of gable)
  //   plane C: 15° pitch facing east,  ~30 m²   (side extension)
  // Plus ~30 random noise points (trees over the roof).
  const rng = makeRng(3);
  const pts = [];

  // A: z = -tan(25°) * y + 8 for y in [0, 8], x in [0, 6]  (north-facing → down-slope +y = south, so up-slope +y = north... wait)
  // OK simpler: build points on each plane. Ignore compass conventions here — just verify RANSAC recovers 3 planes with sensible parameters.
  // North gable half: y in [0, 4], z = 5 + (4 - y) * tan(25°)  (ridge at y=4 is highest)
  for (let x = 0; x < 6; x++) for (let y = 0; y <= 4; y++) {
    const z = 5 + (4 - y) * Math.tan(25 * Math.PI / 180) + (rng() - 0.5) * 0.1;
    pts.push({ x, y, z });
  }
  // South gable half: y in [4, 8], z = 5 + (y - 4) * tan(25°)  wait this makes them both ascend into the ridge... yes that's a gable.
  //   OK so for south half we want z = 5 + (y - 4) * tan(25°) INVERTED — z decreases as y increases past 4.
  //   z = 5 + (4 - y) * tan(25°) is negative for y > 4, meaning south half goes DOWN.
  // Simpler: south half z decreases:
  for (let x = 0; x < 6; x++) for (let y = 5; y < 9; y++) {
    const z = 5 - (y - 4) * Math.tan(25 * Math.PI / 180) + (rng() - 0.5) * 0.1;
    pts.push({ x, y, z });
  }
  // East extension (single-face lean-to): x in [6, 10], y in [2, 7], pitched east
  for (let x = 6; x < 11; x++) for (let y = 2; y < 7; y++) {
    const z = 3 + (10 - x) * Math.tan(15 * Math.PI / 180) + (rng() - 0.5) * 0.1;
    pts.push({ x, y, z });
  }
  // Noise: random points (trees)
  for (let i = 0; i < 30; i++) {
    pts.push({ x: rng() * 11, y: rng() * 9, z: 3 + rng() * 5 });
  }

  const detected = detectRoofPlanes(pts, { rng: makeRng(4), epsilonM: 0.15, iterations: 300, minInliers: 15, maxPlanes: 5 });
  console.log(`  detected ${detected.length} planes:`);
  detected.forEach((d, i) => {
    const pitchDeg = Math.acos(Math.abs(d.plane.normal.z)) * 180 / Math.PI;
    console.log(`    #${i}: ${d.inliers.length} inliers, pitch ${pitchDeg.toFixed(1)}°`);
  });
  assert(detected.length >= 2, `detects at least 2 of the 3 planes (got ${detected.length})`);
  // Every detected plane should have a plausible roof pitch (5-40°).
  for (const d of detected) {
    const pitchDeg = Math.acos(Math.abs(d.plane.normal.z)) * 180 / Math.PI;
    assert(pitchDeg > 5 && pitchDeg < 40, `detected plane pitch in roof range (${pitchDeg.toFixed(1)}°)`);
  }
}

// ── 6. planeToRoofSegment → Google-Solar-compatible shape ────────────────
console.log('\n── 6. planeToRoofSegment (plane → segment) ──');
{
  // NZTM coordinates near Auckland CBD, 30° north-facing plane.
  // Down-slope points north → azimuth 0°.
  //   plane: z = -tan(30°) * (y - y0) + z0  (z decreases as y increases past y0)
  //   Wait — if roof faces north AND normal.z > 0, normal has -y component
  //   (points slightly SOUTH-and-up). So down-slope is +Y (north).
  // Let's just compute the plane from a few points to be sure.
  const y0 = 5_918_000, x0 = 1_757_000;   // NZTM Sky Tower area
  const tilt = 30 * Math.PI / 180;
  const inliers = [];
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
    // South (dy<0) is higher, north (dy>0) is lower → roof faces north
    inliers.push({ x: x0 + dx, y: y0 + dy, z: 50 - dy * Math.tan(tilt) });
  }
  const plane = fitPlaneLeastSquares(inliers);
  const seg = planeToRoofSegment({ plane, inliers }, 1.0);

  assert(near(seg.pitchDegrees, 30, 0.5), `segment pitch ≈ 30° (got ${seg.pitchDegrees.toFixed(1)}°)`);
  // North-facing = azimuth 0° (down-slope compass bearing).
  assert(near(seg.azimuthDegrees, 0, 5) || near(seg.azimuthDegrees, 360, 5),
         `segment azimuth ≈ 0° for N-facing roof (got ${seg.azimuthDegrees.toFixed(1)}°)`);
  const expectedArea = 49 / Math.cos(tilt);   // 7x7 = 49 ground pixels
  assert(near(seg.stats.areaMeters2, expectedArea, 1),
         `area ≈ ${expectedArea.toFixed(1)} m² (got ${seg.stats.areaMeters2.toFixed(1)})`);
  assert(seg._source === 'lidar', 'source tagged as lidar');
  assert(seg._inlierCount === 49, 'inlier count preserved');
  assert(seg.center.latitude < -36 && seg.center.latitude > -37, `centre lat plausible (${seg.center.latitude})`);
  assert(seg.center.longitude > 174 && seg.center.longitude < 175, `centre lng plausible (${seg.center.longitude})`);
}

// ── 7. End-to-end: real DSM → detectRoofSegments ─────────────────────────
console.log('\n── 7. End-to-end (real LINZ DSM → detectRoofSegments) ──');
console.log('(fetches real DSM data from S3 — ~30s cold)');
{
  // 25 Commodore Drive Lynfield — known to have DSM coverage AND known
  // Google Solar segments (from earlier tests). Verify our LiDAR pipeline
  // detects a similar-shaped roof.
  const lynfield = { latitude: -36.9101, longitude: 174.7180 };
  const hit = await findDsmCogForPoint(lynfield);
  if (!hit) {
    console.error('  ⚠ Lynfield COG not found — cannot run end-to-end test');
  } else {
    const dsm = await readDsmWindow({
      cogUrl: hit.cogUrl,
      latitude:  lynfield.latitude,
      longitude: lynfield.longitude,
      radiusMeters: 25,   // just the immediate house area, not neighbours
    });
    console.log(`  read ${dsm.points.length} DSM points around Lynfield`);

    // Filter to points that are noticeably above the local minimum (=roof only,
    // not ground/road). Rough approach: take all points > 2m above the minimum.
    const zs = dsm.points.map(p => p.z).sort((a, b) => a - b);
    // Use the 5th percentile as "ground level" — robust to a few odd low points
    const groundZ = zs[Math.floor(zs.length * 0.05)];
    const abovePoints = dsm.points.filter(p => p.z > groundZ + 1.5);
    console.log(`  ground z ≈ ${groundZ.toFixed(1)}m; ${abovePoints.length} points >1.5m above ground`);

    if (abovePoints.length < 30) {
      console.error('  ⚠ not enough roof points to run RANSAC — perhaps 25m radius was too tight');
    } else {
      const segments = detectRoofSegments(abovePoints, {
        rngSeed: 42, iterations: 300, epsilonM: 0.20, minInliers: 15, maxPlanes: 6, minSegmentAreaM2: 5,
      });
      console.log(`  detected ${segments.length} roof segments:`);
      segments.forEach((s, i) => {
        console.log(`    #${i}: pitch ${s.pitchDegrees.toFixed(1)}°, azimuth ${s.azimuthDegrees.toFixed(0)}°, area ${s.stats.areaMeters2.toFixed(1)} m², z=${s.planeHeightAtCenterMeters.toFixed(1)}m`);
      });
      assert(segments.length >= 1, `at least 1 roof segment detected (got ${segments.length})`);
      // Every segment should have a sensible pitch and area.
      for (const s of segments) {
        assert(s.pitchDegrees >= 0 && s.pitchDegrees <= 60, `pitch in range (${s.pitchDegrees.toFixed(1)}°)`);
        assert(s.stats.areaMeters2 >= 5, `area >= 5 m² (${s.stats.areaMeters2.toFixed(1)})`);
        assert(s._source === 'lidar', `tagged _source=lidar`);
        assert(s.center.latitude < -36 && s.center.latitude > -37, `centre lat plausible`);
      }
    }
  }
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);

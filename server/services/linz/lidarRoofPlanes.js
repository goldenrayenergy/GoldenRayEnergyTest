// ────────────────────────────────────────────────────────────────────────────
// RANSAC roof-plane detector on LINZ 1m DSM points.
//
// Input:  points in NZTM2000 easting/northing/elevation ({x, y, z}), clipped
//         to the customer's building polygon (from lidarDsmFetcher.js).
// Output: an array of detected planes, each described as a
//         Google-Solar-compatible "roof segment" so the existing
//         Cesium3DView + panelGrid pipeline can consume it unchanged.
//
// RANSAC (RANdom SAmple Consensus) is the classic robust plane detector for
// noisy point clouds. Rationale over least-squares:
//   - LSQ fits one plane to ALL points, so a house with 2 gables produces a
//     nonsense "average" plane. RANSAC extracts the biggest plane, removes
//     its inliers, and repeats — giving us multi-face detection.
//   - LSQ is dominated by outliers (trees over the roof, chimneys). RANSAC
//     is robust to outliers by design — an inlier is a point within
//     `epsilon` of the plane; outliers just don't count.
//
// Algorithm per plane:
//   1. Randomly pick 3 non-collinear points → compute the plane through them
//   2. Count inliers (points within `epsilon` metres of that plane)
//   3. Repeat for N iterations, keep the plane with the most inliers
//   4. Refit that plane via least-squares over its inliers (smoother normal)
//   5. Remove inliers from the pool; go to 1 for the next plane
//   6. Stop when: too few points remain, or best plane has too few inliers
//
// Output plane → segment conversion:
//   - normal (a, b, c) → azimuth (compass bearing of down-slope) + pitch
//   - inlier centroid → segment centre (converted to WGS84)
//   - inlier count / cos(pitch) → surface area in m²
// ────────────────────────────────────────────────────────────────────────────

import { nztmToWgs84 } from './lidarDsmFetcher.js';

// ── Seeded RNG for deterministic tests ───────────────────────────────────
// Mulberry32 — simple, fast, good enough distribution for RANSAC sampling.
function makeRng(seed = 42) {
  let s = seed >>> 0;
  return function() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Vector + plane primitives ────────────────────────────────────────────

/**
 * Compute the plane through three points, expressed as (normal, d) where the
 * plane equation is (normal · p) + d = 0 with normal unit-length.
 * Returns null if the three points are (nearly) collinear.
 */
export function planeFromThreePoints(p1, p2, p3) {
  const v1x = p2.x - p1.x, v1y = p2.y - p1.y, v1z = p2.z - p1.z;
  const v2x = p3.x - p1.x, v2y = p3.y - p1.y, v2z = p3.z - p1.z;
  // Cross product v1 × v2 = normal
  const nx = v1y * v2z - v1z * v2y;
  const ny = v1z * v2x - v1x * v2z;
  const nz = v1x * v2y - v1y * v2x;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-6) return null;   // degenerate — collinear points
  const unitNx = nx / len, unitNy = ny / len, unitNz = nz / len;
  // Force normal to point up (+z) — makes pitch math unambiguous.
  const flip = unitNz < 0 ? -1 : 1;
  const normal = { x: unitNx * flip, y: unitNy * flip, z: unitNz * flip };
  const d = -(normal.x * p1.x + normal.y * p1.y + normal.z * p1.z);
  return { normal, d };
}

/** Perpendicular distance from a point to a unit-normal plane. */
export function distanceToPlane(p, plane) {
  return Math.abs(plane.normal.x * p.x + plane.normal.y * p.y + plane.normal.z * p.z + plane.d);
}

/**
 * Fit a plane to N points using least-squares. Used to refine the RANSAC
 * plane over its inliers — the 3-point sample is noise-sensitive; the LSQ
 * refit averages out the noise and gives a smoother normal.
 *
 * Approach: solve the normal equations for the plane z = a*x + b*y + c
 * (treats z as a function of x,y — works well when the plane isn't
 * near-vertical, which is always true for roofs pitched < 55°).
 *
 * IMPORTANT: recentres points around their mean before fitting to avoid
 * numerical precision loss at NZTM2000 coordinate scales (~10^6 eastings
 * make sums-of-squares ~10^12, which blows out Cramer's rule at double
 * precision). Without this, `pitch` comes out as 0° for real DSM data.
 */
export function fitPlaneLeastSquares(points) {
  if (points.length < 3) return null;
  const n = points.length;

  // Centroid — recentre before summing to keep numbers ~O(radius) not O(10^6).
  let mx = 0, my = 0, mz = 0;
  for (const p of points) { mx += p.x; my += p.y; mz += p.z; }
  mx /= n; my /= n; mz /= n;

  // Build the 3x3 normal-equation matrix on RECENTRED points.
  let sxx = 0, sxy = 0, sxz = 0;
  let syy = 0, syz = 0, sz = 0;
  let sx = 0, sy = 0;
  for (const p of points) {
    const x = p.x - mx, y = p.y - my, z = p.z - mz;
    sxx += x * x; sxy += x * y; sxz += x * z;
    syy += y * y; syz += y * z; sz  += z;
    sx  += x;     sy  += y;
  }
  // Solve 3x3: [[sxx sxy sx] [sxy syy sy] [sx sy n]] [a b c'] = [sxz syz sz]
  //   (c' is the intercept in RECENTRED coords)
  const M = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx,  sy,  n ],
  ];
  const rhs = [sxz, syz, sz];
  const abc = solve3x3(M, rhs);
  if (!abc) return null;
  const [a, b, cPrime] = abc;
  // In recentred coords the plane is z' = a*x' + b*y' + c', which is
  //   a*x' + b*y' - z' + c' = 0
  //   (Nx, Ny, Nz, D_recentred) = (a, b, -1, c')
  //
  // Un-recentre: (x, y, z) = (x'+mx, y'+my, z'+mz), so
  //   a*(x-mx) + b*(y-my) - (z-mz) + c' = 0
  //   a*x + b*y - z + (c' - a*mx - b*my + mz) = 0
  //   Nx*x + Ny*y + Nz*z + D_orig = 0  with D_orig = c' - a*mx - b*my + mz
  const dOriginal = cPrime - a * mx - b * my + mz;

  // Scale by flip/len to unit-normalize AND force normal.z > 0.
  const flip = -1;   // Nz was -1 → multiply everything by -1 to make Nz > 0
  const len = Math.sqrt(a * a + b * b + 1);
  return {
    normal: { x: a * flip / len, y: b * flip / len, z: -1 * flip / len },
    d:      dOriginal * flip / len,
  };
}

// Cramer's rule 3x3 — small, no external deps.
function solve3x3(M, rhs) {
  const det =
      M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
    - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
    + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (Math.abs(det) < 1e-9) return null;
  const detA =
      rhs[0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
    - M[0][1] * (rhs[1] * M[2][2] - M[1][2] * rhs[2])
    + M[0][2] * (rhs[1] * M[2][1] - M[1][1] * rhs[2]);
  const detB =
      M[0][0] * (rhs[1] * M[2][2] - M[1][2] * rhs[2])
    - rhs[0] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
    + M[0][2] * (M[1][0] * rhs[2] - rhs[1] * M[2][0]);
  const detC =
      M[0][0] * (M[1][1] * rhs[2] - rhs[1] * M[2][1])
    - M[0][1] * (M[1][0] * rhs[2] - rhs[1] * M[2][0])
    + rhs[0] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  return [detA / det, detB / det, detC / det];
}

// ── RANSAC ────────────────────────────────────────────────────────────────

/**
 * Run RANSAC to find the single best plane in a point set.
 *
 * @param {Array<{x,y,z}>} points
 * @param {object} [opts]
 * @param {number} [opts.iterations=300]       RANSAC iterations
 * @param {number} [opts.epsilonM=0.20]        inlier distance threshold (m)
 * @param {number} [opts.minInliers=15]        below this = no plane
 * @param {() => number} [opts.rng=Math.random] injected RNG for tests
 * @returns {{
 *   plane: {normal:{x,y,z}, d:number},
 *   inliers: Array<{x,y,z}>,
 *   outliers: Array<{x,y,z}>,
 * } | null}
 */
export function ransacBestPlane(points, opts = {}) {
  const iterations = opts.iterations ?? 300;
  const epsilon    = opts.epsilonM   ?? 0.20;
  const minInliers = opts.minInliers ?? 15;
  const rng        = opts.rng        ?? Math.random;
  if (points.length < Math.max(3, minInliers)) return null;

  let bestPlane = null;
  let bestInlierCount = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Sample 3 distinct points
    const i1 = Math.floor(rng() * points.length);
    let i2 = Math.floor(rng() * points.length);
    let i3 = Math.floor(rng() * points.length);
    if (i2 === i1) i2 = (i1 + 1) % points.length;
    if (i3 === i1 || i3 === i2) i3 = (Math.max(i1, i2) + 1) % points.length;
    const plane = planeFromThreePoints(points[i1], points[i2], points[i3]);
    if (!plane) continue;

    // Count inliers
    let count = 0;
    for (const p of points) {
      if (distanceToPlane(p, plane) < epsilon) count++;
    }
    if (count > bestInlierCount) {
      bestInlierCount = count;
      bestPlane = plane;
    }
  }

  if (!bestPlane || bestInlierCount < minInliers) return null;

  // Refit the winning plane via least-squares over its inliers — smoother
  // normal, less sensitive to noise in the 3-point sample.
  const inliers = points.filter(p => distanceToPlane(p, bestPlane) < epsilon);
  const refined = fitPlaneLeastSquares(inliers) || bestPlane;
  const finalInliers = points.filter(p => distanceToPlane(p, refined) < epsilon);
  const outliers = points.filter(p => distanceToPlane(p, refined) >= epsilon);

  if (finalInliers.length < minInliers) return null;
  return { plane: refined, inliers: finalInliers, outliers };
}

/**
 * Iteratively extract multiple planes from a point set. Runs RANSAC, removes
 * the inliers, repeats until no more planes can be found.
 *
 * @param {Array<{x,y,z}>} points
 * @param {object} [opts]        — same as ransacBestPlane, plus:
 * @param {number} [opts.maxPlanes=8]        stop after this many planes
 * @param {number} [opts.minRemainingPoints=30]  stop if fewer points left
 * @param {number} [opts.rngSeed=42]          seed for deterministic runs
 * @returns {Array<{plane, inliers, outliers}>}
 */
export function detectRoofPlanes(points, opts = {}) {
  const maxPlanes           = opts.maxPlanes ?? 8;
  const minRemainingPoints  = opts.minRemainingPoints ?? 30;
  const rng                 = opts.rng || makeRng(opts.rngSeed ?? 42);
  const iterations          = opts.iterations ?? 300;
  const epsilonM            = opts.epsilonM   ?? 0.20;
  const minInliers          = opts.minInliers ?? 15;

  const planes = [];
  let pool = [...points];

  while (pool.length >= minRemainingPoints && planes.length < maxPlanes) {
    const result = ransacBestPlane(pool, { iterations, epsilonM, minInliers, rng });
    if (!result) break;
    planes.push(result);
    pool = result.outliers;
  }

  return planes;
}

// ── Plane → segment conversion ───────────────────────────────────────────

/**
 * Convert a detected plane (in NZTM coordinates) into a Google-Solar-
 * compatible roofSegmentStats object. The Cesium3DView + panelGrid pipeline
 * consumes this shape unchanged.
 *
 * @param {{plane, inliers}} detected  from ransacBestPlane / detectRoofPlanes
 * @param {number} pixelAreaM2         DSM cell area (usually 1.0 for 1m grid)
 * @returns {{
 *   pitchDegrees:                number,
 *   azimuthDegrees:              number,
 *   stats: {
 *     areaMeters2:               number,
 *     groundAreaMeters2:         number,
 *   },
 *   center:                      { latitude, longitude },
 *   planeHeightAtCenterMeters:   number,
 *   _source:                     'lidar',
 *   _inlierCount:                number,
 * }}
 */
export function planeToRoofSegment({ plane, inliers }, pixelAreaM2 = 1.0) {
  const n = plane.normal;

  // Pitch: angle between the plane's normal and vertical (+Z).
  //   cos(θ) = n.z (since both are unit vectors)
  //   pitch  = angle from horizontal = angle between normal and +Z
  //          = acos(n.z)
  const pitchRad = Math.acos(Math.max(-1, Math.min(1, n.z)));
  const pitchDegrees = pitchRad * 180 / Math.PI;

  // Azimuth (compass bearing of DOWN-SLOPE direction, matching Google Solar).
  //
  // Geometry: for a roof tilting down toward direction D, the surface normal
  // (forced to point up, normal.z > 0) tilts toward D as well — think of
  // standing on a ramp going down east, your body's "up" tilts east too.
  // So the horizontal component of the normal (nx, ny) points in the same
  // horizontal direction as the down-slope.
  //
  // Compass bearing from N:
  //   bearing = atan2(east_component, north_component)
  //   where east=+x, north=+y in NZTM (both are geographic east/north).
  const dsX = n.x, dsY = n.y;
  let azimuthDegrees = Math.atan2(dsX, dsY) * 180 / Math.PI;
  if (azimuthDegrees < 0) azimuthDegrees += 360;

  // Compute the ACTUAL roof face dimensions from the inlier point cloud —
  // NOT a sqrt(area) estimate. This is what makes panels FIT ON THE ROOF:
  // downstream panel-grid code uses these dimensions to cap grid extent so
  // panels don't overflow the roof edges.
  //
  // Project each inlier point onto the roof-plane local axes:
  //   u = along-ridge (perpendicular to down-slope, horizontal)
  //   v = up-slope (in-plane, tilted by roof pitch)
  //
  // The u/v spread of the inliers = the roof face's actual width × depth.

  // Area. Each DSM pixel represents pixelAreaM2 of GROUND area. The actual
  // roof surface area is larger for pitched planes:
  //   surface_area = ground_area / cos(pitch)
  const groundAreaMeters2 = inliers.length * pixelAreaM2;
  const cosP = Math.max(0.01, Math.cos(pitchRad));   // guard against divide-by-tiny
  const areaMeters2 = groundAreaMeters2 / cosP;

  // Centroid (NZTM), then convert to WGS84 for the segment output.
  let cx = 0, cy = 0, cz = 0;
  for (const p of inliers) { cx += p.x; cy += p.y; cz += p.z; }
  cx /= inliers.length; cy /= inliers.length; cz /= inliers.length;
  const { lat, lng } = nztmToWgs84(cx, cy);

  // ── Actual face dimensions from inlier projection ──────────────────────
  // u-axis (along ridge, horizontal): perpendicular to horizontal projection of down-slope
  // v-axis (up-slope, in-plane): opposite of down-slope, tilted by roof pitch
  //
  // In world NZTM coords (x=east, y=north, z=up):
  //   down-slope horizontal direction ≈ (n.x, n.y) normalized
  //   u-axis (perpendicular to that, horizontal) = (-n.y, n.x, 0) / |horiz|
  //   v-axis = up-slope in-plane = we can use (-n.x, -n.y, +tan) but for
  //           WIDTH/DEPTH estimation an approximation is fine
  const horizMag = Math.sqrt(n.x * n.x + n.y * n.y);
  const eps = 1e-6;
  const uAxisX = horizMag > eps ? -n.y / horizMag : 1;
  const uAxisY = horizMag > eps ?  n.x / horizMag : 0;
  // Down-slope horizontal (points AWAY from up-slope)
  const dsXn = horizMag > eps ? n.x / horizMag : 0;
  const dsYn = horizMag > eps ? n.y / horizMag : 0;

  // Project every inlier onto (u, ds) — the two horizontal roof axes.
  let uMin = Infinity, uMax = -Infinity;
  let vMin = Infinity, vMax = -Infinity;   // v = signed distance along down-slope from centroid
  for (const p of inliers) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const u = dx * uAxisX + dy * uAxisY;
    const v = dx * dsXn   + dy * dsYn;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const widthAlongRidgeM   = Math.max(0, uMax - uMin);
  const depthAcrossSlopeGroundM = Math.max(0, vMax - vMin);
  // depth along the roof SURFACE (not ground projection) = ground depth / cos(pitch)
  const depthAcrossSlopeM  = depthAcrossSlopeGroundM / Math.max(Math.cos(pitchRad), 0.01);

  return {
    pitchDegrees,
    azimuthDegrees,
    stats: {
      areaMeters2,
      groundAreaMeters2,
    },
    center: {
      latitude:  lat,
      longitude: lng,
    },
    planeHeightAtCenterMeters: cz,
    // Real face dimensions — panel grid uses these to prevent overflow.
    _faceDimensions: {
      widthAlongRidgeM,      // horizontal, perpendicular to slope
      depthAcrossSlopeM,     // in-plane (surface), from up-slope edge to down-slope edge
    },
    _source: 'lidar',
    _inlierCount: inliers.length,
  };
}

/**
 * Merge segments that describe the same physical roof face — RANSAC over
 * noisy DSM points often finds 2-3 slightly-different planes for one
 * physical face (varying by a few degrees because of chimneys, ridge caps,
 * or tree shadows in the point cloud). Distributing panels across these
 * "different" segments causes overlapping panel grids in the same place.
 *
 * Two segments are considered the same face if:
 *   - azimuth within 15° (or 345° wraparound)
 *   - pitch within 5°
 *   - centre within 5m
 *
 * Merged segment = larger of the two areas + sum of inlier counts.
 */
export function mergeSimilarSegments(segments, opts = {}) {
  const azDegTol    = opts.azDegTol    ?? 15;
  const pitchDegTol = opts.pitchDegTol ?? 5;
  const centerMTol  = opts.centerMTol  ?? 5;
  if (!Array.isArray(segments) || segments.length < 2) return segments || [];

  const merged = [];
  const consumed = new Set();
  for (let i = 0; i < segments.length; i++) {
    if (consumed.has(i)) continue;
    let base = segments[i];
    consumed.add(i);
    for (let j = i + 1; j < segments.length; j++) {
      if (consumed.has(j)) continue;
      const other = segments[j];
      // Azimuth diff (wraparound).
      const azDiff = Math.min(
        Math.abs(base.azimuthDegrees - other.azimuthDegrees),
        360 - Math.abs(base.azimuthDegrees - other.azimuthDegrees),
      );
      const pitchDiff = Math.abs(base.pitchDegrees - other.pitchDegrees);
      const dLat = (base.center.latitude  - other.center.latitude)  * 111_320;
      const dLng = (base.center.longitude - other.center.longitude) * 111_320 * Math.cos(base.center.latitude * Math.PI / 180);
      const centerDist = Math.sqrt(dLat * dLat + dLng * dLng);

      if (azDiff <= azDegTol && pitchDiff <= pitchDegTol && centerDist <= centerMTol) {
        // Merge: keep the larger area as the base's area (approximation —
        // proper merge would refit LSQ over combined inliers, but we don't
        // have inlier points on the segment level here).
        base = {
          ...base,
          stats: {
            areaMeters2:      base.stats.areaMeters2 + other.stats.areaMeters2,
            groundAreaMeters2: (base.stats.groundAreaMeters2 || 0) + (other.stats.groundAreaMeters2 || 0),
          },
          _inlierCount: (base._inlierCount || 0) + (other._inlierCount || 0),
          _mergedFrom:  (base._mergedFrom || 1) + 1,
        };
        consumed.add(j);
      }
    }
    merged.push(base);
  }
  return merged;
}

/**
 * Top-level: detect planes + convert to segments + merge duplicates +
 * filter obvious non-roof planes.
 *
 * @param {Array<{x,y,z}>} points  polygon-clipped DSM points
 * @param {object} [opts]           passed through to detectRoofPlanes; plus:
 * @param {number} [opts.pixelAreaM2=1.0]  m² per DSM cell
 * @param {number} [opts.minSegmentAreaM2=5] discard segments smaller than this
 * @param {number} [opts.maxPitchDeg=75]   discard near-vertical planes (walls)
 * @returns {Array}  segments in Google-Solar-compatible shape
 */
export function detectRoofSegments(points, opts = {}) {
  const pixelAreaM2      = opts.pixelAreaM2 ?? 1.0;
  const minSegmentAreaM2 = opts.minSegmentAreaM2 ?? 5;
  const maxPitchDeg      = opts.maxPitchDeg ?? 75;

  const detected = detectRoofPlanes(points, opts);
  const rawSegments = detected.map(d => planeToRoofSegment(d, pixelAreaM2));
  // Merge before filtering so a merged pair passes minSegmentAreaM2 even if
  // each half didn't.
  const mergedSegments = mergeSimilarSegments(rawSegments, opts);
  return mergedSegments
    .filter(s => s.pitchDegrees <= maxPitchDeg)
    .filter(s => s.stats.areaMeters2 >= minSegmentAreaM2)
    // Return largest first so downstream picking (Cesium3DView selectViableSegments)
    // sees the primary roof face first.
    .sort((a, b) => b.stats.areaMeters2 - a.stats.areaMeters2);
}

// Named export for tests that want a fresh seeded RNG.
export { makeRng };

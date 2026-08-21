// ────────────────────────────────────────────────────────────────────────────
// LiDAR-based roof analyser — the M2 fallback wrapper.
//
// Produces the SAME shape as parseBuildingInsightsResponse (Google Solar's
// parser) so the /roof/analyse route can substitute this in transparently
// when Google Solar has no coverage.
//
// Pipeline:
//   1. Find the DSM COG covering the customer's coord (STAC lookup)
//   2. Read a 60m radius window from the COG (HTTP range requests)
//   3. Clip DSM points to the customer's building polygon
//   4. Filter points to those above local ground level (roof + trees, not
//      pavement/lawn around the house)
//   5. Run RANSAC to detect roof planes
//   6. Convert planes to Google-Solar-compatible roof_segments
//   7. Return the composite response
//
// Sunshine / CO2 numbers use NZ national averages since we don't compute
// per-pixel yield (that's the M3 heatmap work). Site survey confirms
// per-face yield.
// ────────────────────────────────────────────────────────────────────────────

import {
  findAllDsmCogsForPoint,
  readDsmWindow,
  clipPointsToPolygon,
} from './lidarDsmFetcher.js';
import { detectRoofSegments } from './lidarRoofPlanes.js';

// NZ national averages — Auckland-specific for now.
// TODO(M4): NIWA integration for per-address sunshine hours.
const NZ_DEFAULTS = {
  sunshineHoursPerYear:      1400,     // Auckland ~1400, national range 1200-1700
  carbonOffsetKgPerKwh:      0.098,    // NZ 2024 emissions-factor for grid
  panelPacking:              0.75,     // fraction of roof area usable (setbacks + walkways)
  panelFootprintM2:          1.65 * 0.99,   // typical 400W residential panel
};

/**
 * Analyse a roof from LINZ DSM.
 *
 * @param {object} p
 * @param {number} p.latitude
 * @param {number} p.longitude
 * @param {Array<[number, number]>} [p.buildingPolygon]  outer ring [[lng,lat],...]
 *   from OSM/LINZ. If absent, we synthesize a 15m×15m box around the coord.
 * @param {number} [p.windowRadiusM=60]  DSM read window radius
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   result?: {
 *     max_array_area_m2: number,
 *     max_array_panels_count: number,
 *     max_sunshine_hours_per_year: number,
 *     carbon_offset_factor_kg_per_kwh: number,
 *     imagery_quality: 'LIDAR',
 *     imagery_date: string,           // survey year, e.g. '2024'
 *     roof_segments: Array,           // Google-Solar-compatible shape
 *     _diagnostics: {
 *       cogUrl, collectionPath,
 *       dsmPointCount, roofPointCount, planeCount,
 *       groundZ, timings,
 *     },
 *   }
 * }>}
 */
export async function analyseRoofFromLidar({
  latitude,
  longitude,
  buildingPolygon = null,
  windowRadiusM   = 60,
}) {
  const timings = {};
  const t0 = Date.now();

  // 1. Find ALL COGs covering this coord (adjacent surveys / boundary tiles).
  //    We'll try each in order (newest first) until one returns valid pixels.
  //    Bbox-containment doesn't guarantee data — survey-boundary tiles can
  //    have the bbox include a point but the actual raster be all no-data.
  const candidates = await findAllDsmCogsForPoint({ latitude, longitude });
  timings.stacLookupMs = Date.now() - t0;
  if (candidates.length === 0) {
    return {
      ok: false,
      error: `No LiDAR DSM coverage for lat ${latitude}, lng ${longitude}. Not covered by any of LINZ's 102 nation-wide 1m DSM surveys.`,
    };
  }

  // 2. Read the DSM window from each candidate until one returns real data.
  const t1 = Date.now();
  let cog = null;
  let dsm = null;
  const attemptedCogs = [];
  for (const candidate of candidates) {
    attemptedCogs.push(candidate.collectionPath);
    const attempt = await readDsmWindow({
      cogUrl:     candidate.cogUrl,
      latitude, longitude,
      radiusMeters: windowRadiusM,
    });
    if (attempt.points.length > 0) {
      cog = candidate;
      dsm = attempt;
      break;
    }
  }
  timings.dsmReadMs = Date.now() - t1;
  if (!dsm) {
    return {
      ok: false,
      error: `Tried ${candidates.length} COG${candidates.length > 1 ? 's' : ''} but all returned zero valid pixels at this coord (probably a survey-boundary hole). Attempted: ${attemptedCogs.join(', ')}`,
    };
  }

  // 3. Clip to the building polygon.
  // If we don't have a polygon (e.g. brand-new sub not in OSM yet), fall
  // back to an 8m half-width box (16m×16m ≈ 256m²) around the coord.
  // Tight enough to stay on the customer's house and not leak into
  // neighbors, which was causing LiDAR-derived faces to be over-wide
  // and downstream panel grids to overflow.
  const t2 = Date.now();
  const ring = buildingPolygon || synthesizeBoxPolygon(latitude, longitude, 8);
  const clipped = clipPointsToPolygon(dsm.points, ring);
  timings.polygonClipMs = Date.now() - t2;
  if (clipped.length < 30) {
    return {
      ok: false,
      error: `Only ${clipped.length} DSM points fell inside the building polygon — not enough to detect roof planes. Building outline may be inaccurate.`,
    };
  }

  // 4. Filter to roof-level (above the local ground). The 5th percentile
  // of z is a robust ground-level estimate — resistant to a few odd low
  // pixels (drains, culverts, negative-height glitches). Anything > 1.5m
  // above that is a roof (or a tall shrub — RANSAC will reject those as
  // scattered points not fitting a plane).
  const zs = clipped.map(p => p.z).sort((a, b) => a - b);
  const groundZ = zs[Math.floor(zs.length * 0.05)];
  const roofPoints = clipped.filter(p => p.z > groundZ + 1.5);
  if (roofPoints.length < 20) {
    return {
      ok: false,
      error: `Only ${roofPoints.length} points above ground level ${groundZ.toFixed(1)}m — building may be single-storey with roof close to the ground threshold. Try a wider polygon.`,
    };
  }

  // 5. RANSAC — detect roof planes.
  const t3 = Date.now();
  const roofSegments = detectRoofSegments(roofPoints, {
    rngSeed:          42,     // deterministic per address for reproducible quotes
    iterations:       300,
    epsilonM:         0.20,
    minInliers:       15,
    maxPlanes:        6,
    minSegmentAreaM2: 5,
    pixelAreaM2:      1.0,    // 1m DSM
  });
  timings.ransacMs = Date.now() - t3;

  if (!roofSegments.length) {
    return {
      ok: false,
      error: `RANSAC detected no roof planes above threshold. Points may be too scattered (e.g. dense tree canopy over roof).`,
    };
  }

  // 6. Aggregate stats to match Google Solar's response shape.
  const totalRoofArea = roofSegments.reduce((s, seg) => s + seg.stats.areaMeters2, 0);
  const maxArrayArea = totalRoofArea * NZ_DEFAULTS.panelPacking;
  const maxArrayPanels = Math.floor(maxArrayArea / NZ_DEFAULTS.panelFootprintM2);

  // Extract survey year from collection path e.g. 'auckland-part-1_2024' → '2024-01-01'
  const yearMatch = cog.collectionPath.match(/_(\d{4})(?:-\d{4})?\//);
  const surveyYear = yearMatch ? yearMatch[1] : 'unknown';
  const imageryDate = surveyYear !== 'unknown' ? `${surveyYear}-01-01` : 'unknown';

  timings.totalMs = Date.now() - t0;

  return {
    ok: true,
    result: {
      max_array_area_m2:               maxArrayArea,
      max_array_panels_count:          maxArrayPanels,
      max_sunshine_hours_per_year:     NZ_DEFAULTS.sunshineHoursPerYear,
      carbon_offset_factor_kg_per_kwh: NZ_DEFAULTS.carbonOffsetKgPerKwh,
      imagery_quality: 'LIDAR',
      imagery_date:    imageryDate,
      roof_segments:   roofSegments,
      _diagnostics: {
        cogUrl:         cog.cogUrl,
        collectionPath: cog.collectionPath,
        dsmPointCount:  dsm.points.length,
        polygonClippedCount: clipped.length,
        roofPointCount: roofPoints.length,
        planeCount:     roofSegments.length,
        groundZ,
        polygonSynthesized: !buildingPolygon,
        timings,
      },
    },
  };
}

/**
 * Synthesize a rectangular polygon around a point. Used when OSM/LINZ don't
 * have the building outline (new subdivisions). Half-width in metres.
 * Kept tight (~8m) so LiDAR RANSAC's inliers stay on the CUSTOMER'S house
 * and don't leak into neighbors — the leakage caused panels to overflow
 * the roof edges downstream.
 * Returns a ring in [[lng, lat], ...] format.
 */
function synthesizeBoxPolygon(latitude, longitude, halfWidthMeters) {
  const METRES_PER_DEG_LAT = 111_320;
  const dLat = halfWidthMeters / METRES_PER_DEG_LAT;
  const dLng = halfWidthMeters / (METRES_PER_DEG_LAT * Math.cos(latitude * Math.PI / 180));
  return [
    [longitude - dLng, latitude - dLat],
    [longitude + dLng, latitude - dLat],
    [longitude + dLng, latitude + dLat],
    [longitude - dLng, latitude + dLat],
    [longitude - dLng, latitude - dLat],   // close the ring
  ];
}

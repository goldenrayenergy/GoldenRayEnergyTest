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
  wgs84ToNztm,
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
  // Round 4 (2026-08-26) — Bug 7/8 fix. When we don't have a polygon (new
  // subdivision not in OSM, sparse Queenstown/Waikanae coverage), the
  // synthesised box was 8m half-width — too tight for larger houses on
  // steep terrain where the address pin lands off-centre from the roof.
  // Bumped to 12m so a bigger fraction of the actual roof lands inside
  // the clip; combined with the looser point-count gate below, this
  // rescues addresses that previously errored with "not enough points."
  //
  // Trade-off: wider box CAN clip neighbouring roofs. Mitigated by the
  // ground-level filter (only points >1.5m above the LOCAL ground count
  // as roof, and RANSAC further filters to coherent planes), plus the
  // per-quadrant ground compute below (was global) so hillside plots
  // with sloped ground don't lose the actual roof to a bogus ground
  // threshold that got pulled down by one high-elevation quadrant.
  const t2 = Date.now();
  const polygonSynthesised = !buildingPolygon;
  const synthesisedHalfWidthM = 12;
  const ring = buildingPolygon || synthesizeBoxPolygon(latitude, longitude, synthesisedHalfWidthM);
  const clipped = clipPointsToPolygon(dsm.points, ring);
  timings.polygonClipMs = Date.now() - t2;
  // Bug 7/8 fix (2026-08-26): different acceptance gates for real-polygon
  // vs synthesised-box paths. Real polygons SHOULD produce plenty of
  // points; below 30 usually means the polygon is bad. Synthesised
  // boxes on steep terrain often clip fewer points because the box
  // straddles cliffs / retaining walls / partial coverage — accept
  // 15+ so Queenstown-style hillside plots aren't rejected.
  const minClippedPoints = polygonSynthesised ? 15 : 30;
  if (clipped.length < minClippedPoints) {
    return {
      ok: false,
      error: `Only ${clipped.length} DSM points fell inside the building polygon (min ${minClippedPoints} for ${polygonSynthesised ? 'synthesised box' : 'real polygon'}). ${polygonSynthesised ? 'Try a wider address pin or a different rooftop coord.' : 'Building outline may be inaccurate.'}`,
    };
  }

  // 4. Filter to roof-level (above the local ground).
  //
  // Bug 7/8 fix (2026-08-26): global 5th-percentile ground-Z fails on
  // hillside plots (Queenstown/Wellington/Dunedin/Kāpiti steep-terrain
  // suburbs). The uphill side of the box may sit at, say, 315m and the
  // downhill side at 305m — global 5th percentile lands near 306m, so
  // the entire uphill roof (~319m) reads as barely-above-ground and
  // most points get filtered out.
  //
  // Fix: compute ground-Z PER QUADRANT of the clip (NE / NW / SE / SW),
  // then subtract the appropriate quadrant's ground from each point.
  // Flat-terrain plots see essentially no behaviour change (all four
  // quadrant ground levels converge). Sloped plots correctly keep
  // their real roof points.
  const roofPoints = filterAboveLocalGround(clipped, latitude, longitude, 1.5);
  const groundZ = quadrantGroundSummary(clipped, latitude, longitude);
  if (roofPoints.length < 20) {
    return {
      ok: false,
      error: `Only ${roofPoints.length} points above local ground level — building may be single-storey too close to the ground threshold, or the address pin may be off-roof.${polygonSynthesised ? ' Try widening the pin or picking a different rooftop coord.' : ''}`,
    };
  }

  // 5. RANSAC — detect roof planes.
  const t3 = Date.now();
  let roofSegments = detectRoofSegments(roofPoints, {
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

  // 5b. Round 4-rework (2026-08-26) — plane-quality filter (Bug 7 Queenstown).
  // RANSAC can latch onto tree canopy or a neighbouring roof when the
  // LINZ polygon is oversized or Google Places' rooftop pin lands off
  // the actual house (Queenstown 7 Kent St reproduces this every time).
  // Reject planes whose centroid sits > 20 m from the building polygon
  // centroid (or address pin when no polygon).
  //
  // If SOME planes pass, use them (drops just the bad ones). If ALL
  // planes fail, FAIL THE ANALYSIS with a clear diagnostic — better UX
  // to route the customer to the SiteSurveyFallback (which now offers
  // Cal.com booking) than to show them visibly-wrong panels on the map.
  const referenceCentroid = polygonCentroid(buildingPolygon, latitude, longitude);
  const PLANE_DISTANCE_MAX_M = 20;
  const distanceOf = (seg) => {
    const dLat = (seg.center.latitude  - referenceCentroid.lat) * 111_320;
    const dLng = (seg.center.longitude - referenceCentroid.lng) * 111_320 *
                 Math.cos(referenceCentroid.lat * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLng * dLng);
  };
  const distancesByPlane = roofSegments.map(s => distanceOf(s));
  const planeCountBeforeQualityFilter = roofSegments.length;
  // Option A investigation (2026-08-26): full per-plane breakdown so
  // we can see everything RANSAC produced BEFORE the quality filter
  // trimmed it. Includes distance from reference centroid to inform
  // the algorithmic improvement.
  const planesDebug = roofSegments.map((s, i) => ({
    idx: i,
    center: s.center,
    pitchDeg: s.pitchDegrees,
    azimuthDeg: s.azimuthDegrees,
    areaM2: s.stats?.areaMeters2,
    inlierCount: s._inlierCount,
    distanceFromRefM: +distancesByPlane[i].toFixed(2),
    faceDimensions: s._faceDimensions || null,
    passesFilter: distancesByPlane[i] <= PLANE_DISTANCE_MAX_M,
  }));
  const nearReference = roofSegments.filter((s, i) => distancesByPlane[i] <= PLANE_DISTANCE_MAX_M);
  const planeQualityDropped = roofSegments.length - nearReference.length;
  if (nearReference.length > 0) {
    // Keep the near-centroid ones (may be the full set, may be a subset).
    //
    // NOTE (2026-08-26): a "pitched-plane preference" filter was tried
    // and reverted. Reason: Queenstown 7 Kent Street is a modern
    // black-clad house with a low-pitch/flat roof — verified via
    // Google Streetview during the fix. Filtering out flat planes
    // (assumed to be driveways/patios) also dropped the customer's
    // actual flat roof. Modern NZ residential architecture routinely
    // uses low-pitch designs — no clean heuristic separates
    // "flat roof" from "driveway" from raw LiDAR alone. Any future
    // attempt to prefer pitched planes needs a stronger signal
    // (e.g. building footprint intersection, elevation vs local
    // ground), not just pitch.
    roofSegments = nearReference;
  } else {
    // Every detected plane is > 20 m from the building — clear signal
    // that RANSAC picked wrong geometry (trees, neighbour's roof, etc).
    // Fail fast with an actionable error; the client's SiteSurveyFallback
    // will render friendly copy + Cal.com booking CTA.
    //
    // Option A investigation (2026-08-26): with the centroid precision
    // bug fixed, this branch now correctly identifies genuinely-wrong
    // RANSAC picks (rather than misfiring on legitimate roofs like it
    // did before). Any address that hits this branch really is a
    // pipeline failure — pin off-roof, LiDAR data missing the actual
    // house, or the reference building outline is for the wrong lot.
    const minDist = distancesByPlane.length ? Math.min(...distancesByPlane).toFixed(0) : '?';
    return {
      ok: false,
      error: `Detected ${roofSegments.length} roof plane(s) but the nearest one sits ${minDist}m from your building. This usually means the rooftop pin is off-target or the building isn't in our reference maps yet — please book a site survey.`,
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
        planeCountBeforeQualityFilter,
        planeQualityDroppedCount: planeQualityDropped,
        planeQualityDroppedAll:   nearReference.length === 0,
        // Option A investigation (2026-08-26): per-plane breakdown so
        // we can see WHY a plane was rejected + how far each plane sits
        // from the reference centroid. Helps diagnose whether RANSAC
        // is finding trees, wrong buildings, or genuine off-centre
        // faces on complex roofs.
        planesDebug: planesDebug,
        referenceCentroid,
        polygonBounds: buildingPolygon
          ? polygonBounds(buildingPolygon)
          : null,
        // Round 4 (2026-08-26): per-quadrant ground diagnostic replaces
        // the single scalar. UI can render the spread as evidence the
        // hillside detector kicked in on steep-terrain addresses.
        groundZ,
        groundZFallback: Number.isFinite(groundZ?.overall) ? groundZ.overall : null,
        polygonSynthesized: polygonSynthesised,
        synthesisedHalfWidthM: polygonSynthesised ? synthesisedHalfWidthM : null,
        minClippedPointsUsed: minClippedPoints,
        timings,
      },
    },
  };
}

/**
 * Compute a robust ground-Z for a point cloud, split into four quadrants
 * around the address centre. Returns { ne, nw, se, sw, overall }.
 *
 * Rationale (Round 4, 2026-08-26 Bug 7/8): the previous implementation
 * took the 5th-percentile Z over the WHOLE clip. On hillside plots
 * (Queenstown/Wellington/Dunedin/Kāpiti steep suburbs) the ground drops
 * several metres across a 24m box, so a global percentile pulls the
 * ground reference down to the downhill corner — the uphill roof then
 * reads as barely-above-ground and its points get filtered out.
 *
 * Per-quadrant compute means each part of the box uses ITS local ground
 * so the roof-point filter stays accurate everywhere on sloped sites.
 * On flat sites all four quadrants converge — no behaviour change.
 *
 * `overall` is the min of the four quadrants (a safety floor used when
 * a quadrant has too few points for a stable 5th percentile).
 */
function quadrantGroundSummary(points, centreLat, centreLng) {
  // Points are in NZTM easting/northing ({x, y, z}). Convert the WGS84
  // centre once and split on NZTM x (east) / y (north) — cheaper than
  // per-point nztmToWgs84 and produces identical geographic quadrants
  // because NZTM axes align with cardinal directions in NZ latitudes.
  const centreNztm = wgs84ToNztm(centreLng, centreLat);
  const bins = { ne: [], nw: [], se: [], sw: [] };
  for (const p of points) {
    const nsKey = p.y >= centreNztm.y ? 'n' : 's';
    const ewKey = p.x >= centreNztm.x ? 'e' : 'w';
    bins[nsKey + ewKey].push(p.z);
  }
  const percentile5 = (arr) => {
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.05)];
  };
  const overallSorted = points.map(p => p.z).sort((a, b) => a - b);
  const overall = overallSorted.length
    ? overallSorted[Math.floor(overallSorted.length * 0.05)]
    : null;
  return {
    ne: percentile5(bins.ne),
    nw: percentile5(bins.nw),
    se: percentile5(bins.se),
    sw: percentile5(bins.sw),
    overall,
  };
}

/**
 * Filter a point cloud to points above the LOCAL (per-quadrant) ground
 * plus threshold metres. On hillside plots this preserves roof points on
 * the uphill side that a global ground threshold would strip out (see
 * quadrantGroundSummary for the rationale).
 */
function filterAboveLocalGround(points, centreLat, centreLng, thresholdM = 1.5) {
  const ground = quadrantGroundSummary(points, centreLat, centreLng);
  const fallback = Number.isFinite(ground.overall) ? ground.overall : 0;
  const centreNztm = wgs84ToNztm(centreLng, centreLat);
  return points.filter(p => {
    const nsKey = p.y >= centreNztm.y ? 'n' : 's';
    const ewKey = p.x >= centreNztm.x ? 'e' : 'w';
    const local = Number.isFinite(ground[nsKey + ewKey]) ? ground[nsKey + ewKey] : fallback;
    return p.z > local + thresholdM;
  });
}

/**
 * Compute bounding box + approximate diagonal of a polygon ring
 * [[lng, lat], ...]. Used by the diagnostic instrumentation to see
 * how big the LINZ polygon actually is for each address — an oversized
 * polygon (e.g. covering house + garage + trees) explains RANSAC picking
 * a plane far from the true roof centre.
 */
export function polygonBounds(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const midLat = (minLat + maxLat) / 2;
  const widthM  = (maxLng - minLng) * 111_320 * Math.cos(midLat * Math.PI / 180);
  const heightM = (maxLat - minLat) * 111_320;
  return {
    widthM:    +widthM.toFixed(1),
    heightM:   +heightM.toFixed(1),
    diagonalM: +Math.sqrt(widthM * widthM + heightM * heightM).toFixed(1),
  };
}

/**
 * Compute the centroid (lat, lng) of a building polygon ring
 * [[lng, lat], ...] using the shoelace formula (proper polygon centroid,
 * not vertex mean — matters for irregular polygons). Falls back to the
 * given address coord when the polygon is missing/degenerate.
 *
 * Option A investigation (2026-08-26): the pre-fix implementation applied
 * the shoelace formula directly on absolute lng/lat values. At NZ latitudes
 * that means cross-products like (168.67 × -45.03) - (168.66 × -45.03),
 * which produces two ~7500 magnitudes whose difference is a tiny signal
 * — double-precision math loses ~4-6 significant digits to catastrophic
 * cancellation. Queenstown 7 Kent showed the symptom: LINZ centroid at
 * (-45.03032, 168.66819) but our formula returned (-45.03064, 168.66939)
 * — an ~90 m error that caused the plane-quality filter to reject
 * legitimate roof planes as "far from centroid."
 *
 * Fix: recentre every vertex to the first vertex before summing, then
 * add the offset back at the end. Deltas are tiny (~0.0001° apart) so
 * cross-products stay in double-precision range — accurate to the
 * micrometre.
 */
export function polygonCentroid(ring, fallbackLat, fallbackLng) {
  if (!Array.isArray(ring) || ring.length < 3) {
    return { lat: fallbackLat, lng: fallbackLng };
  }
  const [x0, y0] = ring[0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const dx1 = x1 - x0, dy1 = y1 - y0;
    const dx2 = x2 - x0, dy2 = y2 - y0;
    const cross = dx1 * dy2 - dx2 * dy1;
    a  += cross;
    cx += (dx1 + dx2) * cross;
    cy += (dy1 + dy2) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-18) {
    // Degenerate polygon (near-zero area) — fall back to vertex mean.
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return { lat: sy / ring.length, lng: sx / ring.length };
  }
  return { lng: x0 + cx / (6 * a), lat: y0 + cy / (6 * a) };
}

/**
 * Synthesize a rectangular polygon around a point. Used when OSM/LINZ don't
 * have the building outline (new subdivisions). Half-width in metres.
 *
 * Round 4 (2026-08-26) — Bug 7/8: default half-width widened from 8m to
 * 12m at the caller. This function still accepts any half-width so tests
 * can override.
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

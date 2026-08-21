// ────────────────────────────────────────────────────────────────────────────
// PVGIS multi-segment yield — Week-7 Phase 2
//
// Given a lat/lng and the segments produced by the LiDAR pipeline (each with
// its own tilt+azimuth), queries PVGIS PER SEGMENT and returns:
//   - an area-weighted mean yield (kWh/kWp/yr) for the whole address
//   - per-segment yield (attached back onto the segment for the client-side
//     panelGrid.js to use for per-panel yield computation, matching how
//     Google Solar's sunshineQuantiles feed the same path)
//
// Segment viability filter mirrors selectViableSegments on the client:
//   - area ≥ 10 m² (bigger than a garden shed)
//   - pitch in [0°, 55°] (skip near-vertical walls)
//   - not South-facing (distFromNorth ≤ 135° for NZ)
//
// If ALL PVGIS queries fail (unlikely — PVGIS has been up for 15+ years),
// returns null so caller falls back to regional yield. Partial failures are
// tolerated: address-mean uses whichever segments succeeded.
// ────────────────────────────────────────────────────────────────────────────

const MIN_AREA_M2 = 10;
const MAX_PITCH_DEG = 55;
const SOUTH_CUTOFF_DIST_FROM_NORTH = 135;

/**
 * @param {object} args
 * @param {number} args.latitude
 * @param {number} args.longitude
 * @param {Array}  args.segments        — LiDAR segments (or any objects with center, azimuthDegrees, pitchDegrees, stats.areaMeters2)
 * @param {object} args.pvgisClient     — { queryYield(...) } — from createPvgisClient()
 * @param {number} [args.concurrency=4] — max parallel PVGIS calls
 * @returns {Promise<{
 *   systemYield: { kwh_per_kwp_per_year, source: 'pvgis', contributing_segments } | null,
 *   perSegmentYields: Array<{ segmentIndex, kwhPerKwpPerYear, pvgisAspect, error? }>,
 *   diagnostics: { attempted, succeeded, failed, cacheHits }
 * }>}
 */
export async function computePvgisYieldForSegments({
  latitude, longitude, segments, pvgisClient, concurrency = 4,
}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { systemYield: null, perSegmentYields: [], diagnostics: { attempted: 0, succeeded: 0, failed: 0, cacheHits: 0 } };
  }

  // Build the list of viable segments with their original index so callers
  // can map results back.
  const viable = [];
  segments.forEach((s, idx) => {
    const area = Number(s?.stats?.areaMeters2) || 0;
    const pitch = Number(s?.pitchDegrees) || 0;
    const az = Number(s?.azimuthDegrees) || 0;
    if (area < MIN_AREA_M2) return;
    if (pitch < 0 || pitch > MAX_PITCH_DEG) return;
    const azNorm = ((az % 360) + 360) % 360;
    const distFromNorth = Math.min(azNorm, 360 - azNorm);
    if (distFromNorth > SOUTH_CUTOFF_DIST_FROM_NORTH) return;
    viable.push({ idx, area, pitch, az });
  });

  if (viable.length === 0) {
    return { systemYield: null, perSegmentYields: [], diagnostics: { attempted: 0, succeeded: 0, failed: 0, cacheHits: 0 } };
  }

  // Run PVGIS queries with bounded concurrency. Chunk into groups of N.
  const results = [];
  let cacheHits = 0;
  for (let i = 0; i < viable.length; i += concurrency) {
    const chunk = viable.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(v => pvgisClient.queryYield({
        latitude, longitude,
        tiltDeg: v.pitch,
        azimuthDeg: v.az,
      }).then(r => ({ ...r, segmentIndex: v.idx, area: v.area }))),
    );
    for (const r of chunkResults) {
      if (r.cacheHit) cacheHits++;
    }
    results.push(...chunkResults);
  }

  const succeeded = results.filter(r => r.ok);
  const failed    = results.filter(r => !r.ok);

  const perSegmentYields = results.map(r => ({
    segmentIndex: r.segmentIndex,
    kwhPerKwpPerYear: r.ok ? r.kwhPerKwpPerYear : null,
    pvgisAspect: r.pvgisAspect ?? null,
    error: r.ok ? null : r.error,
  }));

  if (succeeded.length === 0) {
    return {
      systemYield: null,
      perSegmentYields,
      diagnostics: {
        attempted: results.length, succeeded: 0, failed: failed.length, cacheHits,
        allFailedReason: failed[0]?.error || 'no successful queries',
      },
    };
  }

  // Area-weighted mean over succeeded segments.
  let weightSum = 0;
  let weightedYieldSum = 0;
  for (const r of succeeded) {
    weightSum += r.area;
    weightedYieldSum += r.area * r.kwhPerKwpPerYear;
  }
  const meanYield = Number((weightedYieldSum / weightSum).toFixed(0));

  // V3 (2026-08-18): also aggregate monthly kWh/kWp — area-weighted mean
  // across segments that came back with monthly data. Handles partial
  // failures gracefully: if only some segments have monthly, we still
  // return the aggregate of THOSE segments (weighted by their areas only).
  // Returns null when NO segment had monthly, so caller falls back to a
  // regional Auckland-shape × annual estimate for the chart.
  let monthlyKwhPerKwp = null;
  const withMonthly = succeeded.filter(r =>
    Array.isArray(r.monthlyKwhPerKwp) && r.monthlyKwhPerKwp.length === 12);
  if (withMonthly.length > 0) {
    const byMonth = new Array(12).fill(0);
    let monthlyWeightSum = 0;
    for (const r of withMonthly) {
      for (let i = 0; i < 12; i++) byMonth[i] += r.area * r.monthlyKwhPerKwp[i];
      monthlyWeightSum += r.area;
    }
    monthlyKwhPerKwp = byMonth.map(v => Number((v / monthlyWeightSum).toFixed(1)));
  }

  return {
    systemYield: {
      kwh_per_kwp_per_year: meanYield,
      source: 'pvgis',
      contributing_segments: succeeded.length,
      monthly_kwh_per_kwp: monthlyKwhPerKwp,   // Jan→Dec, null if no segment had monthly
    },
    perSegmentYields,
    diagnostics: {
      attempted: results.length,
      succeeded: succeeded.length,
      failed: failed.length,
      cacheHits,
    },
  };
}

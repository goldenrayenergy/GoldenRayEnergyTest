// ────────────────────────────────────────────────────────────────────────────
// Pure-JS helpers for laying out an idealized rectangular panel grid on a
// tilted roof plane, expressed in world lat/lng/altitude for Cesium to
// render.
//
// No dependencies on React or Cesium — importable + testable from Node.
//
// Input model (per roof segment from Google Solar):
//   {
//     center:            { latitude, longitude },
//     azimuthDegrees:    <compass bearing of down-slope: 0=N, 90=E, ...>,
//     pitchDegrees:      <tilt of the roof plane in degrees from horizontal>,
//     stats: { areaMeters2 },
//     planeHeightAtCenterMeters?: <optional Cesium altitude at segment centre>
//   }
//
// Output (per panel):
//   {
//     center: { latitude, longitude, altitude },
//     orientation: 'LANDSCAPE',      // panel long side runs along the ridge
//     azimuthDeg,   pitchDeg,        // how the panel is tilted in world space
//     dimensions: { longM, shortM }, // physical panel dimensions
//     yieldEstEnergyKwh:  ~500,      // placeholder — real yield is rep-refined
//   }
//
// Geometry notes:
//   - Grid is laid out in the segment's LOCAL frame:
//       u axis = along ridge (perpendicular to down-slope)
//       v axis = up-slope direction (positive v = towards the ridge, i.e.,
//                the higher edge of the roof)
//   - Panel long side runs along +u (landscape).
//   - Rows stack from up-slope (top) to down-slope (bottom); more rows fit
//     when the segment is deeper (more slope-wise).
//   - For each panel, world altitude = centre altitude + v * sin(pitchRad).
//     (Panels closer to the ridge are physically higher because the roof
//     rises up-slope.)
// ────────────────────────────────────────────────────────────────────────────

const METRES_PER_DEG_LAT = 111_320;
const GAP_METRES = 0.02;   // 20 mm inter-panel gap — typical residential

/**
 * Choose grid dimensions that keep the FULL target count and minimize the
 * number of missing slots in the last row.
 *
 * Real MPPT installs preserve the exact panel count (matches kW target /
 * customer bill). When count doesn't divide evenly into a rectangle, the
 * short row is CENTERED under the full rows — installers do this routinely
 * (e.g., 17 panels = two rows of 6 + one row of 5 centered underneath).
 *
 * We pick cols so that the last-row remainder is as CLOSE TO FULL as
 * possible — a row of 5 under two rows of 6 looks tidy; a row of 1 under
 * a row of 8 doesn't.
 *
 * @param {number} target             desired panel count (kept exactly)
 * @param {number} [aspectPref=1.6]   preferred cols/rows ratio
 * @param {number} [maxCols=Infinity] max columns the roof can physically fit
 * @param {number} [maxRows=Infinity] max rows the roof can physically fit
 * @returns {{rows, cols, actualCount, remainder, aspect, target}}
 *   - actualCount === target (we never drop panels)
 *   - remainder is panels in the last (possibly-short) row
 *   - rows = ceil(target/cols)
 */
export function pickGridDimensions(target, aspectPref = 1.6, maxCols = Infinity, maxRows = Infinity) {
  if (!Number.isFinite(target) || target <= 0) {
    return { rows: 0, cols: 0, actualCount: 0, remainder: 0, aspect: 0, target: 0 };
  }
  const t = Math.max(1, Math.floor(target));
  let best = null;
  // Try every plausible cols value (1 up to target, capped by maxCols).
  const colLimit = Math.min(maxCols, t);
  for (let c = 1; c <= colLimit; c++) {
    const rows = Math.ceil(t / c);
    if (rows > maxRows) continue;
    const remainder = t - (rows - 1) * c;  // panels in last row
    const aspect = c / rows;
    // Score components:
    //   fillEff       = target / (rows*cols). 1.0 = perfect rectangle (no
    //                   empty slots). fillEff² weights this heavily so we
    //                   pick the grid that wastes the fewest slots.
    //   aspectFactor  = penalty for cols/rows far from preferred 1.6. Roofs
    //                   are typically 1.5:1 to 2.5:1 wider than deep.
    //   stripePenalty = strong penalty for 1-column or 1-row layouts (a
    //                   line of 17 panels is technically valid but visually
    //                   awful and structurally rare).
    //   portraitPen   = mild penalty for rows > cols (installers prefer
    //                   landscape orientation along the ridge).
    const fillEff       = t / (rows * c);
    const aspectDist    = Math.abs(aspect - aspectPref);
    const aspectFactor  = 1 / (1 + aspectDist * 0.5);
    const stripePenalty = (rows === 1 || c === 1) ? 0.2 : 1.0;
    const portraitPen   = aspect < 1 ? 0.85 : 1.0;
    const score = fillEff * fillEff * aspectFactor * portraitPen * stripePenalty;
    if (!best || score > best.score) {
      best = { rows, cols: c, actualCount: t, remainder, aspect, score, target: t };
    }
  }
  if (!best) return { rows: 1, cols: 1, actualCount: 1, remainder: 1, aspect: 1, target: t };
  const { score, ...rest } = best;
  return rest;
}

/**
 * Compute a rectangular panel grid on the given segment.
 *
 * @param {object} segment
 * @param {number} panelLongM  panel long-side length in metres (typ 1.65)
 * @param {number} panelShortM panel short-side length in metres (typ 0.99)
 * @param {number} targetCount how many panels the tier wants
 * @returns {Array<{center: {latitude, longitude, altitude},
 *                  orientation, azimuthDeg, pitchDeg,
 *                  dimensions: {longM, shortM},
 *                  yieldEstEnergyKwh}>}
 */
export function computePanelGridOnSegment(segment, panelLongM, panelShortM, targetCount) {
  if (!segment?.center?.latitude || !segment?.center?.longitude) return [];
  if (!Number.isFinite(panelLongM) || panelLongM <= 0) return [];
  if (!Number.isFinite(panelShortM) || panelShortM <= 0) return [];
  if (!Number.isFinite(targetCount) || targetCount <= 0) return [];

  const centerLat  = segment.center.latitude;
  const centerLng  = segment.center.longitude;
  const centerAlt  = Number(segment.planeHeightAtCenterMeters) || 0;
  const azimuth    = Number(segment.azimuthDegrees) || 0;
  const pitch      = Number(segment.pitchDegrees) || 0;
  const areaM2     = Number(segment?.stats?.areaMeters2) || 100;

  const longWithGap  = panelLongM + GAP_METRES;
  const shortWithGap = panelShortM + GAP_METRES;
  const panelAreaM2  = panelLongM * panelShortM;

  // Week-7 per-panel yield (kWh/yr). Two sources, checked in order:
  //   1. LiDAR path — server has attached `_yieldKwhPerKwpPerYear` from PVGIS
  //      (Phase 2). Preferred because it's PVGIS's own PVcalc output — includes
  //      losses and POA correction.
  //   2. Google Solar path — segment.stats.sunshineQuantiles[median] (Phase 1).
  //      Google's own tilt+azimuth-aware annual kWh/kWp per segment.
  // Formula: perKwpYield × (panel STC watts / 1000). STC watts ≈ panel area
  // × 200 W/m² (typical PERC ~20%); overridden by segment._panelCapacityWatts
  // when the caller passes real spec. If neither signal is present the
  // per-panel yield falls back to the legacy 500 kWh placeholder so
  // downstream code doesn't crash on missing data.
  const pvgisPerKwp = Number(segment?._yieldKwhPerKwpPerYear);
  const q = segment?.stats?.sunshineQuantiles;
  const googlePerKwp = Array.isArray(q) && q.length >= 6
    ? Number(q[Math.floor(q.length / 2)]) : null;
  const perKwpYield = Number.isFinite(pvgisPerKwp) && pvgisPerKwp > 0
    ? pvgisPerKwp
    : (Number.isFinite(googlePerKwp) && googlePerKwp > 0 ? googlePerKwp : null);
  const perPanelYieldSource = Number.isFinite(pvgisPerKwp) && pvgisPerKwp > 0
    ? 'pvgis'
    : (Number.isFinite(googlePerKwp) && googlePerKwp > 0 ? 'google_sunshine_median' : 'placeholder');
  // Panel STC watts estimate. Modern TOPCon / N-type residential panels
  // (400-600 W in ~1.65-1.95 m² footprint) run at ~340 W/m² efficiency;
  // legacy 200 W/m² PERC has been out of production for years. Using the
  // stale 200 constant systematically undercounts per-panel yield by 40%+
  // and drove the pale-blue heatmap on real installs. The fallback ceiling
  // (340) is chosen conservatively — a real 595W Phono in 1.96m² is 303
  // W/m², our 340 gives a safe over-estimate when the real value is
  // missing rather than the aggressive undercount 200 produced.
  //
  // ALWAYS prefer segment._panelCapacityWatts when the caller has real
  // spec data (composer's picked panel wattage). QuotePage → Cesium3DView
  // → this function plumbs the real value from the compose response, so
  // this fallback only fires for test-harness / standalone callers.
  const panelStcW = Number(segment?._panelCapacityWatts)
    || Math.round(panelAreaM2 * 340);
  const perPanelYieldKwhAnnual = perKwpYield != null
    ? Number((perKwpYield * (panelStcW / 1000)).toFixed(1))
    : null;

  // Panels are laid on the roof SURFACE (tilted area). Real installs achieve
  // ~75% packing due to edge setbacks + obstructions + service walkways —
  // cap accordingly.
  const usableSurfaceArea = areaM2 * 0.75;
  const maxPanels = Math.max(0, Math.floor(usableSurfaceArea / (longWithGap * shortWithGap)));
  if (maxPanels === 0) return [];

  // Determine the ACTUAL usable roof dimensions.
  //   PRIMARY:   segment._faceDimensions (from LiDAR inliers, real u×v extent
  //              in metres) — this is the ONLY way to guarantee panels fit
  //              on the actual roof shape.
  //   FALLBACK:  Google Solar boundingBox → derive dimensions from sw/ne
  //              (crude — bbox is lat/lng axis-aligned, not roof-axis aligned,
  //              but better than a pure sqrt(area) guess).
  //   LAST-RESORT: 1.3×sqrt(area) — assumes roughly square face, gives a
  //              conservative dimension so panels don't overflow badly.
  //              Was 1.5 previously; tightened to 1.3 as a safety margin
  //              for segments without explicit dimensions.
  let maxWidthAlongRidgeM;
  let maxDepthAcrossSlopeM;
  if (segment?._faceDimensions?.widthAlongRidgeM > 0
      && segment._faceDimensions.depthAcrossSlopeM > 0) {
    // 90% packing inside the face — leave a small setback from every edge.
    maxWidthAlongRidgeM   = segment._faceDimensions.widthAlongRidgeM   * 0.90;
    maxDepthAcrossSlopeM  = segment._faceDimensions.depthAcrossSlopeM  * 0.90;
  } else if (segment?.boundingBox?.sw && segment?.boundingBox?.ne) {
    // Google Solar bbox — LAST-RESORT approximation. bbox is lat/lng
    // axis-aligned and ALWAYS larger than the true rotated face (it's the
    // envelope of a rotated rectangle plus any noise Google's segmentation
    // pulled in). Factor 0.70 (not 0.90) because bbox over-estimates true
    // face by 20-40% on typical rotated residential faces — measured
    // empirically against Google's own solar_panels[] projections.
    // Prefer enrichSegmentsWithFaceDimensions() upstream so this branch
    // is only used when Google gave us NO suggested panels for the segment.
    const centreLat = (segment.boundingBox.sw.latitude + segment.boundingBox.ne.latitude) / 2;
    const dLatM = Math.abs(segment.boundingBox.ne.latitude - segment.boundingBox.sw.latitude) * METRES_PER_DEG_LAT;
    const dLngM = Math.abs(segment.boundingBox.ne.longitude - segment.boundingBox.sw.longitude)
                  * METRES_PER_DEG_LAT * Math.cos(centreLat * Math.PI / 180);
    maxWidthAlongRidgeM   = Math.max(dLatM, dLngM) * 0.70;
    maxDepthAcrossSlopeM  = Math.min(dLatM, dLngM) * 0.70;
  } else {
    const fallback = 1.3 * Math.sqrt(areaM2);
    maxWidthAlongRidgeM  = fallback;
    maxDepthAcrossSlopeM = fallback;
  }

  // Absolute safety cap: no residential roof face is wider than ~15m or
  // deeper than ~10m. If _faceDimensions from LiDAR reports larger values,
  // it's usually because RANSAC inliers scattered onto the wrong part of
  // the polygon-clip area. Cap here so panels can never overflow.
  const ABS_MAX_WIDTH_M = 12;
  const ABS_MAX_DEPTH_M = 10;
  maxWidthAlongRidgeM  = Math.min(maxWidthAlongRidgeM,  ABS_MAX_WIDTH_M);
  maxDepthAcrossSlopeM = Math.min(maxDepthAcrossSlopeM, ABS_MAX_DEPTH_M);

  const maxColsByRoof = Math.max(1, Math.floor(maxWidthAlongRidgeM / longWithGap));
  const maxRowsByRoof = Math.max(1, Math.floor(maxDepthAcrossSlopeM / shortWithGap));

  // Cap count by BOTH area capacity AND grid geometry. Previously we only
  // capped by area (maxPanels), so a face that has enough m² but limited
  // cols×rows (long-thin face) would ask pickGridDimensions for an
  // impossible target and get back a {1,1} fallback → only ONE panel got
  // laid down. Cap by cols×rows here so pickGridDimensions always gets a
  // feasible ask.
  const gridCapacity = maxColsByRoof * maxRowsByRoof;
  const count = Math.min(targetCount, maxPanels, gridCapacity);
  if (count === 0) return [];
  const layout = pickGridDimensions(count, 1.6, maxColsByRoof, maxRowsByRoof);
  const rows = layout.rows;
  const cols = layout.cols;
  const lastRowCount = layout.remainder;  // panels in last (possibly-short) row

  // Local axes in world lat/lng offsets, aligned to the segment.
  //
  //   Compass azimuth A = bearing of down-slope. Down-slope direction in
  //   metres east/north = (sin A, cos A). E.g. A=0 → down-slope points north
  //   (a north-facing roof); A=90 → east; A=180 → south; etc.
  //
  //   u axis (along ridge) = down-slope rotated 90° CCW = (-cos A, sin A)
  //   v axis (up-slope)    = -down-slope           = (-sin A, -cos A)
  //     (+v goes AWAY from the down-slope direction — i.e., toward the ridge.
  //      A panel with v > 0 is closer to the top of the roof.)
  const azRad = (azimuth * Math.PI) / 180;
  const pitchRad = (pitch * Math.PI) / 180;
  const cosA = Math.cos(azRad);
  const sinA = Math.sin(azRad);
  const uAxisX = -cosA, uAxisY =  sinA;    // east, north
  const vAxisX = -sinA, vAxisY = -cosA;
  const cosLat = Math.cos(centerLat * Math.PI / 180);
  const metresPerDegLng = METRES_PER_DEG_LAT * cosLat;

  const results = [];
  for (let r = 0; r < rows; r++) {
    // How many panels this row has + how to center them.
    //   - Full rows (all but possibly the last) have `cols` panels.
    //   - Last row may have `lastRowCount` ≤ cols panels, CENTERED under
    //     the full rows above. The u-offset shift = (cols - lastRowCount)/2
    //     half-panel-widths, so a row of 5 under a row of 6 sits with 0.5
    //     panel-width of indent on each side.
    const isLastRow  = (r === rows - 1);
    const inThisRow  = isLastRow ? lastRowCount : cols;
    const uCenterShift = (cols - inThisRow) / 2;   // in units of one panel

    for (let c = 0; c < inThisRow; c++) {
      // Local metres offset from segment centre. Grid is centred: full-row c
      // goes from -(cols-1)/2 to +(cols-1)/2. Short row's c gets shifted by
      // +uCenterShift so it sits symmetrically inside the full-row span.
      const uM = ((c + uCenterShift) - (cols - 1) / 2) * longWithGap;
      const vM = ((rows - 1) / 2 - r) * shortWithGap;

      // Convert (u, v) to east/north metres.
      const eastM  = uM * uAxisX + vM * vAxisX;
      const northM = uM * uAxisY + vM * vAxisY;

      // Convert to lat/lng.
      const lat = centerLat + northM / METRES_PER_DEG_LAT;
      const lng = centerLng + eastM / metresPerDegLng;

      // Altitude: as we move up-slope (v > 0), the roof rises by v * sin(pitch).
      // The horizontal component (v * cos(pitch)) is already captured in the
      // north/east offset since v was in surface (roof-plane) metres.
      const alt = centerAlt + vM * Math.sin(pitchRad);

      results.push({
        center: { latitude: lat, longitude: lng, altitude: alt },
        orientation: 'LANDSCAPE',
        azimuthDeg: azimuth,
        pitchDeg:   pitch,
        dimensions: { longM: panelLongM, shortM: panelShortM },
        // Per-panel annual kWh — real value from PVGIS (LiDAR path) or
        // Google Solar sunshineQuantiles (Google-Solar path). Legacy
        // constant 500 kept ONLY as absolute-last-resort so old callers
        // that check truthy still get a number.
        yieldEstEnergyKwh: perPanelYieldKwhAnnual != null ? perPanelYieldKwhAnnual : 500,
        yieldSource: perPanelYieldSource,
      });
    }
  }
  return results;
}

/**
 * Pick the largest segment (by roof-surface area) from a list. Returns null
 * when the list is empty or has no valid segments.
 */
export function pickLargestSegment(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  return [...segments].sort((a, b) => {
    const areaA = a?.stats?.areaMeters2 || 0;
    const areaB = b?.stats?.areaMeters2 || 0;
    return areaB - areaA;
  })[0] || null;
}

/**
 * Enrich each segment with `_faceDimensions` derived from Google Solar's
 * OWN suggested solarPanels[] for that segment, projected into the segment's
 * roof-axis (u=along ridge, v=up-slope) frame.
 *
 * Why: Google's `boundingBox.sw/ne` is lat/lng axis-aligned — always larger
 * than the true rotated roof face. If we use it as the roof-axis width/depth
 * we over-estimate and panel arrays overflow the actual face at the edges
 * (proven for 75 Mahia Road: bbox → 11 m width, Google's own panels only
 * spanned 7.2 m).
 *
 * Google's suggested-layout panels ARE on the real face (their algorithm
 * knows the exact face geometry), so their u/v extent is the ground truth
 * for how much face the panel grid can actually use.
 *
 * Skips:
 *   - Segments that already have _faceDimensions (LiDAR path — trust those)
 *   - Segments Google gave < 3 panels for (not enough to fit a rectangle)
 *
 * @param {Array} segments      roof_segments from analyse response
 * @param {Array} solarPanels   solar_panels[] from analyse response
 *                              (each has {center, segmentIndex, ...})
 * @returns {Array} same-order segments, some with _faceDimensions added
 */
export function enrichSegmentsWithFaceDimensions(segments, solarPanels) {
  if (!Array.isArray(segments) || !Array.isArray(solarPanels)) return segments || [];
  return segments.map((seg, idx) => {
    // LiDAR already gave us real inlier-derived dimensions — don't overwrite.
    if (seg?._faceDimensions?.widthAlongRidgeM > 0
        && seg._faceDimensions.depthAcrossSlopeM > 0) return seg;
    if (!seg?.center?.latitude || !seg?.center?.longitude) return seg;

    const segPanels = solarPanels.filter(p => p?.segmentIndex === idx
      && Number.isFinite(p?.center?.latitude)
      && Number.isFinite(p?.center?.longitude));
    if (segPanels.length < 3) return seg;   // too few to define a face rectangle

    // Set up the segment's roof-axis frame (same convention as
    // computePanelGridOnSegment): u along ridge, v up-slope.
    const centerLat = seg.center.latitude;
    const centerLng = seg.center.longitude;
    const cosLat    = Math.cos(centerLat * Math.PI / 180);
    const metresPerDegLng = METRES_PER_DEG_LAT * cosLat;
    const azRad = (Number(seg.azimuthDegrees) || 0) * Math.PI / 180;
    const cosA = Math.cos(azRad);
    const sinA = Math.sin(azRad);
    const uEast = -cosA, uNorth =  sinA;   // ridge direction
    const vEast = -sinA, vNorth = -cosA;   // up-slope direction

    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const p of segPanels) {
      const eastM  = (p.center.longitude - centerLng) * metresPerDegLng;
      const northM = (p.center.latitude  - centerLat) * METRES_PER_DEG_LAT;
      const u = eastM * uEast + northM * uNorth;
      const v = eastM * vEast + northM * vNorth;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }

    // Google's positions are panel CENTRES, so the face extent is
    // (max - min) + panel size. Use their assumed panel dims when present,
    // else conservative defaults.
    const panelLongM  = Number(solarPanels[0]?._panelLongM)  || 1.879;
    const panelShortM = Number(solarPanels[0]?._panelShortM) || 1.045;

    return {
      ...seg,
      _faceDimensions: {
        widthAlongRidgeM:  (uMax - uMin) + panelLongM,
        depthAcrossSlopeM: (vMax - vMin) + panelShortM,
        source: 'google-panels-projection',
        panelCount: segPanels.length,
      },
    };
  });
}

/**
 * Filter a list of Google Solar roof segments down to the ones we should
 * actually put panels on, and rank them best-first.
 *
 * Filters:
 *   - area < minAreaM2:            too small to be worth wiring separately
 *   - pitch > maxPitchDeg:         almost-vertical (walls, not roofs)
 *   - azimuth in south-facing arc: for NZ (Southern Hemisphere), north-facing
 *                                   roofs are best; south-facing get ~30% of
 *                                   the yield and are skipped by default.
 *
 * NOTE on low pitch: near-flat roofs (0-10°) are NOT skipped — installers
 * use tilt-frame mounts to angle panels up ~15-20° for proper yield. Real
 * commercial + modern-residential installs frequently use flat roofs this
 * way. The `_viability.needsTiltFrames` flag surfaces this to the UI so
 * the customer sees the note (small extra hardware cost).
 *
 * Ranking: by area × orientation factor (north-facing worth more than E/W).
 *
 * @param {Array}  segments             Google Solar segments (roofSegmentStats[])
 * @param {object} [opts]
 * @param {number} [opts.minAreaM2=10]        ignore segments smaller than this
 * @param {number} [opts.maxPitchDeg=55]      ignore near-vertical segments
 * @param {number} [opts.tiltFrameThreshDeg=10] pitches below this get flagged as needing tilt frames
 * @param {boolean}[opts.skipSouth=true]      skip south-facing (bad for NZ)
 * @returns {Array} viable segments, sorted best-first, each augmented with
 *                  `_viability = { azNorm, orientation, orientationFactor,
 *                                  needsTiltFrames, rank }`
 */
export function selectViableSegments(segments, opts = {}) {
  const minAreaM2         = opts.minAreaM2         ?? 10;
  const maxPitchDeg       = opts.maxPitchDeg       ?? 55;
  const tiltFrameThreshDeg = opts.tiltFrameThreshDeg ?? 10;
  const skipSouth         = opts.skipSouth         ?? true;

  if (!Array.isArray(segments)) return [];

  const scored = [];
  for (const s of segments) {
    if (!s?.center?.latitude || !s?.center?.longitude) continue;
    const area  = Number(s?.stats?.areaMeters2) || 0;
    const az    = Number(s?.azimuthDegrees) || 0;
    const pitch = Number(s?.pitchDegrees) || 0;

    if (area  < minAreaM2)   continue;
    if (pitch < 0)           continue;   // sanity — negative pitch means bad data
    if (pitch > maxPitchDeg) continue;   // near-vertical = wall, not roof

    // Nearly-flat roofs are viable via tilt frames — flag but don't skip.
    const needsTiltFrames = pitch < tiltFrameThreshDeg;

    // Normalize azimuth to [0, 360).
    const azNorm = ((az % 360) + 360) % 360;

    // Southern Hemisphere: north (0°) = best, east/west (90°/270°) = ok,
    // south (180°) = worst. Factor drops linearly from 1.0 at N to 0.0 at S.
    // Panel yield factor from published NZ solar data:
    //   N   1.00
    //   E/W 0.82
    //   S   0.35  (still gets some direct sun in mid-summer)
    const distFromNorth = Math.min(azNorm, 360 - azNorm);   // 0..180
    let orientationFactor;
    let orientation;
    if (distFromNorth <= 45) {
      orientationFactor = 1.0;
      orientation = 'N';
    } else if (distFromNorth <= 135) {
      orientationFactor = 0.82;
      orientation = distFromNorth < 90 ? (azNorm < 180 ? 'NE' : 'NW')
                                       : (azNorm < 180 ? 'E'  : 'W');
    } else {
      orientationFactor = 0.35;
      orientation = 'S';
    }

    if (skipSouth && orientation === 'S') continue;

    scored.push({
      ...s,
      _viability: {
        azNorm,
        orientation,
        orientationFactor,
        needsTiltFrames,
        // Combined rank: area weighted by orientation. Bigger area is
        // still primary, but a 40m² N-face beats a 45m² E-face here.
        // Tilt-framed installs get a small penalty because tilt frames
        // shade adjacent rows, cutting realistic packing density.
        rank: area * orientationFactor * (needsTiltFrames ? 0.85 : 1.0),
      },
    });
  }
  scored.sort((a, b) => b._viability.rank - a._viability.rank);
  return scored;
}

/**
 * Distribute a total target panel count across a set of segments,
 * proportional to each segment's yield-weighted area.
 *
 * Prefers the PRIMARY face only if it can hold all target panels — a
 * multi-face install where 2 grids overlap physically (compact houses with
 * segments <10m apart) looks worse than a clean single-face grid. Only
 * spills to secondary faces when the primary genuinely can't fit target.
 *
 * We aim to keep each segment's install size at least 3 panels (fewer
 * panels than that isn't a real string on an MPPT) — if the proportional
 * math gives a segment <3, we drop that segment and re-distribute.
 *
 * @param {Array}  segments      output of selectViableSegments()
 * @param {number} totalTarget   total panels across all segments
 * @param {number} [minPerSeg=3] min panels per segment (else segment dropped)
 * @param {number} [panelFootprintM2=1.65*0.99]  m² per panel (for capacity check)
 * @returns {Array<{segment, count}>}
 */
export function distributePanels(segments, totalTarget, minPerSeg = 3, panelFootprintM2 = 1.65 * 0.99) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  if (!Number.isFinite(totalTarget) || totalTarget <= 0) return [];

  // PRIMARY-FACE-FIRST: if the largest segment (top-ranked) can fit the
  // full target with realistic packing (75% for setbacks + walkways),
  // don't spread to secondary faces — they'd overlap physically on a
  // compact house.
  const primary = segments[0];
  const primaryUsableM2 = (primary?.stats?.areaMeters2 || 0) * 0.75;
  const primaryCapacity = Math.floor(primaryUsableM2 / panelFootprintM2);
  if (primaryCapacity >= totalTarget) {
    return [{ segment: primary, count: totalTarget }];
  }

  // Iterate: allocate proportionally, drop under-min segments, retry.
  let pool = [...segments];
  while (pool.length > 0) {
    const totalRank = pool.reduce((s, seg) => s + (seg._viability?.rank || seg?.stats?.areaMeters2 || 0), 0);
    if (totalRank <= 0) return [];

    const raw = pool.map(seg => {
      const rank = seg._viability?.rank || seg?.stats?.areaMeters2 || 0;
      return { segment: seg, share: rank / totalRank };
    });
    // Largest-remainder method for integer allocation.
    const rawCounts = raw.map(r => ({ ...r, floatCount: r.share * totalTarget }));
    const floors = rawCounts.map(r => ({ ...r, count: Math.floor(r.floatCount), remainder: r.floatCount - Math.floor(r.floatCount) }));
    let allocated = floors.reduce((s, r) => s + r.count, 0);
    // Distribute the leftover panels one-by-one to segments with largest fractional parts.
    const leftover = totalTarget - allocated;
    const sortedByRemainder = [...floors].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < leftover; i++) {
      sortedByRemainder[i % sortedByRemainder.length].count++;
    }

    // Enforce min per segment.
    const underMin = floors.find(r => r.count < minPerSeg);
    if (!underMin) {
      return floors.map(r => ({ segment: r.segment, count: r.count }));
    }
    // Drop the smallest under-min segment (by share) and retry.
    const worst = floors
      .filter(r => r.count < minPerSeg)
      .sort((a, b) => a.share - b.share)[0];
    pool = pool.filter(seg => seg !== worst.segment);
  }
  return [];
}

// Exported constants so tests + callers can reference them.
export const CONSTANTS = { METRES_PER_DEG_LAT, GAP_METRES };

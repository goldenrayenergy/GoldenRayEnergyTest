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
// NZ installer standard ridge setback. Highest wind-uplift zone on the
// roof is within ~600mm of the ridge, and ridge caps need clearance for
// venting + a foot-hold for the top panel row. 0.8 m matches AS/NZS
// 1170.2 wind-load practice used by most residential installers.
const RIDGE_SETBACK_M = 0.8;

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
// Ray-cast point-in-polygon test. polygonRing = [[lng, lat], ...].
function pointInPolygon(lat, lng, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return true;   // no polygon → don't filter
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Mean lat/lng of a polygon ring (simple average of vertices — good enough
// for the shift heuristic; not the true area centroid).
function polygonMeanLatLng(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  let latSum = 0, lngSum = 0;
  for (const [lng, lat] of ring) { latSum += lat; lngSum += lng; }
  return { lat: latSum / ring.length, lng: lngSum / ring.length };
}

/**
 * Compute the panel grid for a single roof segment.
 *
 * @param {object} segment       Google Solar segment (see file header)
 * @param {number} panelLongM
 * @param {number} panelShortM
 * @param {number} targetCount
 * @param {Array}  [polygonRing] OSM/LINZ building outline as [[lng,lat],…].
 *                               When supplied, panels are shifted inward and
 *                               any that still fall outside are dropped —
 *                               prevents the "panels floating off the roof"
 *                               bug on houses where Google Solar's segment
 *                               center sits near a polygon edge.
 */
export function computePanelGridOnSegment(segment, panelLongM, panelShortM, targetCount, polygonRing) {
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

    // Fix 9 (2026-08-27, refined) — the caller (distributePanels) may
    // ask for MORE panels than `_faceDimensions` accommodates when
    // Pass 2 extends a large-area face's allocation beyond Google's
    // suggested layout footprint. Real installers extend a contiguous
    // string on a big roughly-square face rather than starting a tiny
    // one on a dormer.
    //
    // GUARD (2026-08-27): only relax on ROUGHLY-SQUARE faces (aspect
    // ratio < 1.5). Long-thin faces (aspect ≥ 1.5) already reflect the
    // real face shape — Google's dims aren't conservative, they're
    // accurate — so isotropic sqrt(area) expansion would push panels
    // OFF the actual face. Long-thin case validated by
    // test-panel-grid's "long-thin face caps at grid capacity" test.
    const shortWithGap = panelShortM + GAP_METRES;
    const longWithGap  = panelLongM  + GAP_METRES;
    const currentGridCap =
      Math.floor(maxWidthAlongRidgeM / longWithGap) *
      Math.floor(maxDepthAcrossSlopeM / shortWithGap);
    const faceAspect =
      Math.max(maxWidthAlongRidgeM, maxDepthAcrossSlopeM) /
      Math.max(0.1, Math.min(maxWidthAlongRidgeM, maxDepthAcrossSlopeM));
    if (targetCount > currentGridCap && areaM2 > 0 && faceAspect < 1.5) {
      const areaBound = 1.3 * Math.sqrt(areaM2);
      maxWidthAlongRidgeM  = Math.max(maxWidthAlongRidgeM,  areaBound);
      maxDepthAcrossSlopeM = Math.max(maxDepthAcrossSlopeM, areaBound);
    }
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

  // Ridge setback (2026-08-31) — when this segment has an opposing-face
  // sibling on the same building (gable / hip / dutch-gable), reserve
  // RIDGE_SETBACK_M on ALL edges so panels don't push past the roof face
  // into neighbouring face territory. On a hip roof each face is
  // TRIANGULAR (widest at eave, narrowing to the ridge apex), and the
  // face's axis-aligned bounding box overstates the physical face width
  // near the ridge — a grid sized to the bbox extends past the hip lines
  // (bottom-left "off-roof" clipping reported on 58 David Crescent
  // 2026-08-31). Setback covers both the ridge itself AND the hip lines
  // on either side; matches NZ installer 300-500 mm edge-of-face
  // practice + AS/NZS 1170.2 wind-load edge-zone rules.
  // Rows self-centre in the reduced depth so setback comes off both ends
  // evenly (bottom eave clearance stays intact).
  const ridgeSetbackM = segment?._hasOpposingFace ? RIDGE_SETBACK_M : 0;
  const effectiveWidthM = Math.max(longWithGap,  maxWidthAlongRidgeM  - ridgeSetbackM);
  const effectiveDepthM = Math.max(shortWithGap, maxDepthAcrossSlopeM - ridgeSetbackM);

  const maxColsByRoof = Math.max(1, Math.floor(effectiveWidthM / longWithGap));
  const maxRowsByRoof = Math.max(1, Math.floor(effectiveDepthM / shortWithGap));

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
      // Ridge setback is applied via `effectiveDepthM` (row-count reduction)
      // above. We DON'T also shift the grid centre — a down-slope shift
      // pushes the bottom row past the eave setback (customer report on
      // 58 David Crescent Karori 2026-08-31: "bottom third row clipping
      // through roof"). Symmetric centering in the reduced depth gives
      // extra clearance at BOTH ends (ridge + eave) evenly.
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

  // Polygon-clip pass (Fix 10 / 2026-08-27) — if a building outline was
  // supplied, ensure every panel's lat/lng falls INSIDE it. Real bug on
  // e.g. 10 Newnham Terrace Christchurch: Google Solar's segment center
  // sat 1.6m from the south polygon edge, so the 4.4m half-width grid
  // extended ~3m past the building outline, causing panels to float in
  // the alleyway between houses. Two-step fix:
  //
  //   1. Compute mean displacement from OUTSIDE panels to INSIDE panels.
  //      Shift ALL panel positions by that vector so the grid recentres
  //      into the polygon interior. Iterate up to 3× (each pass typically
  //      resolves 60-80% of the outside panels; 3 iterations is plenty).
  //
  //   2. Any panel that's STILL outside after shifting gets dropped —
  //      UNLESS the segment centre itself was already outside the
  //      polygon (Fix 10a / 2026-08-27 regression fix). When the whole
  //      segment lives outside the parcel (e.g. 31A Hillview Auckland
  //      where Google Solar identified 3 roof segments all outside the
  //      customer's small LINZ parcel), clipping every panel drops the
  //      entire render → the customer sees "17 panels" in the header
  //      and an empty roof. Better to show the panels where Google
  //      Solar put them than to show nothing at all. The customer can
  //      see they're on a neighbouring roof + the survey confirms.
  //
  // When no polygon is supplied (LiDAR path uses a different validation
  // via _faceDimensions, or the segment source didn't hand us one), this
  // pass is a no-op and behavior is unchanged.
  const segmentCentreInPolygon =
    Array.isArray(polygonRing) && polygonRing.length >= 3 &&
    pointInPolygon(centerLat, centerLng, polygonRing);
  if (Array.isArray(polygonRing) && polygonRing.length >= 3 &&
      results.length > 0 && segmentCentreInPolygon) {
    const shiftIterations = 3;
    for (let iter = 0; iter < shiftIterations; iter++) {
      let insideLatSum = 0, insideLngSum = 0, insideN = 0;
      let outsideLatSum = 0, outsideLngSum = 0, outsideN = 0;
      for (const p of results) {
        const inside = pointInPolygon(p.center.latitude, p.center.longitude, polygonRing);
        if (inside) { insideLatSum += p.center.latitude; insideLngSum += p.center.longitude; insideN++; }
        else        { outsideLatSum += p.center.latitude; outsideLngSum += p.center.longitude; outsideN++; }
      }
      if (outsideN === 0) break;   // all fit — done
      let dLat, dLng;
      if (insideN > 0) {
        // Shift toward the inside-panel centroid — the polygon is
        // "pulling" the grid in this direction.
        dLat = (insideLatSum / insideN) - (outsideLatSum / outsideN);
        dLng = (insideLngSum / insideN) - (outsideLngSum / outsideN);
      } else {
        // Every panel outside → shift toward the polygon centroid.
        const cent = polygonMeanLatLng(polygonRing);
        dLat = cent.lat - (outsideLatSum / outsideN);
        dLng = cent.lng - (outsideLngSum / outsideN);
      }
      // Damped step (0.6) to reduce oscillation.
      const damp = 0.6;
      for (const p of results) {
        p.center.latitude  += dLat * damp;
        p.center.longitude += dLng * damp;
      }
    }
    // Final filter: drop any panel still outside after shifting.
    return results.filter(p =>
      pointInPolygon(p.center.latitude, p.center.longitude, polygonRing));
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
  // Sub-building filter (2026-08-31, Bug 1 root fix): segments significantly
  // BELOW the highest detected plane are treated as detached auxiliary
  // structures (garages, sheds, decks, patios) and skipped so panels
  // don't render on the wrong building. Example: 12A Knox Rd Hillpark
  // had 3 LiDAR planes at 41.62m / 40.77m / 37.97m — the 37.97m one is
  // 3.65m below the main house roof, meaning it's a detached shed/pad.
  // Default threshold: 2m separation. Set opts.subBuildingDropM = null
  // to disable (returns to pre-fix behavior).
  const subBuildingDropM = opts.subBuildingDropM ?? 2.0;

  if (!Array.isArray(segments)) return [];

  // Compute the highest planeHeight so we can flag sub-building segments.
  let highestPlaneH = -Infinity;
  if (Number.isFinite(subBuildingDropM)) {
    for (const s of segments) {
      const h = Number(s?.planeHeightAtCenterMeters);
      const a = Number(s?.stats?.areaMeters2) || 0;
      // Only "significant" segments (≥ min area) anchor the height reference —
      // a random tiny sliver at high altitude shouldn't disqualify the roof.
      if (Number.isFinite(h) && a >= minAreaM2 && h > highestPlaneH) highestPlaneH = h;
    }
  }

  const scored = [];
  for (const s of segments) {
    if (!s?.center?.latitude || !s?.center?.longitude) continue;
    const area  = Number(s?.stats?.areaMeters2) || 0;
    const az    = Number(s?.azimuthDegrees) || 0;
    const pitch = Number(s?.pitchDegrees) || 0;

    if (area  < minAreaM2)   continue;
    if (pitch < 0)           continue;   // sanity — negative pitch means bad data
    if (pitch > maxPitchDeg) continue;   // near-vertical = wall, not roof

    // Sub-building drop (2026-08-31, Bug 1 root fix).
    // Skip segments significantly below the highest-plane reference —
    // they're detached auxiliary structures (garage, shed, deck) that
    // aren't the customer's main house. Only fires when we have a
    // valid highest-plane reference AND the current segment has a
    // planeHeight to compare against.
    if (Number.isFinite(subBuildingDropM) && Number.isFinite(highestPlaneH)) {
      const planeH = Number(s?.planeHeightAtCenterMeters);
      if (Number.isFinite(planeH) && (highestPlaneH - planeH) > subBuildingDropM) {
        continue;
      }
    }

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
 * Round 4 (2026-08-26) — Bug 6. Drop segments whose world-space footprints
 * overlap heavily with another (higher-yield) segment already in the list.
 *
 * WHY: RANSAC on complex roofs (hip, valley, dormered) can produce
 * multiple planes that pass mergeSimilarSegments' tolerances (different
 * enough in azimuth) but nonetheless project their panel grids onto
 * overlapping physical footprints. When distributePanels then allocates
 * panels to both, we visibly stack panels facing different directions
 * on top of each other (the user's screenshot for Bug 6).
 *
 * HOW: for each pair of segments, estimate their world-space footprint
 * rectangles from `_faceDimensions` + centre + azimuth, project both
 * onto a shared local frame at the higher-ranked segment's centre, and
 * check bounding-box overlap. If overlap fraction > `overlapPct` of
 * the smaller segment's area, DROP the smaller one. Runs before
 * distributePanels so allocation is on the deduped set.
 *
 * Silent on segments without _faceDimensions (no data to check) — those
 * pass through unchanged. Preserves input order for ties.
 *
 * @param {Array}  segments      output of selectViableSegments()
 * @param {object} [opts]
 * @param {number} [opts.overlapPct=0.5]   drop when >= this fraction of the smaller footprint overlaps a bigger one
 * @returns {Array}  segments minus the dropped overlapping ones
 */
export function deduplicateOverlappingFootprints(segments, opts = {}) {
  const overlapPct = opts.overlapPct ?? 0.5;
  if (!Array.isArray(segments) || segments.length < 2) return segments || [];

  // Estimate each segment's footprint centre + half-extents in metres.
  // Fall back to sqrt(area) when _faceDimensions is absent so a naïve
  // segment doesn't accidentally deduplicate a good neighbour.
  const withFootprint = segments.map((s) => {
    const width = Number(s?._faceDimensions?.widthAlongRidgeM);
    const depth = Number(s?._faceDimensions?.depthAcrossSlopeM);
    const areaM2 = Number(s?.stats?.areaMeters2) || 0;
    const halfW = Number.isFinite(width)  && width  > 0 ? width  / 2 : Math.sqrt(areaM2) * 0.6;
    const halfD = Number.isFinite(depth)  && depth  > 0 ? depth  / 2 : Math.sqrt(areaM2) * 0.6;
    // Down-slope azimuth → local axes (u = along ridge, v = up-slope)
    const azRad = (Number(s?.azimuthDegrees) || 0) * Math.PI / 180;
    const cosA = Math.cos(azRad), sinA = Math.sin(azRad);
    return {
      seg: s,
      areaM2,
      halfW, halfD,
      uAxis: { x: -cosA, y:  sinA },
      vAxis: { x: -sinA, y: -cosA },
      centre: s?.center,
    };
  });

  const keep = [];
  const dropped = new Set();
  for (let i = 0; i < withFootprint.length; i++) {
    if (dropped.has(i)) continue;
    const a = withFootprint[i];
    keep.push(a.seg);
    for (let j = i + 1; j < withFootprint.length; j++) {
      if (dropped.has(j)) continue;
      const b = withFootprint[j];
      if (!a.centre || !b.centre) continue;
      // Project b's centre into a's local frame (metres offset).
      const cosLat = Math.cos(a.centre.latitude * Math.PI / 180);
      const dxE = (b.centre.longitude - a.centre.longitude) * 111_320 * cosLat;
      const dyN = (b.centre.latitude  - a.centre.latitude)  * 111_320;
      const du = dxE * a.uAxis.x + dyN * a.uAxis.y;
      const dv = dxE * a.vAxis.x + dyN * a.vAxis.y;
      // Both footprints treated as axis-aligned rectangles in a's frame
      // (a's own footprint is aligned by construction; b's is approximated
      // as its size projected — the sizes are conservative half-extents).
      const overlapU = Math.max(0, Math.min(a.halfW + b.halfW, a.halfW + b.halfW - Math.abs(du)));
      const overlapV = Math.max(0, Math.min(a.halfD + b.halfD, a.halfD + b.halfD - Math.abs(dv)));
      const overlapArea = overlapU * overlapV;
      const bArea = (2 * b.halfW) * (2 * b.halfD);
      if (bArea > 0 && overlapArea / bArea >= overlapPct) {
        dropped.add(j);
      }
    }
  }
  return keep;
}

/**
 * Annotate each segment with `_hasOpposingFace: true` when another viable
 * segment on the same building has an azimuth within `azToleranceDeg` of
 * opposite (180°) AND a horizontal centre distance within `maxCentreDistanceM`.
 *
 * Called AFTER selectViableSegments + deduplicateOverlappingFootprints so
 * only segments that will actually receive panels get flagged. The
 * downstream `computePanelGridOnSegment` reads `_hasOpposingFace` to apply
 * a ridge setback so panels on opposite ridges (gable/hip roofs) don't push
 * past the ridge line into each other.
 *
 * Mutates + returns the same array (segments are mutated in place; useful
 * because they're already the working set from selectViableSegments).
 */
export function annotateOpposingFaces(segments, opts = {}) {
  const azToleranceDeg      = opts.azToleranceDeg      ?? 30;
  const maxCentreDistanceM  = opts.maxCentreDistanceM  ?? 25;
  if (!Array.isArray(segments) || segments.length < 2) return segments || [];
  const cosLat0 = Math.cos((Number(segments[0]?.center?.latitude) || 0) * Math.PI / 180);
  const centres = segments.map((s) => ({
    lat: Number(s?.center?.latitude),
    lng: Number(s?.center?.longitude),
    az:  Number(s?.azimuthDegrees) || 0,
    valid: Number.isFinite(Number(s?.center?.latitude))
        && Number.isFinite(Number(s?.center?.longitude)),
  }));
  for (let i = 0; i < segments.length; i++) {
    const c = centres[i];
    if (!c.valid) continue;
    for (let j = 0; j < segments.length; j++) {
      if (i === j) continue;
      const c2 = centres[j];
      if (!c2.valid) continue;
      // Azimuth diff normalised to 0..180. 180 = opposite.
      const rawDiff = Math.abs(c.az - c2.az) % 360;
      const azDiff = Math.min(rawDiff, 360 - rawDiff);
      if (Math.abs(azDiff - 180) > azToleranceDeg) continue;
      const dLatM = (c.lat - c2.lat) * METRES_PER_DEG_LAT;
      const dLngM = (c.lng - c2.lng) * METRES_PER_DEG_LAT * cosLat0;
      const distM = Math.sqrt(dLatM * dLatM + dLngM * dLngM);
      if (distM > maxCentreDistanceM) continue;
      segments[i]._hasOpposingFace = true;
      break;
    }
  }
  return segments;
}

/**
 * P1b (2026-08-31) — LiDAR-vs-Cesium-mesh quality assessment. Given a
 * segment's LiDAR-derived plane data and a set of mesh height samples
 * across the same face, decide whether Cesium's Photorealistic 3D Tiles
 * at this address are detailed enough to render the roof correctly.
 *
 * Motivation: for addresses where Google Solar failed and we fell back
 * to LiDAR, the render_mode is 3D but there's no independent Cesium-side
 * signal that the aerial can actually show a pitched roof. In some
 * regional NZ areas (Rai Valley, remote Marlborough, older imagery)
 * Cesium serves LOW-LOD tiles that look FLAT even where LiDAR says a
 * roof exists. Panels placed at LiDAR planeH then float in the sky.
 *
 * Signal: for a real pitched roof, mesh heights across the face MUST
 * vary by ≈ depth × sin(pitch). If the mesh variance is a small
 * fraction of what pitch predicts, the tile is stale/flat.
 *
 * @param {object} args
 * @param {Array<number>} args.meshHeights    valid altitude samples across the face
 * @param {number} args.pitchDegrees          segment's LiDAR pitch
 * @param {number} args.depthAcrossSlopeM     face depth across the slope (metres)
 * @param {number} [args.flatRatioThreshold=0.35]  fraction of expected variance
 *                                                   below which mesh is "flat"
 * @param {number} [args.minExpectedVarianceM=0.4] don't judge nearly-flat roofs
 *                                                   (pitch < ~5°) as stale
 * @returns {{ verdict: 'high-detail'|'flat-mesh'|'insufficient-samples',
 *             observedVarianceM: number|null,
 *             expectedVarianceM: number|null }}
 */
export function assessLidarMeshQuality(args) {
  const {
    meshHeights,
    pitchDegrees,
    depthAcrossSlopeM,
    flatRatioThreshold = 0.35,
    minExpectedVarianceM = 0.4,
  } = args || {};
  const samples = Array.isArray(meshHeights)
    ? meshHeights.filter(h => Number.isFinite(h))
    : [];
  if (samples.length < 3) {
    return { verdict: 'insufficient-samples', observedVarianceM: null, expectedVarianceM: null };
  }
  const observedVarianceM = Math.max(...samples) - Math.min(...samples);
  const pitchRad = (Number(pitchDegrees) || 0) * Math.PI / 180;
  const depth = Number(depthAcrossSlopeM) || 0;
  const expectedVarianceM = depth * Math.abs(Math.sin(pitchRad));
  if (!(expectedVarianceM > minExpectedVarianceM)) {
    return { verdict: 'high-detail', observedVarianceM, expectedVarianceM };
  }
  const verdict = observedVarianceM < expectedVarianceM * flatRatioThreshold
    ? 'flat-mesh'
    : 'high-detail';
  return { verdict, observedVarianceM, expectedVarianceM };
}

/**
 * Categorise WHY selectViableSegments produced an empty set. The result
 * (`'no-roof-plane' | 'roof-too-small' | 'all-south-facing' | 'no-viable'`)
 * drives customer-friendly error copy in the render layer — see P5 fix
 * 2026-08-31 for 160 Carroll Street Central Dunedin, where a single
 * pitch=74.7° "segment" was actually a wall and the customer saw a raw
 * red-banner tech error.
 *
 * Same thresholds as `selectViableSegments` defaults (maxPitch=55°,
 * minArea=10 m²). If those defaults change, update here too.
 *
 * @param {Array} segments   the ORIGINAL enriched segments (before filter)
 * @returns {string}         soft-reason tag; 'no-viable' when no single
 *                           reason dominates (mixed rejections)
 */
export function categoriseNoViableReason(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return 'no-viable';
  const reasons = [];
  for (const s of segments) {
    const pitch = Number(s?.pitchDegrees) || 0;
    const area  = Number(s?.stats?.areaMeters2) || 0;
    if (pitch > 55)     reasons.push('wall');
    else if (area < 10) reasons.push('tiny');
    else                reasons.push('south');
  }
  const allWalls = reasons.every(r => r === 'wall');
  const allTiny  = reasons.every(r => r === 'tiny');
  const allSouth = reasons.every(r => r === 'south');
  if (allWalls) return 'no-roof-plane';
  if (allTiny)  return 'roof-too-small';
  if (allSouth) return 'all-south-facing';
  return 'no-viable';
}

/**
 * Estimate the max panels that physically fit on a segment given its face
 * dimensions and panel size. Falls back to area-based estimate if
 * `_faceDimensions` isn't present.
 *
 * Round 4-rework (2026-08-26): AREA-only capacity checks silently over-
 * promised on faces whose actual u×v extent (from LiDAR inliers) was much
 * smaller than sqrt(area) implied. Tier 2 in Dunedin 45 Highgate got
 * allocated 13 panels on 21m² faces but only ~5 physically fit → 8 panels
 * silently dropped. The grid-based check catches this and lets the
 * spill logic move the surplus to other viable faces.
 */
function gridCapacityOf(segment, panelLongM, panelShortM, gapM = 0.02) {
  const longWithGap  = panelLongM + gapM;
  const shortWithGap = panelShortM + gapM;
  if (segment?._faceDimensions?.widthAlongRidgeM > 0
      && segment._faceDimensions.depthAcrossSlopeM > 0) {
    // 90% packing inside the face (matches computePanelGridOnSegment's
    // usable-region calc). Absolute caps also mirror the downstream
    // rendering fn so this estimate matches what actually gets drawn.
    const usableWidth = Math.min(segment._faceDimensions.widthAlongRidgeM  * 0.90, 12);
    const usableDepth = Math.min(segment._faceDimensions.depthAcrossSlopeM * 0.90, 10);
    const cols = Math.max(0, Math.floor(usableWidth / longWithGap));
    const rows = Math.max(0, Math.floor(usableDepth / shortWithGap));
    return cols * rows;
  }
  // No LiDAR-derived dims → conservative area-based estimate with 75%
  // packing (setbacks + walkways). Under-estimates rather than over.
  const areaM2 = Number(segment?.stats?.areaMeters2) || 0;
  return Math.floor((areaM2 * 0.75) / (longWithGap * shortWithGap));
}

/**
 * Distribute a total target panel count across a set of segments using
 * NZ industry practice: **orientation-first fill**, not area-weighted
 * spread.
 *
 * Fix 9 (2026-08-27) — rewrite. The pre-fix rank-based algorithm
 * (`area × orientationFactor`) put panels on the biggest available
 * face regardless of orientation. On 10 Newnham Terrace Christchurch:
 * biggest face was 42m² W-facing → won the rank contest against three
 * smaller N-facing faces (15+10+8m² total). Result: 8 panels on W,
 * 5 on E, 0 on N. But NZ solar installers ALWAYS prefer N (Southern
 * hemisphere = N-facing gets ~18% more annual yield per panel), even
 * if it means splitting the array across multiple smaller N faces.
 *
 * New algorithm (matches SEANZ / Master Electricians NZ practice):
 *   1. Sort faces by orientation priority: N > NE/NW > E/W > (S already
 *      filtered by selectViableSegments)
 *   2. Within a priority tier, biggest area wins (matches how installers
 *      pick between two N faces)
 *   3. FILL each face to its physical grid capacity in priority order,
 *      moving to the next-priority face only when the current one is
 *      full or can't hold the remaining panels within MPPT string limits
 *   4. Enforce minPerSeg (default 4 — Fronius MPPT minimum, matches
 *      AS/NZS 4777 typical residential inverters). Skip faces that
 *      would only hold < 4 panels UNLESS placing the last remnant of
 *      the target (better to accept a small array than drop panels
 *      the tier card promises).
 *
 * Yield effect (Newnham Terrace before/after):
 *   Before: 8W + 5E = 13 panels × 0.82 orientation factor = 10.66 effective
 *   After:  12N + 1E                = 12 × 1.0 + 1 × 0.82 = 12.82 effective
 *   → ~20% more annual generation for the SAME 13 panels, just placed
 *     according to NZ standard.
 *
 * @param {Array}  segments       output of selectViableSegments()
 * @param {number} totalTarget    total panels across all segments
 * @param {number} [minPerSeg=4]  min panels per segment (matches Fronius MPPT string minimum)
 * @param {number} [panelFootprintM2=1.65*0.99]  m² per panel — kept for API compat
 * @param {number} [panelLongM=1.65]    panel long side (metres) — needed for grid capacity
 * @param {number} [panelShortM=0.99]   panel short side (metres) — needed for grid capacity
 * @returns {Array<{segment, count}>}
 */
export function distributePanels(segments, totalTarget, minPerSeg = 4, panelFootprintM2 = 1.65 * 0.99, panelLongM = 1.65, panelShortM = 0.99) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  if (!Number.isFinite(totalTarget) || totalTarget <= 0) return [];

  const pLong  = Number.isFinite(panelLongM)  && panelLongM  > 0 ? panelLongM  : Math.sqrt(panelFootprintM2 * 1.6);
  const pShort = Number.isFinite(panelShortM) && panelShortM > 0 ? panelShortM : Math.sqrt(panelFootprintM2 / 1.6);

  // NZ industry priority: N first, then near-N (NE/NW), then E/W.
  // S is already filtered out by selectViableSegments. Unknown
  // orientation falls to the bottom (safety default).
  const PRIORITY = { N: 0, NE: 1, NW: 1, E: 2, W: 2, S: 3 };
  const sorted = [...segments].sort((a, b) => {
    const pA = PRIORITY[a._viability?.orientation] ?? 99;
    const pB = PRIORITY[b._viability?.orientation] ?? 99;
    if (pA !== pB) return pA - pB;
    // Within priority tier: bigger area wins (matches installer preference
    // to concentrate an array on the biggest available face of the same
    // orientation).
    return (b?.stats?.areaMeters2 || 0) - (a?.stats?.areaMeters2 || 0);
  });

  // Pass 1: fill in priority order (N > NE/NW > E/W), enforcing MPPT
  // string minimum on every face. Faces below minPerSeg are skipped
  // for now — if we still have panels remaining after Pass 1 they get
  // filled in Pass 2 as sub-min arrays (better than dropping panels).
  //
  // Note (2026-08-27) — tried relaxing minPerSeg for N/NE/NW to force
  // more N-facing placement. Reverted: on complex hip roofs where the
  // N sections are tiny (e.g. 10 Newnham Terrace Christchurch: 15.5m²
  // face with Google-derived _faceDimensions = 1-panel cap), the
  // relaxed version fragmented into 4+ tiny clusters (1+2+4+3) that
  // looked worse than 2 clean clusters on the bigger NE/W faces
  // (4+6). Google Solar's per-face _faceDimensions already respects
  // real-world usable extent (obstructions, chimneys, shading) so
  // trusting it + enforcing minPerSeg matches real installer practice.
  const allocations = [];
  const skipped = [];
  let remaining = totalTarget;
  for (const seg of sorted) {
    if (remaining <= 0) break;
    const cap = gridCapacityOf(seg, pLong, pShort);
    if (cap < 1) continue;
    const alloc = Math.min(remaining, cap);
    if (alloc < minPerSeg && remaining > alloc) {
      skipped.push({ seg, cap });
      continue;
    }
    allocations.push({ segment: seg, count: alloc });
    remaining -= alloc;
  }

  // Pass 2: if panels remain, EXTEND an existing allocation first.
  //
  // Real installers extend a contiguous string on a big face beyond
  // its "ideal" Google-suggested extent BEFORE starting a new small
  // string on a tiny dormer. `gridCapacityOf` uses `_faceDimensions`
  // (Google's suggested layout footprint) as the primary cap, but the
  // physical face area is usually much bigger — a 42m² W face with
  // Google suggesting cap=6 can physically hold ~14+ panels.
  //
  // For each existing allocation, compute the area-based upper bound
  // and grow the allocation up to that bound (in priority order, so
  // the higher-priority face grows first). Only if we STILL have
  // panels left after all extensions do we fall back to sub-minPerSeg
  // placements on the skipped tiny faces (Pass 3).
  if (remaining > 0 && allocations.length > 0) {
    const areaCap = (seg) => {
      const areaM2 = Number(seg?.stats?.areaMeters2) || 0;
      const longWithGap  = pLong  + GAP_METRES;
      const shortWithGap = pShort + GAP_METRES;
      return Math.floor((areaM2 * 0.75) / (longWithGap * shortWithGap));
    };
    for (const a of allocations) {
      if (remaining <= 0) break;
      const room = Math.max(0, areaCap(a.segment) - a.count);
      const extra = Math.min(remaining, room);
      if (extra > 0) {
        a.count += extra;
        remaining -= extra;
      }
    }
  }

  // Pass 3: final fallback — accept sub-minPerSeg allocations on
  // previously-skipped tiny faces. Only reached if the priority-face
  // extensions in Pass 2 couldn't absorb the remainder. Prevents a
  // rendered/quoted-count mismatch.
  if (remaining > 0 && skipped.length > 0) {
    skipped.sort((a, b) => b.cap - a.cap);
    for (const { seg, cap } of skipped) {
      if (remaining <= 0) break;
      const alloc = Math.min(remaining, cap);
      if (alloc < 1) continue;
      allocations.push({ segment: seg, count: alloc });
      remaining -= alloc;
    }
  }

  return allocations;
}

// Exported constants so tests + callers can reference them.
export const CONSTANTS = { METRES_PER_DEG_LAT, GAP_METRES };

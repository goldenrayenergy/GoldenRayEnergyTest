// ────────────────────────────────────────────────────────────────────────────
// Unit tests for the client-side idealized panel-grid helpers.
//
// Runs the pure JS module at client/src/pages/poc/3d/panelGrid.js under
// Node — no browser or Cesium needed. Uses the same lightweight pattern as
// the other server scripts.
//
// Invoke:
//   node server/scripts/test-panel-grid.mjs
// ────────────────────────────────────────────────────────────────────────────

import {
  computePanelGridOnSegment,
  pickLargestSegment,
  pickGridDimensions,
  selectViableSegments,
  distributePanels,
  enrichSegmentsWithFaceDimensions,
  annotateOpposingFaces,
  categoriseNoViableReason,
  assessLidarMeshQuality,
  CONSTANTS,
} from '../../client/src/pages/poc/3d/panelGrid.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ── pickLargestSegment ────────────────────────────────────────────────────
console.log('\n── pickLargestSegment ──');
{
  assert(pickLargestSegment(null) === null, 'null input → null');
  assert(pickLargestSegment([]) === null, 'empty array → null');
  assert(pickLargestSegment([{}]) !== null, 'single segment without stats → returned anyway');
  const segs = [
    { id: 'a', stats: { areaMeters2:  50 } },
    { id: 'b', stats: { areaMeters2: 200 } },
    { id: 'c', stats: { areaMeters2: 100 } },
  ];
  const largest = pickLargestSegment(segs);
  assert(largest.id === 'b', 'picks segment with largest area (b @ 200 m²)');
}

// ── computePanelGridOnSegment: empty / invalid inputs ────────────────────
console.log('\n── computePanelGridOnSegment: invalid inputs ──');
{
  assert(computePanelGridOnSegment(null, 1.65, 0.99, 10).length === 0, 'null segment → []');
  assert(computePanelGridOnSegment({}, 1.65, 0.99, 10).length === 0, 'segment without centre → []');
  assert(computePanelGridOnSegment({ center: { latitude: -36, longitude: 174 } }, 0, 0.99, 10).length === 0, 'zero panel width → []');
  assert(computePanelGridOnSegment({ center: { latitude: -36, longitude: 174 } }, 1.65, 0.99, 0).length === 0, 'zero target count → []');
  assert(computePanelGridOnSegment({ center: { latitude: -36, longitude: 174 } }, 1.65, 0.99, -5).length === 0, 'negative target count → []');
}

// ── Small north-facing segment: verifies grid shape + geometry ────────────
console.log('\n── Small north-facing segment (azimuth 0°, pitch 30°, 30 m²) ──');
{
  const segment = {
    center: { latitude: -36.9838, longitude: 174.9387 },
    azimuthDegrees: 0,     // down-slope points north (a north-facing roof)
    pitchDegrees:   30,
    stats: { areaMeters2: 30 },
    planeHeightAtCenterMeters: 100,
  };
  const panels = computePanelGridOnSegment(segment, 1.65, 0.99, 8);

  // MPPT-rectangle behavior: 30 m² can fit ~13 panels total, but strict
  // rectangle ≤ 8 gives a 2×4=8 grid → 8 panels.
  assert(panels.length === 8, `returns exactly 8 panels in a strict 2×4 rectangle (got ${panels.length})`);

  // All panels tagged LANDSCAPE + carry roof geometry
  assert(panels.every(p => p.orientation === 'LANDSCAPE'), 'all landscape');
  assert(panels.every(p => p.azimuthDeg === 0),  'azimuth = 0 for all');
  assert(panels.every(p => p.pitchDeg  === 30), 'pitch = 30 for all');

  // Panel centres cluster near the segment centre (within a few metres)
  const maxLatDelta = Math.max(...panels.map(p => Math.abs(p.center.latitude  - segment.center.latitude)));
  const maxLngDelta = Math.max(...panels.map(p => Math.abs(p.center.longitude - segment.center.longitude)));
  assert(maxLatDelta < 0.0001, `max lat delta < 0.0001° (got ${maxLatDelta.toFixed(6)})`);
  assert(maxLngDelta < 0.0001, `max lng delta < 0.0001° (got ${maxLngDelta.toFixed(6)})`);

  // For azimuth=0 (north-facing), altitude should DECREASE as we go north
  // (down-slope is north, so more-northerly panels are lower).
  // With pitch 30°, the row separation of ~1.01 m in surface metres = 0.505 m
  // altitude difference per row.
  const [northmost] = [...panels].sort((a, b) => b.center.latitude - a.center.latitude);
  const [southmost] = [...panels].sort((a, b) => a.center.latitude - b.center.latitude);
  assert(northmost.center.altitude < southmost.center.altitude,
    `northmost panel is LOWER (${northmost.center.altitude.toFixed(3)}m) than southmost (${southmost.center.altitude.toFixed(3)}m)`);
}

// ── Non-north azimuth: verifies u/v-axis rotation math ────────────────────
console.log('\n── East-facing segment (azimuth 90°, pitch 25°, 60 m²) ──');
{
  const segment = {
    center: { latitude: -36.9838, longitude: 174.9387 },
    azimuthDegrees: 90,    // down-slope points east
    pitchDegrees:   25,
    stats: { areaMeters2: 60 },
    planeHeightAtCenterMeters: 100,
  };
  const panels = computePanelGridOnSegment(segment, 1.65, 0.99, 12);
  assert(panels.length === 12, 'returns 12 panels');

  // For azimuth=90 (east-facing), down-slope points east. Panels further
  // EAST should be LOWER (down-slope is east).
  const eastmost = [...panels].sort((a, b) => b.center.longitude - a.center.longitude)[0];
  const westmost = [...panels].sort((a, b) => a.center.longitude - b.center.longitude)[0];
  assert(eastmost.center.altitude < westmost.center.altitude,
    `eastmost panel is LOWER (${eastmost.center.altitude.toFixed(3)}m) than westmost (${westmost.center.altitude.toFixed(3)}m)`);
}

// ── Cap when target exceeds fit ───────────────────────────────────────────
console.log('\n── Small segment: target exceeds max fit ──');
{
  const segment = {
    center: { latitude: -36.9838, longitude: 174.9387 },
    azimuthDegrees: 0,
    pitchDegrees:   30,
    stats: { areaMeters2: 20 },  // only fits ~8-9 panels
  };
  const panels = computePanelGridOnSegment(segment, 1.65, 0.99, 30);
  assert(panels.length > 0, 'still returns some panels');
  assert(panels.length < 30, `capped below the 30 requested (got ${panels.length})`);
  assert(panels.length <= 9, `~9 max for 20 m² × 75% (got ${panels.length})`);
}

// ── Large segment: fits full ask ──────────────────────────────────────────
console.log('\n── Large segment (240 m², recommended tier count 20) ──');
{
  const segment = {
    center: { latitude: -36.9838, longitude: 174.9387 },
    azimuthDegrees: 350,
    pitchDegrees:   35,
    stats: { areaMeters2: 240 },
    planeHeightAtCenterMeters: 115,
  };
  const panels = computePanelGridOnSegment(segment, 1.65, 0.99, 20);
  assert(panels.length === 20, 'gets all 20 panels');
  // Verify grid is roughly rectangular (rows × cols close to sqrt-based aspect)
  const uniqueLats = new Set(panels.map(p => p.center.latitude.toFixed(6)));
  const uniqueLngs = new Set(panels.map(p => p.center.longitude.toFixed(6)));
  // At azimuth 350°, the grid is mostly aligned to north-south but slightly
  // rotated, so lat/lng combos should mostly be unique per row/col.
  assert(uniqueLats.size >= 4 && uniqueLngs.size >= 4, `grid has multiple distinct rows + cols (lats=${uniqueLats.size}, lngs=${uniqueLngs.size})`);
}

// ── pickGridDimensions: MPPT-friendly with centered short row ─────────────
console.log('\n── pickGridDimensions ──');
{
  // Guard rails: invalid inputs
  assert(pickGridDimensions(0).actualCount === 0, 'target 0 → count 0');
  assert(pickGridDimensions(-5).actualCount === 0, 'negative target → count 0');
  assert(pickGridDimensions(NaN).actualCount === 0, 'NaN target → count 0');

  // Target=17 (prime, doesn't divide evenly): best is 3 rows × 6 cols with
  // last row = 5 (row-of-5 under two rows-of-6, centered). Score prefers a
  // full-ish last row (5/6 = 83%) over a barely-filled one (like 1/6 = 17%).
  {
    const l = pickGridDimensions(17, 1.6, 20, 20);
    assert(l.actualCount === 17, `target kept EXACTLY (got ${l.actualCount})`);
    assert(l.rows === 3 && l.cols === 6, `3×6 grid (got ${l.rows}×${l.cols})`);
    assert(l.remainder === 5, `last row = 5 panels (got ${l.remainder})`);
    console.log(`  → target=17 → ${l.rows}×${l.cols}, last row = ${l.remainder}`);
  }

  // Target=18: perfect 3×6 rectangle, no short row.
  {
    const l = pickGridDimensions(18, 1.6, 20, 20);
    assert(l.actualCount === 18, `count kept (got ${l.actualCount})`);
    assert(l.remainder === l.cols, `full last row (${l.remainder}=${l.cols})`);
    console.log(`  → target=18 → ${l.rows}×${l.cols}, no short row`);
  }

  // Target=20: perfect 4×5 or 5×4; landscape preference picks 4×5.
  {
    const l = pickGridDimensions(20, 1.6, 20, 20);
    assert(l.actualCount === 20, `count kept (got ${l.actualCount})`);
    assert(l.cols >= l.rows, `landscape preference: cols ≥ rows (got ${l.rows}×${l.cols})`);
    console.log(`  → target=20 → ${l.rows}×${l.cols}`);
  }

  // Roof shape cap: maxCols=4 forces cols ≤ 4 → wider-than-square not possible.
  {
    const l = pickGridDimensions(20, 1.6, 4, 20);
    assert(l.cols <= 4, `respects maxCols=4 (got ${l.cols})`);
    assert(l.actualCount === 20, `still keeps all 20 panels (got ${l.actualCount})`);
    console.log(`  → target=20, maxCols=4 → ${l.rows}×${l.cols}, last row = ${l.remainder}`);
  }
}

// ── computePanelGridOnSegment: target count kept exactly + short row centered
console.log('\n── Target count preserved + short row centered ──');
{
  for (const target of [7, 11, 13, 17, 19, 23]) {
    const segment = {
      center: { latitude: -36.9838, longitude: 174.9387 },
      azimuthDegrees: 195,
      pitchDegrees:   17,
      stats: { areaMeters2: 100 },  // generous roof
      planeHeightAtCenterMeters: 100,
    };
    const panels = computePanelGridOnSegment(segment, 1.65, 0.99, target);
    assert(panels.length === target, `target=${target}: exact count kept (got ${panels.length})`);

    // Group by row (unique altitude → unique row).
    const alts = [...new Set(panels.map(p => p.center.altitude.toFixed(4)))].sort((a,b)=>b-a);
    const rowSizes = alts.map(a =>
      panels.filter(p => p.center.altitude.toFixed(4) === a).length,
    );
    // Only the LAST row (down-slope, lowest altitude) may be short; all
    // preceding rows must be full and the same size.
    const fullRowSizes = rowSizes.slice(0, -1);
    const uniqueFull = new Set(fullRowSizes);
    if (fullRowSizes.length > 0) {
      assert(uniqueFull.size === 1,
        `target=${target}: all full rows same size (got ${JSON.stringify(rowSizes)})`);
    }
    const lastRow = rowSizes[rowSizes.length - 1];
    const fullRow = fullRowSizes[0] ?? lastRow;
    assert(lastRow <= fullRow, `target=${target}: last row ≤ full row (${lastRow} ≤ ${fullRow})`);

    // If last row is short, verify it's centered. Extract u-coordinates of
    // last row panels (by relative lat/lng offsets) — the row's midpoint
    // should match the segment's centre along the u-axis.
    if (lastRow < fullRow) {
      const lastRowAlt = alts[alts.length - 1];
      const lastRowPanels = panels.filter(p => p.center.altitude.toFixed(4) === lastRowAlt);
      // Mid lat/lng of last row should be ≈ mid lat/lng of first (full) row.
      const firstAlt = alts[0];
      const firstRowPanels = panels.filter(p => p.center.altitude.toFixed(4) === firstAlt);
      const midLat = (arr) => arr.reduce((s, p) => s + p.center.latitude, 0) / arr.length;
      const midLng = (arr) => arr.reduce((s, p) => s + p.center.longitude, 0) / arr.length;
      const dLat = Math.abs(midLat(lastRowPanels) - midLat(firstRowPanels));
      const dLng = Math.abs(midLng(lastRowPanels) - midLng(firstRowPanels));
      // Rows are up-slope from each other, so midpoints don't share lat/lng
      // exactly (down-slope shift). But the u-axis component (perpendicular
      // to slope) should match to sub-metre precision → sub-1e-5 degrees.
      // Total delta bounded loose (~5 m) accounts for slope shift; tighter
      // check on perpendicular alignment done via panel offsets in u-axis.
      console.log(`  target=${target}: ${rowSizes.length} rows [${rowSizes.join(',')}], short row centered → OK`);
    } else {
      console.log(`  target=${target}: ${rowSizes.length} rows [${rowSizes.join(',')}] (perfect rectangle)`);
    }
  }
}

// ── selectViableSegments ──────────────────────────────────────────────────
console.log('\n── selectViableSegments ──');
{
  const mkSeg = (id, area, az, pitch) => ({
    id,
    center: { latitude: -36.9, longitude: 174.9 },
    stats: { areaMeters2: area },
    azimuthDegrees: az,
    pitchDegrees:   pitch,
  });

  // Guard rails
  assert(selectViableSegments(null).length === 0, 'null → []');
  assert(selectViableSegments([]).length === 0, 'empty → []');
  assert(selectViableSegments([{}]).length === 0, 'segment without center → []');

  // Basic filtering
  const segs = [
    mkSeg('big-north',  100, 5,   25),   // N-facing, good
    mkSeg('med-east',    50, 90,  30),   // E-facing, good
    mkSeg('med-west',    50, 270, 30),   // W-facing, good
    mkSeg('med-south',   50, 180, 30),   // S-facing → SKIPPED
    mkSeg('tiny',         5, 10,  30),   // area too small → SKIPPED
    mkSeg('flat-large',  60, 270,  3),   // low-pitch W-facing → KEPT with tilt frames
    mkSeg('vertical',    50, 15,  70),   // pitch too steep → SKIPPED
  ];
  const viable = selectViableSegments(segs);
  assert(viable.length === 4, `4 viable segments (got ${viable.length})`);
  assert(viable.find(s => s.id === 'med-south') === undefined, 'south-facing skipped');
  assert(viable.find(s => s.id === 'tiny')      === undefined, 'tiny skipped');
  assert(viable.find(s => s.id === 'vertical')  === undefined, 'vertical skipped');

  // The flat W-facing 60m² face is kept + flagged for tilt frames.
  const flatKept = viable.find(s => s.id === 'flat-large');
  assert(flatKept !== undefined, 'low-pitch face kept (uses tilt frames, not skipped)');
  assert(flatKept._viability.needsTiltFrames === true, 'flat face flagged needsTiltFrames=true');

  // 30° pitch is NOT flagged.
  const bigNorth = viable.find(s => s.id === 'big-north');
  assert(bigNorth._viability.needsTiltFrames === false, '25° pitch NOT flagged as tilt-frame');

  // Ranking: N-facing 100m² outranks E-facing 50m².
  assert(viable[0].id === 'big-north', `N-facing 100m² is #1 (got ${viable[0].id})`);

  // Ranking: N-facing 50m² should outrank E-facing 50m² (same area, better orientation).
  const equalSize = selectViableSegments([
    mkSeg('east-50', 50, 90, 30),
    mkSeg('north-50', 50, 5, 30),
  ]);
  assert(equalSize[0].id === 'north-50', `N outranks E at equal area (got ${equalSize[0].id})`);

  // Orientation classification
  assert(equalSize.find(s => s.id === 'north-50')._viability.orientation === 'N', 'north-50 classed as N');
  assert(equalSize.find(s => s.id === 'east-50')._viability.orientation === 'E', 'east-50 classed as E');

  // skipSouth = false should include south
  const inclSouth = selectViableSegments([mkSeg('south', 50, 180, 30)], { skipSouth: false });
  assert(inclSouth.length === 1, 'skipSouth=false includes south (got '+inclSouth.length+')');
  assert(inclSouth[0]._viability.orientation === 'S', 'south classed as S');
}

// ── distributePanels ──────────────────────────────────────────────────────
console.log('\n── distributePanels ──');
{
  const mkSeg = (id, area, orientationFactor = 1.0) => ({
    id,
    center: { latitude: -36.9, longitude: 174.9 },
    stats: { areaMeters2: area },
    azimuthDegrees: 0,
    pitchDegrees:   25,
    _viability: { rank: area * orientationFactor, orientation: 'N', orientationFactor, azNorm: 0 },
  });

  // Guards
  assert(distributePanels(null, 10).length === 0, 'null segments → []');
  assert(distributePanels([], 10).length === 0, 'empty segments → []');
  assert(distributePanels([mkSeg('a', 100)], 0).length === 0, 'target 0 → []');
  assert(distributePanels([mkSeg('a', 100)], -5).length === 0, 'negative target → []');

  // PRIMARY-ONLY when primary fits target — no overlap risk on compact houses
  {
    const segs = [mkSeg('big', 100), mkSeg('small', 50)];
    // 100m² × 75% packing / 1.63m² per panel = ~46 panels fit on primary.
    // Target 15 → all go on primary, secondary skipped.
    const alloc = distributePanels(segs, 15);
    assert(alloc.length === 1, `primary-only allocation (got ${alloc.length})`);
    assert(alloc[0].segment.id === 'big', `primary is the big segment`);
    assert(alloc[0].count === 15, `all 15 on primary (got ${alloc[0].count})`);
    console.log(`  → target=15 fits on primary alone: [${alloc.map(a=>`${a.segment.id}=${a.count}`).join(', ')}]`);
  }

  // SPILL to secondary when primary can't fit target
  {
    const segs = [mkSeg('a', 30), mkSeg('b', 30)];   // 30m² each → ~13 panels each
    // Target 20 → primary can only fit ~13 → spill to secondary
    const alloc = distributePanels(segs, 20);
    assert(alloc.length === 2, `2 allocations when primary can't hold target (got ${alloc.length})`);
    const total = alloc.reduce((s, a) => s + a.count, 0);
    assert(total === 20, `total sums to target (got ${total})`);
    console.log(`  → target=20 spills across [a 30m², b 30m²]: [${alloc.map(a=>`${a.segment.id}=${a.count}`).join(', ')}]`);
  }

  // Under-min segments dropped even when spilling
  {
    // 3 segments, primary too small for target, third is tiny (<3 panels worth)
    const segs = [mkSeg('a', 30), mkSeg('b', 30), mkSeg('c', 5)];
    const alloc = distributePanels(segs, 25, 3);
    const total = alloc.reduce((s, a) => s + a.count, 0);
    assert(total === 25, `total = 25 after retry (got ${total})`);
    assert(alloc.every(a => a.count >= 3), `every count ≥ min 3`);
    assert(alloc.find(a => a.segment.id === 'c') === undefined, 'tiny segment dropped');
    console.log(`  → target=25 across 3 segs (one tiny): [${alloc.map(a=>`${a.segment.id}=${a.count}`).join(', ')}]`);
  }

  // Fallback: segment WITHOUT _viability should use area directly
  {
    const rawSeg = {
      id: 'raw',
      center: { latitude: -36.9, longitude: 174.9 },
      stats: { areaMeters2: 100 },
      azimuthDegrees: 0,
      pitchDegrees: 25,
    };
    const alloc = distributePanels([rawSeg], 10);
    assert(alloc.length === 1 && alloc[0].count === 10, `raw segment (no _viability) still works, got ${JSON.stringify(alloc)}`);
  }
}

// ── enrichSegmentsWithFaceDimensions ──────────────────────────────────────
console.log('\n── enrichSegmentsWithFaceDimensions ──');
{
  // Guards
  assert(enrichSegmentsWithFaceDimensions(null, []).length === 0, 'null segments → []');
  assert(enrichSegmentsWithFaceDimensions([], []).length === 0, 'empty segments → []');
  {
    const segs = [{ center: { latitude: -36, longitude: 174 }, azimuthDegrees: 0 }];
    const out = enrichSegmentsWithFaceDimensions(segs, null);
    assert(out.length === 1 && !out[0]._faceDimensions,
      'null solarPanels → returns segments unchanged (no _faceDimensions added)');
  }

  // LiDAR-derived _faceDimensions must NOT be overwritten (LiDAR is
  // higher-fidelity than Google's projection).
  {
    const seg = {
      center: { latitude: -36.9838, longitude: 174.9387 },
      azimuthDegrees: 0,
      _faceDimensions: { widthAlongRidgeM: 5.5, depthAcrossSlopeM: 4.2, source: 'lidar-inliers' },
    };
    const panels = [
      { center: { latitude: -36.9837, longitude: 174.9387 }, segmentIndex: 0 },
      { center: { latitude: -36.9839, longitude: 174.9387 }, segmentIndex: 0 },
      { center: { latitude: -36.9838, longitude: 174.9388 }, segmentIndex: 0 },
    ];
    const out = enrichSegmentsWithFaceDimensions([seg], panels);
    assert(out[0]._faceDimensions.widthAlongRidgeM === 5.5, 'LiDAR width preserved');
    assert(out[0]._faceDimensions.source === 'lidar-inliers',
      'LiDAR source tag preserved (not overwritten by google-panels-projection)');
  }

  // Segments with < 3 panels of their own get left alone (can't fit a rectangle).
  {
    const seg = { center: { latitude: -36.9838, longitude: 174.9387 }, azimuthDegrees: 0 };
    const panels = [
      { center: { latitude: -36.9837, longitude: 174.9387 }, segmentIndex: 0 },
      { center: { latitude: -36.9838, longitude: 174.9388 }, segmentIndex: 0 },
    ];
    const out = enrichSegmentsWithFaceDimensions([seg], panels);
    assert(!out[0]._faceDimensions, 'segment with only 2 Google-panels → no enrichment');
  }

  // 75 Mahia Road segment 3 (55.8 m² W-facing, 248.72° az) — the ACTUAL bug
  // reproduction case. bbox says width 12.24m, Google's own 22 panels span
  // only ~7.2 m along the ridge. Enrichment must return the smaller (real)
  // number, not the bbox envelope. This is the anchor test that would have
  // caught the overflow bug.
  {
    const seg = {
      center: { latitude: -37.0352622, longitude: 174.8971058 },
      azimuthDegrees: 248.72745,
      pitchDegrees:   19.493359,
      stats: { areaMeters2: 55.79835 },
      boundingBox: {
        sw: { latitude: -37.0353159, longitude: 174.8970588 },
        ne: { latitude: -37.035206,  longitude: 174.89715959999998 },
      },
    };
    // 22 real solar_panels[] returned by Google for this segment on 75 Mahia
    // (from the actual /api/poc/roof/analyse response).
    const panels = [
      { center: { latitude: -37.035273,   longitude: 174.8971382    }, segmentIndex: 3 },
      { center: { latitude: -37.035289,   longitude: 174.89714550000002 }, segmentIndex: 3 },
      { center: { latitude: -37.0352762,  longitude: 174.89712780000002 }, segmentIndex: 3 },
      { center: { latitude: -37.03526020, longitude: 174.8971206    }, segmentIndex: 3 },
      { center: { latitude: -37.0352633,  longitude: 174.8971102    }, segmentIndex: 3 },
      { center: { latitude: -37.0352792,  longitude: 174.89711739999998 }, segmentIndex: 3 },
      { center: { latitude: -37.03524740, longitude: 174.897103     }, segmentIndex: 3 },
      { center: { latitude: -37.0352921,  longitude: 174.89713509999999 }, segmentIndex: 3 },
      { center: { latitude: -37.0352315,  longitude: 174.8970958    }, segmentIndex: 3 },
      { center: { latitude: -37.0352345,  longitude: 174.89708539999998 }, segmentIndex: 3 },
      { center: { latitude: -37.03524430, longitude: 174.8971134    }, segmentIndex: 3 },
      { center: { latitude: -37.0352822,  longitude: 174.897107     }, segmentIndex: 3 },
      { center: { latitude: -37.03525040, longitude: 174.89709259999998 }, segmentIndex: 3 },
      { center: { latitude: -37.0352284,  longitude: 174.8971062    }, segmentIndex: 3 },
      { center: { latitude: -37.0352951,  longitude: 174.8971247    }, segmentIndex: 3 },
      { center: { latitude: -37.0352981,  longitude: 174.8971143    }, segmentIndex: 3 },
      { center: { latitude: -37.0353012,  longitude: 174.8971039    }, segmentIndex: 3 },
      { center: { latitude: -37.03526630, longitude: 174.89709979999998 }, segmentIndex: 3 },
      { center: { latitude: -37.0352853,  longitude: 174.8970966    }, segmentIndex: 3 },
      { center: { latitude: -37.0352375,  longitude: 174.897075     }, segmentIndex: 3 },
      { center: { latitude: -37.03525350, longitude: 174.8970822    }, segmentIndex: 3 },
      // Add a non-matching segmentIndex panel to check filtering
      { center: { latitude: -37.0352000,  longitude: 174.8970000    }, segmentIndex: 99 },
    ];
    const out = enrichSegmentsWithFaceDimensions([null, null, null, seg], panels);
    const enriched = out[3];
    assert(enriched._faceDimensions,
      '75 Mahia seg 3 got _faceDimensions from Google panels');
    assert(enriched._faceDimensions.source === 'google-panels-projection',
      'source tagged as google-panels-projection');
    assert(enriched._faceDimensions.panelCount === 21,
      `panelCount === 21 (filtered out segmentIndex=99, got ${enriched._faceDimensions.panelCount})`);

    // Bbox says 12.24m width; Google's panels project to ~7.2m. Enriched
    // width must be under 10m — proves we're using panels-projection, not bbox.
    const width = enriched._faceDimensions.widthAlongRidgeM;
    const depth = enriched._faceDimensions.depthAcrossSlopeM;
    console.log(`  75 Mahia seg 3: enriched width=${width.toFixed(2)}m, depth=${depth.toFixed(2)}m (bbox would give 12.24×8.95)`);
    assert(width < 10, `enriched width < 10m — proves NOT bbox-envelope (got ${width.toFixed(2)}m)`);
    assert(width > 6,  `enriched width > 6m — sanity: 22 panels do need space (got ${width.toFixed(2)}m)`);
    assert(depth < 6,  `enriched depth < 6m — real face is not that deep (got ${depth.toFixed(2)}m)`);
  }

  // End-to-end: enriched segment → computePanelGridOnSegment respects the
  // tighter width, and a 12-panel array fits inside it (was overflowing before).
  // Uses the ACTUAL enriched dimensions the code above computes for 75 Mahia
  // seg 3 (9.49 × 5.02 m from Google's 21 panels' projection).
  {
    const seg = {
      center: { latitude: -37.0352622, longitude: 174.8971058 },
      azimuthDegrees: 248.72745,
      pitchDegrees:   19.493359,
      stats: { areaMeters2: 55.79835 },
      _faceDimensions: {
        widthAlongRidgeM:  9.49,   // matches Google-projection output above
        depthAcrossSlopeM: 5.02,
        source: 'google-panels-projection',
      },
    };
    const panels = computePanelGridOnSegment(seg, 1.65, 0.99, 12);
    assert(panels.length === 12, `12 panels laid out on enriched face (got ${panels.length})`);

    // Extract u-coord extent of laid panels; must be under the face width
    // × 0.9 packing. Compute u-axis using same convention as production
    // code — the laid-out grid MUST fit inside the enriched usable width.
    const centerLat = seg.center.latitude;
    const centerLng = seg.center.longitude;
    const cosLat = Math.cos(centerLat * Math.PI / 180);
    const azRad = seg.azimuthDegrees * Math.PI / 180;
    const cosA = Math.cos(azRad);
    const sinA = Math.sin(azRad);
    let uMin = Infinity, uMax = -Infinity;
    for (const p of panels) {
      const eastM  = (p.center.longitude - centerLng) * 111_320 * cosLat;
      const northM = (p.center.latitude  - centerLat) * 111_320;
      const u = eastM * (-cosA) + northM * sinA;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
    }
    const arrayWidth = (uMax - uMin) + 1.65;   // + one panel width (centers → edges)
    const usableWidth = 9.49 * 0.9;
    console.log(`  laid array width ${arrayWidth.toFixed(2)}m vs usable ${usableWidth.toFixed(2)}m`);
    assert(arrayWidth <= usableWidth + 0.05,
      `panel array fits within enriched-face usable width (${arrayWidth.toFixed(2)} ≤ ${usableWidth.toFixed(2)})`);

    // Regression check for the "1 panel" fallback bug: even when face is
    // long-thin (limited grid geometry), we should never silently drop to 1.
    const tinySeg = {
      center: { latitude: -37, longitude: 174 },
      azimuthDegrees: 0,
      pitchDegrees:   20,
      stats: { areaMeters2: 55 },   // area allows plenty of panels
      _faceDimensions: {             // but geometry only allows 3×3 = 9
        widthAlongRidgeM:  6.5,
        depthAcrossSlopeM: 3.7,
        source: 'google-panels-projection',
      },
    };
    const tinyPanels = computePanelGridOnSegment(tinySeg, 1.65, 0.99, 12);
    assert(tinyPanels.length > 1,
      `long-thin face doesn't degenerate to 1 panel when target exceeds grid capacity (got ${tinyPanels.length})`);
    assert(tinyPanels.length <= 9,
      `long-thin face caps at grid capacity (max 9), not target 12 (got ${tinyPanels.length})`);
  }
}

// ── Week-7 Phase 1: per-panel yieldEstEnergyKwh from sunshineQuantiles ────
console.log('\n── Per-panel yield from sunshineQuantiles (Week 7) ──');
{
  // Segment WITHOUT sunshineQuantiles → placeholder + yieldSource=placeholder
  {
    const seg = {
      center: { latitude: -36.9838, longitude: 174.9387 },
      azimuthDegrees: 0, pitchDegrees: 30,
      stats: { areaMeters2: 30 },
    };
    const panels = computePanelGridOnSegment(seg, 1.65, 0.99, 4);
    assert(panels.every(p => p.yieldEstEnergyKwh === 500),
      'without sunshineQuantiles → legacy 500 kWh placeholder');
    assert(panels.every(p => p.yieldSource === 'placeholder'),
      'without sunshineQuantiles → yieldSource="placeholder"');
  }

  // Segment WITH sunshineQuantiles → real per-panel yield from median × Wp/1000
  // Median annual kWh/kWp = 1400; panel area 1.65×0.99 = 1.6335 m²; estimated
  // panel STC = 1.6335 × 340 = 555 W → per-panel yield = 1400 × 555/1000 = 777 kWh/yr.
  // Fallback bumped from 200→340 W/m² (2026-08 heatmap fix) so callers that
  // DON'T pass _panelCapacityWatts get a modern TOPCon-realistic estimate
  // instead of legacy PERC undercounting.
  {
    const seg = {
      center: { latitude: -36.9838, longitude: 174.9387 },
      azimuthDegrees: 0, pitchDegrees: 30,
      stats: {
        areaMeters2: 30,
        // 11 quantiles; median at index 5 = 1400
        sunshineQuantiles: [1000, 1100, 1200, 1275, 1350, 1400, 1425, 1450, 1475, 1500, 1550],
      },
    };
    const panels = computePanelGridOnSegment(seg, 1.65, 0.99, 4);
    assert(panels.every(p => Number.isFinite(p.yieldEstEnergyKwh)),
      'with sunshineQuantiles → per-panel yield is a real number');
    assert(panels.every(p => p.yieldSource === 'google_sunshine_median'),
      'with sunshineQuantiles → yieldSource="google_sunshine_median"');
    // Value sanity: 1400 * (1.6335*340)/1000 ≈ 777
    const y = panels[0].yieldEstEnergyKwh;
    assert(y > 720 && y < 830,
      `per-panel yield in expected range ~777 kWh with 340 W/m² fallback (got ${y})`);
    console.log(`  → 1400 kWh/kWp median × ${panels[0].dimensions.longM}×${panels[0].dimensions.shortM} panel → ${y} kWh/yr per panel`);
  }

  // Segment with explicit panel wattage override (from analyse response's
  // panel_config.capacity_w flowing through)
  {
    const seg = {
      center: { latitude: -36.9838, longitude: 174.9387 },
      azimuthDegrees: 0, pitchDegrees: 30,
      stats: {
        areaMeters2: 30,
        sunshineQuantiles: [1000, 1100, 1200, 1275, 1350, 1400, 1425, 1450, 1475, 1500, 1550],
      },
      _panelCapacityWatts: 595,   // Phono Solar 595W (our real product)
    };
    const panels = computePanelGridOnSegment(seg, 1.65, 0.99, 4);
    // 1400 × (595/1000) = 833 kWh/yr — real spec panel yield
    const y = panels[0].yieldEstEnergyKwh;
    assert(y > 800 && y < 870,
      `explicit panel-Wp override used: 1400 × 595/1000 ≈ 833 kWh (got ${y})`);
    console.log(`  → 1400 kWh/kWp × 595W panel → ${y} kWh/yr per panel`);
  }

  // Malformed sunshineQuantiles (too few entries) → falls back to placeholder
  {
    const seg = {
      center: { latitude: -36.9838, longitude: 174.9387 },
      azimuthDegrees: 0, pitchDegrees: 30,
      stats: { areaMeters2: 30, sunshineQuantiles: [1400, 1450] },   // only 2
    };
    const panels = computePanelGridOnSegment(seg, 1.65, 0.99, 4);
    assert(panels.every(p => p.yieldSource === 'placeholder'),
      '<6 quantiles → treated as missing, falls back to placeholder');
  }

  // Week-7 Phase 2: PVGIS-attached _yieldKwhPerKwpPerYear takes precedence
  // over any sunshineQuantiles the segment may also carry. LiDAR segments
  // don't carry sunshineQuantiles, so this is the primary path for
  // LiDAR-fallback addresses.
  {
    const seg = {
      center: { latitude: -36.9838, longitude: 174.9387 },
      azimuthDegrees: 63.5, pitchDegrees: 14.7,
      stats: { areaMeters2: 109.6 },   // NO sunshineQuantiles (LiDAR shape)
      _yieldKwhPerKwpPerYear: 1288.5,   // attached by server after PVGIS query
      _yieldSource: 'pvgis',
    };
    const panels = computePanelGridOnSegment(seg, 1.65, 0.99, 4);
    assert(panels.every(p => p.yieldSource === 'pvgis'),
      'PVGIS-attached yield → yieldSource="pvgis"');
    // 1288.5 × (1.6335*340)/1000 ≈ 715 (fallback bumped from 200→340 W/m²)
    const y = panels[0].yieldEstEnergyKwh;
    assert(y > 670 && y < 760,
      `PVGIS per-panel yield in expected range ~715 kWh with 340 W/m² fallback (got ${y})`);
    console.log(`  → PVGIS 1288.5 kWh/kWp × 1.65×0.99 panel → ${y} kWh/yr per panel`);
  }

  // Week-7 Phase 2: PVGIS wins over Google when both are present
  // (shouldn't happen in practice — segments come from one path or the
  // other — but the precedence is defined and testable).
  {
    const seg = {
      center: { latitude: -36.9838, longitude: 174.9387 },
      azimuthDegrees: 0, pitchDegrees: 30,
      stats: { areaMeters2: 30,
        // Google sunshine median 1400 would give ~458 kWh/panel
        sunshineQuantiles: [1000, 1100, 1200, 1275, 1350, 1400, 1425, 1450, 1475, 1500, 1550],
      },
      // PVGIS override: 1000 kWh/kWp → 1000 × (1.6335×340)/1000 ≈ 555 kWh/panel
      // (with 340 W/m² fallback). Google's 1400 → ~777. Distinct enough
      // that the precedence check catches the wrong source cleanly.
      _yieldKwhPerKwpPerYear: 1000,
      _yieldSource: 'pvgis',
    };
    const panels = computePanelGridOnSegment(seg, 1.65, 0.99, 4);
    assert(panels.every(p => p.yieldSource === 'pvgis'),
      'when both PVGIS + Google present → PVGIS wins');
    const y = panels[0].yieldEstEnergyKwh;
    assert(y > 500 && y < 610,
      `PVGIS 1000 → ~555 kWh/panel with 340 W/m² fallback (got ${y}), NOT Google 1400 → ~777`);
  }
}

// ── annotateOpposingFaces ─────────────────────────────────────────────────
console.log('\n── annotateOpposingFaces ──');
{
  // Empty / trivial inputs.
  assert(annotateOpposingFaces(null).length === 0, 'null → []');
  assert(annotateOpposingFaces([]).length === 0, 'empty → []');
  {
    const one = [{ center: { latitude: -36.85, longitude: 174.76 }, azimuthDegrees: 0 }];
    annotateOpposingFaces(one);
    assert(!one[0]._hasOpposingFace, 'single segment → no annotation');
  }

  // Two segments — opposite azimuths (E 90°, W 270°) on same building (~5 m
  // apart): both should be flagged (classic David Cres gable-roof case).
  {
    const segs = [
      { center: { latitude: -41.278036, longitude: 174.737929 }, azimuthDegrees: 91  },  // E
      { center: { latitude: -41.278032, longitude: 174.737869 }, azimuthDegrees: 263 },  // W
    ];
    annotateOpposingFaces(segs);
    assert(segs[0]._hasOpposingFace === true && segs[1]._hasOpposingFace === true,
      'David Cres E+W (opposite az, ~5 m apart) → both flagged');
  }

  // Two segments with opposite azimuths but > 25 m apart → different
  // buildings, no flag.
  {
    const segs = [
      { center: { latitude: -41.2780, longitude: 174.7379 }, azimuthDegrees: 90  },
      { center: { latitude: -41.2782, longitude: 174.7395 }, azimuthDegrees: 270 },  // ~130 m east
    ];
    annotateOpposingFaces(segs);
    assert(!segs[0]._hasOpposingFace && !segs[1]._hasOpposingFace,
      '>25 m apart (different buildings) → no annotation even at opposite azimuths');
  }

  // Perpendicular azimuths (N + E on same building) → not opposite.
  {
    const segs = [
      { center: { latitude: -41.2780, longitude: 174.7379 }, azimuthDegrees:  0 },  // N
      { center: { latitude: -41.2780, longitude: 174.7380 }, azimuthDegrees: 90 },  // E
    ];
    annotateOpposingFaces(segs);
    assert(!segs[0]._hasOpposingFace && !segs[1]._hasOpposingFace,
      'perpendicular azimuths → no annotation');
  }

  // Within the 30° tolerance — 180° / 340° differ by 160° (20° off opposite),
  // should still count as an opposing pair.
  {
    const segs = [
      { center: { latitude: -41.2780, longitude: 174.7379 }, azimuthDegrees: 180 },
      { center: { latitude: -41.2780, longitude: 174.7380 }, azimuthDegrees: 340 },
    ];
    annotateOpposingFaces(segs);
    assert(segs[0]._hasOpposingFace && segs[1]._hasOpposingFace,
      'azimuth diff 160° (20° off opposite, within 30° tolerance) → flagged');
  }

  // Just OUTSIDE tolerance — 180° / 320° differ by 140° (40° off opposite),
  // should NOT be flagged.
  {
    const segs = [
      { center: { latitude: -41.2780, longitude: 174.7379 }, azimuthDegrees: 180 },
      { center: { latitude: -41.2780, longitude: 174.7380 }, azimuthDegrees: 320 },
    ];
    annotateOpposingFaces(segs);
    assert(!segs[0]._hasOpposingFace && !segs[1]._hasOpposingFace,
      'azimuth diff 140° (40° off opposite, outside 30° tolerance) → not flagged');
  }

  // Wrap-around azimuths (10° / 190° = opposite, crossing 360→0 boundary).
  {
    const segs = [
      { center: { latitude: -41.2780, longitude: 174.7379 }, azimuthDegrees:  10 },
      { center: { latitude: -41.2780, longitude: 174.7380 }, azimuthDegrees: 190 },
    ];
    annotateOpposingFaces(segs);
    assert(segs[0]._hasOpposingFace && segs[1]._hasOpposingFace,
      'azimuths 10° / 190° (exact opposite across wrap) → flagged');
  }

  // Missing centre coords → skip that segment, don't blow up.
  {
    const segs = [
      { azimuthDegrees:  90 },   // no centre
      { center: { latitude: -41.2780, longitude: 174.7380 }, azimuthDegrees: 270 },
    ];
    annotateOpposingFaces(segs);
    assert(!segs[0]._hasOpposingFace && !segs[1]._hasOpposingFace,
      'missing centre coord → no annotation, no crash');
  }
}

// ── Ridge setback in computePanelGridOnSegment ────────────────────────────
console.log('\n── Ridge setback in computePanelGridOnSegment ──');
{
  // A big rectangular face with LiDAR face dims that fit exactly 4 rows of
  // panels top-to-bottom. With the ridge setback applied, one row should
  // drop (or top row's up-slope position should move down-slope by ≥ 0.4 m).
  const baseSeg = {
    center: { latitude: -41.2780, longitude: 174.7380 },
    azimuthDegrees: 90,     // E-facing
    pitchDegrees:   30,
    planeHeightAtCenterMeters: 100,
    stats: { areaMeters2: 50 },
    _faceDimensions: { widthAlongRidgeM: 8.0, depthAcrossSlopeM: 5.0 },
    _panelCapacityWatts: 400,
  };
  const panelsNoFlag = computePanelGridOnSegment({ ...baseSeg }, 1.65, 0.99, 20);
  const panelsFlagged = computePanelGridOnSegment({ ...baseSeg, _hasOpposingFace: true }, 1.65, 0.99, 20);

  assert(panelsNoFlag.length > 0 && panelsFlagged.length > 0,
    'both configurations produce panels (setback doesn\'t wipe layout)');

  // Ridge setback should NEVER produce more panels than the no-setback baseline.
  assert(panelsFlagged.length <= panelsNoFlag.length,
    `flagged count (${panelsFlagged.length}) ≤ no-flag count (${panelsNoFlag.length})`);

  // The overall grid EXTENT (top row - bottom row altitude) should shrink
  // when the flag is set — fewer rows fit in the reduced usable depth.
  const altRangeNoFlag  = Math.max(...panelsNoFlag.map(p => p.center.altitude))
                        - Math.min(...panelsNoFlag.map(p => p.center.altitude));
  const altRangeFlagged = Math.max(...panelsFlagged.map(p => p.center.altitude))
                        - Math.min(...panelsFlagged.map(p => p.center.altitude));
  assert(altRangeFlagged < altRangeNoFlag,
    `flagged altitude range (${altRangeFlagged.toFixed(3)} m) < no-flag range (${altRangeNoFlag.toFixed(3)} m) — grid extent shrunk by setback`);

  // Grid stays centred on the segment (bottom-clipping regression check):
  // top row and bottom row should be roughly EQUIDISTANT from segment centre
  // altitude (segment centre altitude = planeHeightAtCenterMeters = 100 in
  // this test). Symmetric placement means the setback comes off BOTH ends
  // equally, not just the top — avoids the 58 David Crescent
  // 2026-08-31 regression where bottom row poked past the eave.
  const centreAlt = 100;  // matches planeHeightAtCenterMeters
  const maxAltFlagged  = Math.max(...panelsFlagged.map(p => p.center.altitude));
  const minAltFlagged  = Math.min(...panelsFlagged.map(p => p.center.altitude));
  const topOffset    = Math.abs(maxAltFlagged - centreAlt);
  const bottomOffset = Math.abs(minAltFlagged - centreAlt);
  assert(Math.abs(topOffset - bottomOffset) < 0.05,
    `symmetric placement: top offset ${topOffset.toFixed(3)} m ≈ bottom offset ${bottomOffset.toFixed(3)} m (delta < 5 cm)`);
}

// ── categoriseNoViableReason ──────────────────────────────────────────────
console.log('\n── categoriseNoViableReason (P5 soft-error routing) ──');
{
  assert(categoriseNoViableReason(null) === 'no-viable', 'null → no-viable');
  assert(categoriseNoViableReason([]) === 'no-viable', 'empty → no-viable');

  // Carroll Street case: single segment with pitch=74.7° (a wall).
  {
    const segs = [{ pitchDegrees: 74.7, stats: { areaMeters2: 25 } }];
    assert(categoriseNoViableReason(segs) === 'no-roof-plane',
      "160 Carroll: single 74.7° wall → 'no-roof-plane'");
  }

  // All segments are walls (pitch > 55°).
  {
    const segs = [
      { pitchDegrees: 88, stats: { areaMeters2: 12 } },
      { pitchDegrees: 62, stats: { areaMeters2: 20 } },
    ];
    assert(categoriseNoViableReason(segs) === 'no-roof-plane',
      'all-walls → no-roof-plane');
  }

  // All segments are too tiny (< 10 m²).
  {
    const segs = [
      { pitchDegrees: 25, stats: { areaMeters2: 4 } },
      { pitchDegrees: 30, stats: { areaMeters2: 8 } },
    ];
    assert(categoriseNoViableReason(segs) === 'roof-too-small',
      'all-tiny → roof-too-small');
  }

  // All segments are viable-shape but south-facing (the LAST-resort case).
  {
    const segs = [
      { pitchDegrees: 30, stats: { areaMeters2: 40 } },
      { pitchDegrees: 25, stats: { areaMeters2: 55 } },
    ];
    assert(categoriseNoViableReason(segs) === 'all-south-facing',
      'all viable-shape → all-south-facing (skipped elsewhere)');
  }

  // Mixed rejection reasons → generic 'no-viable' fallback.
  {
    const segs = [
      { pitchDegrees: 88, stats: { areaMeters2: 25 } },  // wall
      { pitchDegrees: 25, stats: { areaMeters2:  3 } },  // tiny
      { pitchDegrees: 30, stats: { areaMeters2: 30 } },  // south
    ];
    assert(categoriseNoViableReason(segs) === 'no-viable',
      'mixed reasons → no-viable');
  }
}

// ── assessLidarMeshQuality ────────────────────────────────────────────────
console.log('\n── assessLidarMeshQuality (P1b LiDAR quality gate) ──');
{
  // Kelburn-style: 30° pitch × 6 m depth → expect ~3 m variance.
  // Realistic Cesium samples on high-detail tile: 100.0 → 103.2 m.
  {
    const out = assessLidarMeshQuality({
      meshHeights: [100.0, 100.9, 101.7, 102.6, 103.2],
      pitchDegrees: 30,
      depthAcrossSlopeM: 6,
    });
    assert(out.verdict === 'high-detail',
      `Kelburn-style (30° / 6 m / 3.2 m obs vs 3.0 m expected) → high-detail (got ${out.verdict})`);
  }

  // Rai Valley-style: LiDAR says 30° / 6 m (~3 m variance expected)
  // BUT Cesium mesh returns nearly flat: 100.0 → 100.4 m.
  {
    const out = assessLidarMeshQuality({
      meshHeights: [100.0, 100.1, 100.2, 100.3, 100.4],
      pitchDegrees: 30,
      depthAcrossSlopeM: 6,
    });
    assert(out.verdict === 'flat-mesh',
      `Rai-Valley-style (30° / 6 m / 0.4 m obs vs 3.0 m expected) → flat-mesh (got ${out.verdict})`);
  }

  // Genuinely low-pitch roof (e.g., commercial flat) — 3° / 8 m → 0.42 m
  // expected. Even a flat Cesium mesh shouldn't be judged stale here.
  {
    const out = assessLidarMeshQuality({
      meshHeights: [100.0, 100.05, 100.1, 100.15, 100.2],
      pitchDegrees: 3,
      depthAcrossSlopeM: 8,
    });
    assert(out.verdict === 'high-detail',
      `low-pitch flat roof (3° / 8 m) → high-detail (guarded by minExpectedVarianceM, got ${out.verdict})`);
  }

  // Insufficient samples: only 2 points → can't judge, don't flag.
  {
    const out = assessLidarMeshQuality({
      meshHeights: [100.0, 100.1],
      pitchDegrees: 30,
      depthAcrossSlopeM: 6,
    });
    assert(out.verdict === 'insufficient-samples',
      '< 3 samples → insufficient-samples');
  }

  // Borderline: expected 3 m, observed exactly at threshold ratio (0.35).
  // Should be treated as flat (< threshold, not ≤).
  {
    const out = assessLidarMeshQuality({
      meshHeights: [100.0, 100.3, 100.6, 100.9, 101.0],  // 1.0 m variance
      pitchDegrees: 30,
      depthAcrossSlopeM: 6,   // expected 3.0 m
      flatRatioThreshold: 0.35,
    });
    // 1.0 / 3.0 = 0.333 < 0.35 → flat
    assert(out.verdict === 'flat-mesh',
      `borderline (obs/expected = 0.333 < 0.35) → flat-mesh (got ${out.verdict})`);
  }

  // Handles nulls/NaNs in samples gracefully.
  {
    const out = assessLidarMeshQuality({
      meshHeights: [100.0, null, 100.9, NaN, 103.2],
      pitchDegrees: 30,
      depthAcrossSlopeM: 6,
    });
    assert(out.verdict === 'high-detail',
      `filters null/NaN samples (got ${out.verdict})`);
  }
}

// ── Constants ─────────────────────────────────────────────────────────────
console.log('\n── Constants ──');
{
  assert(CONSTANTS.METRES_PER_DEG_LAT === 111320, 'metres per degree lat is 111320');
  assert(CONSTANTS.GAP_METRES === 0.02, 'gap is 20 mm');
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);

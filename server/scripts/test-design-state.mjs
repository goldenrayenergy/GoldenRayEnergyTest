// ────────────────────────────────────────────────────────────────────────────
// test-design-state.mjs
//
// Unit tests for client/src/pm/utils/designState.js — Phase 3b schema +
// manipulation helpers. Pure JS, no browser, no DOM.
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../');
const url = pathToFileURL(path.join(REPO_ROOT, 'client/src/pm/utils/designState.js')).href;

const {
  SCHEMA_VERSION, DEFAULT_FACE_SETBACK_M, OBSTRUCTION_DEFAULTS,
  emptyDesignState, migrateDesignState,
  makeRoofFace, addFace, removeFace,
  makeObstruction, addObstruction, removeObstruction,
  makePanel, addPanel, removePanel,
  makeArray, addArray, removeArray,
  facesById, panelsByFace, totalKilowatts,
  faceId, obstId, panelId, arrayId,
  googleSegmentToRoofFace, googleSegmentsToRoofFaces, importGoogleSegments,
  pointInPolygon, faceContainingPoint,
  polygonCentroidLL, snapToFaceGrid, PANEL_GRID_GAP_MM,
  distanceMetres, edgeBearingDegrees, inferAzimuthFromPolygon,
  latLngToFaceLocal, pointInPolygonUV, pointToPolygonMinDist,
  panelAABBFaceLocal, aabbsOverlap,
  checkPanelDropRules, DROP_REASON_HUMAN,
  estimateFaceSunshine, totalAnnualKwh, NZ_DEFAULT_SUNSHINE_KWH_PER_KW_YEAR,
  panelDisplayLabel, buildPanelLabelMap,
  copyArrayToFace,
  autoLayoutFace, panelSkusInDesign,
  importGooglePanels,
} = await import(url);

let pass = 0, fail = 0;
const failures = [];
function assert(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}
function throws(fn, pattern) {
  try { fn(); return false; } catch (e) { return pattern.test(e.message); }
}
console.log('test-design-state\n');

// ── emptyDesignState shape ────────────────────────────────────────────────
{
  console.log('\n▸ emptyDesignState');
  const s = emptyDesignState();
  assert('schemaVersion=2',            s.schemaVersion === 2);
  assert('view identity',               s.view.zoom === 1 && s.view.panX === 0 && s.view.panY === 0);
  assert('canvas.serialized=null',      s.canvas.serialized === null);
  assert('roof.faces=[]',               Array.isArray(s.roof.faces) && s.roof.faces.length === 0);
  assert('roof.obstructions=[]',        Array.isArray(s.roof.obstructions) && s.roof.obstructions.length === 0);
  assert('panels=[]',                   Array.isArray(s.panels) && s.panels.length === 0);
  assert('arrays=[]',                   Array.isArray(s.arrays) && s.arrays.length === 0);

  // Independent copies each call
  const s2 = emptyDesignState();
  s.panels.push({});
  assert('separate instances each call', s2.panels.length === 0);
}

// ── migrateDesignState (v1 → v2, missing fields → defaults) ──────────────
{
  console.log('\n▸ migrateDesignState');
  const migrated = migrateDesignState(null);
  assert('null → empty v2 state',       migrated.schemaVersion === 2);

  const v1 = { view: { zoom: 2, panX: 100, panY: 50 }, canvas: { serialized: 'xxx' } };
  const m = migrateDesignState(v1);
  assert('v1: view preserved',          m.view.zoom === 2 && m.view.panX === 100);
  assert('v1: canvas preserved',        m.canvas.serialized === 'xxx');
  assert('v1: roof.faces backfilled',   Array.isArray(m.roof.faces) && m.roof.faces.length === 0);
  assert('v1: panels backfilled',       Array.isArray(m.panels) && m.panels.length === 0);
  assert('v1: schemaVersion bumped',    m.schemaVersion === 2);

  // Preserves unknown top-level fields (future-proofing)
  const withExtra = { view: {}, canvas: {}, roof: {}, myFutureField: { x: 1 } };
  const me = migrateDesignState(withExtra);
  assert('unknown fields preserved',    me.myFutureField?.x === 1);
}

// ── ID generation ─────────────────────────────────────────────────────────
{
  console.log('\n▸ id generators');
  const a = faceId(), b = faceId();
  assert('faceId format: prefix-6chars', /^face-[0-9a-z]{6}$/.test(a));
  assert('faceId collisions unlikely',   a !== b);
  assert('obstId prefix',                obstId().startsWith('obst-'));
  assert('panelId prefix',               panelId().startsWith('panel-'));
  assert('arrayId prefix',               arrayId().startsWith('arr-'));
}

// ── makeRoofFace ──────────────────────────────────────────────────────────
{
  console.log('\n▸ makeRoofFace');
  const validPoly = [
    { latitude: -36.9, longitude: 174.7 },
    { latitude: -36.9, longitude: 174.71 },
    { latitude: -36.91, longitude: 174.71 },
    { latitude: -36.91, longitude: 174.7 },
  ];

  assert('bad source → throws',
    throws(() => makeRoofFace({ source: 'nope', polygon: validPoly }), /source must be/));
  assert('missing polygon → throws',
    throws(() => makeRoofFace({ source: 'manual' }), /polygon must have at least 3/));
  assert('short polygon → throws',
    throws(() => makeRoofFace({ source: 'manual', polygon: [{ latitude: 0, longitude: 0 }] }), /at least 3/));
  assert('non-numeric vertex → throws',
    throws(() => makeRoofFace({ source: 'manual', polygon: [{ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }, { latitude: 'x', longitude: 0 }] }),
      /numeric latitude/));

  const f = makeRoofFace({
    source: 'google_solar',
    polygon: validPoly,
    pitchDegrees: 22.5, azimuthDegrees: 180, areaMetres2: 41.2,
    material: 'metal',
  });
  assert('valid face has id',            /^face-/.test(f.id));
  assert('valid face preserves fields',  f.pitchDegrees === 22.5 && f.material === 'metal');
  assert('default setback applied',      f.setbackMetres === DEFAULT_FACE_SETBACK_M);
}

// ── addFace / removeFace ──────────────────────────────────────────────────
{
  console.log('\n▸ addFace / removeFace');
  let state = emptyDesignState();
  const poly = [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }, { latitude: 0, longitude: 1 }];
  const f1 = makeRoofFace({ source: 'manual', polygon: poly });
  const f2 = makeRoofFace({ source: 'manual', polygon: poly });

  state = addFace(state, f1);
  state = addFace(state, f2);
  assert('addFace: 2 faces', state.roof.faces.length === 2);
  assert('addFace: order preserved',   state.roof.faces[0].id === f1.id);

  // Remove face with no panels → simple
  state = removeFace(state, f1.id);
  assert('removeFace: 1 face left',    state.roof.faces.length === 1);
  assert('removeFace: correct one gone', state.roof.faces[0].id === f2.id);
}

// ── removeFace cascades to panels + empty arrays ─────────────────────────
{
  console.log('\n▸ removeFace: referential integrity');
  const poly = [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }, { latitude: 0, longitude: 1 }];
  let state = emptyDesignState();
  const f1 = makeRoofFace({ source: 'manual', polygon: poly });
  const f2 = makeRoofFace({ source: 'manual', polygon: poly });
  state = addFace(state, f1);
  state = addFace(state, f2);

  const p1 = makePanel({ faceId: f1.id, sku: 'A', center: { latitude: 0.5, longitude: 0.5 } });
  const p2 = makePanel({ faceId: f1.id, sku: 'A', center: { latitude: 0.5, longitude: 0.5 } });
  const p3 = makePanel({ faceId: f2.id, sku: 'A', center: { latitude: 0.5, longitude: 0.5 } });
  state = addPanel(state, p1);
  state = addPanel(state, p2);
  state = addPanel(state, p3);

  const onlyF1 = makeArray({ name: 'F1 array', panelIds: [p1.id, p2.id] });
  const mixed  = makeArray({ name: 'mixed',    panelIds: [p2.id, p3.id] });
  state = addArray(state, onlyF1);
  state = addArray(state, mixed);

  // Remove f1 → cascade should drop p1+p2, keep p3, drop onlyF1 array, prune mixed to [p3]
  state = removeFace(state, f1.id);
  assert('cascade: only 1 panel remains (p3)',           state.panels.length === 1 && state.panels[0].id === p3.id);
  assert('cascade: onlyF1 array dropped (empty)',        !state.arrays.find(a => a.id === onlyF1.id));
  assert('cascade: mixed array survived',                !!state.arrays.find(a => a.id === mixed.id));
  assert('cascade: mixed array pruned to just p3',       state.arrays.find(a => a.id === mixed.id).panelIds.length === 1);
}

// ── makeObstruction + defaults per type ───────────────────────────────────
{
  console.log('\n▸ makeObstruction');
  assert('bad type → throws',
    throws(() => makeObstruction({ type: 'nope', center: { latitude: 0, longitude: 0 } }), /unknown type/));
  assert('missing center → throws',
    throws(() => makeObstruction({ type: 'chimney' }), /center must have/));

  const chim = makeObstruction({ type: 'chimney', center: { latitude: 0, longitude: 0 } });
  assert('chimney default radius = 0.6m', chim.radiusMetres === OBSTRUCTION_DEFAULTS.chimney.radiusMetres);
  assert('has generated id', /^obst-/.test(chim.id));

  const skylight = makeObstruction({ type: 'skylight', center: { latitude: 0, longitude: 0 }, radiusMetres: 1.5 });
  assert('caller radius overrides default', skylight.radiusMetres === 1.5);
}

// ── addObstruction / removeObstruction ────────────────────────────────────
{
  console.log('\n▸ obstruction add/remove');
  let s = emptyDesignState();
  const o = makeObstruction({ type: 'vent', center: { latitude: 0, longitude: 0 } });
  s = addObstruction(s, o);
  assert('added', s.roof.obstructions.length === 1);
  s = removeObstruction(s, o.id);
  assert('removed', s.roof.obstructions.length === 0);
}

// ── Panel validation ──────────────────────────────────────────────────────
{
  console.log('\n▸ makePanel');
  assert('missing faceId → throws',
    throws(() => makePanel({ sku: 'X', center: { latitude: 0, longitude: 0 } }), /faceId required/));
  assert('missing sku → throws',
    throws(() => makePanel({ faceId: 'f', center: { latitude: 0, longitude: 0 } }), /sku required/));
  assert('bad orientation → throws',
    throws(() => makePanel({ faceId: 'f', sku: 'X', center: { latitude: 0, longitude: 0 }, orientation: 'sideways' }), /orientation must be/));

  const p = makePanel({ faceId: 'f-1', sku: 'PHN-PNL-475-QSR', center: { latitude: -36.9, longitude: 174.7 } });
  assert('default orientation = landscape', p.orientation === 'landscape');
  assert('default rotation = 0',            p.rotationDegrees === 0);
}

// ── removePanel prunes arrays ─────────────────────────────────────────────
{
  console.log('\n▸ removePanel prunes arrays');
  let s = emptyDesignState();
  const poly = [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }, { latitude: 0, longitude: 1 }];
  const f = makeRoofFace({ source: 'manual', polygon: poly });
  s = addFace(s, f);
  const p1 = makePanel({ faceId: f.id, sku: 'A', center: { latitude: 0.5, longitude: 0.5 } });
  const p2 = makePanel({ faceId: f.id, sku: 'A', center: { latitude: 0.5, longitude: 0.5 } });
  s = addPanel(s, p1);
  s = addPanel(s, p2);
  s = addArray(s, makeArray({ name: 'A', panelIds: [p1.id, p2.id] }));
  s = removePanel(s, p1.id);
  assert('panel gone', s.panels.length === 1);
  assert('array pruned to just p2', s.arrays[0].panelIds.length === 1);
}

// ── Array validation ──────────────────────────────────────────────────────
{
  console.log('\n▸ makeArray');
  assert('empty name → throws',
    throws(() => makeArray({ name: '   ' }), /name required/));
  assert('bad panelIds → throws',
    throws(() => makeArray({ name: 'X', panelIds: 'foo' }), /panelIds must be an array/));
  const a = makeArray({ name: '  North  ', panelIds: ['p-1'] });
  assert('name trimmed', a.name === 'North');
}

// ── Query helpers ─────────────────────────────────────────────────────────
{
  console.log('\n▸ query helpers');
  let s = emptyDesignState();
  const poly = [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }, { latitude: 0, longitude: 1 }];
  const f1 = makeRoofFace({ source: 'manual', polygon: poly });
  const f2 = makeRoofFace({ source: 'manual', polygon: poly });
  s = addFace(s, f1); s = addFace(s, f2);
  s = addPanel(s, makePanel({ faceId: f1.id, sku: 'A', center: { latitude: 0.5, longitude: 0.5 } }));
  s = addPanel(s, makePanel({ faceId: f1.id, sku: 'A', center: { latitude: 0.5, longitude: 0.5 } }));
  s = addPanel(s, makePanel({ faceId: f2.id, sku: 'A', center: { latitude: 0.5, longitude: 0.5 } }));

  const byId = facesById(s);
  assert('facesById: entry per face', byId.size === 2 && byId.get(f1.id).id === f1.id);
  assert('panelsByFace f1 → 2', panelsByFace(s, f1.id).length === 2);
  assert('panelsByFace f2 → 1', panelsByFace(s, f2.id).length === 1);

  // totalKilowatts with catalogue lookup
  const cat = new Map([['A', { watts: 475 }]]);
  assert('totalKilowatts: 3 * 475W = 1.425 kW', totalKilowatts(s, cat) === 1.425);
  // Unknown SKUs don't crash
  const s2 = addPanel(s, makePanel({ faceId: f1.id, sku: 'UNKNOWN', center: { latitude: 0.5, longitude: 0.5 } }));
  assert('totalKilowatts skips unknown SKUs', totalKilowatts(s2, cat) === 1.425);
}

// ── Google Solar segment → roof face conversion (Phase 3b.2) ─────────────
{
  console.log('\n▸ googleSegmentToRoofFace');
  const seg = {
    boundingBox: {
      ne: { latitude: -36.9097, longitude: 174.6948 },
      sw: { latitude: -36.9099, longitude: 174.6946 },
    },
    center: { latitude: -36.9098, longitude: 174.6947 },
    pitchDegrees: 22.5,
    azimuthDegrees: 180,
    stats: { areaMeters2: 41.2 },
  };
  const face = googleSegmentToRoofFace(seg);
  assert('produces a face',                   !!face);
  assert('source=google_solar',               face.source === 'google_solar');
  assert('polygon has 4 vertices (from bbox)', face.polygon.length === 4);
  assert('pitch preserved',                    face.pitchDegrees === 22.5);
  assert('azimuth preserved',                  face.azimuthDegrees === 180);
  assert('area preserved',                     face.areaMetres2 === 41.2);
  // Polygon corner order: NW, NE, SE, SW
  assert('vertex 0 = NW',
    face.polygon[0].latitude === seg.boundingBox.ne.latitude
    && face.polygon[0].longitude === seg.boundingBox.sw.longitude);
  assert('vertex 2 = SE',
    face.polygon[2].latitude === seg.boundingBox.sw.latitude
    && face.polygon[2].longitude === seg.boundingBox.ne.longitude);

  // Bad input → returns null, not throw
  assert('null seg → null',           googleSegmentToRoofFace(null) === null);
  assert('missing bbox → null',       googleSegmentToRoofFace({}) === null);
  assert('bbox with no ne → null',    googleSegmentToRoofFace({ boundingBox: { sw: seg.boundingBox.sw } }) === null);
  assert('non-numeric lat → null',
    googleSegmentToRoofFace({ boundingBox: {
      ne: { latitude: 'x', longitude: 0 }, sw: { latitude: 0, longitude: 0 } } }) === null);
}

{
  console.log('\n▸ googleSegmentsToRoofFaces');
  const segs = [
    { boundingBox: { ne: { latitude: 0.001, longitude: 0.001 }, sw: { latitude: 0, longitude: 0 } }, pitchDegrees: 22, azimuthDegrees: 0 },
    { boundingBox: { ne: { latitude: 0.001, longitude: 0.002 }, sw: { latitude: 0, longitude: 0.001 } }, pitchDegrees: 22, azimuthDegrees: 180 },
    null,   // bad — should be dropped
    { boundingBox: null },  // bad — should be dropped
  ];
  const faces = googleSegmentsToRoofFaces(segs);
  assert('drops invalid segments', faces.length === 2);
  assert('each survivor is a valid face',
    faces.every(f => f.source === 'google_solar' && f.polygon.length === 4));

  assert('null input → []',       googleSegmentsToRoofFaces(null).length === 0);
  assert('non-array input → []',  googleSegmentsToRoofFaces('x').length === 0);
}

{
  console.log('\n▸ importGoogleSegments');
  // Start with an empty state
  let state = emptyDesignState();
  const segs = [
    { boundingBox: { ne: { latitude: 0.001, longitude: 0.001 }, sw: { latitude: 0, longitude: 0 } } },
    { boundingBox: { ne: { latitude: 0.001, longitude: 0.002 }, sw: { latitude: 0, longitude: 0.001 } } },
  ];
  state = importGoogleSegments(state, segs);
  assert('imports 2 faces into empty state', state.roof.faces.length === 2);
  assert('all imported faces have source=google_solar',
    state.roof.faces.every(f => f.source === 'google_solar'));

  // Re-importing REPLACES the google faces (no duplication)
  state = importGoogleSegments(state, segs);
  assert('re-import replaces (still 2, not 4)', state.roof.faces.length === 2);

  // Manual faces survive re-import
  const poly = [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }, { latitude: 0, longitude: 1 }];
  const manual = makeRoofFace({ source: 'manual', polygon: poly });
  state = addFace(state, manual);
  assert('manual face added → 3 total', state.roof.faces.length === 3);
  state = importGoogleSegments(state, segs);
  assert('re-import: manual survives + google refreshed', state.roof.faces.length === 3);
  assert('manual face still present', state.roof.faces.some(f => f.id === manual.id));

  // Re-import DROPS panels that were on the old google faces
  const oldGoogleFace = state.roof.faces.find(f => f.source === 'google_solar');
  const p = makePanel({ faceId: oldGoogleFace.id, sku: 'A', center: { latitude: 0.0005, longitude: 0.0005 } });
  state = addPanel(state, p);
  const manualPanel = makePanel({ faceId: manual.id, sku: 'A', center: { latitude: 0.5, longitude: 0.5 } });
  state = addPanel(state, manualPanel);
  assert('panels attached before re-import', state.panels.length === 2);
  state = importGoogleSegments(state, segs);
  assert('re-import drops panel on old google face, keeps manual-face panel',
    state.panels.length === 1 && state.panels[0].id === manualPanel.id);
}

// ── pointInPolygon (Phase 3b.4 panel drop) ────────────────────────────────
{
  console.log('\n▸ pointInPolygon — even-odd raycast');
  // Unit square: (0,0) → (0,1) → (1,1) → (1,0)
  const square = [
    { latitude: 0, longitude: 0 },
    { latitude: 1, longitude: 0 },
    { latitude: 1, longitude: 1 },
    { latitude: 0, longitude: 1 },
  ];
  assert('centre point is inside',              pointInPolygon(square, 0.5, 0.5) === true);
  assert('quarter-in point is inside',          pointInPolygon(square, 0.25, 0.75) === true);
  assert('point outside north',                 pointInPolygon(square, 1.5, 0.5) === false);
  assert('point outside south',                 pointInPolygon(square, -0.5, 0.5) === false);
  assert('point outside east',                  pointInPolygon(square, 0.5, 1.5) === false);
  assert('point outside west',                  pointInPolygon(square, 0.5, -0.5) === false);
  assert('polygon with <3 vertices → false',    pointInPolygon([{ latitude: 0, longitude: 0 }], 0.5, 0.5) === false);
  assert('null polygon → false',                pointInPolygon(null, 0, 0) === false);

  // A concave (L-shaped) polygon should exclude the notch
  //   ┌────┐
  //   │    │
  //   │    └──┐
  //   │       │
  //   └───────┘
  const L = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 3 },
    { latitude: 2, longitude: 3 },
    { latitude: 2, longitude: 1 },
    { latitude: 3, longitude: 1 },
    { latitude: 3, longitude: 0 },
  ];
  assert('L-shape: point in main stem is inside',  pointInPolygon(L, 2.5, 0.5) === true);
  assert('L-shape: point in the arm is inside',    pointInPolygon(L, 1, 2) === true);
  assert('L-shape: point in the notch is OUT',     pointInPolygon(L, 2.5, 2) === false);
}

// ── faceContainingPoint (Phase 3b.4 panel drop attaches panel to face) ────
{
  console.log('\n▸ faceContainingPoint');
  let s = emptyDesignState();
  // Face 1: unit square around (0,0) — (0,0)/(0,1)/(1,1)/(1,0)
  const f1 = makeRoofFace({
    source: 'manual',
    polygon: [
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
      { latitude: 1, longitude: 1 },
      { latitude: 0, longitude: 1 },
    ],
  });
  // Face 2: unit square offset to (10,10)
  const f2 = makeRoofFace({
    source: 'manual',
    polygon: [
      { latitude: 10, longitude: 10 },
      { latitude: 11, longitude: 10 },
      { latitude: 11, longitude: 11 },
      { latitude: 10, longitude: 11 },
    ],
  });
  s = addFace(addFace(s, f1), f2);

  assert('point inside face 1 → returns face 1',
    faceContainingPoint(s, 0.5, 0.5)?.id === f1.id);
  assert('point inside face 2 → returns face 2',
    faceContainingPoint(s, 10.5, 10.5)?.id === f2.id);
  assert('point outside both → returns null',
    faceContainingPoint(s, 5, 5) === null);
  assert('empty state → returns null',
    faceContainingPoint(emptyDesignState(), 0, 0) === null);
  assert('null state → returns null (defensive)',
    faceContainingPoint(null, 0, 0) === null);
}

// ── polygonCentroidLL (Phase 3b.6 — grid origin) ─────────────────────────
{
  console.log('\n▸ polygonCentroidLL');
  assert('null polygon → null',   polygonCentroidLL(null) === null);
  assert('empty polygon → null',  polygonCentroidLL([]) === null);

  const unitSquare = [
    { latitude: 0, longitude: 0 },
    { latitude: 1, longitude: 0 },
    { latitude: 1, longitude: 1 },
    { latitude: 0, longitude: 1 },
  ];
  const c = polygonCentroidLL(unitSquare);
  assert('unit square: centroid at (0.5, 0.5)',
    Math.abs(c.latitude - 0.5) < 1e-9 && Math.abs(c.longitude - 0.5) < 1e-9);

  // Skewed L-shape — mean-of-vertices is a defensible-but-not-perfect centroid
  const L = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 3 },
    { latitude: 2, longitude: 3 },
    { latitude: 2, longitude: 1 },
    { latitude: 3, longitude: 1 },
    { latitude: 3, longitude: 0 },
  ];
  const cL = polygonCentroidLL(L);
  const expLat = (0 + 0 + 2 + 2 + 3 + 3) / 6;
  const expLng = (0 + 3 + 3 + 1 + 1 + 0) / 6;
  assert('L-shape: arithmetic-mean centroid',
    Math.abs(cL.latitude - expLat) < 1e-9 && Math.abs(cL.longitude - expLng) < 1e-9);
}

// ── snapToFaceGrid (Phase 3b.6 — panel grid snap) ────────────────────────
{
  console.log('\n▸ snapToFaceGrid');
  assert('gap default is 20mm', PANEL_GRID_GAP_MM === 20);

  // Auckland roof-scale centroid so lng/metres math exercises cos(lat).
  const centroid = { latitude: -36.9098, longitude: 174.6948 };
  const panelDims = { panelLengthMm: 1800, panelWidthMm: 1100, orientation: 'landscape', gapMm: 20 };

  // Centre → centre (target == centroid → snapped centre = centroid)
  {
    const r = snapToFaceGrid({
      faceAzimuthDegrees: 0,
      faceCentroid: centroid,
      target: { ...centroid },
      ...panelDims,
    });
    assert('centre point snaps to centroid (any azimuth)',
      Math.abs(r.latitude - centroid.latitude)   < 1e-9
      && Math.abs(r.longitude - centroid.longitude) < 1e-9);
  }

  // A north-aligned grid (azimuth=0), landscape 1800×1100 + 20mm gap:
  //   cellU (east) = (1800 + 20)/1000 = 1.82 m
  //   cellV (north) = (1100 + 20)/1000 = 1.12 m
  {
    // Click 0.5m east — 0.5/1.82 = 0.275, unambiguously rounds to cell 0.
    const metresPerDegLng = 111320 * Math.cos(centroid.latitude * Math.PI / 180);
    const target = {
      latitude: centroid.latitude,
      longitude: centroid.longitude + 0.5 / metresPerDegLng,
    };
    const r = snapToFaceGrid({
      faceAzimuthDegrees: 0,
      faceCentroid: centroid, target,
      ...panelDims,
    });
    const dEast = (r.longitude - centroid.longitude) * metresPerDegLng;
    assert('az=0, 0.5m east: snaps to cell 0 (centroid)', Math.abs(dEast) < 0.001);
  }

  // Click 2m east of centroid → nearest cell along east is 1 * 1.82m = 1.82m
  {
    const metresPerDegLng = 111320 * Math.cos(centroid.latitude * Math.PI / 180);
    const target = {
      latitude: centroid.latitude,
      longitude: centroid.longitude + 2.0 / metresPerDegLng,
    };
    const r = snapToFaceGrid({
      faceAzimuthDegrees: 0,
      faceCentroid: centroid, target,
      ...panelDims,
    });
    const dEast = (r.longitude - centroid.longitude) * metresPerDegLng;
    assert('az=0, 2m east: snaps to 1.82m (cellU=1.82)',
      Math.abs(dEast - 1.82) < 0.001, `got dEast=${dEast}`);
  }

  // With azimuth=90 the grid rotates so cellU aligns with north-south.
  // Click 2m NORTH now snaps to the U-cell (1.82m) instead of the V-cell.
  {
    const target = {
      latitude: centroid.latitude + 2.0 / 111320,
      longitude: centroid.longitude,
    };
    const r = snapToFaceGrid({
      faceAzimuthDegrees: 90,
      faceCentroid: centroid, target,
      ...panelDims,
    });
    const dNorth = (r.latitude - centroid.latitude) * 111320;
    assert('az=90, 2m north: snaps to 1.82m (cellU along north-south)',
      Math.abs(dNorth - 1.82) < 0.005, `got dNorth=${dNorth}`);
  }

  // ── Regression: rotated face — grid must align with eave, not normal ───
  // Bug: a sign error in the (east,north) → (u,v) rotation aligned the
  // u-axis with the face NORMAL instead of the eave. Panels visually
  // rotated correctly (rendered at Fabric angle = face.azimuth) but tiled
  // on an axis 90° off, producing gaps + overlaps instead of clean rows.
  // Caught only by rotated-face tests — az=0 and az=90 pass either way
  // because sin(0)=0 masks the sign.
  //
  // For az=45 (NE-facing face), the eave runs NW→SE (bearing 135°). A
  // click 1m SE of centroid lies exactly on the u-axis at u=1m. With
  // cellU=1.82m the click snaps to u=1.82m → 1.82m SE of centroid.
  {
    const mPerDegLng = 111320 * Math.cos(centroid.latitude * Math.PI / 180);
    // 1m along bearing 135° (SE): dEast = sin(135°), dNorth = cos(135°)
    const dEast  = Math.sin(135 * Math.PI / 180);   //  +0.707
    const dNorth = Math.cos(135 * Math.PI / 180);   //  -0.707
    const target = {
      latitude:  centroid.latitude  + dNorth / 111320,
      longitude: centroid.longitude + dEast  / mPerDegLng,
    };
    const r = snapToFaceGrid({
      faceAzimuthDegrees: 45,
      faceCentroid: centroid, target,
      ...panelDims,
    });
    // Snapped position should be 1.82m SE of centroid.
    const rEast  = (r.longitude - centroid.longitude) * mPerDegLng;
    const rNorth = (r.latitude  - centroid.latitude)  * 111320;
    const bearingRad = Math.atan2(rEast, rNorth);
    const dist = Math.hypot(rEast, rNorth);
    assert('az=45: click 1m SE snaps to 1.82m along SE (grid aligns with eave, not normal)',
      Math.abs(dist - 1.82) < 0.01 && Math.abs(bearingRad - 135 * Math.PI / 180) < 0.01,
      `expected dist≈1.82m, bearing≈135°; got dist=${dist.toFixed(3)}, bearing=${(bearingRad*180/Math.PI).toFixed(1)}°`);
  }

  // Same face — a click 1m along the SLOPE direction (bearing 45°, NE)
  // is perpendicular to the eave. With cellV=1.12m and 1m in v, round(1/1.12)=1
  // → snaps to 1.12m NE of centroid.
  {
    const mPerDegLng = 111320 * Math.cos(centroid.latitude * Math.PI / 180);
    const dEast  = Math.sin(45 * Math.PI / 180);   //  +0.707
    const dNorth = Math.cos(45 * Math.PI / 180);   //  +0.707
    const target = {
      latitude:  centroid.latitude  + dNorth / 111320,
      longitude: centroid.longitude + dEast  / mPerDegLng,
    };
    const r = snapToFaceGrid({
      faceAzimuthDegrees: 45,
      faceCentroid: centroid, target,
      ...panelDims,
    });
    const rEast  = (r.longitude - centroid.longitude) * mPerDegLng;
    const rNorth = (r.latitude  - centroid.latitude)  * 111320;
    const bearingRad = Math.atan2(rEast, rNorth);
    const dist = Math.hypot(rEast, rNorth);
    assert('az=45: click 1m NE snaps to 1.12m along NE (perpendicular to eave)',
      Math.abs(dist - 1.12) < 0.01 && Math.abs(bearingRad - 45 * Math.PI / 180) < 0.01,
      `expected dist≈1.12m, bearing≈45°; got dist=${dist.toFixed(3)}, bearing=${(bearingRad*180/Math.PI).toFixed(1)}°`);
  }

  // Two panels dropped one cell apart in the u-axis land exactly cellU metres apart.
  {
    const cellU = (1800 + 20) / 1000;
    const metresPerDegLng = 111320 * Math.cos(centroid.latitude * Math.PI / 180);
    const p1 = snapToFaceGrid({
      faceAzimuthDegrees: 0,
      faceCentroid: centroid,
      target: { latitude: centroid.latitude, longitude: centroid.longitude + (cellU * 0.4) / metresPerDegLng },
      ...panelDims,
    });
    const p2 = snapToFaceGrid({
      faceAzimuthDegrees: 0,
      faceCentroid: centroid,
      target: { latitude: centroid.latitude, longitude: centroid.longitude + (cellU * 1.4) / metresPerDegLng },
      ...panelDims,
    });
    const dLngMetres = (p2.longitude - p1.longitude) * metresPerDegLng;
    assert('two clicks in adjacent cells → snapped centres exactly cellU apart',
      Math.abs(dLngMetres - cellU) < 0.001, `expected ${cellU}, got ${dLngMetres}`);
  }

  // Portrait orientation swaps cellU and cellV.
  {
    const metresPerDegLng = 111320 * Math.cos(centroid.latitude * Math.PI / 180);
    const target = {
      latitude: centroid.latitude,
      longitude: centroid.longitude + 2.0 / metresPerDegLng,
    };
    const r = snapToFaceGrid({
      faceAzimuthDegrees: 0,
      faceCentroid: centroid, target,
      panelLengthMm: 1800, panelWidthMm: 1100,
      orientation: 'portrait',
      gapMm: 20,
    });
    const dEast = (r.longitude - centroid.longitude) * metresPerDegLng;
    // portrait: cellU = 1120mm/1000 = 1.12 → 2m east snaps to round(2/1.12)*1.12 = 2 * 1.12 = 2.24
    assert('portrait: cellU = width+gap, 2m east snaps to 2.24m',
      Math.abs(dEast - 2.24) < 0.001, `got dEast=${dEast}`);
  }

  // Defensive: missing centroid → return raw target
  {
    const target = { latitude: 1, longitude: 2 };
    const r = snapToFaceGrid({
      faceAzimuthDegrees: 0,
      faceCentroid: null, target,
      panelLengthMm: 1800, panelWidthMm: 1100,
    });
    assert('null centroid → returns raw target', r === target);
  }

  // Defensive: missing panel dims → return raw target
  {
    const target = { latitude: 1, longitude: 2 };
    const r = snapToFaceGrid({
      faceAzimuthDegrees: 0,
      faceCentroid: centroid, target,
      panelLengthMm: null, panelWidthMm: 0,
    });
    assert('missing panel dims → returns raw target', r === target);
  }
}

// ── distanceMetres + edgeBearingDegrees (Phase 3b.6 helpers) ─────────────
{
  console.log('\n▸ distanceMetres + edgeBearingDegrees');
  const centre = { latitude: -36.9098, longitude: 174.6948 };

  // 1° latitude ≈ 111,320m at any longitude → 0.001° lat ≈ 111.32m
  const oneKmNorth = { latitude: centre.latitude + 1000 / 111320, longitude: centre.longitude };
  assert('distanceMetres: 1000m north within 1m',
    Math.abs(distanceMetres(centre, oneKmNorth) - 1000) < 1);

  const mPerDegLng = 111320 * Math.cos(centre.latitude * Math.PI / 180);
  const oneKmEast = { latitude: centre.latitude, longitude: centre.longitude + 1000 / mPerDegLng };
  assert('distanceMetres: 1000m east within 1m',
    Math.abs(distanceMetres(centre, oneKmEast) - 1000) < 1);

  assert('distanceMetres: null args → Infinity', distanceMetres(null, centre) === Infinity);

  assert('edgeBearingDegrees: straight north = 0°',
    Math.abs(edgeBearingDegrees(centre, oneKmNorth)) < 0.1);
  assert('edgeBearingDegrees: straight east = 90°',
    Math.abs(edgeBearingDegrees(centre, oneKmEast) - 90) < 0.1);

  const oneKmSouth = { latitude: centre.latitude - 1000 / 111320, longitude: centre.longitude };
  assert('edgeBearingDegrees: straight south = 180°',
    Math.abs(edgeBearingDegrees(centre, oneKmSouth) - 180) < 0.1);

  const oneKmWest = { latitude: centre.latitude, longitude: centre.longitude - 1000 / mPerDegLng };
  assert('edgeBearingDegrees: straight west = 270°',
    Math.abs(edgeBearingDegrees(centre, oneKmWest) - 270) < 0.1);
}

// ── inferAzimuthFromPolygon (Phase 3b.6 auto-azimuth for manual traces) ─
{
  console.log('\n▸ inferAzimuthFromPolygon');
  assert('null polygon → null', inferAzimuthFromPolygon(null) === null);
  assert('polygon with <3 vertices → null', inferAzimuthFromPolygon([{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }]) === null);

  // Rectangle 10m east-west × 4m north-south. Longest edge runs east-west
  // (bearing 90° from any north-south vertex). Face azimuth = 90 - 90 = 0.
  const centre = { latitude: -36.9098, longitude: 174.6948 };
  const mPerDegLng = 111320 * Math.cos(centre.latitude * Math.PI / 180);
  const rectEW = [
    { latitude: centre.latitude - 2 / 111320, longitude: centre.longitude },
    { latitude: centre.latitude - 2 / 111320, longitude: centre.longitude + 10 / mPerDegLng },
    { latitude: centre.latitude + 2 / 111320, longitude: centre.longitude + 10 / mPerDegLng },
    { latitude: centre.latitude + 2 / 111320, longitude: centre.longitude },
  ];
  const azEW = inferAzimuthFromPolygon(rectEW);
  assert('rect 10m east-west long edge → azimuth ≈ 0 (or 180, same axis)',
    Math.abs(azEW) < 1 || Math.abs(azEW - 180) < 1, `got ${azEW}`);

  // Rectangle 4m east-west × 10m north-south. Longest edge is north-south
  // (bearing 0° or 180°). Face azimuth = 0 - 90 = -90 → 270 (or 90).
  const rectNS = [
    { latitude: centre.latitude - 5 / 111320, longitude: centre.longitude },
    { latitude: centre.latitude - 5 / 111320, longitude: centre.longitude + 4 / mPerDegLng },
    { latitude: centre.latitude + 5 / 111320, longitude: centre.longitude + 4 / mPerDegLng },
    { latitude: centre.latitude + 5 / 111320, longitude: centre.longitude },
  ];
  const azNS = inferAzimuthFromPolygon(rectNS);
  assert('rect 10m north-south long edge → azimuth ≈ 90 or 270',
    Math.abs(azNS - 90) < 1 || Math.abs(azNS - 270) < 1, `got ${azNS}`);

  // Rectangle rotated 45° — long edge runs NE-SW. Face azimuth = 45 - 90 = -45 → 315 (or 135).
  // Build a 10m × 4m rect rotated 45° around the centre.
  const rot45 = (dx, dy) => ({
    dx: (dx - dy) / Math.SQRT2,
    dy: (dx + dy) / Math.SQRT2,
  });
  const dims = [ [-5, -2], [5, -2], [5, 2], [-5, 2] ];
  const rect45 = dims.map(([dx, dy]) => {
    const r = rot45(dx, dy);
    return {
      latitude:  centre.latitude + r.dy / 111320,
      longitude: centre.longitude + r.dx / mPerDegLng,
    };
  });
  const az45 = inferAzimuthFromPolygon(rect45);
  // Long edge bearing = 45° (NE) or 225° (SW). Face az = -45 or 135.
  assert('rect rotated 45° → azimuth ≈ 315 or 135',
    Math.abs(az45 - 315) < 2 || Math.abs(az45 - 135) < 2, `got ${az45}`);
}

// ── migrateDesignState backfills azimuth on legacy manual faces ─────────
{
  console.log('\n▸ migrateDesignState azimuth backfill');
  const legacyState = {
    schemaVersion: 2,
    view: { zoom: 1, panX: 0, panY: 0 },
    canvas: { serialized: null },
    roof: {
      faces: [
        // Manual face with no azimuth — should get one
        {
          id: 'face-legacy1', source: 'manual',
          polygon: [
            { latitude: 0, longitude: 0 },
            { latitude: 0, longitude: 0.001 },
            { latitude: 0.0001, longitude: 0.001 },
            { latitude: 0.0001, longitude: 0 },
          ],
          azimuthDegrees: null,
        },
        // Google face — must be left alone
        {
          id: 'face-legacy2', source: 'google_solar',
          polygon: [
            { latitude: 1, longitude: 1 },
            { latitude: 1, longitude: 1.001 },
            { latitude: 1.001, longitude: 1.001 },
          ],
          azimuthDegrees: 236.5,
        },
        // Manual face WITH azimuth already — must be left alone
        {
          id: 'face-legacy3', source: 'manual',
          polygon: [
            { latitude: 2, longitude: 2 },
            { latitude: 2, longitude: 2.001 },
            { latitude: 2.001, longitude: 2.001 },
          ],
          azimuthDegrees: 42,
        },
      ],
      obstructions: [],
    },
    panels: [], arrays: [],
  };
  const m = migrateDesignState(legacyState);
  const [f1, f2, f3] = m.roof.faces;
  assert('legacy manual face gets a computed azimuth',
    typeof f1.azimuthDegrees === 'number' && !Number.isNaN(f1.azimuthDegrees));
  assert('google face keeps its original azimuth (236.5)', f2.azimuthDegrees === 236.5);
  assert('manual face with existing azimuth keeps its value (42)', f3.azimuthDegrees === 42);

  // Manual face with degenerate polygon → azimuth stays null (no crash)
  const degenerate = migrateDesignState({
    ...legacyState,
    roof: { faces: [{ id: 'x', source: 'manual', polygon: [], azimuthDegrees: null }], obstructions: [] },
  });
  assert('degenerate polygon → azimuth stays null (no crash)',
    degenerate.roof.faces[0].azimuthDegrees == null);
}

// ── migrateDesignState drops orphan panels + cleans arrays (Phase 3b.9) ─
{
  console.log('\n▸ migrateDesignState orphan cleanup');
  const state = {
    schemaVersion: 2,
    view: { zoom: 1, panX: 0, panY: 0 },
    canvas: { serialized: null },
    roof: {
      faces: [{ id: 'face-alive', source: 'manual', azimuthDegrees: 0, polygon: [
        { latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }, { latitude: 1, longitude: 1 },
      ] }],
      obstructions: [],
    },
    panels: [
      { id: 'p-1', faceId: 'face-alive',   sku: 'A', center: { latitude: 0.5, longitude: 0.5 }, rotationDegrees: 0, orientation: 'landscape' },
      { id: 'p-2', faceId: 'face-DELETED', sku: 'A', center: { latitude: 0.4, longitude: 0.4 }, rotationDegrees: 0, orientation: 'landscape' },
      { id: 'p-3', faceId: 'face-alive',   sku: 'A', center: { latitude: 0.6, longitude: 0.6 }, rotationDegrees: 0, orientation: 'landscape' },
    ],
    arrays: [
      { id: 'arr-1', name: 'Mixed array', panelIds: ['p-1', 'p-2', 'p-3'] },
      { id: 'arr-2', name: 'All-orphan',  panelIds: ['p-2'] },
    ],
  };
  const m = migrateDesignState(state);
  assert('orphan panel (face-DELETED) is dropped', m.panels.length === 2);
  assert('surviving panels are the two on face-alive',
    m.panels.every(p => p.faceId === 'face-alive'));
  assert('arrays purge dead panelIds — mixed array keeps p-1 + p-3',
    m.arrays.find(a => a.id === 'arr-1')?.panelIds.length === 2);
  assert('all-orphan array is dropped entirely',
    !m.arrays.some(a => a.id === 'arr-2'));

  // Correctly-maintained state passes through untouched
  const cleanState = {
    schemaVersion: 2,
    view: { zoom: 1, panX: 0, panY: 0 }, canvas: { serialized: null },
    roof: { faces: [{ id: 'f-1', source: 'manual', azimuthDegrees: 0, polygon: [
      { latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }, { latitude: 1, longitude: 1 },
    ] }], obstructions: [] },
    panels: [{ id: 'p-1', faceId: 'f-1', sku: 'A', center: { latitude: 0.5, longitude: 0.5 }, rotationDegrees: 0, orientation: 'landscape' }],
    arrays: [{ id: 'arr-1', name: 'A', panelIds: ['p-1'] }],
  };
  const clean = migrateDesignState(cleanState);
  assert('clean state passes through untouched',
    clean.panels.length === 1 && clean.arrays.length === 1);
}

// ── latLngToFaceLocal (Phase 3b.8 rule-engine primitive) ─────────────────
{
  console.log('\n▸ latLngToFaceLocal');
  const centroid = { latitude: -36.9098, longitude: 174.6948 };
  const mPerDegLng = 111320 * Math.cos(centroid.latitude * Math.PI / 180);

  // az=0: 1m east → u=1, v=0
  const oneMEast = {
    latitude: centroid.latitude,
    longitude: centroid.longitude + 1 / mPerDegLng,
  };
  {
    const r = latLngToFaceLocal({ faceAzimuthDegrees: 0, faceCentroid: centroid, target: oneMEast });
    assert('az=0, 1m east → u≈1, v≈0',
      Math.abs(r.u - 1) < 0.001 && Math.abs(r.v) < 0.001);
  }

  // az=90: 1m north → u=-1, v=0 (u-axis rotated 90° = south direction; north maps to -u)
  {
    const oneMNorth = { latitude: centroid.latitude + 1 / 111320, longitude: centroid.longitude };
    const r = latLngToFaceLocal({ faceAzimuthDegrees: 90, faceCentroid: centroid, target: oneMNorth });
    assert('az=90, 1m north → u≈-1, v≈0',
      Math.abs(r.u + 1) < 0.001 && Math.abs(r.v) < 0.001, `got u=${r.u}, v=${r.v}`);
  }

  assert('null centroid → null', latLngToFaceLocal({ faceAzimuthDegrees: 0, faceCentroid: null, target: oneMEast }) === null);
}

// ── pointInPolygonUV + pointToPolygonMinDist ──────────────────────────────
{
  console.log('\n▸ pointInPolygonUV + pointToPolygonMinDist');
  // Unit square in (u, v) coords
  const square = [
    { u: 0, v: 0 },
    { u: 1, v: 0 },
    { u: 1, v: 1 },
    { u: 0, v: 1 },
  ];
  assert('centre point inside',           pointInPolygonUV(square, 0.5, 0.5) === true);
  assert('point outside east',            pointInPolygonUV(square, 1.5, 0.5) === false);
  assert('degenerate polygon → false',    pointInPolygonUV([], 0, 0) === false);

  // Distance from (0.5, 0.5) to nearest edge should be 0.5
  assert('centre → min edge dist = 0.5',
    Math.abs(pointToPolygonMinDist(square, 0.5, 0.5) - 0.5) < 1e-9);
  // Distance from (0.5, 0.1) to nearest edge (south edge) should be 0.1
  assert('near south edge → dist = 0.1',
    Math.abs(pointToPolygonMinDist(square, 0.5, 0.1) - 0.1) < 1e-9);
  // Distance from corner-adjacent (0.05, 0.05) to nearest edge should be 0.05
  assert('near corner → dist = 0.05',
    Math.abs(pointToPolygonMinDist(square, 0.05, 0.05) - 0.05) < 1e-9);
}

// ── panelAABBFaceLocal + aabbsOverlap ────────────────────────────────────
{
  console.log('\n▸ panelAABBFaceLocal + aabbsOverlap');
  const centroid = { latitude: -36.9098, longitude: 174.6948 };
  // Panel dropped exactly at centroid, landscape 1800×1100 → AABB (-0.9, -0.55) → (0.9, 0.55)
  const aabb = panelAABBFaceLocal({
    panelCenter: centroid,
    faceAzimuthDegrees: 0,
    faceCentroid: centroid,
    panelLengthMm: 1800, panelWidthMm: 1100,
    orientation: 'landscape',
  });
  assert('landscape 1800x1100 at centroid → AABB (-0.9,-0.55)→(0.9,0.55)',
    Math.abs(aabb.uMin + 0.9)  < 0.001
    && Math.abs(aabb.uMax - 0.9) < 0.001
    && Math.abs(aabb.vMin + 0.55) < 0.001
    && Math.abs(aabb.vMax - 0.55) < 0.001,
    `got uMin=${aabb.uMin}, uMax=${aabb.uMax}, vMin=${aabb.vMin}, vMax=${aabb.vMax}`);

  // Portrait swaps
  const portraitAABB = panelAABBFaceLocal({
    panelCenter: centroid,
    faceAzimuthDegrees: 0, faceCentroid: centroid,
    panelLengthMm: 1800, panelWidthMm: 1100, orientation: 'portrait',
  });
  assert('portrait: width becomes height and vice-versa',
    Math.abs(portraitAABB.uMax - 0.55) < 0.001 && Math.abs(portraitAABB.vMax - 0.9) < 0.001);

  // AABBs overlap
  const a = { uMin: 0, uMax: 2, vMin: 0, vMax: 2 };
  const b = { uMin: 1, uMax: 3, vMin: 1, vMax: 3 };
  const c = { uMin: 3, uMax: 5, vMin: 0, vMax: 2 };
  assert('AABB overlap when partial intersection',       aabbsOverlap(a, b) === true);
  assert('AABB no overlap when only touching at edge',   aabbsOverlap(a, c) === false);
  assert('AABB no overlap when separated',               aabbsOverlap(a, { uMin: 10, uMax: 11, vMin: 10, vMax: 11 }) === false);
  assert('AABB null args → no overlap (defensive)',      aabbsOverlap(null, a) === false);
}

// ── checkPanelDropRules (Phase 3b.8 end-to-end) ──────────────────────────
{
  console.log('\n▸ checkPanelDropRules');

  // Build a state with a 10m × 6m north-facing face (az=0), centred on Auckland.
  const centre = { latitude: -36.9098, longitude: 174.6948 };
  const mPerDegLng = 111320 * Math.cos(centre.latitude * Math.PI / 180);
  const face = makeRoofFace({
    source: 'manual',
    polygon: [
      { latitude: centre.latitude - 3 / 111320, longitude: centre.longitude - 5 / mPerDegLng },
      { latitude: centre.latitude - 3 / 111320, longitude: centre.longitude + 5 / mPerDegLng },
      { latitude: centre.latitude + 3 / 111320, longitude: centre.longitude + 5 / mPerDegLng },
      { latitude: centre.latitude + 3 / 111320, longitude: centre.longitude - 5 / mPerDegLng },
    ],
    azimuthDegrees: 0,
    setbackMetres: 0.3,
  });
  let state = addFace(emptyDesignState(), face);
  const spec = { length_mm: 1800, width_mm: 1100 };
  const catalogue = new Map([['PANEL-A', spec]]);

  // Drop at centre → should pass
  {
    const r = checkPanelDropRules({
      state, face, panelCenter: centre,
      panelLengthMm: 1800, panelWidthMm: 1100, orientation: 'landscape',
      setbackMetres: 0.3, panelCatalogueBySku: catalogue,
    });
    assert('drop at centre of 10x6m face: ok', r.ok === true);
  }

  // Drop 5m east (right at east edge, panel extends past edge) → outside-face
  {
    const east5 = { latitude: centre.latitude, longitude: centre.longitude + 5 / mPerDegLng };
    const r = checkPanelDropRules({
      state, face, panelCenter: east5,
      panelLengthMm: 1800, panelWidthMm: 1100, orientation: 'landscape',
      setbackMetres: 0.3, panelCatalogueBySku: catalogue,
    });
    assert('drop past east edge: outside-face', r.ok === false && r.reason === 'outside-face');
  }

  // Drop 4.5m east — panel fits inside but is within setback of east edge
  // (east corner at u = 4.5 + 0.9 = 5.4 outside actually; try 4.0)
  // 4m east: panel east corner at u=4.9, face east edge at u=5.0, dist=0.1 < setback=0.3
  {
    const east4 = { latitude: centre.latitude, longitude: centre.longitude + 4.0 / mPerDegLng };
    const r = checkPanelDropRules({
      state, face, panelCenter: east4,
      panelLengthMm: 1800, panelWidthMm: 1100, orientation: 'landscape',
      setbackMetres: 0.3, panelCatalogueBySku: catalogue,
    });
    assert('drop 4m east: setback violation (0.1m to edge)',
      r.ok === false && r.reason === 'setback',
      `got ${JSON.stringify(r)}`);
  }

  // Setback disabled → same drop passes
  {
    const east4 = { latitude: centre.latitude, longitude: centre.longitude + 4.0 / mPerDegLng };
    const r = checkPanelDropRules({
      state, face, panelCenter: east4,
      panelLengthMm: 1800, panelWidthMm: 1100, orientation: 'landscape',
      setbackMetres: 0, panelCatalogueBySku: catalogue,
    });
    assert('drop 4m east with setback=0: passes', r.ok === true);
  }

  // Add a panel at centre, then try to drop another at 0.5m east → overlap
  {
    const panel1 = makePanel({
      faceId: face.id, sku: 'PANEL-A', center: centre,
      rotationDegrees: 0, orientation: 'landscape',
    });
    const stateWithPanel = addPanel(state, panel1);
    const near = { latitude: centre.latitude, longitude: centre.longitude + 0.5 / mPerDegLng };
    const r = checkPanelDropRules({
      state: stateWithPanel, face, panelCenter: near,
      panelLengthMm: 1800, panelWidthMm: 1100, orientation: 'landscape',
      setbackMetres: 0.3, panelCatalogueBySku: catalogue,
    });
    assert('drop overlapping existing panel: overlap-panel',
      r.ok === false && r.reason === 'overlap-panel');
  }

  // Add panel at centre; drop 2m east — no overlap (panel widths 1.8 + gap = ~2m)
  {
    const panel1 = makePanel({
      faceId: face.id, sku: 'PANEL-A', center: centre,
      rotationDegrees: 0, orientation: 'landscape',
    });
    const stateWithPanel = addPanel(state, panel1);
    const east2 = { latitude: centre.latitude, longitude: centre.longitude + 2.0 / mPerDegLng };
    const r = checkPanelDropRules({
      state: stateWithPanel, face, panelCenter: east2,
      panelLengthMm: 1800, panelWidthMm: 1100, orientation: 'landscape',
      setbackMetres: 0.3, panelCatalogueBySku: catalogue,
    });
    assert('drop 2m east of existing panel (no overlap, past setback): ok',
      r.ok === true, `got ${JSON.stringify(r)}`);
  }

  // Obstruction at (1, 0) with radius 0.5m — drop at centre should still pass
  // (panel east edge at u=0.9, obstruction west edge at u=0.5 → touching but our overlap check
  // uses < r so touching passes)
  // Better: obstruction at (0.5, 0) radius 0.6 — panel east edge = 0.9, distance = 0.5-0.9=−0.4 clamped to 0
  // dy=0 → d=0. r=0.6 → d < r → obstruction.
  {
    const obst = makeObstruction({
      type: 'chimney',
      center: { latitude: centre.latitude, longitude: centre.longitude + 0.5 / mPerDegLng },
      radiusMetres: 0.6,
    });
    const stateWithObst = addObstruction(state, obst);
    const r = checkPanelDropRules({
      state: stateWithObst, face, panelCenter: centre,
      panelLengthMm: 1800, panelWidthMm: 1100, orientation: 'landscape',
      setbackMetres: 0.3, panelCatalogueBySku: catalogue,
    });
    assert('panel overlaps obstruction: obstruction',
      r.ok === false && r.reason === 'obstruction');
  }

  // Invalid face
  {
    const r = checkPanelDropRules({
      state, face: { id: 'x', polygon: null },
      panelCenter: centre,
      panelLengthMm: 1800, panelWidthMm: 1100, orientation: 'landscape',
      setbackMetres: 0.3, panelCatalogueBySku: catalogue,
    });
    assert('invalid face (null polygon): invalid-face', r.ok === false && r.reason === 'invalid-face');
  }

  // Invalid panel dims
  {
    const r = checkPanelDropRules({
      state, face, panelCenter: centre,
      panelLengthMm: 0, panelWidthMm: 0, orientation: 'landscape',
      setbackMetres: 0.3, panelCatalogueBySku: catalogue,
    });
    assert('invalid panel dims (0): invalid-panel', r.ok === false && r.reason === 'invalid-panel');
  }

  // DROP_REASON_HUMAN provides messages for all reason codes
  const reasons = ['outside-face', 'setback', 'overlap-panel', 'obstruction', 'invalid-face', 'invalid-panel'];
  const humanOK = reasons.every(r => typeof DROP_REASON_HUMAN[r] === 'string' && DROP_REASON_HUMAN[r].length > 0);
  assert('DROP_REASON_HUMAN has a message for every reason code', humanOK);
}

// ── Irradiance helpers (Phase 3b.8 irradiance surfacing) ────────────────
{
  console.log('\n▸ googleSegmentToRoofFace extracts median sunshine');
  const seg = {
    boundingBox: {
      ne: { latitude: -36.9, longitude: 174.7 },
      sw: { latitude: -36.91, longitude: 174.69 },
    },
    pitchDegrees: 20, azimuthDegrees: 5,
    stats: {
      areaMeters2: 42,
      sunshineQuantiles: [700, 800, 900, 1000, 1100, 1250, 1400, 1500, 1600, 1700, 1800],
    },
  };
  const face = googleSegmentToRoofFace(seg);
  assert('face carries the segment median (index 5) sunshine',
    face.sunshineKwhPerKwPerYear === 1250);

  // Segment without sunshineQuantiles → null on the face
  const bareSeg = { ...seg, stats: { areaMeters2: 30 } };
  const bareFace = googleSegmentToRoofFace(bareSeg);
  assert('missing sunshineQuantiles → null on face', bareFace.sunshineKwhPerKwPerYear === null);
}

{
  console.log('\n▸ estimateFaceSunshine precedence');
  assert('NZ default constant defined', NZ_DEFAULT_SUNSHINE_KWH_PER_KW_YEAR === 1350);

  // 1. Face has its own value — returns it
  const faceOwn = { id: 'a', sunshineKwhPerKwPerYear: 1500 };
  assert('face own value wins over everything',
    estimateFaceSunshine({ roof: { faces: [] } }, faceOwn) === 1500);

  // 2. Face is null-valued, other Google faces have values → returns median of others
  const google1 = { id: 'g1', source: 'google_solar', sunshineKwhPerKwPerYear: 1200 };
  const google2 = { id: 'g2', source: 'google_solar', sunshineKwhPerKwPerYear: 1400 };
  const google3 = { id: 'g3', source: 'google_solar', sunshineKwhPerKwPerYear: 1600 };
  const manual  = { id: 'm', source: 'manual', sunshineKwhPerKwPerYear: null };
  const stateMulti = { roof: { faces: [google1, google2, google3, manual] } };
  assert('manual face inherits median of Google faces (1400)',
    estimateFaceSunshine(stateMulti, manual) === 1400);

  // 3. No known values → fallback (NZ default)
  const emptyState = { roof: { faces: [{ id: 'x', sunshineKwhPerKwPerYear: null }] } };
  assert('no known values → NZ default fallback (1350)',
    estimateFaceSunshine(emptyState, { id: 'x', sunshineKwhPerKwPerYear: null })
      === NZ_DEFAULT_SUNSHINE_KWH_PER_KW_YEAR);

  // 4. Fallback override
  assert('caller-supplied fallback wins over the default',
    estimateFaceSunshine(emptyState, { id: 'x' }, 999) === 999);
}

{
  console.log('\n▸ totalAnnualKwh');
  // Empty state → 0
  assert('no panels → 0 kWh',
    totalAnnualKwh(emptyDesignState(), new Map()) === 0);

  // Simple: 1 face with sunshine=1500, 2 panels of 500W → 2 * 0.5 * 1500 = 1500 kWh
  const centre = { latitude: -36.9098, longitude: 174.6948 };
  const face = makeRoofFace({
    source: 'google_solar',
    polygon: [
      { latitude: centre.latitude - 0.0001, longitude: centre.longitude - 0.0001 },
      { latitude: centre.latitude - 0.0001, longitude: centre.longitude + 0.0001 },
      { latitude: centre.latitude + 0.0001, longitude: centre.longitude + 0.0001 },
    ],
    sunshineKwhPerKwPerYear: 1500,
  });
  let s = addFace(emptyDesignState(), face);
  s = addPanel(s, makePanel({ faceId: face.id, sku: 'A', center: centre }));
  s = addPanel(s, makePanel({ faceId: face.id, sku: 'A', center: centre }));
  const cat = new Map([['A', { watts: 500 }]]);
  assert('2 × 500W on face with 1500 kWh/kW/yr → 1500 kWh',
    totalAnnualKwh(s, cat) === 1500);

  // Panel on face without sunshine → inherits (via estimateFaceSunshine)
  const bareFace = makeRoofFace({
    source: 'manual',
    polygon: [
      { latitude: 1, longitude: 1 },
      { latitude: 1, longitude: 1.001 },
      { latitude: 1.001, longitude: 1.001 },
    ],
  });
  let s2 = addFace(s, bareFace);
  s2 = addPanel(s2, makePanel({ faceId: bareFace.id, sku: 'A', center: { latitude: 1, longitude: 1 } }));
  // 3 panels now: 2 × 500W × 1500 = 1500, 1 × 500W × 1500 (median of known = 1500) = 750
  // Total = 2250
  assert('manual face panel inherits median from Google faces (1500)',
    totalAnnualKwh(s2, cat) === 2250);
}

// ── Panel auto-numbering (Phase 3b.11) ───────────────────────────────────
{
  console.log('\n▸ panelDisplayLabel + buildPanelLabelMap');
  const state = {
    schemaVersion: 2,
    view: { zoom: 1, panX: 0, panY: 0 }, canvas: { serialized: null },
    roof: { faces: [], obstructions: [] },
    panels: [],   // panel entities not needed for label lookup
    arrays: [
      { id: 'arr-1', name: 'North array', panelIds: ['p-a', 'p-b', 'p-c'] },
      { id: 'arr-2', name: 'SW array',    panelIds: ['p-x', 'p-y'] },
    ],
  };

  assert('S1P1 = 1st panel in 1st array',   panelDisplayLabel(state, 'p-a') === 'S1P1');
  assert('S1P3 = 3rd panel in 1st array',   panelDisplayLabel(state, 'p-c') === 'S1P3');
  assert('S2P1 = 1st panel in 2nd array',   panelDisplayLabel(state, 'p-x') === 'S2P1');
  assert('S2P2 = 2nd panel in 2nd array',   panelDisplayLabel(state, 'p-y') === 'S2P2');
  assert('un-arrayed panel → null',         panelDisplayLabel(state, 'p-nowhere') === null);
  assert('null state → null (defensive)',   panelDisplayLabel(null, 'p-a') === null);
  assert('null panel id → null (defensive)', panelDisplayLabel(state, null) === null);

  const map = buildPanelLabelMap(state);
  assert('label map size = total panelIds across arrays', map.size === 5);
  assert('label map: p-a → S1P1',            map.get('p-a') === 'S1P1');
  assert('label map: p-y → S2P2',            map.get('p-y') === 'S2P2');
  assert('label map has no entry for un-arrayed panels', !map.has('p-nowhere'));
}

// ── copyArrayToFace (Phase 3b.10) ────────────────────────────────────────
{
  console.log('\n▸ copyArrayToFace');

  // Build a state with two 20m × 12m faces, both azimuth=0 (same rotation)
  // so a copied panel lands at the SAME face-local (u, v). Central Auckland
  // centre for a realistic metric scale.
  const cAuck = { latitude: -36.9098, longitude: 174.6948 };
  const mPerDegLng = 111320 * Math.cos(cAuck.latitude * Math.PI / 180);
  const mkRect = (centre, halfW, halfH) => [
    { latitude: centre.latitude - halfH / 111320, longitude: centre.longitude - halfW / mPerDegLng },
    { latitude: centre.latitude - halfH / 111320, longitude: centre.longitude + halfW / mPerDegLng },
    { latitude: centre.latitude + halfH / 111320, longitude: centre.longitude + halfW / mPerDegLng },
    { latitude: centre.latitude + halfH / 111320, longitude: centre.longitude - halfW / mPerDegLng },
  ];
  const face1 = makeRoofFace({ source: 'manual', polygon: mkRect(cAuck, 10, 6), azimuthDegrees: 0, setbackMetres: 0.3 });
  // Face 2 offset 50m north, same shape / azimuth
  const cFace2 = { latitude: cAuck.latitude + 50 / 111320, longitude: cAuck.longitude };
  const face2 = makeRoofFace({ source: 'manual', polygon: mkRect(cFace2, 10, 6), azimuthDegrees: 0, setbackMetres: 0.3 });

  const spec = new Map([['A', { length_mm: 1800, width_mm: 1100, watts: 400 }]]);

  // Drop 3 panels on face1 (well-spaced to avoid overlap after snap)
  let s = addFace(addFace(emptyDesignState(), face1), face2);
  const panelCentres = [
    { latitude: cAuck.latitude, longitude: cAuck.longitude },                                                // centre
    { latitude: cAuck.latitude, longitude: cAuck.longitude + 2 / mPerDegLng },                                // 2m east
    { latitude: cAuck.latitude, longitude: cAuck.longitude + 4 / mPerDegLng },                                // 4m east
  ];
  const panelIds = [];
  for (const c of panelCentres) {
    const snapped = snapToFaceGrid({
      faceAzimuthDegrees: 0, faceCentroid: polygonCentroidLL(face1.polygon),
      target: c, panelLengthMm: 1800, panelWidthMm: 1100, orientation: 'landscape',
    });
    const p = makePanel({ faceId: face1.id, sku: 'A', center: snapped, rotationDegrees: 0, orientation: 'landscape' });
    s = addPanel(s, p);
    panelIds.push(p.id);
  }
  s = addArray(s, makeArray({ name: 'Source array', panelIds }));

  // Copy to face2 — since face2 is same shape + azimuth, all 3 should transfer cleanly
  {
    const arrId = s.arrays[0].id;
    const r = copyArrayToFace({
      state: s, arrayId: arrId, targetFaceId: face2.id,
      panelCatalogueBySku: spec,
    });
    assert('copied all 3 panels to same-shape target face', r.copied === 3);
    assert('no rejections',                                   r.skipped === 0);
    assert('new state has 6 panels total (3 source + 3 copy)', r.state.panels.length === 6);
    assert('new state has 2 arrays (source + copy)',           r.state.arrays.length === 2);
    assert('copy array is named "Copy of Source array"',       r.state.arrays[1].name === 'Copy of Source array');
    assert('copy panels are on target face',
      r.state.arrays[1].panelIds.every(pid => r.state.panels.find(p => p.id === pid).faceId === face2.id));
  }

  // Custom name override
  {
    const arrId = s.arrays[0].id;
    const r = copyArrayToFace({
      state: s, arrayId: arrId, targetFaceId: face2.id,
      newArrayName: 'North twin', panelCatalogueBySku: spec,
    });
    assert('newArrayName override used', r.state.arrays[1].name === 'North twin');
  }

  // Target face too small → some panels rejected as outside-face
  {
    const tiny = makeRoofFace({
      source: 'manual',
      polygon: mkRect({ latitude: cAuck.latitude - 30 / 111320, longitude: cAuck.longitude }, 2, 2),
      azimuthDegrees: 0, setbackMetres: 0.3,
    });
    const sWithTiny = addFace(s, tiny);
    const arrId = s.arrays[0].id;
    const r = copyArrayToFace({
      state: sWithTiny, arrayId: arrId, targetFaceId: tiny.id,
      panelCatalogueBySku: spec,
    });
    assert('copy to tiny face: some panels rejected',
      r.skipped > 0 && r.copied < 3);
    assert('reason counts include outside-face or setback',
      r.reasonCounts.has('outside-face') || r.reasonCounts.has('setback'));
  }

  // Invalid arguments → empty result, no crash
  {
    const r = copyArrayToFace({
      state: s, arrayId: 'nope', targetFaceId: face2.id, panelCatalogueBySku: spec,
    });
    assert('bogus arrayId → 0 copied, no crash', r.copied === 0 && r.skipped === 0);

    const r2 = copyArrayToFace({
      state: s, arrayId: s.arrays[0].id, targetFaceId: 'nope', panelCatalogueBySku: spec,
    });
    assert('bogus targetFaceId → 0 copied, no crash', r2.copied === 0 && r2.skipped === 0);
  }
}

// ── autoLayoutFace (Phase 3b.13) ─────────────────────────────────────────
{
  console.log('\n▸ autoLayoutFace');

  // 10m × 6m north-facing face (az=0), Auckland centre. Setback 0.3m.
  // Panel 1800×1100 landscape → cellU 1.82m, cellV 1.12m.
  // Usable interior after setback: 9.4m × 5.4m.
  // Cols: floor(9.4 / 1.82) = 5 → but rounding to grid centres, actual is ~5.
  // Rows: floor(5.4 / 1.12) = 4 → actual ~4.
  // Expect ~15-25 panels placed (depending on how the raster snap lines up).
  const cAuck = { latitude: -36.9098, longitude: 174.6948 };
  const mPerDegLng = 111320 * Math.cos(cAuck.latitude * Math.PI / 180);
  const face = makeRoofFace({
    source: 'manual',
    polygon: [
      { latitude: cAuck.latitude - 3 / 111320, longitude: cAuck.longitude - 5 / mPerDegLng },
      { latitude: cAuck.latitude - 3 / 111320, longitude: cAuck.longitude + 5 / mPerDegLng },
      { latitude: cAuck.latitude + 3 / 111320, longitude: cAuck.longitude + 5 / mPerDegLng },
      { latitude: cAuck.latitude + 3 / 111320, longitude: cAuck.longitude - 5 / mPerDegLng },
    ],
    azimuthDegrees: 0, setbackMetres: 0.3,
  });
  const s = addFace(emptyDesignState(), face);
  const cat = new Map([['A', { length_mm: 1800, width_mm: 1100, watts: 400 }]]);

  {
    const r = autoLayoutFace({
      state: s, faceId: face.id, sku: 'A', panelCatalogueBySku: cat,
    });
    assert('placed at least 10 panels on 10x6m face', r.placed >= 10,
      `only got ${r.placed}`);
    assert('placed panels are all on this face',
      r.state.panels.every(p => p.faceId === face.id));
    assert('every placed panel uses the requested SKU',
      r.state.panels.every(p => p.sku === 'A'));
    assert('no array created when arrayName not passed',
      r.state.arrays.length === 0);
    assert('newArrayId is null when arrayName absent', r.newArrayId === null);
  }

  {
    const r = autoLayoutFace({
      state: s, faceId: face.id, sku: 'A', panelCatalogueBySku: cat,
      arrayName: 'North fill',
    });
    assert('arrayName creates an array on successful placement',
      r.state.arrays.length === 1 && r.state.arrays[0].name === 'North fill');
    assert('array contains every placed panel',
      r.state.arrays[0].panelIds.length === r.placed);
    assert('newArrayId returned', typeof r.newArrayId === 'string' && r.newArrayId.startsWith('arr-'));
  }

  // Auto-layout on a face that already has some panels → new drops fit around them
  {
    // Start with 2 panels roughly at centre
    let s2 = s;
    s2 = addPanel(s2, makePanel({
      faceId: face.id, sku: 'A',
      center: cAuck, rotationDegrees: 0, orientation: 'landscape',
    }));
    const r = autoLayoutFace({
      state: s2, faceId: face.id, sku: 'A', panelCatalogueBySku: cat,
    });
    assert('auto-layout respects existing panels (no overlap)',
      r.state.panels.length > 1 && r.state.panels.length === 1 + r.placed);
  }

  // Bogus inputs → empty result, no crash
  assert('no SKU → 0 placed', autoLayoutFace({ state: s, faceId: face.id, panelCatalogueBySku: cat }).placed === 0);
  assert('bogus faceId → 0 placed', autoLayoutFace({ state: s, faceId: 'nope', sku: 'A', panelCatalogueBySku: cat }).placed === 0);
}

// ── panelSkusInDesign (Phase 3b.13) ──────────────────────────────────────
{
  console.log('\n▸ panelSkusInDesign');
  assert('empty design → empty set', panelSkusInDesign(emptyDesignState()).size === 0);
  assert('null state → empty set (defensive)', panelSkusInDesign(null).size === 0);

  let s = addFace(emptyDesignState(), makeRoofFace({
    source: 'manual',
    polygon: [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }, { latitude: 1, longitude: 1 }],
    azimuthDegrees: 0,
  }));
  const faceId = s.roof.faces[0].id;
  s = addPanel(s, makePanel({ faceId, sku: 'A', center: { latitude: 0.5, longitude: 0.5 } }));
  s = addPanel(s, makePanel({ faceId, sku: 'A', center: { latitude: 0.6, longitude: 0.6 } }));
  s = addPanel(s, makePanel({ faceId, sku: 'B', center: { latitude: 0.7, longitude: 0.7 } }));

  const skus = panelSkusInDesign(s);
  assert('3 panels of 2 SKUs → set size 2', skus.size === 2);
  assert('set contains A + B', skus.has('A') && skus.has('B'));
}

// ── importGooglePanels (Phase 3e) ────────────────────────────────────────
{
  console.log('\n▸ importGooglePanels');

  // Two Google-sourced faces, segmentIndex 0 and 1.
  const segs = [
    { boundingBox: { ne: { latitude: 0.0002, longitude: 0.0002 }, sw: { latitude: 0, longitude: 0 } },
      pitchDegrees: 20, azimuthDegrees: 0, stats: { areaMeters2: 40 } },
    { boundingBox: { ne: { latitude: 0.0002, longitude: 0.001 }, sw: { latitude: 0, longitude: 0.0008 } },
      pitchDegrees: 22, azimuthDegrees: 90, stats: { areaMeters2: 35 } },
  ];
  let s = importGoogleSegments(emptyDesignState(), segs);
  const face0 = s.roof.faces.find(f => f.googleSegmentIndex === 0);
  const face1 = s.roof.faces.find(f => f.googleSegmentIndex === 1);
  assert('googleSegmentIndex preserved on imported faces',
    face0 != null && face1 != null);

  // Google-style solarPanels[] — three panels: two on seg 0 (one high-shade,
  // one low), one on seg 1. Include one panel referencing a segment that
  // doesn't exist to check the skip path.
  const gPanels = [
    { center: { latitude: 0.0001, longitude: 0.0001 }, orientation: 'PORTRAIT',
      segmentIndex: 0, yearlyEnergyDcKwh: 600 },   // seg 0, high energy
    { center: { latitude: 0.00015, longitude: 0.00015 }, orientation: 'LANDSCAPE',
      segmentIndex: 0, yearlyEnergyDcKwh: 200 },   // seg 0, low energy
    { center: { latitude: 0.0001, longitude: 0.0009 }, orientation: 'LANDSCAPE',
      segmentIndex: 1, yearlyEnergyDcKwh: 550 },   // seg 1
    { center: { latitude: 0, longitude: 0 }, orientation: 'PORTRAIT',
      segmentIndex: 99, yearlyEnergyDcKwh: 100 },  // orphan segment → skipped
  ];
  const r = importGooglePanels({ state: s, googlePanels: gPanels, sku: 'A' });

  assert('imported 3 valid panels',                  r.imported === 3);
  assert('skipped 1 (orphan segmentIndex)',           r.skipped === 1);
  assert('arraysCreated = 2 (one per face touched)',  r.arraysCreated === 2);
  assert('new state has 3 panels total',              r.state.panels.length === 3);
  assert('new state has 2 arrays total',              r.state.arrays.length === 2);
  assert('all panels have the requested SKU',
    r.state.panels.every(p => p.sku === 'A'));

  // Sort-by-energy check: within seg 0, the 600-kWh panel should be S1P1,
  // the 200-kWh panel should be S1P2.
  const seg0Array = r.state.arrays.find(a => a.name === 'Segment 1 array');
  assert('best-shaded panel on seg 0 is first in the array',
    seg0Array?.panelIds.length === 2
      && r.state.panels.find(p => p.id === seg0Array.panelIds[0]).center.longitude === 0.0001);

  // Portrait orientation preserved
  const p1 = r.state.panels.find(p => p.center.longitude === 0.0001);
  assert('PORTRAIT orientation preserved from Google', p1?.orientation === 'portrait');

  // Empty / bogus inputs → no crash, empty result
  assert('no SKU → empty result',
    importGooglePanels({ state: s, googlePanels: gPanels }).imported === 0);
  assert('null state → empty result',
    importGooglePanels({ state: null, googlePanels: gPanels, sku: 'A' }).imported === 0);
  assert('empty google panels → empty result',
    importGooglePanels({ state: s, googlePanels: [], sku: 'A' }).imported === 0);
  assert('state with no google faces → empty result (nothing to match onto)',
    importGooglePanels({ state: emptyDesignState(), googlePanels: gPanels, sku: 'A' }).imported === 0);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

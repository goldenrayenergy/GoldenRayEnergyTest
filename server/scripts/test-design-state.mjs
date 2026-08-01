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

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

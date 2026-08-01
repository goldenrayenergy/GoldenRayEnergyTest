// ────────────────────────────────────────────────────────────────────────────
// PM Tool — Design tool state schema + manipulation helpers (Phase 3b)
//
// The design tool persists its state as a jsonb blob (see server/routes/pm/
// designs.js). This file defines the CANONICAL shape of that blob and pure
// helpers to manipulate it. Keep this module dependency-free so both client
// and (future) server-side validators can import it.
//
// Design principles:
//   • Every polygon/point is in WGS84 lat/lng — matches Google Solar segments
//     and LINZ Basemap coordinates. Client renders by projecting via the
//     tile's radiusMeters + centre (see utils/roofOverlay.js).
//   • Every entity has a stable id — panel/array references outlive canvas
//     re-renders and survive save→reload cycles.
//   • Missing fields tolerated. Older saves must load in the current client.
//     Adding a NEW field is safe (defaults everywhere); RENAMING a field
//     requires a migration path (see MIGRATIONS below).
//
// STATE SHAPE (v2 — Phase 3b introduces roof/panels/arrays):
//
//   {
//     schemaVersion: 2,
//     view:   { zoom, panX, panY },
//     canvas: { serialized: <Fabric JSON | null> },
//     roof: {
//       faces: [
//         {
//           id: 'face-1',
//           source: 'google_solar' | 'manual',
//           polygon: [{ latitude, longitude }, ...],   // 3+ vertices
//           pitchDegrees, azimuthDegrees,             // 0=N, 90=E, 180=S, 270=W
//           areaMetres2,                              // computed at import (or 0 for manual)
//           material: null | 'metal' | 'tile' | 'colorsteel' | 'membrane',
//           setbackMetres: 0.3,                       // min panel-to-edge distance
//           notes: '',
//         }
//       ],
//       obstructions: [
//         {
//           id: 'obst-1',
//           type: 'chimney' | 'skylight' | 'vent' | 'satellite' | 'hvac' | 'other',
//           center: { latitude, longitude },
//           radiusMetres: 0.5,                        // exclusion circle radius
//           note: '',
//         }
//       ],
//     },
//     panels: [
//       {
//         id: 'panel-1',
//         faceId: 'face-1',                           // which face it sits on
//         sku: 'PHN-PNL-475-QSR',                     // catalogue lookup key
//         center: { latitude, longitude },
//         rotationDegrees: 0,                          // relative to face azimuth
//         orientation: 'portrait' | 'landscape',
//       }
//     ],
//     arrays: [
//       {
//         id: 'arr-1',
//         name: 'North array',
//         panelIds: ['panel-1', ...],
//       }
//     ]
//   }
//
// MIGRATIONS (renames / removals need one — additions do not):
//   v1 → v2: add roof/panels/arrays (Phase 3b). Existing v1 states get
//            empty roof/panels/arrays via migrateDesignState().
// ────────────────────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = 2;

// Roof-face default setback (metres from edge where panels can't sit).
// Chosen conservatively — most NZ install codes want ≥300mm from ridge/eaves;
// engineer can override per face via Phase 3d.
export const DEFAULT_FACE_SETBACK_M = 0.3;

// Obstruction type enum — panels must sit outside the exclusion circle around
// each obstruction. Radii below are DEFAULTS applied when auto-detecting from
// Google Solar; rep can adjust per-obstruction.
export const OBSTRUCTION_DEFAULTS = {
  chimney:   { radiusMetres: 0.6, note: '' },
  skylight:  { radiusMetres: 0.3, note: '' },
  vent:      { radiusMetres: 0.3, note: '' },
  satellite: { radiusMetres: 0.3, note: '' },
  hvac:      { radiusMetres: 0.8, note: '' },
  other:     { radiusMetres: 0.3, note: '' },
};

// ── Empty state (Phase 3b v2) ─────────────────────────────────────────────
export function emptyDesignState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    view:   { zoom: 1.0, panX: 0, panY: 0 },
    canvas: { serialized: null },
    roof:   { faces: [], obstructions: [] },
    panels: [],
    arrays: [],
  };
}

// ── Migration ─────────────────────────────────────────────────────────────
// Loads a saved state (any schema version) and returns a v2-shaped state.
// Missing sections get empty defaults; unknown sections are preserved
// unchanged in case a future version adds them and we need to round-trip.
export function migrateDesignState(state) {
  if (!state || typeof state !== 'object') return emptyDesignState();
  const migrated = {
    ...state,
    schemaVersion: SCHEMA_VERSION,
    view:   state.view   || { zoom: 1.0, panX: 0, panY: 0 },
    canvas: state.canvas || { serialized: null },
    roof: {
      faces:        Array.isArray(state.roof?.faces)        ? state.roof.faces        : [],
      obstructions: Array.isArray(state.roof?.obstructions) ? state.roof.obstructions : [],
    },
    panels: Array.isArray(state.panels) ? state.panels : [],
    arrays: Array.isArray(state.arrays) ? state.arrays : [],
  };
  return migrated;
}

// ── ID generator ───────────────────────────────────────────────────────────
// Small, human-readable IDs. NOT cryptographically strong — we don't need
// that for design entities, they're all scoped to a single design row.
// Format: prefix + '-' + 6-char base36. Collision odds within one design's
// (~hundreds of) entities are negligible.
function _rand6() {
  // Math.random() is banned in workflows but NOT in normal client code
  // (this file is imported by the client bundle, not a workflow script).
  return Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
}
export function newId(prefix) { return `${prefix}-${_rand6()}`; }
export const faceId  = () => newId('face');
export const obstId  = () => newId('obst');
export const panelId = () => newId('panel');
export const arrayId = () => newId('arr');

// ── Roof face helpers ─────────────────────────────────────────────────────
export function makeRoofFace({
  source,
  polygon,
  pitchDegrees = null,
  azimuthDegrees = null,
  areaMetres2 = 0,
  material = null,
  setbackMetres = DEFAULT_FACE_SETBACK_M,
  notes = '',
} = {}) {
  if (source !== 'google_solar' && source !== 'manual') {
    throw new Error(`[designState] makeRoofFace: source must be 'google_solar' or 'manual', got ${source}`);
  }
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new Error('[designState] makeRoofFace: polygon must have at least 3 vertices');
  }
  for (const v of polygon) {
    if (typeof v?.latitude !== 'number' || typeof v?.longitude !== 'number') {
      throw new Error('[designState] makeRoofFace: every polygon vertex needs numeric latitude/longitude');
    }
  }
  return {
    id: faceId(),
    source,
    polygon,
    pitchDegrees,
    azimuthDegrees,
    areaMetres2,
    material,
    setbackMetres,
    notes,
  };
}

export function addFace(state, face) {
  return { ...state, roof: { ...state.roof, faces: [...state.roof.faces, face] } };
}

export function removeFace(state, id) {
  // Removing a face also removes panels on it — enforce referential integrity
  // in the client so Phase 3b never leaves orphan panels.
  const keepPanels = state.panels.filter(p => p.faceId !== id);
  const panelIdsRemoved = new Set(state.panels.filter(p => p.faceId === id).map(p => p.id));
  const cleanArrays = state.arrays
    .map(a => ({ ...a, panelIds: a.panelIds.filter(pid => !panelIdsRemoved.has(pid)) }))
    .filter(a => a.panelIds.length > 0);   // drop now-empty arrays
  return {
    ...state,
    roof:   { ...state.roof, faces: state.roof.faces.filter(f => f.id !== id) },
    panels: keepPanels,
    arrays: cleanArrays,
  };
}

// ── Obstruction helpers ───────────────────────────────────────────────────
export function makeObstruction({ type, center, radiusMetres, note = '' } = {}) {
  if (!OBSTRUCTION_DEFAULTS[type]) {
    throw new Error(`[designState] makeObstruction: unknown type '${type}'`);
  }
  if (typeof center?.latitude !== 'number' || typeof center?.longitude !== 'number') {
    throw new Error('[designState] makeObstruction: center must have numeric latitude/longitude');
  }
  return {
    id: obstId(),
    type,
    center,
    radiusMetres: (typeof radiusMetres === 'number' && radiusMetres > 0)
      ? radiusMetres : OBSTRUCTION_DEFAULTS[type].radiusMetres,
    note,
  };
}

export function addObstruction(state, obst) {
  return { ...state, roof: { ...state.roof, obstructions: [...state.roof.obstructions, obst] } };
}

export function removeObstruction(state, id) {
  return {
    ...state,
    roof: { ...state.roof, obstructions: state.roof.obstructions.filter(o => o.id !== id) },
  };
}

// ── Panel helpers (Phase 3b.4+ will wire these into UI) ───────────────────
export function makePanel({ faceId, sku, center, rotationDegrees = 0, orientation = 'landscape' } = {}) {
  if (!faceId) throw new Error('[designState] makePanel: faceId required');
  if (!sku)    throw new Error('[designState] makePanel: sku required');
  if (typeof center?.latitude !== 'number' || typeof center?.longitude !== 'number') {
    throw new Error('[designState] makePanel: center must have numeric latitude/longitude');
  }
  if (orientation !== 'portrait' && orientation !== 'landscape') {
    throw new Error(`[designState] makePanel: orientation must be 'portrait' or 'landscape', got ${orientation}`);
  }
  return { id: panelId(), faceId, sku, center, rotationDegrees, orientation };
}

export function addPanel(state, panel) {
  return { ...state, panels: [...state.panels, panel] };
}

export function removePanel(state, id) {
  return {
    ...state,
    panels: state.panels.filter(p => p.id !== id),
    arrays: state.arrays
      .map(a => ({ ...a, panelIds: a.panelIds.filter(pid => pid !== id) }))
      .filter(a => a.panelIds.length > 0),
  };
}

// ── Array helpers ─────────────────────────────────────────────────────────
export function makeArray({ name, panelIds = [] } = {}) {
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('[designState] makeArray: name required');
  }
  if (!Array.isArray(panelIds)) {
    throw new Error('[designState] makeArray: panelIds must be an array');
  }
  return { id: arrayId(), name: name.trim(), panelIds };
}

export function addArray(state, arr) {
  return { ...state, arrays: [...state.arrays, arr] };
}

export function removeArray(state, id) {
  return { ...state, arrays: state.arrays.filter(a => a.id !== id) };
}

// ── Google Solar segment → roof face conversion (Phase 3b.2) ─────────────
// A Google Solar `roofSegmentStat` looks like:
//   { boundingBox: { ne: {latitude, longitude}, sw: {latitude, longitude} },
//     center: { latitude, longitude },
//     pitchDegrees, azimuthDegrees,
//     stats: { areaMeters2, ... } }
//
// We convert the axis-aligned bbox to a 4-vertex polygon. This is a
// SIMPLIFIED approximation — real roof faces are rarely axis-aligned to
// lat/lng, so the polygon shows where the face is, not its exact edges.
// Phase 3b.3 (manual tracing) will let the rep drag vertices to refine.
// Later phases can use Google's `boundaryPolygon` if/when we start reading it.
export function googleSegmentToRoofFace(seg) {
  const bbox = seg?.boundingBox;
  if (!bbox?.ne || !bbox?.sw) return null;
  if (typeof bbox.ne.latitude !== 'number' || typeof bbox.ne.longitude !== 'number') return null;
  if (typeof bbox.sw.latitude !== 'number' || typeof bbox.sw.longitude !== 'number') return null;

  // Order: NW → NE → SE → SW (clockwise from top-left)
  const polygon = [
    { latitude: bbox.ne.latitude, longitude: bbox.sw.longitude },  // NW
    { latitude: bbox.ne.latitude, longitude: bbox.ne.longitude },  // NE
    { latitude: bbox.sw.latitude, longitude: bbox.ne.longitude },  // SE
    { latitude: bbox.sw.latitude, longitude: bbox.sw.longitude },  // SW
  ];

  return makeRoofFace({
    source: 'google_solar',
    polygon,
    pitchDegrees:   typeof seg.pitchDegrees   === 'number' ? seg.pitchDegrees   : null,
    azimuthDegrees: typeof seg.azimuthDegrees === 'number' ? seg.azimuthDegrees : null,
    areaMetres2:    typeof seg?.stats?.areaMeters2 === 'number' ? seg.stats.areaMeters2 : 0,
  });
}

// Convert an ENTIRE Google Solar segment array (roof_analyses.roof_segments)
// to roof-face objects, dropping any segments that fail conversion.
export function googleSegmentsToRoofFaces(segments) {
  if (!Array.isArray(segments)) return [];
  const faces = [];
  for (const seg of segments) {
    const f = googleSegmentToRoofFace(seg);
    if (f) faces.push(f);
  }
  return faces;
}

// Import Google segments into state.roof.faces. Returns a NEW state object.
// If state already has faces, this REPLACES the Google-sourced ones and keeps
// any manual faces — so hitting "Trace from Google" twice won't duplicate.
export function importGoogleSegments(state, segments) {
  const newGoogleFaces = googleSegmentsToRoofFaces(segments);
  const manualFaces    = state.roof.faces.filter(f => f.source !== 'google_solar');

  // Collect any panel IDs that were on old google faces — they'll be orphaned
  // unless we drop them. Panels persist attach-to-face id, so replacing faces
  // requires clearing panels that were on the old ones.
  const oldGoogleFaceIds = new Set(
    state.roof.faces.filter(f => f.source === 'google_solar').map(f => f.id),
  );
  const survivingPanels = state.panels.filter(p => !oldGoogleFaceIds.has(p.faceId));
  const droppedPanelIds = new Set(
    state.panels.filter(p => oldGoogleFaceIds.has(p.faceId)).map(p => p.id),
  );
  const cleanArrays = state.arrays
    .map(a => ({ ...a, panelIds: a.panelIds.filter(pid => !droppedPanelIds.has(pid)) }))
    .filter(a => a.panelIds.length > 0);

  return {
    ...state,
    roof: { ...state.roof, faces: [...manualFaces, ...newGoogleFaces] },
    panels: survivingPanels,
    arrays: cleanArrays,
  };
}

// ── Query helpers ─────────────────────────────────────────────────────────
export function facesById(state) {
  const map = new Map();
  for (const f of state.roof.faces) map.set(f.id, f);
  return map;
}

export function panelsByFace(state, faceId) {
  return state.panels.filter(p => p.faceId === faceId);
}

// Total kW installed. Requires a catalogue lookup for panel wattage — passed
// in so this module stays dependency-free. `catalogueByFksu` is a Map<sku, {watts}>.
export function totalKilowatts(state, catalogueBySku) {
  let totalWatts = 0;
  for (const p of state.panels) {
    const spec = catalogueBySku?.get(p.sku);
    if (spec && typeof spec.watts === 'number') totalWatts += spec.watts;
  }
  return +(totalWatts / 1000).toFixed(3);   // kW to 3dp
}

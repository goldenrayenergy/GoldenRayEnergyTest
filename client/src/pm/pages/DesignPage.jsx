// ────────────────────────────────────────────────────────────────────────────
// PM Tool — Panel-layout design tool (Phase 3a)
//
// Route: /pm/quotes/:id/design
//
// Phase 3a scope:
//   • Route + page skeleton
//   • Load quote → contact → latest roof analysis (signed image URL)
//   • Fabric.js canvas with the roof image loaded
//   • Pan (drag) + zoom (wheel + buttons)
//   • Save + autosave (debounced 2s) with optimistic-concurrency version check
//   • Graceful "no roof image yet" state
//
// Deliberately NOT in Phase 3a (comes in 3b–f):
//   • Roof face tracing, obstruction markers
//   • Panel drop / drag / grid snap
//   • Inverter / battery / pricing panels
//   • Google's suggest-a-layout
//   • Compliance warnings
//   • Handoff to engineer
//   • Proposal PDF push
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as fabric from 'fabric';
import { ChevronLeft, ChevronRight, ChevronDown, ZoomIn, ZoomOut, Maximize2, Save, Loader2, AlertCircle, X, Trash2, Copy, Search } from 'lucide-react';
import { pmQuotesAPI, pmContactsAPI } from '../services/pmQuotesApi';
import { pmDesignsAPI, emptyDesignState, migrateDesignState } from '../services/pmDesignsApi';
import { makeLatLngToPixel, makePixelToLatLng } from '../utils/roofOverlay';
import {
  importGoogleSegments, makeRoofFace, addFace, removeFace,
  makePanel, addPanel, removePanel,
  makeObstruction, addObstruction, removeObstruction, OBSTRUCTION_DEFAULTS,
  makeArray, addArray, removeArray,
  faceContainingPoint, totalKilowatts, totalAnnualKwh, estimateFaceSunshine,
  snapToFaceGrid, polygonCentroidLL, PANEL_GRID_GAP_MM,
  inferAzimuthFromPolygon, distanceMetres,
  checkPanelDropRules, DROP_REASON_HUMAN, DEFAULT_FACE_SETBACK_M,
  buildPanelLabelMap, copyArrayToFace,
  autoLayoutFace, panelSkusInDesign,
  importGooglePanels,
} from '../utils/designState';
import useCatalogueOptions from '../hooks/useCatalogueOptions';
// segmentBboxToPolygon + segmentLabel remain exported from roofOverlay.js —
// Phase 3b will re-import them when we render segment polygons for panel placement.

// Fallback panel dimensions used when a catalogue row has no length_mm/width_mm
// populated yet (older SKUs). Rep can still drop the panel and it renders at a
// typical residential-mono size (~1755 × 1038 mm — approx a 400W Q.PEAK).
const DEFAULT_PANEL_LENGTH_MM = 1755;
const DEFAULT_PANEL_WIDTH_MM  = 1038;

// Fallback tile radius when the roof_analyses row has no stored value
// (pre-Migration-040 rows). Modern rows include tile_radius_m and the client
// uses that instead — see radiusForAnalysis().
const FALLBACK_TILE_RADIUS_METERS = 50;

// Threshold — if the stored tile is bigger than this, we trigger a refetch
// on load to upgrade the row in place. Must match REFETCH_TIGHT_THRESHOLD_M
// on the server (server refuses to refetch if already ≤20m).
const REFETCH_THRESHOLD_METERS = 20;

function radiusForAnalysis(roofAnalysis) {
  const stored = Number(roofAnalysis?.tile_radius_m);
  return Number.isFinite(stored) && stored > 0 ? stored : FALLBACK_TILE_RADIUS_METERS;
}

// Convert a Fabric scene-space pointer to WGS84 lat/lng using the aerial
// image's current transform. Shared by trace-vertex placement (Phase 3b.3)
// and panel drop (Phase 3b.4). Returns null if the image isn't ready.
function canvasToLatLng(scenePoint, img, roof) {
  if (!img || !roof) return null;
  const scale = img.scaleX || 1;
  const imgPxX = (scenePoint.x - (img.left || 0)) / scale;
  const imgPxY = (scenePoint.y - (img.top  || 0)) / scale;
  const toLatLng = makePixelToLatLng({
    centerLat:    Number(roof.latitude),
    centerLng:    Number(roof.longitude),
    radiusMeters: radiusForAnalysis(roof),
    imgWidth:  img.width,
    imgHeight: img.height,
  });
  return toLatLng(imgPxX, imgPxY);
}

// Fabric.js v6+ changed the default originX/originY from 'left'/'top' to
// 'center'/'center'. Our coordinate math assumes top-left origin (canvas coord
// (0,0) = top-left of the canvas), so we MUST set origin explicitly on every
// object we position with .left/.top. Otherwise Fabric places the object's
// centre at (.left, .top), which put most of the image off-canvas and made
// Fabric auto-adjust the viewport to compensate — the root cause of the
// entire debugging saga around markers landing in the bottom-right corner.
const TL_ORIGIN = { originX: 'left', originY: 'top' };

// Autosave debounce — waits this long after last change before PUT.
const AUTOSAVE_DEBOUNCE_MS = 2000;

// Zoom bounds — Fabric will happily zoom to 0.001 or 1000 if we don't clamp.
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8.0;
const ZOOM_STEP = 1.2;

export default function DesignPage() {
  const { id: quoteId } = useParams();

  // Refs — Fabric canvas + parent container for responsive sizing
  const canvasElRef = useRef(null);        // <canvas> DOM element
  const canvasRef = useRef(null);          // fabric.Canvas instance
  const containerRef = useRef(null);       // parent div for width/height
  const stateRef = useRef(null);           // latest design state (for autosave capture)
  const versionRef = useRef(0);            // latest saved version (for optimistic concurrency)
  const roofImgRef = useRef(null);         // fabric.Image of the roof (kept across resizes)
  const overlayObjectsRef = useRef([]);    // segment polygons + labels + crosshair
  const ghostPanelRef = useRef(null);      // Phase 3b.9 — live snap-preview panel while armed
  const hideGhostPanelRef = useRef(null);  // exposed so armed-off / drop paths can dismiss it
  const roofAnalysisRef = useRef(null);    // stable roof analysis for re-layout
  const hasAutoZoomedRef = useRef(false);  // only auto-zoom to roof on first layout
  const layoutAndDrawRef = useRef(null);   // callable from the image-load effect

  // UI state
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [quote, setQuote] = useState(null);
  const [currentVersion, setCurrentVersion] = useState(null);
  const [roofAnalysis, setRoofAnalysis] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [zoomDisplay, setZoomDisplay] = useState(1.0);
  const [dirty, setDirty] = useState(false);
  const [refetching, setRefetching] = useState(false);   // background tile upgrade
  const [faceCount, setFaceCount] = useState(0);         // reactive mirror of state.roof.faces.length
  const [importingSegments, setImportingSegments] = useState(false);
  // Phase 3b.3 — manual roof-face tracing
  const [isTracing, setIsTracing] = useState(false);
  const [traceVertexCount, setTraceVertexCount] = useState(0);
  const isTracingRef = useRef(false);                    // synced from React state; ref for mouse handler
  const traceVerticesRef = useRef([]);                   // {latitude, longitude} array being built
  const finishTraceRef = useRef(null);                   // dblclick handler calls the latest finishTrace via this ref

  // Phase 3b.4 — panel palette + drop
  const { options: catalogue, loading: catalogueLoading, error: catalogueError } = useCatalogueOptions();
  const [armedPanelSku, setArmedPanelSku] = useState(null);   // sku the next click drops
  const armedPanelSkuRef = useRef(null);                      // stable read for mouse handler
  const [panelCount, setPanelCount] = useState(0);            // reactive mirror of state.panels.length
  const [totalKw, setTotalKw]       = useState(0);            // reactive mirror of totalKilowatts()
  const [totalKwh, setTotalKwh]     = useState(0);            // reactive mirror of totalAnnualKwh()

  // Phase 3b.7 (part) + 3b.9 — panel selection is now a multi-set to support
  // array creation (Shift+click adds/removes). Single-panel actions (drag, R,
  // delete-one) still work when exactly one panel is selected; multi-panel
  // actions (create array, delete-all) work with any non-empty selection.
  const [selectedPanelIds, setSelectedPanelIds] = useState([]);
  const selectedPanelIdsRef = useRef([]);

  // Phase 3b.9 — delete-face mode. When active, the next click on a face
  // polygon deletes that face (with confirm). Sidebar face list also has
  // per-row delete buttons. Both paths run removeFace() which cascades
  // panel + array removal via designState's helper.
  const [isDeletingFace, setIsDeletingFace] = useState(false);
  const isDeletingFaceRef = useRef(false);
  useEffect(() => { isDeletingFaceRef.current = isDeletingFace; }, [isDeletingFace]);

  // Phase 3c — obstruction placement. armedObstructionType is the type the
  // next canvas click will drop (chimney/skylight/vent/satellite/hvac/other).
  // Uses OBSTRUCTION_DEFAULTS from designState for per-type exclusion radius.
  // Rule engine (checkPanelDropRules from 3b.8) already refuses panel drops
  // that penetrate an obstruction radius — this UI adds the ability to place
  // them in the first place.
  const [armedObstructionType, setArmedObstructionType] = useState(null);
  const armedObstructionTypeRef = useRef(null);
  useEffect(() => { armedObstructionTypeRef.current = armedObstructionType; }, [armedObstructionType]);
  // Esc un-arms obstruction placement so the rep can back out without
  // clicking anywhere on the aerial.
  useEffect(() => {
    if (!armedObstructionType) return;
    const onKey = (e) => { if (e.key === 'Escape') setArmedObstructionType(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armedObstructionType]);

  const dropObstructionAt = useCallback((type, latLng) => {
    if (!OBSTRUCTION_DEFAULTS[type]) return;
    try {
      const obst = makeObstruction({
        type,
        center: latLng,
        radiusMetres: OBSTRUCTION_DEFAULTS[type].radiusMetres,
        note: OBSTRUCTION_DEFAULTS[type].note || '',
      });
      stateRef.current = addObstruction(stateRef.current, obst);
      setDirty(true);
      layoutAndDrawRef.current?.();
    } catch (err) {
      console.warn('[DesignPage] failed to place obstruction:', err?.message || err);
    }
  }, []);

  const deleteObstructionById = useCallback((obstId) => {
    stateRef.current = removeObstruction(stateRef.current, obstId);
    setDirty(true);
    layoutAndDrawRef.current?.();
    // Force re-render — obstructions live on stateRef which React can't see.
    setSelectedPanelIds(prev => [...prev]);
  }, []);

  // Phase 3b.8 — drop-rule rejection hint. Shows a brief toast when a drop
  // is rejected so the rep sees WHY nothing happened. Auto-dismisses.
  const [dropRejectReason, setDropRejectReason] = useState(null);
  const dropRejectTimerRef = useRef(null);
  const flashDropReject = useCallback((reason) => {
    setDropRejectReason(reason);
    if (dropRejectTimerRef.current) clearTimeout(dropRejectTimerRef.current);
    dropRejectTimerRef.current = setTimeout(() => setDropRejectReason(null), 2500);
  }, []);
  useEffect(() => () => {
    if (dropRejectTimerRef.current) clearTimeout(dropRejectTimerRef.current);
  }, []);

  // Phase 3e (cleanup) — accordion collapse state for the three sidebar list
  // sections (Roof faces, Arrays, Obstructions). Palette stays always
  // expanded (primary tool). Defaults to COLLAPSED even when populated so
  // the palette gets the room by default; rep clicks a chevron to peek.
  const [sectionOpen, setSectionOpen] = useState({
    faces: false, arrays: false, obstructions: false,
  });
  const toggleSection = useCallback((k) => {
    setSectionOpen(prev => ({ ...prev, [k]: !prev[k] }));
  }, []);
  // Panel-catalogue lookup by SKU — Map so palette + drop + overlay all share
  // the same shape. Rebuilt whenever the catalogue reloads.
  const panelCatalogueBySku = useMemo(() => {
    const m = new Map();
    for (const p of catalogue?.panels || []) m.set(p.sku, p);
    return m;
  }, [catalogue]);
  const panelCatalogueRef = useRef(panelCatalogueBySku);
  useEffect(() => { panelCatalogueRef.current = panelCatalogueBySku; }, [panelCatalogueBySku]);

  // ── Load quote + roof analysis + existing design ───────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        // 1. Load the quote (need contact_id for the roof lookup).
        // API returns { quote, current_version, pending_discount }. The header
        // customer/address display reads from current_version.spec.customer
        // (that's where the canonical, up-to-date customer data lives — the
        // top-level `quotes` row has no spec column).
        const qResp = await pmQuotesAPI.get(quoteId);
        if (cancelled) return;
        const q = qResp.data?.quote;
        setQuote(q);
        setCurrentVersion(qResp.data?.current_version || null);

        // 2. Load roof analysis (best-effort — may be 204 if no scan).
        if (q?.contact_id) {
          const rResp = await pmContactsAPI.latestRoofAnalysis(q.contact_id);
          if (cancelled) return;
          if (rResp.status === 200) {
            setRoofAnalysis(rResp.data);

            // Migration 040: if the stored tile is too wide (or null =
            // pre-migration), upgrade to a tight tile in the background.
            // Fire-and-forget: the design page renders with whatever data
            // we already have, and re-renders when the refetch completes.
            const currentRadius = Number(rResp.data.tile_radius_m);
            const needsUpgrade  = !Number.isFinite(currentRadius) || currentRadius > REFETCH_THRESHOLD_METERS;
            if (needsUpgrade) {
              setRefetching(true);
              pmDesignsAPI.refetchRoofImage(quoteId)
                .then(async refetchResp => {
                  if (cancelled) return;
                  if (refetchResp.status === 200) {
                    // Reload the analysis to get the fresh signed URL + radius
                    const freshResp = await pmContactsAPI.latestRoofAnalysis(q.contact_id);
                    if (cancelled) return;
                    if (freshResp.status === 200) setRoofAnalysis(freshResp.data);
                  }
                  // 204/404/etc — silent; we already have a usable tile
                })
                .catch(err => {
                  console.warn('[DesignPage] roof refetch failed (non-fatal):', err?.message || err);
                })
                .finally(() => { if (!cancelled) setRefetching(false); });
            }
          }
        }

        // 3. Load existing design (may be 204 if never designed).
        // migrateDesignState fills in Phase 3b's roof/panels/arrays sections
        // if the saved state predates Migration 041 (schemaVersion < 2), so
        // downstream code can always assume the current shape.
        const dResp = await pmDesignsAPI.get(quoteId);
        if (cancelled) return;
        if (dResp.status === 200) {
          stateRef.current = migrateDesignState(dResp.data.state);
          versionRef.current = dResp.data.version;
          setLastSavedAt(dResp.data.updated_at);
        } else {
          // No design yet — synthesise a blank Phase 3b state for the client
          stateRef.current = emptyDesignState();
          versionRef.current = 0;
        }
        // Mirror face count into React state so UI conditionals react on
        // load AND on subsequent mutations (see importFromGoogle below).
        setFaceCount(stateRef.current?.roof?.faces?.length ?? 0);
        // Phase 3b.4 — mirror panel count + total kW so the footer reflects
        // the design's actual state after loading a previously-saved design.
        setPanelCount(stateRef.current?.panels?.length ?? 0);
        setTotalKw(totalKilowatts(stateRef.current, panelCatalogueRef.current));
        setTotalKwh(totalAnnualKwh(stateRef.current, panelCatalogueRef.current));
      } catch (e) {
        if (!cancelled) setLoadError(e.response?.data?.error || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [quoteId]);

  // ── Serialize the current design state into the save payload ───────────
  // MUST spread `stateRef.current` so that Phase 3b sections (roof.faces,
  // roof.obstructions, panels, arrays, schemaVersion) survive the round-trip.
  // A previous version returned only { view, canvas } — a Phase 3a artefact
  // from when there was no data model — which silently wiped every traced
  // face and dropped panel 2 s after the autosave debounce fired. The
  // symptom was maddening: the Fabric polygon stayed drawn on screen (old
  // canvas render, not re-drawn) while stateRef.current lost all faces,
  // so subsequent clicks reported "no face contains this point" and
  // couldn't drop panels.
  const captureCanvasState = useCallback(() => {
    const base = stateRef.current || emptyDesignState();
    const canvas = canvasRef.current;
    const view = canvas
      ? {
          zoom: canvas.getZoom(),
          panX: canvas.viewportTransform?.[4] ?? 0,
          panY: canvas.viewportTransform?.[5] ?? 0,
        }
      : base.view;
    const canvasSerialized = canvas
      ? JSON.stringify(canvas.toJSON())
      : base.canvas?.serialized ?? null;
    return {
      ...base,
      view,
      canvas: { serialized: canvasSerialized },
    };
  }, []);

  // ── Save (used by manual button + debounced autosave) ──────────────────
  const doSave = useCallback(async () => {
    if (saving) return;   // let the in-flight save finish; autosave will re-fire
    setSaving(true);
    setSaveError('');
    try {
      const state = captureCanvasState();
      const resp = await pmDesignsAPI.save(quoteId, {
        state,
        version: versionRef.current,
      });
      stateRef.current = resp.data.state;
      versionRef.current = resp.data.version;
      setLastSavedAt(resp.data.updated_at);
      setDirty(false);
    } catch (e) {
      // 409 = version mismatch — surface loudly so user reloads before continuing.
      if (e.response?.status === 409) {
        setSaveError(
          `Design was modified elsewhere (server v${e.response.data.server_version}, you have v${e.response.data.client_version}). Reload before saving.`
        );
      } else {
        setSaveError(e.response?.data?.error || e.message);
      }
    } finally {
      setSaving(false);
    }
  }, [quoteId, saving, captureCanvasState]);

  // ── Autosave — debounce dirty flag; re-arm timer on every change ───────
  useEffect(() => {
    if (!dirty || loading) return;
    const t = setTimeout(() => { doSave(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [dirty, loading, doSave]);

  // ── Set browser tab title so multi-tab workflows are readable ──────────
  useEffect(() => {
    const name = customerName(quote, currentVersion);
    const ref  = quote?.quote_ref;
    document.title = name && ref ? `Design · ${name} (${ref}) — Goldenray`
                    : ref        ? `Design · ${ref} — Goldenray`
                    :              'Design layout — Goldenray';
    return () => { document.title = 'Goldenray'; };
  }, [quote, currentVersion]);

  // Keep the latest roofAnalysis available to the layout function without
  // re-running the whole init effect on every roofAnalysis change.
  // Also reset the auto-zoom guard so a refetched (tighter) tile gets
  // re-fitted properly on the next layoutAndDraw call.
  useEffect(() => {
    roofAnalysisRef.current = roofAnalysis;
    hasAutoZoomedRef.current = false;
  }, [roofAnalysis]);

  // Sync isTracing → isTracingRef so mouse:down (a stable closure inside the
  // canvas-init effect) can check the current tracing state without re-binding.
  useEffect(() => { isTracingRef.current = isTracing; }, [isTracing]);

  // Sync armedPanelSku → ref so the stable mouse:down closure can read it
  // without needing to re-bind on every arm/unarm. On un-arm, dismiss any
  // ghost-panel preview that was following the mouse.
  useEffect(() => {
    armedPanelSkuRef.current = armedPanelSku;
    if (!armedPanelSku) hideGhostPanelRef.current?.();
  }, [armedPanelSku]);

  // Sync selectedPanelIds → ref (same reason: keydown/mouse handlers need
  // the latest value without re-binding the listener on every selection
  // change) AND update the panels' fill/stroke IN PLACE so highlights
  // update without a full layoutAndDraw pass.
  //
  // BUG (fixed): calling layoutAndDraw here destroyed and recreated every
  // panel Fabric object on click. Fabric's built-in drag started on
  // mouse:down but its _currentTransform ended up pointing at a removed
  // object once our sync effect fired, so mouse:move produced no visible
  // motion. In-place restyle keeps the same Fabric object identity so the
  // native drag survives every selection tick.
  useEffect(() => {
    selectedPanelIdsRef.current = selectedPanelIds;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const selectedSet = new Set(selectedPanelIds);
    let touched = false;
    for (const obj of overlayObjectsRef.current) {
      const panelId = obj?.data?.panelId;
      if (!panelId) continue;
      const shouldBeSelected = selectedSet.has(panelId);
      const alreadySelected = obj.data.isSelectedVisual === true;
      if (shouldBeSelected === alreadySelected) continue;
      // Fabric.Group children[0] is the panel body Rect; children[1] is the busbar Line.
      const body = obj._objects?.[0];
      if (body) {
        body.set({
          fill:   shouldBeSelected ? 'rgba(56, 189, 248, 0.75)' : 'rgba(15, 29, 58, 0.90)',
          stroke: shouldBeSelected ? '#38BDF8' : '#C4C9D4',
          strokeWidth: shouldBeSelected ? 2.5 : 1.2,
        });
      }
      obj.set('hoverCursor', shouldBeSelected ? 'move' : 'pointer');
      obj.data.isSelectedVisual = shouldBeSelected;
      obj.setCoords();
      touched = true;
    }
    if (touched) canvas.requestRenderAll();
  }, [selectedPanelIds]);

  // Recompute total kW when the catalogue arrives after the design has loaded.
  // Wattage lives in the catalogue (not the panel entity), so a design that
  // loaded before the catalogue would otherwise show 0 kW until the next drop.
  useEffect(() => {
    if (loading) return;
    setTotalKw(totalKilowatts(stateRef.current, panelCatalogueBySku));
    setTotalKwh(totalAnnualKwh(stateRef.current, panelCatalogueBySku));
  }, [panelCatalogueBySku, loading]);

  // Esc un-arms the panel. Separate effect from the tracing Esc handler so
  // pressing Esc while both are active un-arms the panel first (matches the
  // trace flow: cancel trace to leave tracing mode, then Esc again to un-arm).
  useEffect(() => {
    if (!armedPanelSku || isTracing) return;
    const onKey = (e) => { if (e.key === 'Escape') setArmedPanelSku(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armedPanelSku, isTracing]);

  // Phase 3b.7 (part) — delete the selected panel via keyboard.
  // Delete + Backspace both work (macOS reps use Backspace, Windows uses Delete).
  // Esc deselects without deleting. Guarded against typing in text inputs
  // (search boxes, notes) so we don't nuke a panel while the rep is typing.
  // Deletes ALL currently-selected panels (Phase 3b.9 multi-select). Runs
  // removePanel per id — the helper already cascades panelIds through
  // state.arrays[] and drops arrays that end up empty.
  const deleteSelectedPanel = useCallback(() => {
    const ids = selectedPanelIdsRef.current || [];
    if (ids.length === 0) return;
    let next = stateRef.current;
    for (const id of ids) next = removePanel(next, id);
    stateRef.current = next;
    setPanelCount(next.panels.length);
    setTotalKw(totalKilowatts(next, panelCatalogueRef.current));
    setTotalKwh(totalAnnualKwh(next, panelCatalogueRef.current));
    setSelectedPanelIds([]);
    setDirty(true);
    layoutAndDrawRef.current?.();
  }, []);

  // Phase 3b.7 — toggle the selected panel's orientation (portrait ↔ landscape).
  // Runs the SAME rule check as a fresh drop; if the toggled dims push the
  // panel over a face edge or into an existing panel, we revert with a
  // reject-toast instead of leaving the design in an invalid state.
  const toggleSelectedPanelOrientation = useCallback(() => {
    const ids = selectedPanelIdsRef.current || [];
    // Only meaningful for a single-panel selection; multi-select users can
    // deselect all but one and try again.
    if (ids.length !== 1) return;
    const id = ids[0];
    const st = stateRef.current;
    const panel = st?.panels?.find(p => p.id === id);
    if (!panel) return;
    const face = st?.roof?.faces?.find(f => f.id === panel.faceId);
    if (!face) return;
    const nextOrientation = panel.orientation === 'portrait' ? 'landscape' : 'portrait';
    const spec = panelCatalogueRef.current?.get?.(panel.sku);
    const stateSansSelf = { ...st, panels: st.panels.filter(p => p.id !== id) };
    const check = checkPanelDropRules({
      state: stateSansSelf,
      face,
      panelCenter: panel.center,
      panelLengthMm: Number(spec?.length_mm) || DEFAULT_PANEL_LENGTH_MM,
      panelWidthMm:  Number(spec?.width_mm)  || DEFAULT_PANEL_WIDTH_MM,
      orientation: nextOrientation,
      setbackMetres: Number.isFinite(face?.setbackMetres) ? face.setbackMetres : DEFAULT_FACE_SETBACK_M,
      panelCatalogueBySku: panelCatalogueRef.current,
    });
    if (!check.ok) {
      flashDropReject(check.reason);
      return;
    }
    stateRef.current = {
      ...st,
      panels: st.panels.map(p => p.id === id ? { ...p, orientation: nextOrientation } : p),
    };
    setDirty(true);
    layoutAndDrawRef.current?.();
  }, [flashDropReject]);

  useEffect(() => {
    if (selectedPanelIds.length === 0) return;
    const onKey = (e) => {
      // Ignore key events fired while the rep is typing in a text field.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedPanel();
      } else if (e.key === 'Escape') {
        setSelectedPanelIds([]);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        toggleSelectedPanelOrientation();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPanelIds, deleteSelectedPanel, toggleSelectedPanelOrientation]);

  // ── Phase 3b.9 — array creation + management ───────────────────────────
  // Suggest a default array name based on the face's compass direction so the
  // rep doesn't have to think about naming ("North array", "SW array"). Falls
  // back to a running index when the panels span multiple faces.
  const suggestArrayName = useCallback((panelIds) => {
    const st = stateRef.current;
    if (!st) return `Array ${((st?.arrays?.length ?? 0) + 1)}`;
    const facesTouched = new Set();
    for (const pid of panelIds) {
      const panel = st.panels.find(p => p.id === pid);
      if (panel) facesTouched.add(panel.faceId);
    }
    if (facesTouched.size === 1) {
      const face = st.roof.faces.find(f => f.id === [...facesTouched][0]);
      const compass = azimuthToCompass(face?.azimuthDegrees);
      if (compass) return `${compass} array`;
    }
    return `Array ${(st.arrays?.length ?? 0) + 1}`;
  }, []);

  const createArrayFromSelection = useCallback(() => {
    const ids = selectedPanelIdsRef.current || [];
    if (ids.length === 0) return;
    const defaultName = suggestArrayName(ids);
    // eslint-disable-next-line no-alert
    const name = typeof window !== 'undefined'
      ? window.prompt('Name this array', defaultName)
      : defaultName;
    if (name == null) return;   // rep cancelled
    const trimmed = name.trim() || defaultName;
    try {
      const arr = makeArray({ name: trimmed, panelIds: [...ids] });
      stateRef.current = addArray(stateRef.current, arr);
      setDirty(true);
      setSelectedPanelIds([]);   // selection consumed by the new array
      layoutAndDrawRef.current?.();
    } catch (err) {
      console.warn('[DesignPage] failed to create array:', err?.message || err);
    }
  }, [suggestArrayName]);

  const selectArrayPanels = useCallback((arrayId) => {
    const st = stateRef.current;
    const arr = st?.arrays?.find(a => a.id === arrayId);
    if (!arr) return;
    setSelectedPanelIds([...arr.panelIds]);
  }, []);

  const deleteArrayKeepPanels = useCallback((arrayId) => {
    stateRef.current = removeArray(stateRef.current, arrayId);
    setDirty(true);
    layoutAndDrawRef.current?.();
    // Force re-render of the arrays list — arrays live in stateRef so React
    // needs a nudge. A no-op set on selectedPanelIds fires the sync effect.
    setSelectedPanelIds(prev => [...prev]);
  }, []);

  // Phase 3b.9 — destructive counterpart: remove every panel in the array
  // (each removePanel call cascades through remaining arrays too). Used by
  // the "Delete panels" branch of the array-row confirm dialog.
  // Phase 3e — one-click import of Google's suggested panel layout.
  // Google returns solarPotential.solarPanels[] with every position their
  // shading model considers usable. We drop them all as design panels
  // grouped into per-face arrays (Segment 1 array, Segment 2 array, ...).
  // Rep then trims to hit target kW — the trailing panels are the worst-
  // shaded because Google pre-sorts by yearlyEnergyDcKwh DESC.
  //
  // TRUE one-click: if Google's segments haven't been imported as faces
  // yet, we import them first (via importGoogleSegments, same call the
  // separate "📐 Trace from Google" button uses). Rep doesn't have to
  // remember two buttons in the right order.
  const importGoogleLayoutHandler = useCallback(() => {
    const sku = armedPanelSkuRef.current;
    if (!sku) {
      setDropRejectReason('Arm a panel from the palette first, then click Use Google\'s layout.');
      if (dropRejectTimerRef.current) clearTimeout(dropRejectTimerRef.current);
      dropRejectTimerRef.current = setTimeout(() => setDropRejectReason(null), 3500);
      return;
    }
    const googlePanels = roofAnalysisRef.current?.solar_panels;
    if (!Array.isArray(googlePanels) || googlePanels.length === 0) {
      setDropRejectReason('Google didn\'t return a panel layout for this property.');
      if (dropRejectTimerRef.current) clearTimeout(dropRejectTimerRef.current);
      dropRejectTimerRef.current = setTimeout(() => setDropRejectReason(null), 3500);
      return;
    }
    // Confirm if design already has panels — this is additive, not replacing.
    const existingPanels = stateRef.current?.panels?.length || 0;
    if (existingPanels > 0) {
      // eslint-disable-next-line no-alert
      const yes = typeof window !== 'undefined' && window.confirm(
        `You already have ${existingPanels} panel${existingPanels === 1 ? '' : 's'} placed. Adding ${googlePanels.length} more from Google's suggested layout. Continue?`
      );
      if (!yes) return;
    }

    // Auto-import Google's segments as faces ONLY when the design has zero
    // faces. If the rep already has manual traces, importing Google's faces
    // on top produces visually-stacked outlines (their manual polygon + our
    // Google bbox polygon over the same roof). If they want Google's shape
    // instead, they should delete their manual faces first.
    const allFaceCount = (stateRef.current?.roof?.faces || []).length;
    let facesAutoImported = 0;
    if (allFaceCount === 0) {
      const segments = roofAnalysisRef.current?.roof_segments;
      if (Array.isArray(segments) && segments.length > 0) {
        stateRef.current = importGoogleSegments(stateRef.current, segments);
        facesAutoImported = (stateRef.current?.roof?.faces || [])
          .filter(f => f?.source === 'google_solar').length;
        setFaceCount(stateRef.current.roof.faces.length);
      }
    }

    const result = importGooglePanels({
      state: stateRef.current,
      googlePanels,
      sku,
      panelCatalogueBySku: panelCatalogueRef.current,
    });
    stateRef.current = result.state;
    setPanelCount(stateRef.current.panels.length);
    setTotalKw(totalKilowatts(stateRef.current, panelCatalogueRef.current));
    setTotalKwh(totalAnnualKwh(stateRef.current, panelCatalogueRef.current));
    setDirty(true);
    setSelectedPanelIds([]);
    layoutAndDrawRef.current?.();
    let summary;
    if (result.imported === 0) {
      summary = allFaceCount > 0 && facesAutoImported === 0
        ? `Google's panels reference segments we didn't auto-import (you already have manual faces). Delete manual faces + retry, or use 📐 Trace from Google to import Google's own faces first.`
        : `Couldn't import any panels — try tracing faces first.`;
    } else {
      const parts = [`Imported ${result.imported} panel${result.imported === 1 ? '' : 's'}`];
      if (facesAutoImported > 0) parts.push(`across ${facesAutoImported} auto-imported face${facesAutoImported === 1 ? '' : 's'}`);
      parts.push(`into ${result.arraysCreated} array${result.arraysCreated === 1 ? '' : 's'}`);
      if (result.skipped > 0) {
        // Break the skipped count down by reason so the rep knows if their
        // SKU is too big vs the layout being unlucky.
        const reasonBits = [];
        for (const [reason, count] of result.skippedReasons || []) {
          reasonBits.push(`${count} ${reason}`);
        }
        const detail = reasonBits.length ? ` — ${reasonBits.join(', ')}` : '';
        parts.push(`(${result.skipped} skipped${detail})`);
        if ((result.skippedReasons?.get('overlap-panel') || 0) > 0) {
          parts.push(`— your armed SKU may be bigger than Google's assumed panel; try a smaller SKU for a denser layout`);
        }
      }
      summary = parts.join(' ') + '.';
    }
    setDropRejectReason(summary);
    if (dropRejectTimerRef.current) clearTimeout(dropRejectTimerRef.current);
    dropRejectTimerRef.current = setTimeout(() => setDropRejectReason(null), 5000);
  }, []);

  // Phase 3b.13 — auto-fill a face with the currently-armed panel SKU.
  // One click drops every panel that fits (respecting setback, overlap,
  // obstruction) and groups them into a new array named after the face
  // direction. Requires an armed SKU — pops a hint via the reject-toast
  // slot if the rep hasn't picked one yet.
  const autoFillFaceHandler = useCallback((faceId) => {
    const sku = armedPanelSkuRef.current;
    if (!sku) {
      setDropRejectReason('Arm a panel first (click one in the palette), then Auto-fill.');
      if (dropRejectTimerRef.current) clearTimeout(dropRejectTimerRef.current);
      dropRejectTimerRef.current = setTimeout(() => setDropRejectReason(null), 3000);
      return;
    }
    const face = stateRef.current?.roof?.faces?.find(f => f.id === faceId);
    if (!face) return;
    const suggested = (typeof face.azimuthDegrees === 'number' && azimuthToCompass(face.azimuthDegrees))
      ? `${azimuthToCompass(face.azimuthDegrees)} array`
      : `Array ${(stateRef.current?.arrays?.length ?? 0) + 1}`;
    const result = autoLayoutFace({
      state: stateRef.current,
      faceId, sku,
      panelCatalogueBySku: panelCatalogueRef.current,
      gapMm: PANEL_GRID_GAP_MM,
      orientation: 'landscape',
      arrayName: suggested,
    });
    stateRef.current = result.state;
    setPanelCount(stateRef.current.panels.length);
    setTotalKw(totalKilowatts(stateRef.current, panelCatalogueRef.current));
    setTotalKwh(totalAnnualKwh(stateRef.current, panelCatalogueRef.current));
    setDirty(true);
    setSelectedPanelIds([]);
    layoutAndDrawRef.current?.();
    const msg = result.placed > 0
      ? `Auto-filled ${result.placed} panel${result.placed === 1 ? '' : 's'} on this face (new array "${suggested}").`
      : `Couldn't place any panels — face may be too small for the armed SKU or already full.`;
    setDropRejectReason(msg);
    if (dropRejectTimerRef.current) clearTimeout(dropRejectTimerRef.current);
    dropRejectTimerRef.current = setTimeout(() => setDropRejectReason(null), 4500);
  }, []);

  // Phase 3b.10 — copy an array's layout onto another face. Preserves
  // relative positions (source face-local (u,v) → target face-local (u,v)),
  // snaps each candidate onto the target's grid, rule-checks each drop,
  // and creates a new array on the target with the surviving panels.
  // Flashes a summary toast so the rep knows the outcome ("Copied 6 of 8;
  // 2 rejected: 1 setback, 1 outside-face").
  const copyArrayToTargetFace = useCallback((arrayId, targetFaceId) => {
    const result = copyArrayToFace({
      state: stateRef.current,
      arrayId,
      targetFaceId,
      panelCatalogueBySku: panelCatalogueRef.current,
      gapMm: PANEL_GRID_GAP_MM,
    });
    stateRef.current = result.state;
    setPanelCount(stateRef.current.panels.length);
    setTotalKw(totalKilowatts(stateRef.current, panelCatalogueRef.current));
    setTotalKwh(totalAnnualKwh(stateRef.current, panelCatalogueRef.current));
    setDirty(true);
    setSelectedPanelIds([]);
    layoutAndDrawRef.current?.();
    // Summarise the outcome for the rep. Uses the same toast slot as drop
    // rejections but with a bespoke message keyed by outcome shape.
    if (result.copied === 0 && result.skipped === 0) return;
    let summary;
    if (result.skipped === 0) {
      summary = `Copied ${result.copied} panel${result.copied === 1 ? '' : 's'} to the target face.`;
    } else if (result.copied === 0) {
      summary = `Couldn't copy any panels — target face is too small or already crowded.`;
    } else {
      const parts = [];
      for (const [reason, count] of result.reasonCounts) {
        const label = DROP_REASON_HUMAN[reason] ? reason.replace('-', ' ') : reason;
        parts.push(`${count} ${label}`);
      }
      summary = `Copied ${result.copied}, skipped ${result.skipped}${parts.length ? ' (' + parts.join(', ') + ')' : ''}.`;
    }
    // Reuse the drop-reject state for the toast; auto-dismisses via the
    // same timer. Adding a new state slot would be gratuitous.
    setDropRejectReason(summary);
    if (dropRejectTimerRef.current) clearTimeout(dropRejectTimerRef.current);
    dropRejectTimerRef.current = setTimeout(() => setDropRejectReason(null), 4500);
  }, []);

  const deleteArrayAndPanels = useCallback((arrayId) => {
    const st = stateRef.current;
    const arr = st?.arrays?.find(a => a.id === arrayId);
    if (!arr) return;
    let next = st;
    for (const pid of arr.panelIds) next = removePanel(next, pid);
    next = removeArray(next, arrayId);
    stateRef.current = next;
    setPanelCount(next.panels.length);
    setTotalKw(totalKilowatts(next, panelCatalogueRef.current));
    setTotalKwh(totalAnnualKwh(next, panelCatalogueRef.current));
    setDirty(true);
    setSelectedPanelIds([]);
    layoutAndDrawRef.current?.();
  }, []);

  // Phase 3b.9 — remove a face by id. Cascades panels + arrays via designState.
  // Confirms with the rep because a mis-click here nukes real work.
  const deleteFaceById = useCallback((faceId, opts = {}) => {
    const st = stateRef.current;
    const face = st?.roof?.faces?.find(f => f.id === faceId);
    if (!face) return;
    const panelsOnFace = (st.panels || []).filter(p => p.faceId === faceId).length;
    if (opts.confirm !== false) {
      const msg = panelsOnFace > 0
        ? `Delete this roof face and its ${panelsOnFace} panel${panelsOnFace === 1 ? '' : 's'}? This can't be undone.`
        : `Delete this roof face? This can't be undone.`;
      // eslint-disable-next-line no-alert
      const yes = typeof window !== 'undefined' ? window.confirm(msg) : true;
      if (!yes) return;
    }
    stateRef.current = removeFace(st, faceId);
    setFaceCount(stateRef.current.roof.faces.length);
    setPanelCount(stateRef.current.panels.length);
    setTotalKw(totalKilowatts(stateRef.current, panelCatalogueRef.current));
    setTotalKwh(totalAnnualKwh(stateRef.current, panelCatalogueRef.current));
    setDirty(true);
    setSelectedPanelIds([]);
    layoutAndDrawRef.current?.();
  }, []);

  // Esc exits delete-face mode (before it hits the selection-Esc handler).
  useEffect(() => {
    if (!isDeletingFace) return;
    const onKey = (e) => { if (e.key === 'Escape') setIsDeletingFace(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDeletingFace]);

  // ── Initialize Fabric once the DOM canvas + container are ready ────────
  useEffect(() => {
    if (loading || !canvasElRef.current || !containerRef.current) return;
    if (canvasRef.current) return;   // guard against double-init in strict mode

    const container = containerRef.current;
    // getBoundingClientRect gives the ACTUAL rendered size — clientWidth can
    // be stale during initial layout while flex is still settling.
    const initRect = container.getBoundingClientRect();

    const canvas = new fabric.Canvas(canvasElRef.current, {
      width:  initRect.width,
      height: initRect.height,
      backgroundColor: '#f1eddb',
      preserveObjectStacking: true,
      selection: false,   // phase 3a: no object selection yet
    });
    canvasRef.current = canvas;

    // Phase 3a: DO NOT restore saved viewport state. Persisting pan/zoom
    // across sessions caused a real bug — accumulated pan offsets pushed the
    // image + overlays off-centre. Viewport restoration belongs in Phase 3b
    // when there's actual design content (panels, roof faces) worth saving
    // — at that point we'll also bounds-check the restored view against the
    // current canvas size so old off-screen positions can't be re-applied.
    // For now the canvas always opens at identity (zoom=1, pan=0).

    // ── Layout function — runs on init AND on every container resize ──
    // Resizes the canvas to match the container, re-fits the roof image,
    // and redraws overlays at correct pixel positions. Called from the
    // ResizeObserver below so we don't care if the initial measure was
    // wrong (common when flex layout hasn't settled yet).
    const layoutAndDraw = () => {
      const c = canvasRef.current;
      const el = containerRef.current;
      if (!c || !el) return;
      // (defined here as a closure so it captures `canvas`; also exposed
      //  via layoutAndDrawRef so the image-load effect can invoke it.)

      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w <= 0 || h <= 0) return;

      if (c.getWidth() !== w || c.getHeight() !== h) {
        c.setDimensions({ width: w, height: h });
      }

      // Phase 3b.9 fix: release Fabric's internal grip on any active object
      // BEFORE we remove-and-recreate the overlay set. Without this, calling
      // c.remove() on the currently-active object (e.g. a panel the rep just
      // finished dragging) leaves it as a phantom on the canvas — Fabric
      // still tracks it via _activeObject/_currentTransform, so the "removed"
      // Group renders alongside the fresh replacement, producing visible
      // duplicates in different shades of blue (dragged copies stacking up
      // after every drag). Discarding first drops both trackers cleanly.
      if (c.getActiveObject && c.getActiveObject()) c.discardActiveObject();

      const img = roofImgRef.current;
      if (img) {
        const scale = Math.min(w / img.width, h / img.height);
        const left  = (w - img.width  * scale) / 2;
        const top   = (h - img.height * scale) / 2;
        img.set({ left, top, scaleX: scale, scaleY: scale });
        img.setCoords();

        // Clear old overlays, redraw at current transform.
        // Phase 3a's centre-crosshair "Customer property" marker was removed —
        // the LINZ tile is already centred on the customer's property and the
        // name/address show in the top bar, so the marker added no signal and
        // sat right on top of the roof the rep is trying to trace.
        for (const obj of overlayObjectsRef.current) c.remove(obj);
        // Phase 3b.2 — imported/manual roof faces (sage/amber outlines).
        // allPanels passed so overlayRoofFaces can fade the guide-outline
        // on faces that already have panels on them (Phase 3e cleanup).
        const facePolys = overlayRoofFaces({
          canvas: c,
          faces: stateRef.current?.roof?.faces || [],
          allPanels: stateRef.current?.panels || [],
          roofAnalysis: roofAnalysisRef.current,
          imgWidth: img.width, imgHeight: img.height,
          left, top, scale,
        });
        // Phase 3b.9 — snap-grid overlay REPLACED by a live "ghost panel"
        // preview that follows the mouse (see mouse:move handler below).
        // The grid was visually noisy on real roofs; the ghost shows exactly
        // where the panel WILL land, one shape not dozens of dashed lines.
        const gridObjs = [];
        // Phase 3c — obstruction exclusion circles (chimney, vent, skylight,
        // etc). Drawn BEFORE panels so panels visually stack on top of any
        // overlapping obstruction — helps the rep spot bad placements at a
        // glance. The rule engine still refuses drops that overlap, so
        // visible stacking should never actually persist in state.
        const obstructionObjs = overlayObstructions({
          canvas: c,
          obstructions: stateRef.current?.roof?.obstructions || [],
          roofAnalysis: roofAnalysisRef.current,
          imgWidth: img.width, imgHeight: img.height,
          left, top, scale,
        });

        // Phase 3b.4 — dropped panels (rectangles at real-world dimensions).
        // 3b.7/3b.9 — pass selectedPanelIds so ALL selected panels get the
        // highlight stroke/fill treatment (multi-select for array grouping).
        // 3b.11 — pass buildPanelLabelMap so each panel that belongs to an
        // array renders its "S1P3" auto-number label centred on top.
        const panelObjs = overlayPanels({
          canvas: c,
          panels: stateRef.current?.panels || [],
          panelCatalogueBySku: panelCatalogueRef.current,
          roofAnalysis: roofAnalysisRef.current,
          imgWidth: img.width, imgHeight: img.height,
          left, top, scale,
          selectedPanelIds: selectedPanelIdsRef.current,
          panelLabels: buildPanelLabelMap(stateRef.current),
        });
        // Phase 3b.3 — in-progress trace on top of everything.
        const traceObjects = overlayTraceInProgress({
          canvas: c,
          traceVertices: traceVerticesRef.current || [],
          roofAnalysis: roofAnalysisRef.current,
          imgWidth: img.width, imgHeight: img.height,
          left, top, scale,
        });
        overlayObjectsRef.current = [...facePolys, ...gridObjs, ...obstructionObjs, ...panelObjs, ...traceObjects];

        // First layout only: auto-zoom so the customer's roof fills the view.
        // Google Solar tile is 100m × 100m — much bigger than a typical NZ
        // house (~10–15m across) — so without zooming the roof would be a
        // tiny speck in the middle of neighbours' rooftops. We union the
        // roof segments' bounding boxes to get the roof's on-image extent,
        // then set the Fabric viewport to fit that bbox at ~70% of the
        // canvas. User can zoom out with the wheel/buttons to see context.
        if (!hasAutoZoomedRef.current) {
          const zoomApplied = autoZoomToRoof(
            c, roofAnalysisRef.current,
            img.width, img.height, left, top, scale, w, h,
          );
          if (zoomApplied) {
            setZoomDisplay(zoomApplied);
            hasAutoZoomedRef.current = true;
          }
        }
      }
      c.renderAll();
    };
    layoutAndDrawRef.current = layoutAndDraw;   // expose to image-load effect

    // ── Pan (drag) ─────────────────────────────────────────────────────
    let isPanning = false;
    let lastPosX = 0, lastPosY = 0;

    canvas.on('mouse:down', (opt) => {
      // Fabric v7 replaced canvas.getPointer(e) with getScenePoint(e) —
      // returns the pointer in world/scene coords (post viewport-transform),
      // which is what our image-space math expects. The old getPointer call
      // silently threw inside Fabric's event dispatch and no vertex was ever
      // added — a real crash swallowed by the framework.
      const pointer = canvas.getScenePoint(opt.e);

      // Phase 3c — obstruction placement intercepts first. When an
      // obstruction type is armed, any click on a traced face drops that
      // type's exclusion circle at the click point (no snap — obstructions
      // aren't grid-aligned). Clicks outside all faces are no-ops that keep
      // arm mode active (rep can zoom/pan and try again).
      if (armedObstructionTypeRef.current && !isTracingRef.current && !isDeletingFaceRef.current) {
        const img  = roofImgRef.current;
        const roof = roofAnalysisRef.current;
        if (img && roof) {
          const latLng = canvasToLatLng(pointer, img, roof);
          if (latLng) {
            const face = faceContainingPoint(stateRef.current, latLng.latitude, latLng.longitude);
            if (face) {
              dropObstructionAt(armedObstructionTypeRef.current, latLng);
              // Stay armed so the rep can drop multiple of the same type in
              // one go (typical: three vents on a roof). Esc or clicking the
              // 'Cancel' pill un-arms.
            }
          }
        }
        return;
      }

      // Phase 3b.9 — delete-face mode intercepts before anything else. Any
      // click on a face polygon (via point-in-polygon lookup) removes that
      // face after a confirm. Clicks outside all faces are no-ops that keep
      // delete mode active (rep can try again). We DON'T deselect the panel
      // set here — that's a UX bonus if the rep armed something first.
      if (isDeletingFaceRef.current && !isTracingRef.current) {
        const img  = roofImgRef.current;
        const roof = roofAnalysisRef.current;
        if (img && roof) {
          const latLng = canvasToLatLng(pointer, img, roof);
          if (latLng) {
            const face = faceContainingPoint(stateRef.current, latLng.latitude, latLng.longitude);
            if (face) {
              deleteFaceById(face.id);
              setIsDeletingFace(false);   // one-shot; rep re-arms if they want another
            }
          }
        }
        return;
      }

      // Phase 3b.7 + 3b.9 — click on a panel selects it (or toggles it in the
      // multi-selection with Shift/Ctrl held). Highest priority so it wins
      // over tracing/dropping/panning. Skipped while tracing so vertex
      // placement inside a face's overlay isn't hijacked by a stray panel.
      const clickedPanelId = opt.target?.data?.panelId;
      const nativeEvt = opt.e;
      const additive = nativeEvt && (nativeEvt.shiftKey || nativeEvt.ctrlKey || nativeEvt.metaKey);
      if (!isTracingRef.current && clickedPanelId) {
        const current = selectedPanelIdsRef.current || [];
        if (additive) {
          // Toggle this panel's membership in the selection.
          const next = current.includes(clickedPanelId)
            ? current.filter(id => id !== clickedPanelId)
            : [...current, clickedPanelId];
          setSelectedPanelIds(next);
        } else {
          // Replace the selection with just this panel.
          setSelectedPanelIds([clickedPanelId]);
        }
        return;
      }
      // Any click NOT on a panel deselects. Cheap way to give the rep
      // "click somewhere blank to deselect" behaviour without a modifier key.
      if ((selectedPanelIdsRef.current?.length ?? 0) > 0 && !clickedPanelId) {
        setSelectedPanelIds([]);
        // continue to the tracing/drop/pan branches — a click on empty roof
        // should also allow the next action (e.g. drop the armed panel).
      }

      // Phase 3b.3 — while tracing, clicks add polygon vertices instead of panning.
      // We read the ref (not React state) so this closure stays stable across renders.
      if (isTracingRef.current) {
        const img  = roofImgRef.current;
        const roof = roofAnalysisRef.current;
        if (!img || !roof) return;
        const latLng = canvasToLatLng(pointer, img, roof);
        if (!latLng) return;
        traceVerticesRef.current.push(latLng);
        setTraceVertexCount(traceVerticesRef.current.length);
        layoutAndDrawRef.current?.();
        return;   // don't initiate a pan
      }

      // Phase 3b.4 — when a panel is armed, click drops the panel on whichever
      // roof face contains the click. Missing-target case falls through to pan
      // so the rep isn't left wondering why nothing happened; we surface the
      // reason via the palette header hint ("Click on a traced roof face").
      if (armedPanelSkuRef.current) {
        const img  = roofImgRef.current;
        const roof = roofAnalysisRef.current;
        if (img && roof) {
          const latLng = canvasToLatLng(pointer, img, roof);
          if (latLng) {
            const face = faceContainingPoint(stateRef.current, latLng.latitude, latLng.longitude);
            if (face) {
              try {
                // Phase 3b.6 — snap the raw click to the face-aligned grid so
                // dropped panels tile edge-to-edge instead of overlapping at
                // arbitrary offsets. Grid origin = face centroid, axes rotated
                // by face azimuth, cell = panel dims + 20mm rail gap.
                const spec = panelCatalogueRef.current?.get?.(armedPanelSkuRef.current);
                const snappedCenter = snapToFaceGrid({
                  faceAzimuthDegrees: face.azimuthDegrees,
                  faceCentroid: polygonCentroidLL(face.polygon),
                  target: latLng,
                  panelLengthMm: Number(spec?.length_mm) || DEFAULT_PANEL_LENGTH_MM,
                  panelWidthMm:  Number(spec?.width_mm)  || DEFAULT_PANEL_WIDTH_MM,
                  orientation: 'landscape',
                  gapMm: PANEL_GRID_GAP_MM,
                });
                // Phase 3b.9 — removed the silent-dedup pre-check. It made
                // dropped-on-same-cell attempts vanish with no feedback (rep
                // clicks 3 spots, only 2 land, no toast explaining why). The
                // full rule engine below catches the identical case via
                // overlap-panel AND flashes a plain-English reason, which is
                // what the rep actually needs.

                // Phase 3b.8 — enforce setback + no-overlap + obstruction rules.
                // On rejection, flash a hint bar with the specific reason
                // so the rep doesn't wonder why nothing happened.
                const ruleCheck = checkPanelDropRules({
                  state: stateRef.current,
                  face,
                  panelCenter: snappedCenter,
                  panelLengthMm: Number(spec?.length_mm) || DEFAULT_PANEL_LENGTH_MM,
                  panelWidthMm:  Number(spec?.width_mm)  || DEFAULT_PANEL_WIDTH_MM,
                  orientation: 'landscape',
                  setbackMetres: Number.isFinite(face?.setbackMetres) ? face.setbackMetres : DEFAULT_FACE_SETBACK_M,
                  panelCatalogueBySku: panelCatalogueRef.current,
                });
                if (!ruleCheck.ok) {
                  flashDropReject(ruleCheck.reason);
                  return;
                }

                const panel = makePanel({
                  faceId: face.id,
                  sku: armedPanelSkuRef.current,
                  center: snappedCenter,
                  rotationDegrees: typeof face.azimuthDegrees === 'number' ? face.azimuthDegrees : 0,
                  orientation: 'landscape',
                });
                stateRef.current = addPanel(stateRef.current, panel);
                setPanelCount(stateRef.current.panels.length);
                setTotalKw(totalKilowatts(stateRef.current, panelCatalogueRef.current));
                setTotalKwh(totalAnnualKwh(stateRef.current, panelCatalogueRef.current));
                setDirty(true);
                // Dismiss the ghost so we don't render both the ghost and the
                // freshly-dropped panel at the same spot (mouse:move will
                // re-render the ghost at the next cell as the pointer moves).
                hideGhostPanelRef.current?.();
                layoutAndDrawRef.current?.();
              } catch (err) {
                console.warn('[DesignPage] failed to drop panel:', err?.message || err);
              }
              return;   // don't initiate a pan
            }
          }
        }
        // No face under the click — fall through to pan so the drag still works;
        // the palette header already tells the rep to click a traced face.
      }

      const evt = opt.e;
      isPanning = true;
      canvas.setCursor('grabbing');
      canvas.defaultCursor = 'grabbing';
      lastPosX = evt.clientX;
      lastPosY = evt.clientY;
    });

    // Double-click finishes an in-progress trace. The dblclick fires a
    // preceding single-click (which adds a vertex) — that's fine; the finish
    // handler ignores traces with <3 vertices, and users double-click AFTER
    // they've placed all corners.
    canvas.on('mouse:dblclick', () => {
      if (!isTracingRef.current) return;
      if (traceVerticesRef.current.length < 3) return;
      // Delegate to the React-state-aware finishTrace (captured via ref).
      finishTraceRef.current?.();
    });

    canvas.on('mouse:move', (opt) => {
      // Phase 3b.9 — ghost panel preview. When a panel is armed and the
      // mouse is over a traced face, show a translucent panel at the exact
      // grid cell the click would drop into. Rep sees exactly where the
      // panel will land BEFORE they commit.
      if (armedPanelSkuRef.current && !isTracingRef.current && !isPanning) {
        maybeUpdateGhostPanel(opt);
      }

      if (!isPanning) return;
      const evt = opt.e;
      const vpt = canvas.viewportTransform;
      vpt[4] += evt.clientX - lastPosX;
      vpt[5] += evt.clientY - lastPosY;
      canvas.requestRenderAll();
      lastPosX = evt.clientX;
      lastPosY = evt.clientY;
    });

    // Hide the ghost when the pointer leaves the canvas (rep moved to sidebar
    // to change SKU, etc.) so it doesn't get stuck at the last hover point.
    canvas.on('mouse:out', (opt) => {
      // Fabric fires mouse:out for both canvas-leave AND object hover-out.
      // We only care about the canvas-level event (opt.target is null).
      if (opt.target == null) hideGhostPanel();
    });

    canvas.on('mouse:up', () => {
      if (!isPanning) return;
      isPanning = false;
      canvas.defaultCursor = 'grab';
      canvas.setCursor('grab');
      // Persist viewport back into transform (Fabric needs this after direct vpt mutation).
      canvas.setViewportTransform(canvas.viewportTransform);
      // Phase 3a: pan doesn't dirty the design (viewport isn't persisted).
    });

    // ── Panel drag-to-move (Phase 3b.7) ────────────────────────────────
    // Fires when Fabric finishes a drag on a selectable object. We convert
    // the new canvas position → lat/lng → snap to face grid → run the same
    // drop-rule check used for fresh drops. If it fails, we flash the reason
    // and redraw to revert the visual (state.panels still has the ORIGINAL
    // centre because we only wrote after passing validation).
    // Phase 3b.9 — ghost panel helpers. Ghost is a single Fabric.Rect that
    // follows the mouse when a panel is armed, positioned at the SNAPPED
    // grid cell so the rep previews the exact drop before clicking. Rendered
    // green when the snap position passes rules, red when it would be
    // rejected (setback / overlap / outside-face). Hidden when armed but the
    // pointer is over empty area (no face under cursor).
    const hideGhostPanel = () => {
      if (ghostPanelRef.current) {
        canvas.remove(ghostPanelRef.current);
        ghostPanelRef.current = null;
        canvas.requestRenderAll();
      }
    };
    hideGhostPanelRef.current = hideGhostPanel;
    const maybeUpdateGhostPanel = (opt) => {
      const img  = roofImgRef.current;
      const roof = roofAnalysisRef.current;
      if (!img || !roof) { hideGhostPanel(); return; }
      const pointer = canvas.getScenePoint(opt.e);
      const latLng = canvasToLatLng(pointer, img, roof);
      if (!latLng) { hideGhostPanel(); return; }
      const face = faceContainingPoint(stateRef.current, latLng.latitude, latLng.longitude);
      if (!face) { hideGhostPanel(); return; }
      const sku = armedPanelSkuRef.current;
      const spec = panelCatalogueRef.current?.get?.(sku);
      const lenMm = Number(spec?.length_mm) || DEFAULT_PANEL_LENGTH_MM;
      const widMm = Number(spec?.width_mm)  || DEFAULT_PANEL_WIDTH_MM;
      const snappedCenter = snapToFaceGrid({
        faceAzimuthDegrees: face.azimuthDegrees,
        faceCentroid: polygonCentroidLL(face.polygon),
        target: latLng,
        panelLengthMm: lenMm, panelWidthMm: widMm,
        orientation: 'landscape',
        gapMm: PANEL_GRID_GAP_MM,
      });
      // Ask the rule engine if this snap would be valid — colours the ghost.
      const ruleCheck = checkPanelDropRules({
        state: stateRef.current, face,
        panelCenter: snappedCenter,
        panelLengthMm: lenMm, panelWidthMm: widMm,
        orientation: 'landscape',
        setbackMetres: Number.isFinite(face?.setbackMetres) ? face.setbackMetres : DEFAULT_FACE_SETBACK_M,
        panelCatalogueBySku: panelCatalogueRef.current,
      });
      const valid = ruleCheck.ok;

      // Convert snapped centre to canvas px + compute panel size in canvas px.
      const scale = img.scaleX || 1;
      const centerLatDeg = Number(roof?.latitude);
      const centerLngDeg = Number(roof?.longitude);
      const radiusMeters = radiusForAnalysis(roof);
      const toPixel = makeLatLngToPixel({
        centerLat: centerLatDeg, centerLng: centerLngDeg,
        radiusMeters, imgWidth: img.width, imgHeight: img.height,
      });
      const px = toPixel(snappedCenter.latitude, snappedCenter.longitude);
      const canvasX = (img.left || 0) + px.x * scale;
      const canvasY = (img.top  || 0) + px.y * scale;
      const metresToCanvasPx = (m) => (m / (2 * radiusMeters)) * img.width * scale;
      const wPx = metresToCanvasPx(lenMm / 1000);
      const hPx = metresToCanvasPx(widMm / 1000);
      const angle = typeof face.azimuthDegrees === 'number' ? face.azimuthDegrees : 0;

      // Create the ghost once, then update in place on subsequent moves.
      if (!ghostPanelRef.current) {
        const ghost = new fabric.Rect({
          left: canvasX, top: canvasY,
          originX: 'center', originY: 'center',
          width: wPx, height: hPx,
          angle,
          fill:   valid ? 'rgba(34, 197, 94, 0.35)'  : 'rgba(239, 68, 68, 0.35)',
          stroke: valid ? '#16A34A' : '#DC2626',
          strokeWidth: 2, strokeDashArray: [4, 4], strokeUniform: true,
          selectable: false, evented: false, excludeFromExport: true,
        });
        ghostPanelRef.current = ghost;
        canvas.add(ghost);
      } else {
        ghostPanelRef.current.set({
          left: canvasX, top: canvasY,
          width: wPx, height: hPx,
          angle,
          fill:   valid ? 'rgba(34, 197, 94, 0.35)'  : 'rgba(239, 68, 68, 0.35)',
          stroke: valid ? '#16A34A' : '#DC2626',
        });
        ghostPanelRef.current.setCoords();
        // Keep the ghost on top so it always shows through panels.
        canvas.bringObjectToFront?.(ghostPanelRef.current);
      }
      canvas.requestRenderAll();
    };

    // Helper: convert a panel's lat/lng centre to its canvas-space (x, y)
    // using the CURRENT image transform. Used by the drag handler to
    // reposition the same Fabric object in place (instead of destroying and
    // recreating via layoutAndDraw, which broke Fabric's transform lifecycle
    // mid-event — panel would stay attached to the mouse after "release").
    const panelCenterToCanvasPx = (centerLatLng, img, roof) => {
      const scale = img.scaleX || 1;
      const centerLat = Number(roof?.latitude);
      const centerLng = Number(roof?.longitude);
      const radiusMeters = radiusForAnalysis(roof);
      const toPixel = makeLatLngToPixel({
        centerLat, centerLng, radiusMeters,
        imgWidth: img.width, imgHeight: img.height,
      });
      const px = toPixel(centerLatLng.latitude, centerLatLng.longitude);
      return {
        x: (img.left || 0) + px.x * scale,
        y: (img.top  || 0) + px.y * scale,
      };
    };

    canvas.on('object:modified', (opt) => {
      const obj = opt.target;
      const panelId = obj?.data?.panelId;
      if (!panelId) return;
      const st = stateRef.current;
      const panel = st?.panels?.find(p => p.id === panelId);
      if (!panel) return;
      const face = st?.roof?.faces?.find(f => f.id === panel.faceId);
      const img  = roofImgRef.current;
      const roof = roofAnalysisRef.current;

      // Revert-in-place helper: snap this Fabric object back to whatever
      // `panel.center` says. Avoids full layoutAndDraw which would kill
      // Fabric's transform lifecycle before it finished cleaning up.
      const revert = () => {
        if (!img || !roof || !panel?.center) return;
        const px = panelCenterToCanvasPx(panel.center, img, roof);
        obj.set({ left: px.x, top: px.y });
        obj.setCoords();
        canvas.requestRenderAll();
      };
      if (!face || !img || !roof) { revert(); return; }

      const newLatLng = canvasToLatLng({ x: obj.left, y: obj.top }, img, roof);
      if (!newLatLng) { revert(); return; }

      const spec = panelCatalogueRef.current?.get?.(panel.sku);
      const snappedCenter = snapToFaceGrid({
        faceAzimuthDegrees: face.azimuthDegrees,
        faceCentroid: polygonCentroidLL(face.polygon),
        target: newLatLng,
        panelLengthMm: Number(spec?.length_mm) || DEFAULT_PANEL_LENGTH_MM,
        panelWidthMm:  Number(spec?.width_mm)  || DEFAULT_PANEL_WIDTH_MM,
        orientation: panel.orientation || 'landscape',
        gapMm: PANEL_GRID_GAP_MM,
      });

      // Rule check must exclude THIS panel from overlap detection —
      // otherwise dragging any distance triggers self-overlap.
      const stateSansSelf = { ...st, panels: st.panels.filter(p => p.id !== panelId) };
      const check = checkPanelDropRules({
        state: stateSansSelf,
        face,
        panelCenter: snappedCenter,
        panelLengthMm: Number(spec?.length_mm) || DEFAULT_PANEL_LENGTH_MM,
        panelWidthMm:  Number(spec?.width_mm)  || DEFAULT_PANEL_WIDTH_MM,
        orientation: panel.orientation || 'landscape',
        setbackMetres: Number.isFinite(face?.setbackMetres) ? face.setbackMetres : DEFAULT_FACE_SETBACK_M,
        panelCatalogueBySku: panelCatalogueRef.current,
      });
      if (!check.ok) {
        flashDropReject(check.reason);
        revert();
        return;
      }

      // Commit: update state AND snap the same Fabric object to the target
      // canvas position. No layoutAndDraw call — the object identity stays
      // stable so Fabric's transform can finish resetting cleanly.
      stateRef.current = {
        ...st,
        panels: st.panels.map(p => p.id === panelId ? { ...p, center: snappedCenter } : p),
      };
      setDirty(true);
      setTotalKw(totalKilowatts(stateRef.current, panelCatalogueRef.current));
      setTotalKwh(totalAnnualKwh(stateRef.current, panelCatalogueRef.current));

      const snappedPx = panelCenterToCanvasPx(snappedCenter, img, roof);
      obj.set({ left: snappedPx.x, top: snappedPx.y });
      obj.setCoords();
      canvas.requestRenderAll();
    });

    // ── Zoom (mouse wheel) ─────────────────────────────────────────────
    canvas.on('mouse:wheel', (opt) => {
      const delta = opt.e.deltaY;
      let z = canvas.getZoom() * (delta > 0 ? 1 / ZOOM_STEP : ZOOM_STEP);
      z = clampZoom(z);
      // Zoom relative to the pointer position — feels natural.
      canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, z);
      opt.e.preventDefault();
      opt.e.stopPropagation();
      setZoomDisplay(z);
      // Phase 3a: zoom doesn't dirty the design (viewport isn't persisted).
    });

    // ── Resize handling — ResizeObserver catches ALL layout changes,
    // not just window resize. Fixes the "flex hadn't settled at mount"
    // case where the initial measurement was wrong and content ended up
    // in the corner of a stale canvas.
    const ro = new ResizeObserver(() => layoutAndDraw());
    ro.observe(container);

    canvas.defaultCursor = 'grab';

    return () => {
      ro.disconnect();
      canvas.dispose();
      canvasRef.current = null;
      layoutAndDrawRef.current = null;
      roofImgRef.current = null;
      overlayObjectsRef.current = [];
      ghostPanelRef.current = null;
      hideGhostPanelRef.current = null;
    };
  }, [loading]);

  // ── Image-load effect — swaps the aerial image whenever its signed URL
  // changes. Runs on initial load AND whenever roofAnalysis is refreshed
  // (e.g. after a refetch upgrades the tile). Keeps the Fabric canvas alive
  // across swaps — no re-init, no lost handlers.
  useEffect(() => {
    if (loading) return;
    const canvas = canvasRef.current;
    if (!canvas) return;   // canvas-init effect hasn't run yet

    // Clear the previous image + overlays before loading the new one.
    if (roofImgRef.current) {
      canvas.remove(roofImgRef.current);
      roofImgRef.current = null;
    }
    for (const obj of overlayObjectsRef.current) canvas.remove(obj);
    overlayObjectsRef.current = [];

    const imageUrl = roofAnalysis?.roof_image_signed_url;
    if (!imageUrl) {
      // No image on file → placeholder roof so pan/zoom is testable
      drawPlaceholderRoof(canvas, canvas.getWidth(), canvas.getHeight());
      return;
    }

    let cancelled = false;
    fabric.Image.fromURL(imageUrl, { crossOrigin: 'anonymous' })
      .then(img => {
        if (cancelled || !canvasRef.current) return;
        img.set({
          ...TL_ORIGIN,       // top-left origin — see comment on TL_ORIGIN
          selectable: false,
          evented: false,
          hoverCursor: 'grab',
        });
        canvas.add(img);
        canvas.sendObjectToBack(img);
        roofImgRef.current = img;
        layoutAndDrawRef.current?.();
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[DesignPage] roof image load failed (non-fatal):', err?.message || err);
        drawPlaceholderRoof(canvas, canvas.getWidth(), canvas.getHeight());
      });
    return () => { cancelled = true; };
  }, [loading, roofAnalysis?.roof_image_signed_url]);

  // ── "Trace from Google" — Phase 3b.2 ─────────────────────────────────
  // Converts Google Solar's detected roof_segments into design.state.roof.faces,
  // then redraws the canvas to show the polygons. Re-clicking replaces any
  // Google-sourced faces (manual faces + any panels on manual faces survive;
  // panels on the OLD google faces are dropped since their face id is gone).
  const importFromGoogle = useCallback(() => {
    if (importingSegments) return;
    const segments = roofAnalysisRef.current?.roof_segments;
    if (!Array.isArray(segments) || segments.length === 0) return;
    setImportingSegments(true);
    try {
      const nextState = importGoogleSegments(stateRef.current, segments);
      stateRef.current = nextState;
      setFaceCount(nextState.roof.faces.length);
      setDirty(true);
      // Redraw so the new polygons appear immediately (autosave will PUT the
      // updated state 2s later via the existing debounced autosave effect).
      layoutAndDrawRef.current?.();
    } finally {
      setImportingSegments(false);
    }
  }, [importingSegments]);

  // ── Manual roof-face tracing — Phase 3b.3 ────────────────────────────
  // Rep clicks 'Trace face', clicks each corner on the aerial to build a
  // polygon, then double-clicks (or clicks Finish) to close + save. Esc
  // cancels mid-draw. Vertices are stored in lat/lng from the moment they're
  // clicked, so they survive pan/zoom + container resizes.
  const startTrace = useCallback(() => {
    if (isTracing) return;
    traceVerticesRef.current = [];
    setTraceVertexCount(0);
    setIsTracing(true);
    // Redraw so previously-visible controls (e.g. pan cursor) update
    layoutAndDrawRef.current?.();
  }, [isTracing]);

  const cancelTrace = useCallback(() => {
    if (!isTracing) return;
    traceVerticesRef.current = [];
    setTraceVertexCount(0);
    setIsTracing(false);
    layoutAndDrawRef.current?.();
  }, [isTracing]);

  const finishTrace = useCallback(() => {
    if (!isTracing) return;
    const vertices = traceVerticesRef.current;
    if (vertices.length < 3) {
      // silently ignore — the finish button is disabled anyway, but the
      // dblclick path can hit this with 1–2 vertices
      return;
    }
    try {
      // Phase 3b.6 — infer face azimuth from the longest polygon edge so the
      // panel snap grid aligns with the roof's eave/ridge instead of true
      // north. Google faces already have Google's azimuth; this only fires
      // on manual traces.
      const azimuthDegrees = inferAzimuthFromPolygon(vertices);
      const face = makeRoofFace({ source: 'manual', polygon: vertices, azimuthDegrees });
      stateRef.current = addFace(stateRef.current, face);
      setFaceCount(stateRef.current.roof.faces.length);
      setDirty(true);
    } catch (err) {
      // makeRoofFace validates the polygon — unlikely to throw here since
      // we've filtered to >=3 vertices, but be defensive.
      console.warn('[DesignPage] failed to save traced face:', err?.message || err);
    } finally {
      traceVerticesRef.current = [];
      setTraceVertexCount(0);
      setIsTracing(false);
      layoutAndDrawRef.current?.();
    }
  }, [isTracing]);

  // Convert a canvas-space pointer coordinate to lat/lng using the current
  // image transform + tile radius. Returns null if the roof image or analysis
  // isn't loaded yet (shouldn't happen once trace mode is active).
  const canvasPointerToLatLng = useCallback((pointerX, pointerY) => {
    const img  = roofImgRef.current;
    const roof = roofAnalysisRef.current;
    if (!img || !roof) return null;
    const scale = img.scaleX || 1;
    const left  = img.left   || 0;
    const top   = img.top    || 0;
    const imgPxX = (pointerX - left) / scale;
    const imgPxY = (pointerY - top)  / scale;
    const toLatLng = makePixelToLatLng({
      centerLat:    Number(roof.latitude),
      centerLng:    Number(roof.longitude),
      radiusMeters: Number.isFinite(Number(roof.tile_radius_m)) && Number(roof.tile_radius_m) > 0
                      ? Number(roof.tile_radius_m)
                      : FALLBACK_TILE_RADIUS_METERS,
      imgWidth:  img.width,
      imgHeight: img.height,
    });
    return toLatLng(imgPxX, imgPxY);
  }, []);

  // Esc cancels an in-progress trace.
  useEffect(() => {
    if (!isTracing) return;
    const onKey = (e) => { if (e.key === 'Escape') cancelTrace(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTracing, cancelTrace]);

  // Keep finishTraceRef pointed at the latest useCallback so the stable
  // mouse:dblclick handler inside the canvas-init effect can invoke it.
  useEffect(() => { finishTraceRef.current = finishTrace; }, [finishTrace]);

  // ── Zoom button handlers ───────────────────────────────────────────────
  // Phase 3a: viewport changes don't dirty the design; save infrastructure is
  // ready but won't fire until Phase 3b adds real content (panels, roof faces).
  const zoomIn = () => {
    const c = canvasRef.current; if (!c) return;
    const z = clampZoom(c.getZoom() * ZOOM_STEP);
    c.zoomToPoint({ x: c.width / 2, y: c.height / 2 }, z);
    setZoomDisplay(z);
  };
  const zoomOut = () => {
    const c = canvasRef.current; if (!c) return;
    const z = clampZoom(c.getZoom() / ZOOM_STEP);
    c.zoomToPoint({ x: c.width / 2, y: c.height / 2 }, z);
    setZoomDisplay(z);
  };
  // "Reset view" = re-fit to customer's roof (not identity). Rep expects
  // this button to give them the useful default view, not the raw tile.
  const zoomFit = () => {
    const c = canvasRef.current; const img = roofImgRef.current;
    if (!c || !img) return;
    const w = c.getWidth(), h = c.getHeight();
    const scale = Math.min(w / img.width, h / img.height);
    const left  = (w - img.width  * scale) / 2;
    const top   = (h - img.height * scale) / 2;
    const zoomApplied = autoZoomToRoof(c, roofAnalysisRef.current, img.width, img.height, left, top, scale, w, h);
    if (zoomApplied) {
      setZoomDisplay(zoomApplied);
    } else {
      // No segment data → plain identity view
      c.setViewportTransform([1, 0, 0, 1, 0, 0]);
      setZoomDisplay(1);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto py-12 px-6">
        <Link to={`/pm/quotes/${quoteId}`} className="text-sm text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
          <ChevronLeft className="w-4 h-4" /> back to quote
        </Link>
        <div className="mt-4 bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded flex items-start gap-3">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold">Couldn't load the design</div>
            <div className="text-sm mt-1">{loadError}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link
            to={`/pm/quotes/${quoteId}`}
            className="text-sm text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" /> Quote
          </Link>
          <div>
            <div className="text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
              {customerName(quote, currentVersion) || <span className="text-slate-400">No customer name on file</span>}
              {quote?.quote_ref && (
                <span className="text-xs font-mono font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                  {quote.quote_ref}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-2 flex-wrap">
              <span>
                {addressLine(quote, currentVersion, roofAnalysis)
                  || <span className="italic text-slate-400">No address on file</span>}
              </span>
              {imageryLabel(roofAnalysis) && (
                <span className="text-slate-400">
                  · {imageryLabel(roofAnalysis)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Phase 3b.2 — "Trace from Google" pill, visible only until faces are imported */}
          {faceCount === 0
            && Array.isArray(roofAnalysis?.roof_segments)
            && roofAnalysis.roof_segments.length > 0 && (
              <button
                onClick={importFromGoogle}
                disabled={importingSegments}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-full px-3 py-1 disabled:opacity-50"
                title={`Import ${roofAnalysis.roof_segments.length} roof face(s) detected by Google Solar`}
              >
                📐 Trace from Google ({roofAnalysis.roof_segments.length})
              </button>
          )}
          {faceCount > 0 && (
            <span className="text-xs text-slate-500">
              {faceCount} roof face{faceCount === 1 ? '' : 's'}
            </span>
          )}
          {/* Phase 3b.3 — manual roof-face tracing (always available once image loaded) */}
          {roofAnalysis?.roof_image_signed_url && !isTracing && !isDeletingFace && !armedObstructionType && (
            <button
              onClick={startTrace}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-full px-3 py-1"
              title="Manually trace a roof face by clicking each corner on the image"
            >
              ✏️ Trace face
            </button>
          )}
          {/* Phase 3e — Use Google's suggested panel layout. Visible whenever
              Google returned a solarPanels[] for the property. Handler auto-
              imports Google's segments as faces if none exist yet, so this
              is a true one-click. */}
          {Array.isArray(roofAnalysis?.solar_panels)
            && roofAnalysis.solar_panels.length > 0
            && !isTracing && !isDeletingFace && !armedObstructionType && (
              <button
                onClick={importGoogleLayoutHandler}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-800 bg-purple-50 hover:bg-purple-100 border border-purple-300 rounded-full px-3 py-1"
                title={`Import Google's ${roofAnalysis.solar_panels.length} suggested panel positions (best-shaded first)`}
              >
                🌟 Use Google's layout ({roofAnalysis.solar_panels.length})
              </button>
          )}
          {/* Phase 3b.9 — delete-face mode toggle */}
          {faceCount > 0 && !isTracing && !armedObstructionType && (
            <button
              onClick={() => setIsDeletingFace(v => !v)}
              className={
                'inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 border ' +
                (isDeletingFace
                  ? 'text-white bg-red-600 hover:bg-red-700 border-red-700'
                  : 'text-red-800 bg-red-50 hover:bg-red-100 border-red-300')
              }
              title={isDeletingFace ? 'Click a face to delete it, or click here to cancel' : 'Enter delete-face mode'}
            >
              🗑️ {isDeletingFace ? 'Cancel delete' : 'Delete face'}
            </button>
          )}
          {/* Phase 3c — obstruction placement toggle */}
          {faceCount > 0 && !isTracing && !isDeletingFace && (
            <button
              onClick={() => setArmedObstructionType(v => v ? null : 'chimney')}
              className={
                'inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 border ' +
                (armedObstructionType
                  ? 'text-white bg-amber-600 hover:bg-amber-700 border-amber-700'
                  : 'text-amber-800 bg-amber-50 hover:bg-amber-100 border-amber-300')
              }
              title={armedObstructionType
                ? 'Click a face to drop an obstruction, or click here to cancel'
                : 'Add roof obstructions (chimney, vent, skylight)'}
            >
              🚧 {armedObstructionType ? 'Cancel add' : 'Add obstruction'}
            </button>
          )}
          {refetching && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              Fetching sharper aerial…
            </span>
          )}
          {saveError && (
            <span className="text-xs text-red-700 max-w-xs truncate" title={saveError}>
              {saveError}
            </span>
          )}
          {!saveError && lastSavedAt && !dirty && !saving && (
            <span className="text-xs text-emerald-700">
              ● Saved {formatSavedAgo(lastSavedAt)}
            </span>
          )}
          {dirty && !saving && (
            <span className="text-xs text-amber-700">● Unsaved changes</span>
          )}
          <button
            onClick={doSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-semibold"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Main row: canvas + right-side palette ───────────────────── */}
      <div className="flex-1 flex overflow-hidden">
      <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[#f1eddb]">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading design…
          </div>
        )}
        {!loading && !roofAnalysis?.roof_image_signed_url && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-amber-50 border border-amber-300 text-amber-900 px-4 py-2 rounded text-sm flex items-center gap-2 shadow-sm">
            <AlertCircle className="w-4 h-4" />
            No roof image on file for this customer yet — canvas is available but blank.
          </div>
        )}
        {/* Phase 3b.3 — trace-mode instruction bar */}
        {isTracing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-emerald-50 border border-emerald-400 text-emerald-900 px-4 py-2 rounded-lg text-sm flex items-center gap-3 shadow-md">
            <span className="font-semibold">✏️ Tracing roof face</span>
            <span className="text-emerald-700">
              {traceVertexCount === 0
                ? 'Click each corner of the roof face'
                : traceVertexCount < 3
                  ? `${traceVertexCount} corner${traceVertexCount === 1 ? '' : 's'} — need at least 3`
                  : `${traceVertexCount} corners · double-click or Finish to close`}
            </span>
            <button
              onClick={finishTrace}
              disabled={traceVertexCount < 3}
              className="ml-2 px-3 py-1 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded"
            >
              Finish
            </button>
            <button
              onClick={cancelTrace}
              className="px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 rounded"
            >
              Cancel (Esc)
            </button>
          </div>
        )}
        {/*
          Fabric.js wraps the <canvas> in a `.canvas-container` <div> and adds
          a second <canvas> sibling during initialization — that mutates the
          DOM tree behind React's back. Placing the <canvas> directly inside
          the container caused React's diffing to crash with NotFoundError:
          insertBefore on a stale node reference whenever a conditional
          sibling (loading state, trace instruction bar) appeared/disappeared.
          Isolating Fabric's mutations under its own dedicated wrapper div
          keeps React's children of `containerRef` stable across renders.
        */}
        <div className="absolute inset-0">
          <canvas ref={canvasElRef} />
        </div>

        {/* Phase 3b.7 + 3b.9 — selection hint bar. Single-select shows the
            drag/rotate/delete actions; multi-select shows Create-array +
            Delete-many. Shift/Ctrl-click to add or remove panels from the set. */}
        {selectedPanelIds.length > 0 && !isTracing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-sky-50 border border-sky-300 text-sky-900 px-4 py-2 rounded-lg shadow-md text-sm flex items-center gap-3">
            {selectedPanelIds.length === 1 ? (
              <>
                <span className="font-semibold">🔷 Panel selected</span>
                <span className="text-sky-700">
                  Drag to move · R to rotate P↔L · Shift+click another panel to group · Esc to deselect
                </span>
                <button
                  onClick={toggleSelectedPanelOrientation}
                  className="ml-1 px-2 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100 border border-sky-300 rounded"
                  title="Toggle portrait ↔ landscape (R)"
                >
                  ⟳ P↔L
                </button>
              </>
            ) : (
              <>
                <span className="font-semibold">🔷 {selectedPanelIds.length} panels selected</span>
                <span className="text-sky-700">
                  Group them into a named array for string design + easier PDF export.
                </span>
                <button
                  onClick={createArrayFromSelection}
                  className="ml-1 px-3 py-1 text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white rounded"
                  title="Group these panels into a named array"
                >
                  + Create array
                </button>
              </>
            )}
            <button
              onClick={deleteSelectedPanel}
              className="px-2 py-1 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded inline-flex items-center gap-1"
              title={selectedPanelIds.length === 1 ? 'Delete this panel' : `Delete ${selectedPanelIds.length} panels`}
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        )}

        {/* Phase 3c — obstruction placement instruction bar with type picker */}
        {armedObstructionType && !isTracing && !isDeletingFace && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-amber-50 border border-amber-400 text-amber-900 px-4 py-2 rounded-lg text-sm flex items-center gap-3 shadow-md flex-wrap max-w-[90%]">
            <span className="font-semibold">🚧 Add obstruction</span>
            <span className="text-amber-700 text-xs">Pick type, then click on a roof face:</span>
            <div className="flex gap-1">
              {Object.keys(OBSTRUCTION_DEFAULTS).map(t => (
                <button
                  key={t}
                  onClick={() => setArmedObstructionType(t)}
                  className={
                    'px-2 py-1 text-xs font-semibold rounded border transition-colors ' +
                    (armedObstructionType === t
                      ? 'bg-amber-600 text-white border-amber-700'
                      : 'bg-white text-amber-900 hover:bg-amber-100 border-amber-300')
                  }
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <button
              onClick={() => setArmedObstructionType(null)}
              className="px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 rounded"
            >
              Cancel (Esc)
            </button>
          </div>
        )}

        {/* Phase 3b.9 — delete-face mode instruction bar */}
        {isDeletingFace && !isTracing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-red-50 border border-red-400 text-red-900 px-4 py-2 rounded-lg text-sm flex items-center gap-3 shadow-md">
            <span className="font-semibold">🗑️ Delete a roof face</span>
            <span className="text-red-700">Click a face to delete it (with all panels on it) · Esc to cancel</span>
          </div>
        )}

        {/* Phase 3b.8 + 3b.10 — inline toast: drop rejections use the reason
            enum + DROP_REASON_HUMAN lookup; copy-array summaries pass a full
            sentence directly. If the value matches a known reason we render
            the human message; otherwise we render the value verbatim. */}
        {dropRejectReason && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-red-50 border border-red-300 text-red-900 px-4 py-2 rounded-lg shadow-md text-sm flex items-center gap-2 max-w-md">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{DROP_REASON_HUMAN[dropRejectReason] || dropRejectReason}</span>
          </div>
        )}

        {/* Phase 3b.4 — armed panel indicator (bottom-centre overlay) */}
        {armedPanelSku && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-blue-50 border border-blue-300 text-blue-900 px-4 py-2 rounded-lg shadow-md text-sm flex items-center gap-3">
            <span className="font-semibold">📌 {armedPanelLabel(catalogue, armedPanelSku)}</span>
            <span className="text-blue-700">
              {faceCount === 0 ? 'Trace a roof face first, then click to drop' : 'Click a roof face to drop this panel'}
            </span>
            <button
              onClick={() => setArmedPanelSku(null)}
              className="ml-1 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 rounded"
              title="Un-arm (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Zoom controls (bottom-left overlay) */}
        <div className="absolute bottom-4 left-4 bg-white border border-slate-200 rounded shadow-sm flex flex-col divide-y divide-slate-200">
          <button onClick={zoomIn}  className="p-2 hover:bg-slate-50" title="Zoom in"><ZoomIn className="w-4 h-4" /></button>
          <button onClick={zoomOut} className="p-2 hover:bg-slate-50" title="Zoom out"><ZoomOut className="w-4 h-4" /></button>
          <button onClick={zoomFit} className="p-2 hover:bg-slate-50" title="Reset view"><Maximize2 className="w-4 h-4" /></button>
        </div>
      </div>

      {/* ── Right sidebar: palette + arrays + faces (Phase 3b.4 + 3b.9) ── */}
      <PanelPalette
        panels={catalogue?.panels || []}
        loading={catalogueLoading}
        error={catalogueError}
        armedPanelSku={armedPanelSku}
        onArm={setArmedPanelSku}
        panelCount={panelCount}
        totalKw={totalKw}
        totalKwh={totalKwh}
        arrays={stateRef.current?.arrays || []}
        onSelectArray={selectArrayPanels}
        onUngroupArray={deleteArrayKeepPanels}
        onDeleteArrayAndPanels={deleteArrayAndPanels}
        onCopyArrayToFace={copyArrayToTargetFace}
        faces={stateRef.current?.roof?.faces || []}
        allPanels={stateRef.current?.panels || []}
        onDeleteFace={(faceId) => deleteFaceById(faceId)}
        onAutoFillFace={autoFillFaceHandler}
        armedPanelSku={armedPanelSku}
        distinctSkuCount={panelSkusInDesign(stateRef.current).size}
        obstructions={stateRef.current?.roof?.obstructions || []}
        onDeleteObstruction={deleteObstructionById}
        sectionOpen={sectionOpen}
        onToggleSection={toggleSection}
      />
      </div>

      {/* ── Footer status bar ───────────────────────────────────────── */}
      <div className="border-t border-slate-200 bg-white px-4 py-1.5 flex-shrink-0 flex items-center justify-between text-xs text-slate-500">
        {/* Footer is now purely technical status — live design totals moved
            to the sidebar (PanelPalette top block) where the rep is working. */}
        <div className="flex gap-4">
          <span>Zoom: <b className="text-slate-800">{Math.round(zoomDisplay * 100)}%</b></span>
          <span>Design version: <b className="text-slate-800">v{versionRef.current}</b></span>
          <span className="text-slate-400">
            Autosave: on ({AUTOSAVE_DEBOUNCE_MS / 1000}s)
          </span>
        </div>
        <div className="text-slate-400">
          {roofAnalysis?.imagery_source === 'linz' && (
            <>Aerial imagery: LINZ · </>
          )}
          Phase 3b — palette + drop. Rotate / arrays / rules ship in later phases.
        </div>
      </div>
    </div>
  );
}

// ── Local utilities ─────────────────────────────────────────────────────
function clampZoom(z) {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

// Compute the union bounding box of Google Solar's detected roof segments in
// image-pixel space, then set the Fabric viewport so that bbox fills ~70% of
// the canvas. Returns the applied zoom factor if it ran, or null if there
// wasn't enough segment data to compute a bbox.
//
// Portion of the canvas the roof takes up when auto-zoomed. 0.7 leaves a bit
// of context (adjacent trees, driveway) so the rep can spot obvious issues.
const AUTO_ZOOM_FILL_FRACTION = 0.7;

function autoZoomToRoof(canvas, roofAnalysis, imgWidth, imgHeight, left, top, scale, canvasW, canvasH) {
  const centerLat = Number(roofAnalysis?.latitude);
  const centerLng = Number(roofAnalysis?.longitude);
  const segments  = roofAnalysis?.roof_segments;
  if (!Array.isArray(segments) || !segments.length) return null;
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return null;

  const toPixel = makeLatLngToPixel({
    centerLat, centerLng,
    radiusMeters: radiusForAnalysis(roofAnalysis),
    imgWidth, imgHeight,
  });

  // Union bbox of all segment corners, in image-pixel space
  let minPx = Infinity, minPy = Infinity, maxPx = -Infinity, maxPy = -Infinity;
  for (const seg of segments) {
    const bbox = seg?.boundingBox;
    if (!bbox?.ne || !bbox?.sw) continue;
    const corners = [
      toPixel(bbox.ne.latitude, bbox.sw.longitude),
      toPixel(bbox.ne.latitude, bbox.ne.longitude),
      toPixel(bbox.sw.latitude, bbox.ne.longitude),
      toPixel(bbox.sw.latitude, bbox.sw.longitude),
    ];
    for (const c of corners) {
      if (c.x < minPx) minPx = c.x;
      if (c.x > maxPx) maxPx = c.x;
      if (c.y < minPy) minPy = c.y;
      if (c.y > maxPy) maxPy = c.y;
    }
  }
  if (!Number.isFinite(minPx) || minPx === maxPx || minPy === maxPy) return null;

  // Convert bbox from image-pixel space to canvas-pixel space (image position transform)
  const bboxCanvasW = (maxPx - minPx) * scale;
  const bboxCanvasH = (maxPy - minPy) * scale;
  const bboxCanvasCx = left + ((minPx + maxPx) / 2) * scale;
  const bboxCanvasCy = top  + ((minPy + maxPy) / 2) * scale;

  // Zoom to fit at AUTO_ZOOM_FILL_FRACTION of canvas, clamped to [1, MAX_ZOOM]
  const zoom = Math.max(1, Math.min(MAX_ZOOM,
    Math.min(canvasW / bboxCanvasW, canvasH / bboxCanvasH) * AUTO_ZOOM_FILL_FRACTION
  ));

  // Set viewport: zoom, then translate so bbox centre lands at canvas centre
  canvas.setViewportTransform([
    zoom, 0, 0, zoom,
    canvasW / 2 - bboxCanvasCx * zoom,
    canvasH / 2 - bboxCanvasCy * zoom,
  ]);
  return zoom;
}

// Draw the roof-face polygons on top of the aerial. Every face is a polygon
// in lat/lng — we project each vertex through the tile's radiusMeters and
// then through the image's placement transform (left/top/scale) so faces
// stay locked to the roof under pan/zoom.
//
// Colour scheme:
//   • google_solar-sourced faces → amber fill/outline (matches our brand)
//   • manual faces               → sage fill/outline (visually distinct so
//     rep can tell what they traced vs what came from Google)
function overlayRoofFaces({ canvas, faces, allPanels, roofAnalysis, imgWidth, imgHeight, left, top, scale }) {
  const created = [];
  if (!Array.isArray(faces) || faces.length === 0) return created;

  const centerLat = Number(roofAnalysis?.latitude);
  const centerLng = Number(roofAnalysis?.longitude);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return created;

  const radiusMeters = Number(roofAnalysis?.tile_radius_m) > 0
    ? Number(roofAnalysis.tile_radius_m)
    : ROOF_TILE_RADIUS_METERS_FALLBACK;

  const toPixel = makeLatLngToPixel({
    centerLat, centerLng, radiusMeters,
    imgWidth, imgHeight,
  });
  const toCanvas = (p) => ({ x: left + p.x * scale, y: top + p.y * scale });

  // Which faces already have panels? Face outlines + fill are GUIDES for
  // placement. Once a face has panels on it the guide is done — fading it
  // out drops a lot of visual noise on dense designs (e.g. Google's layout
  // where 3 overlapping segment bboxes stack amber fills into mud).
  const facesWithPanels = new Set();
  for (const p of allPanels || []) {
    if (p?.faceId) facesWithPanels.add(p.faceId);
  }

  faces.forEach((face, i) => {
    if (!Array.isArray(face.polygon) || face.polygon.length < 3) return;

    const points = face.polygon.map(v => toCanvas(toPixel(v.latitude, v.longitude)));
    const hasPanels = facesWithPanels.has(face.id);

    const isGoogle = face.source === 'google_solar';
    // Fade the fill + outline when the face has panels — kept just barely
    // visible so the rep can still see the boundary if they need to.
    const fill = hasPanels
      ? 'rgba(255, 255, 255, 0)'   // fully transparent
      : (isGoogle ? 'rgba(245, 166, 35, 0.18)' : 'rgba(74, 124, 89, 0.18)');
    const stroke = hasPanels
      ? (isGoogle ? 'rgba(255, 106, 0, 0.25)' : 'rgba(74, 124, 89, 0.25)')
      : (isGoogle ? 'rgba(255, 106, 0, 0.9)'  : 'rgba(74, 124, 89, 0.9)');
    const strokeWidth = hasPanels ? 1 : 2;
    const strokeDashArray = hasPanels ? [4, 4] : null;

    const polygon = new fabric.Polygon(points, {
      ...TL_ORIGIN,
      fill, stroke, strokeWidth,
      ...(strokeDashArray ? { strokeDashArray } : {}),
      selectable: false,   // Phase 3b.7 will make faces selectable
      evented: false,
      hoverCursor: 'grab',
    });
    canvas.add(polygon);
    created.push(polygon);

    // Face label — pitch + orientation + irradiance. ONLY rendered when the
    // face has no panels yet (i.e. it's still a placement guide). Once the
    // face is designed, the same info lives in the sidebar Roof-faces list
    // and cluttering the aerial with labels stacking near overlapping faces
    // (Google's segment bboxes overlap often) just adds noise.
    if (!hasPanels) {
      const topLeft = points.reduce((min, p) =>
        (p.y < min.y || (p.y === min.y && p.x < min.x)) ? p : min, points[0]);
      const parts = [`#${i + 1}`];
      if (face.areaMetres2)    parts.push(`${face.areaMetres2.toFixed(1)}m²`);
      if (face.azimuthDegrees != null) parts.push(azimuthToCompass(face.azimuthDegrees));
      if (face.pitchDegrees   != null) parts.push(`${face.pitchDegrees.toFixed(0)}°`);
      if (typeof face.sunshineKwhPerKwPerYear === 'number' && face.sunshineKwhPerKwPerYear > 0) {
        parts.push(`${Math.round(face.sunshineKwhPerKwPerYear)} kWh/kW/yr`);
      }
      const label = new fabric.Text(parts.join(' · '), {
        ...TL_ORIGIN,
        left: topLeft.x + 4, top: topLeft.y - 14,   // sits just above the top-left corner
        fontSize: 10,
        fontFamily: '-apple-system, "Segoe UI", system-ui, sans-serif',
        fill: '#1B1810',
        backgroundColor: 'rgba(255, 253, 246, 0.85)',
        padding: 2,
        selectable: false, evented: false,
      });
      canvas.add(label);
      created.push(label);
    }
  });

  return created;
}

// Phase 3b.3 — draw an in-progress trace: numbered vertex dots + solid lines
// between consecutive vertices + a dashed "closing" line from the last vertex
// back to the first (visual preview of the shape that Finish will save).
function overlayTraceInProgress({ canvas, traceVertices, roofAnalysis, imgWidth, imgHeight, left, top, scale }) {
  const created = [];
  if (!Array.isArray(traceVertices) || traceVertices.length === 0) return created;

  const centerLat = Number(roofAnalysis?.latitude);
  const centerLng = Number(roofAnalysis?.longitude);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return created;

  const radiusMeters = Number(roofAnalysis?.tile_radius_m) > 0
    ? Number(roofAnalysis.tile_radius_m)
    : ROOF_TILE_RADIUS_METERS_FALLBACK;

  const toPixel = makeLatLngToPixel({
    centerLat, centerLng, radiusMeters,
    imgWidth, imgHeight,
  });
  const toCanvas = (p) => ({ x: left + p.x * scale, y: top + p.y * scale });

  const points = traceVertices.map(v => toCanvas(toPixel(v.latitude, v.longitude)));

  // Solid lines between consecutive vertices
  for (let i = 0; i < points.length - 1; i++) {
    const line = new fabric.Line(
      [points[i].x, points[i].y, points[i + 1].x, points[i + 1].y],
      { ...TL_ORIGIN, stroke: '#22421E', strokeWidth: 2, selectable: false, evented: false }
    );
    canvas.add(line);
    created.push(line);
  }

  // Dashed closing line when we have >=3 vertices (visualises the polygon that
  // Finish would save without prematurely closing it)
  if (points.length >= 3) {
    const first = points[0], last = points[points.length - 1];
    const closingLine = new fabric.Line(
      [last.x, last.y, first.x, first.y],
      {
        ...TL_ORIGIN, stroke: '#4A7C59', strokeWidth: 2,
        strokeDashArray: [6, 4],
        selectable: false, evented: false,
      }
    );
    canvas.add(closingLine);
    created.push(closingLine);
  }

  // Numbered vertex dots on top of the lines
  points.forEach((p, i) => {
    const dot = new fabric.Circle({
      left: p.x, top: p.y,
      originX: 'center', originY: 'center',
      radius: 6,
      fill: '#4A7C59', stroke: '#FFFDF6', strokeWidth: 2,
      selectable: false, evented: false,
    });
    canvas.add(dot);
    created.push(dot);

    // Small vertex number label above the dot
    const label = new fabric.Text(String(i + 1), {
      left: p.x, top: p.y - 14,
      originX: 'center', originY: 'center',
      fontSize: 10, fontWeight: '700',
      fontFamily: '-apple-system, "Segoe UI", system-ui, sans-serif',
      fill: '#22421E',
      backgroundColor: 'rgba(255, 253, 246, 0.95)',
      padding: 1,
      selectable: false, evented: false,
    });
    canvas.add(label);
    created.push(label);
  });

  return created;
}

// Phase 3c — draw obstruction exclusion circles (chimney, skylight, vent,
// satellite, hvac, other). Each is a translucent amber disc sized to the
// obstruction's stored radiusMetres, with a single-letter type badge in
// the centre so the rep can identify what's what at a glance.
const OBSTRUCTION_ICON = {
  chimney: 'C', skylight: 'S', vent: 'V', satellite: 'A', hvac: 'H', other: 'O',
};
function overlayObstructions({ canvas, obstructions, roofAnalysis, imgWidth, imgHeight, left, top, scale }) {
  const created = [];
  if (!Array.isArray(obstructions) || obstructions.length === 0) return created;

  const centerLat = Number(roofAnalysis?.latitude);
  const centerLng = Number(roofAnalysis?.longitude);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return created;

  const radiusMeters = Number(roofAnalysis?.tile_radius_m) > 0
    ? Number(roofAnalysis.tile_radius_m)
    : ROOF_TILE_RADIUS_METERS_FALLBACK;

  const toPixel = makeLatLngToPixel({ centerLat, centerLng, radiusMeters, imgWidth, imgHeight });
  const toCanvas = (p) => ({ x: left + p.x * scale, y: top + p.y * scale });
  // metres → canvas px (same math as overlayPanels)
  const metresToCanvasPx = (m) => (m / (2 * radiusMeters)) * imgWidth * scale;

  for (const obst of obstructions) {
    if (!obst?.center || typeof obst.center.latitude !== 'number') continue;
    const rM = Number(obst.radiusMetres);
    if (!Number.isFinite(rM) || rM <= 0) continue;
    const rPx = metresToCanvasPx(rM);
    const centerCanvas = toCanvas(toPixel(obst.center.latitude, obst.center.longitude));

    const disc = new fabric.Circle({
      left: centerCanvas.x, top: centerCanvas.y,
      originX: 'center', originY: 'center',
      radius: rPx,
      fill: 'rgba(217, 119, 6, 0.35)',   // amber-600 translucent
      stroke: '#B45309',                    // amber-700
      strokeWidth: 1.5,
      strokeUniform: true,
      selectable: false, evented: false,
    });
    const badge = new fabric.Text(OBSTRUCTION_ICON[obst.type] || 'O', {
      left: centerCanvas.x, top: centerCanvas.y,
      originX: 'center', originY: 'center',
      fontSize: Math.max(9, Math.min(rPx * 0.7, 16)),
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontWeight: '800',
      fill: '#FFFFFF',
      shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.85)', blur: 2 }),
      selectable: false, evented: false,
    });
    canvas.add(disc);
    canvas.add(badge);
    created.push(disc, badge);
  }

  return created;
}

// Phase 3b.4 — draw the dropped panels as real-world-sized rectangles.
// Each panel rendered at its catalogue length_mm × width_mm converted to
// image pixels via the tile's radiusMeters, then scaled to canvas coords.
// Rotation is `rotationDegrees` from the design state — defaults to the
// face's azimuth at drop time so panels look roughly aligned to the roof.
// Missing catalogue rows fall back to a Q.PEAK-sized default so the panel
// still renders (rep can swap SKU later without re-dropping).
//
// Phase 3b.7 (part) — each rect carries a `panelId` custom property so the
// mouse:down handler can identify which panel was clicked for selection.
// Selected panel gets a thicker, brighter stroke so it stands out from the
// crowd. Panels are `evented: true` but `selectable: false` because we
// implement single-select ourselves (Fabric's built-in selection would let
// users drag/scale/rotate panels, which we want to control explicitly in
// later phases; drag = 3b.7b, rotate = 3b.7c).
function overlayPanels({ canvas, panels, panelCatalogueBySku, roofAnalysis, imgWidth, imgHeight, left, top, scale, selectedPanelIds, panelLabels }) {
  const selectedSet = selectedPanelIds instanceof Set
    ? selectedPanelIds
    : new Set(Array.isArray(selectedPanelIds) ? selectedPanelIds : []);
  const labels = panelLabels instanceof Map ? panelLabels : new Map();
  const created = [];
  if (!Array.isArray(panels) || panels.length === 0) return created;

  const centerLat = Number(roofAnalysis?.latitude);
  const centerLng = Number(roofAnalysis?.longitude);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return created;

  const radiusMeters = Number(roofAnalysis?.tile_radius_m) > 0
    ? Number(roofAnalysis.tile_radius_m)
    : ROOF_TILE_RADIUS_METERS_FALLBACK;

  const toPixel = makeLatLngToPixel({
    centerLat, centerLng, radiusMeters,
    imgWidth, imgHeight,
  });
  const toCanvas = (p) => ({ x: left + p.x * scale, y: top + p.y * scale });

  // metres → canvas pixels: (m / (2 * radiusMeters)) * imgWidth * scale
  // (Same math the polygon overlay uses; kept explicit here for clarity.)
  const metresToCanvasPx = (metres) => (metres / (2 * radiusMeters)) * imgWidth * scale;

  for (const panel of panels) {
    if (!panel?.center || typeof panel.center.latitude !== 'number') continue;

    const spec = panelCatalogueBySku?.get?.(panel.sku);
    const lenMm = Number(spec?.length_mm) > 0 ? Number(spec.length_mm) : DEFAULT_PANEL_LENGTH_MM;
    const widMm = Number(spec?.width_mm)  > 0 ? Number(spec.width_mm)  : DEFAULT_PANEL_WIDTH_MM;
    // orientation: 'landscape' = long edge horizontal, 'portrait' = long edge vertical
    const isLandscape = panel.orientation !== 'portrait';
    const widthMetres  = (isLandscape ? lenMm : widMm) / 1000;
    const heightMetres = (isLandscape ? widMm : lenMm) / 1000;

    const centerCanvas = toCanvas(toPixel(panel.center.latitude, panel.center.longitude));

    const isSelected = selectedSet.has(panel.id);
    const wPx = metresToCanvasPx(widthMetres);
    const hPx = metresToCanvasPx(heightMetres);
    // Panel body — dark navy near-opaque with a silver frame. Selected state
    // swaps to a bright cyan fill + stroke that reads through the transparency.
    const body = new fabric.Rect({
      left: 0, top: 0,
      originX: 'center', originY: 'center',
      width: wPx, height: hPx,
      fill:   isSelected ? 'rgba(56, 189, 248, 0.75)' : 'rgba(15, 29, 58, 0.90)',
      stroke: isSelected ? '#38BDF8' : '#C4C9D4',   // silver frame for the unselected state
      strokeWidth: isSelected ? 2.5 : 1.2,
      strokeUniform: true,
    });
    // Centre busbar strip — modern half-cut panels have a visible horizontal
    // seam across the middle. One thin line is enough to sell the look at
    // typical canvas scales without becoming visual noise when zoomed out.
    const busbar = new fabric.Line([-wPx / 2, 0, wPx / 2, 0], {
      stroke: 'rgba(196, 201, 212, 0.5)',
      strokeWidth: 0.6,
      strokeUniform: true,
    });
    // Phase 3b.11 — auto-number label (S1P3, S2P1, …) centred on the panel.
    // Only added for panels that belong to an array; rogue panels stay
    // un-labelled since their string position is undefined until grouped.
    // Font size scales with panel size so the label reads at any zoom, and
    // clamps to a legible min/max so a tiny thumbnail doesn't fold to 3px
    // or a huge panel doesn't shout at 40px.
    const children = [body, busbar];
    const labelText = labels.get(panel.id);
    if (labelText) {
      // Cap at 11px so densely-packed layouts (Google's suggested layout
      // in particular) don't have labels overflowing the panel edges. Was
      // 16 before — too shouty on tight roofs.
      const fontPx = Math.max(8, Math.min(hPx * 0.22, 11));
      const label = new fabric.Text(labelText, {
        left: 0, top: 0,
        originX: 'center', originY: 'center',
        fontSize: fontPx,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: '700',
        fill: '#FFFFFF',
        shadow: new fabric.Shadow({ color: 'rgba(0, 0, 0, 0.85)', blur: 3, offsetX: 0, offsetY: 0 }),
      });
      children.push(label);
    }

    const group = new fabric.Group(children, {
      left: centerCanvas.x, top: centerCanvas.y,
      originX: 'center', originY: 'center',
      angle:  Number(panel.rotationDegrees) || 0,
      // Phase 3b.7 — panels are draggable, but ONLY draggable. Scaling and
      // rotation are locked because those are structural decisions (dims
      // come from the catalogue SKU; rotation is per-face azimuth). The
      // selection border/controls are hidden — our own cyan highlight
      // (in overlayPanels above) provides all the visual affordance.
      selectable: true, evented: true,
      hasControls: false, hasBorders: false,
      lockScalingX: true, lockScalingY: true, lockRotation: true,
      hoverCursor: isSelected ? 'move' : 'pointer',
    });
    // Stash the id + current visual-selection state on the Fabric object.
    // isSelectedVisual lets the sync effect (which restyles in place on
    // selection change) skip the redraw when the state hasn't actually
    // flipped for this panel.
    group.data = { panelId: panel.id, isSelectedVisual: isSelected };
    canvas.add(group);
    created.push(group);
  }

  return created;
}

// Phase 3b.6 (viz) — draw the snap grid on each face when a panel is armed.
// Cell dimensions come from the armed panel's SKU + PANEL_GRID_GAP_MM, so the
// grid the rep sees is exactly the grid the drop handler will snap to. Lines
// are clipped to each face's own bounding box in face-local coords so they
// don't spray across the whole aerial.
function overlayFaceGrid({ canvas, faces, panelCatalogueBySku, armedSku, roofAnalysis, imgWidth, imgHeight, left, top, scale }) {
  const created = [];
  if (!armedSku || !Array.isArray(faces) || faces.length === 0) return created;
  const spec = panelCatalogueBySku?.get?.(armedSku);
  const cellUm = ((Number(spec?.length_mm) || DEFAULT_PANEL_LENGTH_MM) + PANEL_GRID_GAP_MM) / 1000;
  const cellVm = ((Number(spec?.width_mm)  || DEFAULT_PANEL_WIDTH_MM)  + PANEL_GRID_GAP_MM) / 1000;

  const centerLat = Number(roofAnalysis?.latitude);
  const centerLng = Number(roofAnalysis?.longitude);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return created;
  const radiusMeters = Number(roofAnalysis?.tile_radius_m) > 0
    ? Number(roofAnalysis.tile_radius_m)
    : ROOF_TILE_RADIUS_METERS_FALLBACK;
  const toPixel = makeLatLngToPixel({ centerLat, centerLng, radiusMeters, imgWidth, imgHeight });
  const toCanvas = (p) => ({ x: left + p.x * scale, y: top + p.y * scale });

  const METRES_PER_DEG_LAT_LOCAL = 111320;

  for (const face of faces) {
    if (!Array.isArray(face.polygon) || face.polygon.length < 3) continue;
    const centroid = polygonCentroidLL(face.polygon);
    if (!centroid) continue;
    const az = Number(face.azimuthDegrees) || 0;
    const azRad = az * Math.PI / 180;
    const cosA = Math.cos(azRad), sinA = Math.sin(azRad);
    const centreLatRad = centroid.latitude * Math.PI / 180;
    const metresPerDegLng = METRES_PER_DEG_LAT_LOCAL * Math.cos(centreLatRad);

    // Project each polygon vertex into face-local (u,v) to get grid extents.
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const vert of face.polygon) {
      const dE = (vert.longitude - centroid.longitude) * metresPerDegLng;
      const dN = (vert.latitude  - centroid.latitude)  * METRES_PER_DEG_LAT_LOCAL;
      const u = dE * cosA - dN * sinA;
      const v = dE * sinA + dN * cosA;
      if (u < uMin) uMin = u; if (u > uMax) uMax = u;
      if (v < vMin) vMin = v; if (v > vMax) vMax = v;
    }

    // Helper to project a face-local (u, v) point back to canvas pixels.
    const uvToCanvas = (u, v) => {
      const dE =  u * cosA + v * sinA;
      const dN = -u * sinA + v * cosA;
      const lat = centroid.latitude  + dN / METRES_PER_DEG_LAT_LOCAL;
      const lng = centroid.longitude + dE / metresPerDegLng;
      return toCanvas(toPixel(lat, lng));
    };

    const gridLineStyle = {
      ...TL_ORIGIN,
      stroke: 'rgba(56, 189, 248, 0.45)',   // sky-400 translucent
      strokeWidth: 0.6,
      strokeDashArray: [3, 3],
      strokeUniform: true,
      selectable: false, evented: false,
    };

    // Vertical grid lines (constant u, spanning v range)
    const iMin = Math.floor(uMin / cellUm);
    const iMax = Math.ceil(uMax  / cellUm);
    for (let i = iMin; i <= iMax; i++) {
      const u = i * cellUm;
      const a = uvToCanvas(u, vMin);
      const b = uvToCanvas(u, vMax);
      const line = new fabric.Line([a.x, a.y, b.x, b.y], gridLineStyle);
      canvas.add(line);
      created.push(line);
    }
    // Horizontal grid lines (constant v, spanning u range)
    const jMin = Math.floor(vMin / cellVm);
    const jMax = Math.ceil(vMax  / cellVm);
    for (let j = jMin; j <= jMax; j++) {
      const v = j * cellVm;
      const a = uvToCanvas(uMin, v);
      const b = uvToCanvas(uMax, v);
      const line = new fabric.Line([a.x, a.y, b.x, b.y], gridLineStyle);
      canvas.add(line);
      created.push(line);
    }
  }
  return created;
}

// Compute the centroid of a polygon defined by canvas-pixel points.
// Simple arithmetic mean works well for convex + near-convex polygons.
function polygonCentroid(points) {
  const n = points.length;
  let sx = 0, sy = 0;
  for (const p of points) { sx += p.x; sy += p.y; }
  return { x: sx / n, y: sy / n };
}

// Compass direction from azimuth. 0=N, 90=E, 180=S, 270=W.
function azimuthToCompass(deg) {
  if (deg == null || Number.isNaN(deg)) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// Fallback tile radius (kept in sync with FALLBACK_TILE_RADIUS_METERS)
// so overlayRoofFaces can be called without pulling the whole DesignPage
// closure. Only used when roofAnalysis.tile_radius_m is missing (pre-M040).
const ROOF_TILE_RADIUS_METERS_FALLBACK = 50;

// Placeholder roof drawn when no aerial image is available.
// Gives the rep something to pan/zoom over so they can validate the canvas
// mechanics. Removed automatically once a real roof image is loaded (the
// image is added AFTER these shapes, or the shapes are cleared when we
// reload with a real image).
function drawPlaceholderRoof(canvas, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const roofW = Math.min(width, height) * 0.65;
  const roofH = roofW * 0.6;

  // Grass background
  const grass = new fabric.Rect({
    left: -width * 2, top: -height * 2,
    width: width * 5, height: height * 5,
    fill: '#8fa77a',
    ...TL_ORIGIN, selectable: false, evented: false,
  });

  // Roof body
  const roof = new fabric.Rect({
    left: cx - roofW / 2, top: cy - roofH / 2,
    width: roofW, height: roofH,
    fill: '#7d5a44',
    stroke: '#4d3826', strokeWidth: 2,
    ...TL_ORIGIN, selectable: false, evented: false,
    shadow: new fabric.Shadow({ color: 'rgba(0,0,0,0.35)', blur: 20, offsetX: 0, offsetY: 8 }),
  });

  // Ridge line down the middle
  const ridge = new fabric.Line(
    [cx, cy - roofH / 2, cx, cy + roofH / 2],
    { stroke: '#3d2818', strokeWidth: 3, selectable: false, evented: false }
  );

  // Chimney
  const chimney = new fabric.Rect({
    left: cx + roofW * 0.15, top: cy - roofH * 0.1,
    width: roofW * 0.06, height: roofH * 0.15,
    fill: '#3a2d24', stroke: '#221812', strokeWidth: 1,
    ...TL_ORIGIN, selectable: false, evented: false,
  });

  // Vent
  const vent = new fabric.Circle({
    left: cx - roofW * 0.25, top: cy + roofH * 0.15,
    radius: roofW * 0.015,
    fill: '#2c2119', selectable: false, evented: false,
  });

  // Label so it's obviously a placeholder, not the real thing
  const label = new fabric.Textbox('Test roof · placeholder (no aerial image on file)', {
    left: cx - roofW / 2, top: cy - roofH / 2 - 36,
    width: roofW,
    fontSize: 13,
    fill: '#4E4A40',
    fontFamily: '-apple-system, "Segoe UI", system-ui, sans-serif',
    textAlign: 'center',
    ...TL_ORIGIN, selectable: false, evented: false,
  });

  canvas.add(grass, roof, ridge, chimney, vent, label);
  canvas.renderAll();
}

function formatSavedAgo(iso) {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 5_000) return 'just now';
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    return new Date(iso).toLocaleString();
  } catch { return ''; }
}

// Customer name: prefer the quote's current version spec (what the customer
// will see on their proposal), fall back to the joined CRM contact.
function customerName(quote, currentVersion) {
  return currentVersion?.spec?.customer?.full_name
      || quote?.contacts?.name
      || null;
}

// One-line install address. Priority:
//   1. current_version.spec.customer.address — the canonical, editable spec
//      the rep entered on the quote form
//   2. contacts.street/... — CRM fallback if spec has no address yet
//   3. roof_analyses.address_used — the address Google Solar was queried
//      with, as a last resort when nothing else is on file
function addressLine(quote, currentVersion, roofAnalysis) {
  const s = currentVersion?.spec?.customer?.address;
  if (s?.street) {
    return [s.street, s.suburb, s.city, s.postcode].filter(Boolean).join(', ');
  }
  const c = quote?.contacts;
  if (c?.street) {
    return [c.street, c.suburb, c.city, c.postcode].filter(Boolean).join(', ');
  }
  return roofAnalysis?.address_used || null;
}

// Source-aware label for the aerial tile shown in the header.
// LINZ tiles don't carry quality/date via the tile API (they'd need a
// separate LINZ imagery-metadata call, deferred to a later phase).
// Google Solar tiles ship with imagery_quality + imagery_date from the
// buildingInsights analysis.
function imageryLabel(roofAnalysis) {
  if (!roofAnalysis) return null;
  if (roofAnalysis.imagery_source === 'linz') {
    return <>aerial: <b className="text-slate-600">LINZ</b> (~3cm/px)</>;
  }
  // google_solar or null (pre-Migration-041 rows) — show the quality/date pair
  if (roofAnalysis.imagery_quality) {
    return <>
      aerial: <b className="text-slate-600">Google Solar · {roofAnalysis.imagery_quality}</b>
      {roofAnalysis.imagery_date && <> ({formatImageryDate(roofAnalysis.imagery_date)})</>}
    </>;
  }
  return null;
}

// Google Solar returns imagery_date as either an ISO string OR an object
// { year, month, day }. Handle both shapes.
function formatImageryDate(d) {
  if (!d) return '';
  if (typeof d === 'string') {
    try { return new Date(d).toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' }); }
    catch { return d; }
  }
  if (typeof d === 'object' && d.year) {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d.month ? months[d.month - 1] + ' ' : ''}${d.year}`;
  }
  return '';
}

// Short label for the armed-panel indicator ("Q.PEAK 475W" style).
function armedPanelLabel(catalogue, sku) {
  const p = catalogue?.panels?.find(x => x.sku === sku);
  if (!p) return sku;
  const brand = p.brand || '';
  const watts = p.watts ? `${p.watts}W` : '';
  return [brand, watts].filter(Boolean).join(' · ') || sku;
}

// ── Panel palette (Phase 3b.4) ───────────────────────────────────────────
// Right-side sidebar listing every panel SKU in the catalogue. Rep clicks
// a card to "arm" that SKU; the next click on a traced roof face drops the
// panel. Grouped by brand so the list stays scannable when catalogues get
// large. Cards show brand, watts, and physical dimensions so the rep can
// eyeball the fit against the roof before dropping.
function PanelPalette({ panels, loading, error, armedPanelSku, onArm, panelCount, totalKw, totalKwh, arrays, onSelectArray, onUngroupArray, onDeleteArrayAndPanels, onCopyArrayToFace, faces, allPanels, onDeleteFace, onAutoFillFace, distinctSkuCount, obstructions, onDeleteObstruction, sectionOpen, onToggleSection }) {
  const panelsPerFace = useMemo(() => {
    const map = new Map();
    for (const p of allPanels || []) map.set(p.faceId, (map.get(p.faceId) || 0) + 1);
    return map;
  }, [allPanels]);
  // Phase 3b.9 — which array (if any) is showing the un-group / delete
  // confirm prompt inline in its row. null = no confirm open. Only one row
  // can be confirming at a time.
  const [confirmingArrayId, setConfirmingArrayId] = useState(null);
  // Phase 3b.10 — which array (if any) is showing the "copy to face" picker
  // inline. Mutually-exclusive with the delete confirm above.
  const [copyingArrayId, setCopyingArrayId] = useState(null);

  // Phase 3b.12 — palette search + brand-collapse. Scales the palette to
  // 100+ SKUs without an unreadable scrolling wall. When a search query is
  // non-empty, the render collapses down to a flat filtered list; when it's
  // empty, brand headers are collapsed by default and click to expand.
  // Auto-expand rule: any brand whose SKU is currently armed is force-open
  // so the rep can see and confirm their selection.
  const [paletteSearch, setPaletteSearch] = useState('');
  const [expandedBrands, setExpandedBrands] = useState(() => new Set());
  const query = paletteSearch.trim().toLowerCase();
  const matchesQuery = (p) => {
    if (!query) return true;
    return (
      (p.sku    && p.sku.toLowerCase().includes(query))
      || (p.brand && p.brand.toLowerCase().includes(query))
      || (p.label && p.label.toLowerCase().includes(query))
      || (p.watts != null && String(p.watts).includes(query))
    );
  };
  const isBrandOpen = (brand, brandPanels) =>
    Boolean(query)                                            // search mode = all open
    || expandedBrands.has(brand)                              // manually expanded
    || brandPanels.some(p => p.sku === armedPanelSku);        // auto-expand armed brand
  const toggleBrand = (brand) => setExpandedBrands(prev => {
    const next = new Set(prev);
    if (next.has(brand)) next.delete(brand);
    else next.add(brand);
    return next;
  });
  const grouped = useMemo(() => {
    const byBrand = new Map();
    for (const p of panels || []) {
      const key = p.brand || 'Other';
      if (!byBrand.has(key)) byBrand.set(key, []);
      byBrand.get(key).push(p);
    }
    return Array.from(byBrand.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [panels]);

  return (
    <aside className="w-72 flex-shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-hidden">
      {/* Live design totals — Phase 3b.8 promoted these out of the footer so
          they sit prominently next to the palette where the rep is working. */}
      <div className="px-4 py-3 border-b border-slate-200 flex-shrink-0 bg-slate-50">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-xs text-slate-500">Panels</div>
            <div className="text-lg font-semibold text-slate-900 tabular-nums">{panelCount ?? 0}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">System</div>
            <div className="text-lg font-semibold text-slate-900 tabular-nums">
              {(totalKw ?? 0).toFixed(2)}<span className="text-xs font-normal text-slate-500 ml-0.5">kW</span>
            </div>
          </div>
          <div title="Estimated annual production (median irradiance × panel wattage)">
            <div className="text-xs text-slate-500">Est. output</div>
            <div className="text-lg font-semibold text-emerald-700 tabular-nums">
              {((totalKwh ?? 0) / 1000).toFixed(1)}<span className="text-xs font-normal text-slate-500 ml-0.5">MWh/yr</span>
            </div>
          </div>
        </div>
      </div>
      {/* Phase 3b.13 — mixed-SKU advisory. Non-blocking: flags that the
          design uses more than one panel model so the engineer confirms
          MPPT/string design assumptions before pricing. */}
      {distinctSkuCount > 1 && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Design uses <b>{distinctSkuCount} panel SKUs</b>. Each string must
            be a single model — confirm inverter MPPT capacity before pricing.
          </span>
        </div>
      )}

      {/* Phase 3b.9 — roof faces list. Delete-face row + panel count. Collapsed
          when zero faces so a fresh design isn't crowded.
          Phase 3b.13 — auto-fill button per row uses the currently-armed SKU
          to greedy-fill every valid grid cell on the face. */}
      {Array.isArray(faces) && faces.length > 0 && (
        <div className="border-b border-slate-200 flex-shrink-0">
          <button
            type="button"
            onClick={() => onToggleSection?.('faces')}
            className="w-full flex items-center gap-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50 hover:bg-slate-100 border-b border-slate-100"
            title={sectionOpen?.faces ? 'Collapse this section' : 'Expand this section'}
          >
            {sectionOpen?.faces
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronRight className="w-3 h-3" />}
            <span className="flex-1 text-left">Roof faces</span>
            <span className="text-slate-400 font-normal normal-case">{faces.length}</span>
          </button>
          {sectionOpen?.faces && (
          <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {faces.map((f, i) => {
              const panelsOnFace = panelsPerFace.get(f.id) || 0;
              const source = f.source === 'google_solar' ? 'Google' : 'Traced';
              return (
                <li key={f.id} className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50 group">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-slate-800 truncate">
                      #{i + 1}
                      {f.azimuthDegrees != null && <span className="text-slate-500 font-normal"> · {azimuthToCompass(f.azimuthDegrees)}</span>}
                      {f.areaMetres2 > 0 && <span className="text-slate-500 font-normal"> · {f.areaMetres2.toFixed(1)}m²</span>}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {source} · {panelsOnFace} panel{panelsOnFace === 1 ? '' : 's'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAutoFillFace?.(f.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-emerald-700 transition-opacity"
                    title={armedPanelSku
                      ? 'Auto-fill this face with the armed panel'
                      : 'Arm a panel first, then click to auto-fill'}
                  >
                    🪄
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteFace?.(f.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 transition-opacity"
                    title="Delete this face (and any panels on it)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
          )}
        </div>
      )}

      {/* Phase 3c — obstructions list. Row per obstruction with type badge +
          delete button. Panels drop-check refuses to overlap these (rule
          engine from 3b.8), so this list is the ground truth for what real-
          world hazards the rep has flagged. */}
      {Array.isArray(obstructions) && obstructions.length > 0 && (
        <div className="border-b border-slate-200 flex-shrink-0">
          <button
            type="button"
            onClick={() => onToggleSection?.('obstructions')}
            className="w-full flex items-center gap-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50 hover:bg-slate-100 border-b border-slate-100"
            title={sectionOpen?.obstructions ? 'Collapse this section' : 'Expand this section'}
          >
            {sectionOpen?.obstructions
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronRight className="w-3 h-3" />}
            <span className="flex-1 text-left">Obstructions</span>
            <span className="text-slate-400 font-normal normal-case">{obstructions.length}</span>
          </button>
          {sectionOpen?.obstructions && (
          <ul className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
            {obstructions.map((o, i) => (
              <li key={o.id} className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50 group">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-800 truncate">
                    #{i + 1} · {o.type.charAt(0).toUpperCase() + o.type.slice(1)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    ⌀ {(o.radiusMetres * 2).toFixed(1)}m exclusion
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteObstruction?.(o.id)}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 transition-opacity"
                  title="Delete this obstruction"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
          )}
        </div>
      )}

      {/* Phase 3b.9 — arrays list. Collapsible header (Phase 3e cleanup). */}
      {Array.isArray(arrays) && arrays.length > 0 && (
        <div className="border-b border-slate-200 flex-shrink-0">
          <button
            type="button"
            onClick={() => onToggleSection?.('arrays')}
            className="w-full flex items-center gap-1 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50 hover:bg-slate-100 border-b border-slate-100"
            title={sectionOpen?.arrays ? 'Collapse this section' : 'Expand this section'}
          >
            {sectionOpen?.arrays
              ? <ChevronDown className="w-3 h-3" />
              : <ChevronRight className="w-3 h-3" />}
            <span className="flex-1 text-left">Arrays</span>
            <span className="text-slate-400 font-normal normal-case">{arrays.length}</span>
          </button>
          {sectionOpen?.arrays && (
          <ul className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {arrays.map(a => {
              const isConfirming = confirmingArrayId === a.id;
              const isCopying    = copyingArrayId === a.id;
              // Phase 3b.10 — copy target picker. Lists every face OTHER
              // than the one this array's panels live on (copying to the
              // same face would just overlap the source).
              if (isCopying) {
                const sourceFaceId = allPanels?.find(p => a.panelIds.includes(p.id))?.faceId;
                const targets = (faces || []).filter(f => f.id !== sourceFaceId);
                return (
                  <li key={a.id} className="px-4 py-3 bg-sky-50 border-l-4 border-sky-400">
                    <div className="text-xs text-slate-800 mb-2">
                      Copy <b>{a.name}</b> ({a.panelIds.length} panel{a.panelIds.length === 1 ? '' : 's'}) to which face?
                    </div>
                    {targets.length === 0 ? (
                      <div className="text-[11px] text-slate-500 italic">
                        No other faces to copy to. Trace another face first.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {targets.map((f, i) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => { onCopyArrayToFace?.(a.id, f.id); setCopyingArrayId(null); }}
                            className="px-2 py-1 text-[11px] font-semibold text-sky-800 bg-white hover:bg-sky-100 border border-sky-300 rounded"
                            title={`Copy this array's layout onto face #${faces.indexOf(f) + 1}`}
                          >
                            → #{faces.indexOf(f) + 1}
                            {f.azimuthDegrees != null && <span className="font-normal text-sky-600 ml-1">{azimuthToCompass(f.azimuthDegrees)}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setCopyingArrayId(null)}
                        className="px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </li>
                );
              }
              if (isConfirming) {
                // Inline confirm — three explicit choices so a mis-click can't
                // accidentally destroy panels.
                return (
                  <li key={a.id} className="px-4 py-3 bg-red-50 border-l-4 border-red-400">
                    <div className="text-xs text-slate-800 mb-2">
                      Delete <b>{a.name}</b> ({a.panelIds.length} panel{a.panelIds.length === 1 ? '' : 's'})?
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => { onUngroupArray?.(a.id); setConfirmingArrayId(null); }}
                        className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded"
                        title="Delete the group but keep the panels on the roof"
                      >
                        Un-group only
                      </button>
                      <button
                        type="button"
                        onClick={() => { onDeleteArrayAndPanels?.(a.id); setConfirmingArrayId(null); }}
                        className="px-2 py-1 text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 rounded"
                        title="Delete the group AND the panels in it"
                      >
                        Delete panels
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingArrayId(null)}
                        className="px-2 py-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </li>
                );
              }
              return (
                <li key={a.id} className="flex items-center gap-2 px-4 py-2 hover:bg-slate-50 group">
                  <button
                    type="button"
                    onClick={() => onSelectArray?.(a.id)}
                    className="flex-1 text-left min-w-0"
                    title={`Select the ${a.panelIds.length} panel${a.panelIds.length === 1 ? '' : 's'} in ${a.name}`}
                  >
                    <div className="text-xs font-semibold text-slate-800 truncate">{a.name}</div>
                    <div className="text-[10px] text-slate-500">
                      {a.panelIds.length} panel{a.panelIds.length === 1 ? '' : 's'}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCopyingArrayId(a.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-sky-600 transition-opacity"
                    title="Copy this array to another face"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingArrayId(a.id)}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-600 transition-opacity"
                    title="Delete this array (choose to keep or remove panels)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
          )}
        </div>
      )}

      <div className="px-4 py-3 border-b border-slate-200 flex-shrink-0">
        <div className="text-sm font-semibold text-slate-900">Panel palette</div>
        <div className="text-xs text-slate-500 mt-0.5">
          {panelCount > 0
            ? `Click a card to arm the next drop · Shift+click panels to group into arrays`
            : 'Click a card to arm, then click the roof to drop'}
        </div>
        {/* Phase 3b.12 — search box scales the palette to 100+ SKUs. When
            typing, the render below collapses to a flat filtered list. */}
        <div className="mt-2 relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={paletteSearch}
            onChange={e => setPaletteSearch(e.target.value)}
            placeholder="Search SKU, brand, or watts"
            className="w-full pl-7 pr-7 py-1.5 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
          {paletteSearch && (
            <button
              type="button"
              onClick={() => setPaletteSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-4 py-6 text-xs text-slate-500 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading catalogue…
          </div>
        )}
        {error && !loading && (
          <div className="px-4 py-3 text-xs text-red-700">
            Couldn't load panel catalogue: {error}
          </div>
        )}
        {!loading && !error && grouped.length === 0 && (
          <div className="px-4 py-6 text-xs text-slate-500">
            No panels in the catalogue yet. Ask an admin to add SKUs under Admin → Products.
          </div>
        )}
        {!loading && !error && grouped.length > 0
          && grouped.every(([, list]) => list.filter(matchesQuery).length === 0) && (
            <div className="px-4 py-6 text-xs text-slate-500">
              No panels match <b>"{paletteSearch}"</b>.
              <button
                type="button"
                onClick={() => setPaletteSearch('')}
                className="ml-1 text-blue-600 hover:underline"
              >
                Clear search
              </button>
            </div>
        )}

        {grouped.map(([brand, list]) => {
          const matched = list.filter(matchesQuery);
          if (matched.length === 0) return null;   // hide brands with no matches
          const open = isBrandOpen(brand, list);
          return (
            <div key={brand} className="border-b border-slate-100 last:border-b-0">
              <button
                type="button"
                onClick={() => toggleBrand(brand)}
                disabled={Boolean(query)}
                className={
                  'w-full flex items-center gap-1 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-slate-50 hover:bg-slate-100 transition-colors '
                  + (query ? 'text-slate-600 cursor-default' : 'text-slate-500')
                }
                title={query ? 'Expanded during search' : (open ? 'Collapse this brand' : 'Expand this brand')}
              >
                {open
                  ? <ChevronDown className="w-3 h-3" />
                  : <ChevronRight className="w-3 h-3" />}
                <span className="flex-1 text-left">{brand}</span>
                <span className="text-slate-400 font-normal normal-case">
                  {query
                    ? `${matched.length}/${list.length}`
                    : list.length}
                </span>
              </button>
              {open && (
                <ul className="divide-y divide-slate-100">
                  {matched.map(p => {
                    const armed = p.sku === armedPanelSku;
                    const dims = p.length_mm && p.width_mm
                      ? `${p.length_mm} × ${p.width_mm} mm`
                      : 'dims not set';
                    return (
                      <li key={p.sku}>
                        <button
                          type="button"
                          onClick={() => onArm(armed ? null : p.sku)}
                          className={
                            'w-full text-left px-4 py-2.5 text-xs transition-colors ' +
                            (armed
                              ? 'bg-blue-50 hover:bg-blue-100 border-l-4 border-blue-500'
                              : 'hover:bg-slate-50 border-l-4 border-transparent')
                          }
                          title={p.label || p.sku}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className={`font-semibold ${armed ? 'text-blue-900' : 'text-slate-800'}`}>
                              {p.watts ? `${p.watts}W` : '—W'}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400 truncate">
                              {p.sku}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{dims}</div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

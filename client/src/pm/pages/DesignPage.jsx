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
import { ChevronLeft, ZoomIn, ZoomOut, Maximize2, Save, Loader2, AlertCircle, X, Trash2 } from 'lucide-react';
import { pmQuotesAPI, pmContactsAPI } from '../services/pmQuotesApi';
import { pmDesignsAPI, emptyDesignState, migrateDesignState } from '../services/pmDesignsApi';
import { makeLatLngToPixel, makePixelToLatLng } from '../utils/roofOverlay';
import {
  importGoogleSegments, makeRoofFace, addFace,
  makePanel, addPanel, removePanel,
  faceContainingPoint, totalKilowatts, totalAnnualKwh, estimateFaceSunshine,
  snapToFaceGrid, polygonCentroidLL, PANEL_GRID_GAP_MM,
  inferAzimuthFromPolygon, distanceMetres,
  checkPanelDropRules, DROP_REASON_HUMAN, DEFAULT_FACE_SETBACK_M,
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

  // Phase 3b.7 (part) — click-to-select + Delete-key removal
  const [selectedPanelId, setSelectedPanelId] = useState(null);
  const selectedPanelIdRef = useRef(null);

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
  // without needing to re-bind on every arm/unarm. Also triggers a redraw
  // so the snap-grid preview appears/disappears immediately when the rep
  // arms or un-arms a panel (Phase 3b.6 viz).
  useEffect(() => {
    armedPanelSkuRef.current = armedPanelSku;
    layoutAndDrawRef.current?.();
  }, [armedPanelSku]);

  // Sync selectedPanelId → ref (same reason: keydown handler needs the
  // latest value without re-binding the listener on every selection change)
  // AND trigger a redraw so the selected panel's highlight updates.
  useEffect(() => {
    selectedPanelIdRef.current = selectedPanelId;
    layoutAndDrawRef.current?.();
  }, [selectedPanelId]);

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
  const deleteSelectedPanel = useCallback(() => {
    const id = selectedPanelIdRef.current;
    if (!id) return;
    stateRef.current = removePanel(stateRef.current, id);
    setPanelCount(stateRef.current.panels.length);
    setTotalKw(totalKilowatts(stateRef.current, panelCatalogueRef.current));
    setTotalKwh(totalAnnualKwh(stateRef.current, panelCatalogueRef.current));
    setSelectedPanelId(null);
    setDirty(true);
    layoutAndDrawRef.current?.();
  }, []);

  useEffect(() => {
    if (!selectedPanelId) return;
    const onKey = (e) => {
      // Ignore key events fired while the rep is typing in a text field.
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelectedPanel();
      } else if (e.key === 'Escape') {
        setSelectedPanelId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedPanelId, deleteSelectedPanel]);

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
        const facePolys = overlayRoofFaces({
          canvas: c,
          faces: stateRef.current?.roof?.faces || [],
          roofAnalysis: roofAnalysisRef.current,
          imgWidth: img.width, imgHeight: img.height,
          left, top, scale,
        });
        // Phase 3b.6 (viz) — dashed grid preview on each face while a panel
        // is armed, so the rep can see where the next drop will land.
        const gridObjs = overlayFaceGrid({
          canvas: c,
          faces: stateRef.current?.roof?.faces || [],
          panelCatalogueBySku: panelCatalogueRef.current,
          armedSku: armedPanelSkuRef.current,
          roofAnalysis: roofAnalysisRef.current,
          imgWidth: img.width, imgHeight: img.height,
          left, top, scale,
        });
        // Phase 3b.4 — dropped panels (rectangles at real-world dimensions).
        // 3b.7 (part) — pass selectedPanelId so the selected panel gets the
        // highlight stroke/fill treatment.
        const panelObjs = overlayPanels({
          canvas: c,
          panels: stateRef.current?.panels || [],
          panelCatalogueBySku: panelCatalogueRef.current,
          roofAnalysis: roofAnalysisRef.current,
          imgWidth: img.width, imgHeight: img.height,
          left, top, scale,
          selectedPanelId: selectedPanelIdRef.current,
        });
        // Phase 3b.3 — in-progress trace on top of everything.
        const traceObjects = overlayTraceInProgress({
          canvas: c,
          traceVertices: traceVerticesRef.current || [],
          roofAnalysis: roofAnalysisRef.current,
          imgWidth: img.width, imgHeight: img.height,
          left, top, scale,
        });
        overlayObjectsRef.current = [...facePolys, ...gridObjs, ...panelObjs, ...traceObjects];

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

      // Phase 3b.7 (part) — click on a panel selects it (highest priority so
      // it wins over tracing/dropping/panning). Clicked panel is identified
      // via the custom `data.panelId` we attach in overlayPanels. Clicking
      // empty area deselects. We skip this while tracing so vertex placement
      // inside a face's overlay isn't hijacked by a stray panel.
      const clickedPanelId = opt.target?.data?.panelId;
      if (!isTracingRef.current && clickedPanelId) {
        setSelectedPanelId(clickedPanelId);
        return;
      }
      // Any click NOT on a panel deselects. Cheap way to give the rep
      // "click somewhere blank to deselect" behaviour without a modifier key.
      if (selectedPanelIdRef.current && !clickedPanelId) {
        setSelectedPanelId(null);
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
                // Dedup: repeat clicks in the same grid cell would snap to the
                // exact same centre and silently stack panels. Skip the drop
                // if there's already a panel on this face within 100mm of the
                // snapped centre. Broader no-overlap enforcement lives in the
                // rule engine below.
                const isDupe = stateRef.current.panels.some(p =>
                  p.faceId === face.id
                  && distanceMetres(p.center, snappedCenter) < 0.1
                );
                if (isDupe) return;

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
      if (!isPanning) return;
      const evt = opt.e;
      const vpt = canvas.viewportTransform;
      vpt[4] += evt.clientX - lastPosX;
      vpt[5] += evt.clientY - lastPosY;
      canvas.requestRenderAll();
      lastPosX = evt.clientX;
      lastPosY = evt.clientY;
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
          {roofAnalysis?.roof_image_signed_url && !isTracing && (
            <button
              onClick={startTrace}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-full px-3 py-1"
              title="Manually trace a roof face by clicking each corner on the image"
            >
              ✏️ Trace face
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

        {/* Phase 3b.7 (part) — selected-panel hint bar (top-centre overlay) */}
        {selectedPanelId && !isTracing && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-sky-50 border border-sky-300 text-sky-900 px-4 py-2 rounded-lg shadow-md text-sm flex items-center gap-3">
            <span className="font-semibold">🔷 Panel selected</span>
            <span className="text-sky-700">Delete/Backspace to remove · Esc or click elsewhere to deselect</span>
            <button
              onClick={deleteSelectedPanel}
              className="ml-2 px-2 py-1 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded inline-flex items-center gap-1"
              title="Delete this panel"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
        )}

        {/* Phase 3b.8 — drop-rejected toast. Auto-dismisses in ~2.5s. */}
        {dropRejectReason && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-red-50 border border-red-300 text-red-900 px-4 py-2 rounded-lg shadow-md text-sm flex items-center gap-2 max-w-md">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{DROP_REASON_HUMAN[dropRejectReason] || `Drop rejected (${dropRejectReason})`}</span>
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

      {/* ── Right sidebar: panel palette (Phase 3b.4) ─────────────────── */}
      <PanelPalette
        panels={catalogue?.panels || []}
        loading={catalogueLoading}
        error={catalogueError}
        armedPanelSku={armedPanelSku}
        onArm={setArmedPanelSku}
        panelCount={panelCount}
        totalKw={totalKw}
        totalKwh={totalKwh}
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
function overlayRoofFaces({ canvas, faces, roofAnalysis, imgWidth, imgHeight, left, top, scale }) {
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

  faces.forEach((face, i) => {
    if (!Array.isArray(face.polygon) || face.polygon.length < 3) return;

    const points = face.polygon.map(v => toCanvas(toPixel(v.latitude, v.longitude)));

    const isGoogle = face.source === 'google_solar';
    const fill   = isGoogle ? 'rgba(245, 166, 35, 0.18)' : 'rgba(74, 124, 89, 0.18)';
    const stroke = isGoogle ? 'rgba(255, 106, 0, 0.9)'   : 'rgba(74, 124, 89, 0.9)';

    const polygon = new fabric.Polygon(points, {
      ...TL_ORIGIN,
      fill, stroke, strokeWidth: 2,
      selectable: false,   // Phase 3b.7 will make faces selectable
      evented: false,
      hoverCursor: 'grab',
    });
    canvas.add(polygon);
    created.push(polygon);

    // Small label at the polygon centroid with pitch + orientation + irradiance
    const centroid = polygonCentroid(points);
    const parts = [`#${i + 1}`];
    if (face.areaMetres2)    parts.push(`${face.areaMetres2.toFixed(1)}m²`);
    if (face.azimuthDegrees != null) parts.push(azimuthToCompass(face.azimuthDegrees));
    if (face.pitchDegrees   != null) parts.push(`${face.pitchDegrees.toFixed(0)}°`);
    // Phase 3b.8 — per-face solar irradiance (kWh/kW/yr) when we have it.
    // Google-imported faces get the segment median from Google Solar's
    // sunshineQuantiles; manual faces stay unlabelled (the footer's total
    // still estimates them via estimateFaceSunshine).
    if (typeof face.sunshineKwhPerKwPerYear === 'number' && face.sunshineKwhPerKwPerYear > 0) {
      parts.push(`${Math.round(face.sunshineKwhPerKwPerYear)} kWh/kW/yr`);
    }
    const label = new fabric.Text(parts.join(' · '), {
      left: centroid.x, top: centroid.y,
      originX: 'center', originY: 'center',
      fontSize: 10,
      fontFamily: '-apple-system, "Segoe UI", system-ui, sans-serif',
      fill: '#1B1810',
      backgroundColor: 'rgba(255, 253, 246, 0.85)',
      padding: 2,
      selectable: false, evented: false,
    });
    canvas.add(label);
    created.push(label);
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
function overlayPanels({ canvas, panels, panelCatalogueBySku, roofAnalysis, imgWidth, imgHeight, left, top, scale, selectedPanelId }) {
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

    const isSelected = panel.id === selectedPanelId;
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
    const group = new fabric.Group([body, busbar], {
      left: centerCanvas.x, top: centerCanvas.y,
      originX: 'center', originY: 'center',
      angle:  Number(panel.rotationDegrees) || 0,
      selectable: false, evented: true,     // Fabric selection off — we handle click-to-select in mouse:down
      hoverCursor: 'pointer',
    });
    group.data = { panelId: panel.id };     // stash id so mouse:down can look it up
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
function PanelPalette({ panels, loading, error, armedPanelSku, onArm, panelCount, totalKw, totalKwh }) {
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
      <div className="px-4 py-3 border-b border-slate-200 flex-shrink-0">
        <div className="text-sm font-semibold text-slate-900">Panel palette</div>
        <div className="text-xs text-slate-500 mt-0.5">
          {panelCount > 0
            ? `Click a card to arm the next drop`
            : 'Click a card to arm, then click the roof to drop'}
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

        {grouped.map(([brand, list]) => (
          <div key={brand} className="border-b border-slate-100 last:border-b-0">
            <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50">
              {brand}
            </div>
            <ul className="divide-y divide-slate-100">
              {list.map(p => {
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
          </div>
        ))}
      </div>
    </aside>
  );
}

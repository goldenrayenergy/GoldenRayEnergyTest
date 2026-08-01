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

import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as fabric from 'fabric';
import { ChevronLeft, ZoomIn, ZoomOut, Maximize2, Save, Loader2, AlertCircle } from 'lucide-react';
import { pmQuotesAPI, pmContactsAPI } from '../services/pmQuotesApi';
import { pmDesignsAPI, emptyDesignState, migrateDesignState } from '../services/pmDesignsApi';
import { makeLatLngToPixel } from '../utils/roofOverlay';
import { importGoogleSegments } from '../utils/designState';
// segmentBboxToPolygon + segmentLabel remain exported from roofOverlay.js —
// Phase 3b will re-import them when we render segment polygons for panel placement.

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
      } catch (e) {
        if (!cancelled) setLoadError(e.response?.data?.error || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [quoteId]);

  // ── Serialize the current canvas + view state into the state blob ──────
  const captureCanvasState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return stateRef.current;
    const zoom = canvas.getZoom();
    const vpt = canvas.viewportTransform;
    return {
      view: { zoom, panX: vpt?.[4] ?? 0, panY: vpt?.[5] ?? 0 },
      canvas: { serialized: JSON.stringify(canvas.toJSON()) },
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
        for (const obj of overlayObjectsRef.current) c.remove(obj);
        const propertyMarker = overlayRoofSegments({
          canvas: c, roofAnalysis: roofAnalysisRef.current,
          imgWidth: img.width, imgHeight: img.height,
          left, top, scale,
        });
        // Phase 3b.2 — draw the imported/manual roof faces on top of the image.
        const facePolys = overlayRoofFaces({
          canvas: c,
          faces: stateRef.current?.roof?.faces || [],
          roofAnalysis: roofAnalysisRef.current,
          imgWidth: img.width, imgHeight: img.height,
          left, top, scale,
        });
        overlayObjectsRef.current = [...propertyMarker, ...facePolys];

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
      const evt = opt.e;
      isPanning = true;
      canvas.setCursor('grabbing');
      canvas.defaultCursor = 'grabbing';
      lastPosX = evt.clientX;
      lastPosY = evt.clientY;
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

      {/* ── Canvas region ───────────────────────────────────────────── */}
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
        <canvas ref={canvasElRef} />

        {/* Zoom controls (bottom-left overlay) */}
        <div className="absolute bottom-4 left-4 bg-white border border-slate-200 rounded shadow-sm flex flex-col divide-y divide-slate-200">
          <button onClick={zoomIn}  className="p-2 hover:bg-slate-50" title="Zoom in"><ZoomIn className="w-4 h-4" /></button>
          <button onClick={zoomOut} className="p-2 hover:bg-slate-50" title="Zoom out"><ZoomOut className="w-4 h-4" /></button>
          <button onClick={zoomFit} className="p-2 hover:bg-slate-50" title="Reset view"><Maximize2 className="w-4 h-4" /></button>
        </div>
      </div>

      {/* ── Footer status bar ───────────────────────────────────────── */}
      <div className="border-t border-slate-200 bg-white px-4 py-1.5 flex-shrink-0 flex items-center justify-between text-xs text-slate-500">
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
          Phase 3a — canvas + roof image + pan/zoom. Panels come in Phase 3b.
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

// Overlay a marker at the property centre — a crosshair + ring + "Customer
// property" pin. Positioned in image-pixel space then transformed to canvas
// coords using the same (left, top, scale) as the underlying image, so it
// stays locked to the roof no matter how the user pans/zooms.
//
// Phase 3a intentionally only draws the property marker. Segment polygons +
// labels made the small NZ suburban roof (~50m² across 3 tiny faces) too
// cluttered to read. Segments come back in Phase 3b when panels are being
// dropped onto specific faces — at that point the polygons ARE the interaction
// target, not decoration, so they belong on the canvas again.
function overlayRoofSegments({ canvas, roofAnalysis, imgWidth, imgHeight, left, top, scale }) {
  const created = [];
  const centerLat = Number(roofAnalysis?.latitude);
  const centerLng = Number(roofAnalysis?.longitude);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return created;

  const toPixel = makeLatLngToPixel({
    centerLat, centerLng,
    radiusMeters: radiusForAnalysis(roofAnalysis),
    imgWidth, imgHeight,
  });
  const toCanvas = (p) => ({ x: left + p.x * scale, y: top + p.y * scale });

  // ── Property centre crosshair + label ─────────────────────────────────
  const centerCanvas = toCanvas({ x: imgWidth / 2, y: imgHeight / 2 });
  const cross1 = new fabric.Line(
    [centerCanvas.x - 14, centerCanvas.y, centerCanvas.x + 14, centerCanvas.y],
    { ...TL_ORIGIN, stroke: '#FF6A00', strokeWidth: 2, selectable: false, evented: false }
  );
  const cross2 = new fabric.Line(
    [centerCanvas.x, centerCanvas.y - 14, centerCanvas.x, centerCanvas.y + 14],
    { ...TL_ORIGIN, stroke: '#FF6A00', strokeWidth: 2, selectable: false, evented: false }
  );
  const ring = new fabric.Circle({
    left: centerCanvas.x, top: centerCanvas.y,
    originX: 'center', originY: 'center',   // centre-origin: ring sits ON the crosshair centre
    radius: 7,
    fill: 'transparent',
    stroke: '#FF6A00',
    strokeWidth: 2,
    selectable: false, evented: false,
  });
  const pin = new fabric.Text('◉ Customer property', {
    ...TL_ORIGIN,
    left: centerCanvas.x + 12,
    top: centerCanvas.y - 24,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: '-apple-system, "Segoe UI", system-ui, sans-serif',
    fill: '#7A2E0A',
    backgroundColor: 'rgba(253, 224, 204, 0.95)',
    padding: 3,
    selectable: false, evented: false,
  });
  canvas.add(cross1, cross2, ring, pin);
  created.push(cross1, cross2, ring, pin);

  return created;
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

    // Small label at the polygon centroid with pitch + orientation
    const centroid = polygonCentroid(points);
    const parts = [`#${i + 1}`];
    if (face.areaMetres2)    parts.push(`${face.areaMetres2.toFixed(1)}m²`);
    if (face.azimuthDegrees != null) parts.push(azimuthToCompass(face.azimuthDegrees));
    if (face.pitchDegrees   != null) parts.push(`${face.pitchDegrees.toFixed(0)}°`);
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

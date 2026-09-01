// Aerial2DPanelView — Path B (2026-08-26) 2D fallback for the roof render.
//
// Renders a top-down Google Static Maps satellite tile with SVG panel
// overlays positioned via Web Mercator math. Used when the server's
// analyse endpoint returns render_mode='2d' (LiDAR fallback path OR
// nearest-not-containing polygon), which correlates with regions where
// Cesium's Photorealistic 3D Tiles are patchy (Queenstown, Waikanae,
// regional/rural NZ).
//
// Same signature as Cesium3DPanelHero so QuoteStage can swap in/out:
//   { coords, segments, solarPanels, panelTargetCount, recommendedTier,
//     building, onPlacementChange, showBattery, showEv }
//
// Panel data comes from the SAME layout functions Cesium3DPanelHero
// uses (selectViableSegments → enrichSegmentsWithFaceDimensions →
// distributePanels → computePanelGridOnSegment). Only the RENDERER
// differs — 2D SVG rectangles rotated to azimuth, instead of 3D
// Cesium entities placed on a mesh.
//
// No altitude / mesh-sampling / tile-loading gotchas — 2D projection
// is deterministic. If the panel lat/lng is correct, the visual is
// correct. This is Path B's whole point: eliminate the "panels
// floating in sky" failure mode by removing the 3D coordinate math.

import { useEffect, useMemo, useState } from 'react';
import { InfoIcon } from 'lucide-react';
import {
  selectViableSegments,
  distributePanels,
  computePanelGridOnSegment,
  enrichSegmentsWithFaceDimensions,
  deduplicateOverlappingFootprints,
  annotateOpposingFaces,
} from '../3d/panelGrid.js';
import { buildApiImageUrl } from '../../../services/apiImageUrl.js';

// ── Config ─────────────────────────────────────────────────────────────
// Google Static Maps free-tier limit is 640×640 (with paid API key we
// could go 1280×1280 with scale=2 param). Keep at 640 for compat.
const IMG_SIZE = 640;
const ZOOM = 20;   // ~59 cm/pixel at NZ latitudes — tight enough for
                    // panel-scale detail, wide enough to show ~40m of
                    // surrounding context

// Web Mercator metres-per-pixel at a given latitude + zoom.
function metersPerPixel(lat, zoom) {
  return 40075016.686 * Math.cos(lat * Math.PI / 180) / (256 * Math.pow(2, zoom));
}

// Project a WGS84 point onto the SVG image plane (assumes the image is
// centred at `centerLat/centerLng`, with north-up orientation, and
// `metersPerPx` scale).
function projectToPixel(lat, lng, centerLat, centerLng, metersPerPx) {
  const dLat = lat - centerLat;
  const dLng = lng - centerLng;
  const dyM  = dLat * 111_320;                                     // north +
  const dxM  = dLng * 111_320 * Math.cos(centerLat * Math.PI / 180); // east +
  return {
    x: IMG_SIZE / 2 + dxM / metersPerPx,
    y: IMG_SIZE / 2 - dyM / metersPerPx,   // SVG y grows down; north = up
  };
}

export function Aerial2DPanelView({
  coords, segments = [], solarPanels = [], panelTargetCount = 0,
  recommendedTier, building, onPlacementChange,
}) {
  const [showLegend, setShowLegend] = useState(false);

  const centerLat = Number(coords?.latitude) || 0;
  const centerLng = Number(coords?.longitude) || 0;
  const metersPerPx = useMemo(() => metersPerPixel(centerLat, ZOOM), [centerLat]);

  // Resolve real panel dimensions from the recommended tier's catalogue
  // row (Phono 595W = 1.879×1.045 m), fall back to typical residential
  // dims when the row lacks them (matches Cesium3DView's fallback).
  const panelDims = useMemo(() => {
    const l = recommendedTier?.panel?.length_mm;
    const w = recommendedTier?.panel?.width_mm;
    if (l && w) {
      return { longM: Math.max(l, w) / 1000, shortM: Math.min(l, w) / 1000 };
    }
    return { longM: 1.65, shortM: 0.99 };
  }, [recommendedTier?.panel?.length_mm, recommendedTier?.panel?.width_mm]);

  // Compute the panel layout using the same math the 3D path uses.
  // Pure functions — no I/O, no side effects.
  const panels = useMemo(() => {
    if (!Array.isArray(segments) || segments.length === 0) return [];
    if (!panelTargetCount || panelTargetCount <= 0) return [];
    const enriched = enrichSegmentsWithFaceDimensions(segments, solarPanels || []);
    // Bug 1 fix (2026-08-31) — S-inclusion fallback. Same policy as
    // Cesium3DView: if primary-orientation viable area is tiny (<20 m²),
    // retry with skipSouth=false so a lone-S-facing roof can still take
    // panels. Keeps 2D and 3D render paths in lockstep.
    let viable = selectViableSegments(enriched);
    const primaryAreaM2 = viable.reduce((s, x) => s + (x?.stats?.areaMeters2 || 0), 0);
    if (primaryAreaM2 < 20) {
      const withSouth = selectViableSegments(enriched, { skipSouth: false });
      if (withSouth.reduce((s, x) => s + (x?.stats?.areaMeters2 || 0), 0) > primaryAreaM2) {
        viable = withSouth;
      }
    }
    // Bug 6 wire-up (2026-08-31) — same overlap dedupe as Cesium3DView
    viable = deduplicateOverlappingFootprints(viable, { overlapPct: 0.5 });
    if (!viable.length) return [];
    // Ridge setback wire-up (2026-08-31) — annotate opposing-face pairs so
    // computePanelGridOnSegment reserves 0.8 m of depth on the ridge side.
    // Keeps 2D and 3D render paths in lockstep.
    annotateOpposingFaces(viable);
    // Fix 9 (2026-08-27): pass ALL viable to distributePanels so the
    // orientation-first fill can pick the best faces (N always
    // preferred). Safety cap at 8 to avoid pathological cases.
    // minPerSeg=4 matches Fronius MPPT string minimum.
    const top = viable.slice(0, 8);
    const allocations = distributePanels(
      top, panelTargetCount, 4,
      panelDims.longM * panelDims.shortM,
      panelDims.longM, panelDims.shortM,
    );
    // Fix 10 (2026-08-27) — same polygon-clip as Cesium3DView, applies
    // here too because 2D SVG rendering trusts panelGrid's lat/lng.
    const polygonRing = building?.polygon?.[0] || null;
    const all = [];
    for (const { segment, count } of allocations) {
      const arr = computePanelGridOnSegment(segment, panelDims.longM, panelDims.shortM, count, polygonRing);
      for (const p of arr) all.push(p);
    }
    return all;
  }, [segments, solarPanels, panelTargetCount, panelDims.longM, panelDims.shortM, building]);

  // Bubble the placement count up to the parent (matches
  // Cesium3DPanelHero.onPlacementChange contract) so QuoteStage's
  // roof-fit re-compose logic can react to the actual rendered count.
  useEffect(() => {
    if (typeof onPlacementChange === 'function') {
      onPlacementChange({
        totalRendered: panels.length,
        perSegment: [],           // 2D mode doesn't track per-segment breakdown
        skippedSegments: 0,
        renderMode: '2d',
      });
    }
  }, [panels.length, onPlacementChange]);

  // Project each panel + the building polygon into SVG viewport pixels
  // once per render (cheap — plain arithmetic).
  const projectedPanels = useMemo(() => {
    const longPx  = panelDims.longM  / metersPerPx;
    const shortPx = panelDims.shortM / metersPerPx;
    return panels.map(p => {
      const { x, y } = projectToPixel(
        p.center.latitude, p.center.longitude,
        centerLat, centerLng, metersPerPx,
      );
      return { x, y, longPx, shortPx, azimuth: p.azimuthDeg || 0 };
    });
  }, [panels, panelDims.longM, panelDims.shortM, centerLat, centerLng, metersPerPx]);

  const projectedBuildingPolygon = useMemo(() => {
    const ring = building?.polygon?.[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    return ring.map(([lng, lat]) => projectToPixel(lat, lng, centerLat, centerLng, metersPerPx));
  }, [building, centerLat, centerLng, metersPerPx]);

  // Google Static Maps satellite through our existing proxy — hides the
  // API key + centralises billing. Path B uses zoom 20 for close-up
  // panel-scale detail. Format-8-bit satellite for max detail.
  //
  // Fix (2026-09-01) — prefix VITE_API_BASE_URL so the <img src> resolves
  // to the Render backend on Vercel-hosted prod. Without this, the plain
  // relative path resolves to the Vercel frontend origin which returns
  // index.html (SPA fallback) → browser can't render HTML as a JPEG →
  // blank image tile (whole 2D fallback view breaks).
  const aerialUrl = buildApiImageUrl(
    import.meta.env.VITE_API_BASE_URL || '',
    `/api/aerial/google?lat=${centerLat}&lng=${centerLng}&zoom=${ZOOM}&size=${IMG_SIZE}x${IMG_SIZE}&marker=0`,
  );

  return (
    <div className="w-full">
      {/* Path B honest banner — small, one line, doesn't overwhelm */}
      <div className="mb-3 inline-flex items-start gap-2 px-3 py-2 rounded-lg bg-[#F4EEE1] border border-[#E3D9C4] text-xs text-[#55504A]">
        <InfoIcon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[#8B8377]" />
        <span>
          Showing a satellite view for this address — 3D detail is limited in this region.
          Numbers below are calibrated to your roof; a site survey confirms exact panel placement.
        </span>
      </div>

      <div className="relative rounded-2xl overflow-hidden border border-[#E3D9C4] bg-[#0f1523] mx-auto"
           style={{ width: '100%', maxWidth: IMG_SIZE, aspectRatio: '1 / 1' }}>
        {/* Aerial background (Google Static Maps satellite via our proxy) */}
        <img
          src={aerialUrl}
          alt={`Aerial view of your property at ${centerLat.toFixed(6)}, ${centerLng.toFixed(6)}`}
          width={IMG_SIZE}
          height={IMG_SIZE}
          className="absolute inset-0 w-full h-full object-cover"
          onLoad={() => setShowLegend(true)}
        />

        {/* SVG overlay: building outline + panels + compass */}
        <svg
          viewBox={`0 0 ${IMG_SIZE} ${IMG_SIZE}`}
          className="absolute inset-0 w-full h-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Building polygon outline (OSM/LINZ) — dashed orange so the
              customer can see we've locked onto their building */}
          {projectedBuildingPolygon && projectedBuildingPolygon.length >= 3 && (
            <polygon
              points={projectedBuildingPolygon.map(p => `${p.x},${p.y}`).join(' ')}
              fill="rgba(217,83,30,0.08)"
              stroke="#D9531E"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              opacity="0.75"
            />
          )}

          {/* Panels — dark navy rectangles rotated to each panel's azimuth */}
          {projectedPanels.map((p, i) => (
            <rect
              key={i}
              x={p.x - p.longPx / 2}
              y={p.y - p.shortPx / 2}
              width={p.longPx}
              height={p.shortPx}
              fill="#1e3a8a"
              stroke="#0c1e5b"
              strokeWidth="0.4"
              transform={`rotate(${p.azimuth} ${p.x} ${p.y})`}
              opacity="0.90"
            />
          ))}

          {/* Compass rose — top-left */}
          <g transform="translate(40, 40)" opacity="0.85">
            <circle r="26" fill="rgba(15,21,35,0.75)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
            <text y="-10" textAnchor="middle" fill="#fff" fontSize="11" fontWeight="700"
                  style={{ fontFamily: 'system-ui,sans-serif' }}>N</text>
            <path d="M0,-18 L5,10 L0,6 L-5,10 Z" fill="#ef4444" />
            <text y="22" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="8"
                  style={{ fontFamily: 'system-ui,sans-serif' }}>S</text>
          </g>

          {/* Legend — bottom-right */}
          {showLegend && (
            <g transform={`translate(${IMG_SIZE - 20}, ${IMG_SIZE - 30})`} opacity="0.9">
              <rect x="-140" y="-14" width="140" height="26" rx="4"
                    fill="rgba(15,21,35,0.8)" stroke="rgba(255,255,255,0.2)" strokeWidth="0.5" />
              <rect x="-130" y="-6" width="12" height="8" fill="#1e3a8a" opacity="0.9" />
              <text x="-113" y="2" fill="#fff" fontSize="10"
                    style={{ fontFamily: 'system-ui,sans-serif' }}>
                {panels.length} panels
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

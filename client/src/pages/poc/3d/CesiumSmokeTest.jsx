// POC — Cesium + Google Photorealistic 3D Tiles smoke test.
//
// Standalone page at /poc/3d-test. Loads a rotatable/tiltable 3D scene
// using Google's Photorealistic 3D Tiles.
//
// Server counterpart: server/routes/poc/threed.js (GET /api/poc/3d/tileset-config)
//
// Query string modes:
//   Default:      ?lat=&lng=&height=&heading=&pitch=   → free-look at coord
//   Demo panels:  ?panels=demo                          → hardcoded 6 Woodacre
//   LIVE ADDRESS: ?address=25+Commodore+Drive+Lynfield  → fetches live analyse
//                                                          data + renders panels
//                                                          snapped to Cesium mesh
//
// When ?address= is present, the smoke test:
//   1. Calls /api/poc/places/autocomplete to resolve address → Place ID
//   2. Calls /api/poc/roof/analyse to get Google Solar roof segments
//   3. Picks the largest segment and computes an idealized panel grid
//   4. Uses Cesium's sampleHeightMostDetailed() to snap each panel's altitude
//      to the ACTUAL 3D Tiles mesh height at that lat/lng (not Google Solar's
//      MSL altitude which mismatches Cesium's ellipsoid frame)
//   5. Renders panels flush on the roof

import { useEffect, useRef, useState } from 'react';
import { publicApi } from '../../../services/api';
import {
  computePanelGridOnSegment,
  pickLargestSegment,
  selectViableSegments,
  distributePanels,
} from './panelGrid';
import { addPanelEntities } from './cesiumPanelEntities';
import 'cesium/Build/Cesium/Widgets/widgets.css';

// Log the current camera position with a label — used for diagnostics so we
// know what Cesium actually did rather than what we asked it to do.
function logCamera(viewer, Cesium, label) {
  try {
    const carto = viewer.camera.positionCartographic;
    console.log(`[camera] ${label}: lat=${Cesium.Math.toDegrees(carto.latitude).toFixed(7)}, lng=${Cesium.Math.toDegrees(carto.longitude).toFixed(7)}, alt=${carto.height.toFixed(1)}m, heading=${Cesium.Math.toDegrees(viewer.camera.heading).toFixed(1)}°, pitch=${Cesium.Math.toDegrees(viewer.camera.pitch).toFixed(1)}°`);
  } catch (e) {
    console.warn(`[camera] ${label}: failed to read position -`, e.message);
  }
}

// Hardcoded test segments for the 6 Woodacre Street response we captured
// earlier. Used when ?panels=demo is set on the URL — proves the panel
// pipeline against real Google Solar data without needing a live analyse
// call. Segment 7 was the largest (237.6 m², azimuth ~350°, pitch ~44°).
const DEMO_6_WOODACRE_SEGMENTS = [
  {
    pitchDegrees: 43.64416, azimuthDegrees: 350.3265,
    stats: { areaMeters2: 237.59048, groundAreaMeters2: 171.93 },
    center: { latitude: -36.9837872, longitude: 174.9389885 },
    planeHeightAtCenterMeters: 116.354355,
  },
  {
    pitchDegrees: 44.087063, azimuthDegrees: 352.29538,
    stats: { areaMeters2: 118.56045, groundAreaMeters2: 85.16 },
    center: { latitude: -36.9839415, longitude: 174.9390473 },
    planeHeightAtCenterMeters: 115.84474,
  },
  {
    pitchDegrees: 42.128353, azimuthDegrees: 162.19922,
    stats: { areaMeters2: 160.34648, groundAreaMeters2: 118.92 },
    center: { latitude: -36.983821899999995, longitude: 174.9390674 },
    planeHeightAtCenterMeters: 116.22671,
  },
];

export default function CesiumSmokeTest() {
  const viewerRef = useRef(null);          // <div> that Cesium mounts into
  const cesiumViewerRef = useRef(null);    // the Cesium.Viewer instance
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [attribution, setAttribution] = useState('');
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let viewer = null;

    (async () => {
      try {
        // 1. Get the tileset URL + attribution from our server. Keeps the
        //    API key server-side; browser only sees the ready-to-use URL.
        setStatus('fetching-config');
        const { data: config } = await publicApi.get('/poc/3d/tileset-config');
        if (cancelled) return;
        setAttribution(config.attribution);

        // 2. Dynamic-import Cesium so the ~1.5MB library is code-split and
        //    only loads when the user actually hits the 3D page.
        setStatus('loading-cesium');
        const Cesium = await import('cesium');
        if (cancelled) return;

        // Cesium needs a base URL for its static assets (widgets, workers).
        // vite-plugin-cesium sets window.CESIUM_BASE_URL automatically.

        // 3. Read camera params from URL query string (falls back to config
        //    defaults which currently point to Auckland CBD).
        const q = new URLSearchParams(window.location.search);
        const lat  = parseFloat(q.get('lat'))  || config.default_camera.latitude;
        const lng  = parseFloat(q.get('lng'))  || config.default_camera.longitude;
        const alt  = parseFloat(q.get('height')) || config.default_camera.height_m;
        const heading = parseFloat(q.get('heading')) || config.default_camera.heading_deg;
        const pitch   = parseFloat(q.get('pitch'))   || config.default_camera.pitch_deg;
        setMeta({ lat, lng, alt, heading, pitch });

        // 4. Create the viewer. We disable most of Cesium's default widgets
        //    (timeline, animation, geocoder, base layer picker) since we
        //    want a clean camera surface for our own UI.
        setStatus('creating-viewer');
        viewer = new Cesium.Viewer(viewerRef.current, {
          timeline:            false,
          animation:           false,
          geocoder:            false,
          baseLayerPicker:     false,
          homeButton:          false,
          sceneModePicker:     false,
          navigationHelpButton: false,
          fullscreenButton:    false,
          infoBox:             false,
          selectionIndicator:  false,
          // Disable the default imagery layer — Photorealistic 3D Tiles
          // include textures baked in, so a base map would just add cost.
          baseLayer:           false,
          // Disable atmospheric skybox rendering for a cleaner UI while
          // we're on a specific building (can re-enable later).
          skyBox:              false,
          skyAtmosphere:       false,
        });
        cesiumViewerRef.current = viewer;

        // Make sure Cesium doesn't render an empty blue globe under the
        // photorealistic mesh — those tiles include ground.
        viewer.scene.globe.show = false;

        // 5. Load the Photorealistic 3D Tileset from Google.
        setStatus('loading-tileset');
        const tileset = await Cesium.Cesium3DTileset.fromUrl(config.tileset_url, {
          // Show the credit chip Google requires.
          showCreditsOnScreen: true,
        });
        if (cancelled) { viewer.destroy(); return; }
        viewer.scene.primitives.add(tileset);

        // 6. Panels mode. Three branches:
        //    - ?address=X : fetch live analyse for the address + snap panels to Cesium mesh
        //    - ?panels=demo : use hardcoded 6 Woodacre segments (legacy diagnostic path)
        //    - neither    : just show the 3D scene, no panels
        const panelsMode  = q.get('panels');
        const addressMode = q.get('address');
        let panelCount = 0;
        let segmentBreakdown = null;  // populated by address-mode: [{orient:'N', count:12}, ...]

        if (addressMode) {
          setStatus('resolving-address');
          console.log(`[address-mode] Looking up "${addressMode}"`);

          // 6a. Places autocomplete → first suggestion → Place ID.
          const { data: ac } = await publicApi.get('/poc/places/autocomplete', {
            params: { input: addressMode },
          });
          if (cancelled) { viewer.destroy(); return; }
          const first = ac?.suggestions?.[0];
          if (!first?.place_id) {
            throw new Error(`No Places autocomplete match for "${addressMode}". Try a more specific address.`);
          }
          console.log(`[address-mode] Matched Places suggestion: ${first.text}`);
          console.log(`[address-mode] place_id = ${first.place_id}`);

          // 6b. Analyse endpoint → segments + coord.
          setStatus('fetching-analyse');
          const { data: analyse } = await publicApi.post('/poc/roof/analyse', {
            place_id: first.place_id,
          });
          if (cancelled) { viewer.destroy(); return; }
          const segments = analyse?.roof?.segments || [];
          const coords   = analyse?.coords;
          console.log(`[address-mode] analyse: ${segments.length} segments, coords ${coords?.latitude}, ${coords?.longitude}`);

          if (!segments.length) {
            throw new Error(`Google Solar returned zero roof segments for this address — either no coverage, or a data gap. Try a different address, or wait for Phase B (LiDAR) to fix new-subdivision cases.`);
          }

          // 6c. Filter to viable segments (skip south-facing, too-small, too-flat, too-steep)
          //     and rank by area × orientation-yield-factor.
          const viable = selectViableSegments(segments);
          if (!viable.length) {
            throw new Error(`No viable roof segments found for this address (${segments.length} raw segments were either south-facing, too small, or wrong pitch). This is a real solar coverage problem.`);
          }
          console.log(`[address-mode] Viable segments (best first):`);
          viable.forEach((s, i) => {
            const v = s._viability;
            console.log(`  #${i}: ${v.orientation}-facing (az ${v.azNorm.toFixed(0)}°), pitch ${s.pitchDegrees?.toFixed(1)}°, area ${s.stats?.areaMeters2?.toFixed(1)} m², rank ${v.rank.toFixed(1)}`);
          });

          // 6d. Take top 3 segments and distribute the total panel target
          //     proportionally to each segment's area × orientation-factor.
          const maxSegments = parseInt(q.get('segments'), 10) || 3;
          const topSegments = viable.slice(0, maxSegments);
          const targetCount = parseInt(q.get('count'), 10) || 17;
          const allocations = distributePanels(topSegments, targetCount);
          if (!allocations.length) {
            throw new Error(`distributePanels returned no allocations for ${topSegments.length} segments — this shouldn't happen.`);
          }
          console.log(`[address-mode] Panel allocation across ${allocations.length} segment(s):`);
          allocations.forEach(a => {
            console.log(`  ${a.segment._viability.orientation}-face (${a.segment.stats?.areaMeters2?.toFixed(1)} m²): ${a.count} panels`);
          });

          // 6e. Position camera above the CENTROID of allocated segments so
          //     tiles start loading BEFORE we sample mesh heights.
          const centroidLat = allocations.reduce((s, a) => s + a.segment.center.latitude,  0) / allocations.length;
          const centroidLng = allocations.reduce((s, a) => s + a.segment.center.longitude, 0) / allocations.length;
          viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(centroidLng, centroidLat, 200),
            orientation: {
              heading: Cesium.Math.toRadians(0),
              pitch:   Cesium.Math.toRadians(-90),
              roll:    0,
            },
          });

          // Wait a beat for tiles to stream in around the centroid, THEN
          // sample mesh heights per-segment.
          setStatus('sampling-mesh');
          await new Promise((r) => setTimeout(r, 1500));

          // 6f. For each allocated segment: compute grid → sample mesh →
          //     apply median rigid offset → render entities.
          //     Per-segment (NOT globally): each roof face has its own
          //     Google-Solar-to-Cesium-mesh datum offset (typically all
          //     within ±1m for the same building, but could differ if
          //     one face has heavy foliage over it).
          setStatus('rendering-panels');
          const allEntities = [];
          let totalRendered = 0;
          for (const { segment, count } of allocations) {
            const segPanels = computePanelGridOnSegment(segment, 1.65, 0.99, count);
            if (!segPanels.length) {
              console.warn(`[address-mode] Segment ${segment._viability.orientation}: computePanelGrid returned 0 panels for count=${count}, skipping`);
              continue;
            }

            // Mesh sample for THIS segment's panels.
            const positions = segPanels.map(p =>
              Cesium.Cartographic.fromDegrees(p.center.longitude, p.center.latitude, 0),
            );
            const sampled = await viewer.scene.sampleHeightMostDetailed(positions);
            if (cancelled) { viewer.destroy(); return; }

            const deltas = [];
            segPanels.forEach((p, i) => {
              const meshH = sampled[i]?.height;
              if (Number.isFinite(meshH) && Number.isFinite(p.center.altitude)) {
                deltas.push(meshH - p.center.altitude);
              }
            });
            if (deltas.length === 0) {
              console.warn(`[address-mode] Segment ${segment._viability.orientation}: no mesh samples returned. Skipping this segment.`);
              continue;
            }
            deltas.sort((a, b) => a - b);
            const median  = deltas[Math.floor(deltas.length / 2)];
            const spread  = deltas[deltas.length - 1] - deltas[0];
            console.log(`[address-mode] Segment ${segment._viability.orientation} (${segPanels.length} panels): median offset ${median.toFixed(2)}m, spread ${spread.toFixed(2)}m`);
            segPanels.forEach((p) => {
              p.center.altitude = (p.center.altitude || 0) + median;
            });

            const entities = addPanelEntities(Cesium, viewer, segPanels, {
              altitudeOffsetM: 0.25,
              thicknessM: 0.05,
              color: '#0B2A5C',
              outlineColor: '#FFFFFF',
            });
            allEntities.push(...entities);
            totalRendered += segPanels.length;
          }
          panelCount = totalRendered;
          segmentBreakdown = allocations.map(a => ({
            orient: a.segment._viability.orientation,
            count:  a.count,
            areaM2: a.segment.stats?.areaMeters2,
          }));
          console.log(`[address-mode] Total rendered: ${totalRendered} panels across ${allocations.length} segments`);

          // 6g. Frame the whole cluster with a nice angled view. Use the
          //     top segment's azimuth for camera heading so the "best"
          //     face is visible head-on.
          setTimeout(() => {
            if (!viewer.isDestroyed() && allEntities.length > 0) {
              viewer.zoomTo(allEntities, new Cesium.HeadingPitchRange(
                Cesium.Math.toRadians(allocations[0].segment.azimuthDegrees || 0),
                Cesium.Math.toRadians(-55),
                80,
              ));
            }
          }, 300);
        } else if (panelsMode === 'demo') {
          const targetCount = parseInt(q.get('count'), 10) || 17;
          const largest = pickLargestSegment(DEMO_6_WOODACRE_SEGMENTS);
          console.log('[demo] Largest segment:', {
            center: largest.center,
            planeHeight: largest.planeHeightAtCenterMeters,
            azimuth: largest.azimuthDegrees,
            pitch: largest.pitchDegrees,
            area: largest.stats?.areaMeters2,
          });
          const panels = computePanelGridOnSegment(largest, 1.65, 0.99, targetCount);
          console.log(`[demo] computePanelGridOnSegment returned ${panels.length} panels`);
          panels.forEach((p, i) => {
            console.log(`  panel #${i}: lat=${p.center.latitude.toFixed(7)}, lng=${p.center.longitude.toFixed(7)}, alt=${p.center.altitude?.toFixed(2)}m, az=${p.azimuthDeg}°, pitch=${p.pitchDeg}°, orient=${p.orientation}`);
          });

          const entities = addPanelEntities(Cesium, viewer, panels, {
            altitudeOffsetM: 5,
            thicknessM: 0.35,
            color: '#0B2A5C',
            outlineColor: '#FFFFFF',
          });
          console.log(`[demo] addPanelEntities created ${entities.length} entities`);
          console.log(`[demo] viewer.entities.values.length = ${viewer.entities.values.length}`);

          // ── DIAGNOSTIC: add a bright red POINT + LABEL at each panel's centre.
          // Points always render regardless of depth/mesh occlusion — if
          // points appear but boxes don't, we know it's a mesh-occlusion or
          // box-geometry issue rather than a coord/camera issue.
          panels.forEach((p, i) => {
            viewer.entities.add({
              position: Cesium.Cartesian3.fromDegrees(
                p.center.longitude, p.center.latitude, (p.center.altitude || 0) + 5,
              ),
              point: {
                pixelSize: 12,
                color: Cesium.Color.RED,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,  // always visible
              },
              label: {
                text: `${i}`,
                font: '12px sans-serif',
                fillColor: Cesium.Color.WHITE,
                pixelOffset: new Cesium.Cartesian2(0, -18),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
              },
            });
          });

          // ── DIAGNOSTIC: query Cesium's ACTUAL mesh height at the first panel
          // position and compare to Google Solar's reported height. Any big
          // difference (>1m) = datum mismatch (Google Solar returns MSL,
          // Cesium expects WGS84 ellipsoid).
          const samplePositions = panels.slice(0, 3).map(p =>
            Cesium.Cartographic.fromDegrees(p.center.longitude, p.center.latitude, 0),
          );
          viewer.scene.sampleHeightMostDetailed(samplePositions).then((sampled) => {
            console.log('[diagnostic] Cesium mesh heights at first 3 panel lat/lngs:');
            sampled.forEach((c, i) => {
              const googleH = panels[i].center.altitude;
              const meshH   = c.height;
              const diff    = googleH - meshH;
              console.log(`  panel #${i}: Google Solar alt = ${googleH?.toFixed(2)}m, Cesium mesh alt = ${meshH?.toFixed(2)}m, diff = ${diff?.toFixed(2)}m`);
            });
            console.log('[diagnostic] If diff ≈ +30m → datum mismatch (MSL vs ellipsoid); if ≈ 0 → panels should be above mesh; if negative → something else.');
          }).catch(err => {
            console.warn('[diagnostic] sampleHeightMostDetailed failed:', err);
          });

          // Verify each entity's ACTUAL world position (from Cesium's PoV)
          entities.forEach((e, i) => {
            const cart = e.position?.getValue(Cesium.JulianDate.now());
            if (!cart) { console.warn(`  entity #${i}: NO POSITION!`); return; }
            const carto = Cesium.Cartographic.fromCartesian(cart);
            console.log(`  entity #${i}: lat=${Cesium.Math.toDegrees(carto.latitude).toFixed(7)}, lng=${Cesium.Math.toDegrees(carto.longitude).toFixed(7)}, alt=${carto.height.toFixed(2)}m`);
          });

          panelCount = panels.length;

          // Straight-down initial view directly above the panel cluster.
          viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(174.9389885, -36.9837872, 250),
            orientation: {
              heading: Cesium.Math.toRadians(0),
              pitch:   Cesium.Math.toRadians(-90),
              roll:    0,
            },
          });
          console.log('[demo] setView complete');
          logCamera(viewer, Cesium, 'after setView');

          // Auto-frame the panel entities after a beat.
          setTimeout(() => {
            if (viewer.isDestroyed() || entities.length === 0) {
              console.warn('[demo] cannot zoomTo — destroyed or no entities');
              return;
            }
            console.log('[demo] calling viewer.zoomTo(entities)...');
            const zoomPromise = viewer.zoomTo(entities, new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(0),
              Cesium.Math.toRadians(-60),
              80,
            ));
            if (zoomPromise?.then) {
              zoomPromise.then(
                () => { console.log('[demo] zoomTo resolved OK'); logCamera(viewer, Cesium, 'after zoomTo'); },
                (err) => { console.error('[demo] zoomTo rejected:', err); },
              );
            } else {
              // Older Cesium APIs may not return a promise
              console.log('[demo] zoomTo did not return a promise');
              setTimeout(() => logCamera(viewer, Cesium, '500ms after zoomTo'), 500);
            }
          }, 500);
        } else {
          // 7. Fly to the target coord.
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lng, lat, alt),
            orientation: {
              heading: Cesium.Math.toRadians(heading),
              pitch:   Cesium.Math.toRadians(pitch),
              roll:    0,
            },
            duration: 2.5,
          });
        }

        setMeta((m) => ({ ...m, panels: panelCount, segmentBreakdown }));
        if (addressMode) {
          const breakdown = segmentBreakdown?.length
            ? segmentBreakdown.map(s => `${s.count} on ${s.orient}`).join(' + ')
            : `${panelCount} panels`;
          setStatus(`ready · ${panelCount} panels (${breakdown}) on ${addressMode}`);
        } else if (panelsMode === 'demo') {
          setStatus(`ready · ${panelCount} demo panels`);
        } else {
          setStatus('ready');
        }
      } catch (e) {
        console.error('[CesiumSmokeTest] failed:', e);
        setError(e?.response?.data?.error || e?.message || String(e));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (cesiumViewerRef.current && !cesiumViewerRef.current.isDestroyed()) {
        cesiumViewerRef.current.destroy();
        cesiumViewerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      {/* Cesium mounts here */}
      <div
        ref={viewerRef}
        className="absolute inset-0"
        style={{ backgroundColor: '#000' }}
      />

      {/* Status / debug overlay */}
      <div className="absolute top-4 left-4 z-10 px-4 py-2 rounded-lg bg-black/60 backdrop-blur text-white text-xs font-mono max-w-md">
        <div className="text-[11px] uppercase tracking-widest opacity-70 mb-1">Cesium smoke test</div>
        <div>status: <span className="text-amber-300">{status}</span></div>
        {meta?.segmentBreakdown?.length > 0 && (
          <div className="mt-2 border-t border-white/10 pt-2">
            <div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">segments</div>
            {meta.segmentBreakdown.map((s, i) => (
              <div key={i} className="opacity-90">
                <span className="inline-block w-8 text-amber-300">{s.orient}</span>
                <span className="opacity-70">{s.count} panels · {s.areaM2?.toFixed(0)} m²</span>
              </div>
            ))}
          </div>
        )}
        {meta && (
          <div className="mt-1 opacity-80">
            centre: {meta.lat.toFixed(6)}, {meta.lng.toFixed(6)} · alt {meta.alt}m · heading {meta.heading}° · pitch {meta.pitch}°
          </div>
        )}
        {error && (
          <div className="mt-2 text-red-300 whitespace-pre-wrap">{error}</div>
        )}
        <div className="mt-2 text-[10px] opacity-60">
          Try: <code>?count=20</code> or <code>?segments=2</code>
        </div>
      </div>

      {/* Google attribution (required by TOS) */}
      {attribution && (
        <div className="absolute bottom-2 left-4 right-4 z-10 text-[10px] font-mono text-white/70 bg-black/50 rounded px-2 py-1 pointer-events-none">
          {attribution}
        </div>
      )}
    </div>
  );
}

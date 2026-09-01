// Reusable Cesium 3D roof view for the /poc/quote flow.
//
// Two modes:
//   showPanels=false : Just the 3D scene at (lat, lng). Used in AddressStage
//                      for "Is this your house?" confirmation — customer sees
//                      their actual home in 3D instead of a 2D aerial.
//   showPanels=true  : 3D scene + panels distributed across all viable roof
//                      segments (using the multi-segment pipeline built in M1).
//                      Used in QuoteStage.
//
// The component is INTENTIONALLY DUMB — it takes data in via props (not
// fetching analyse itself) so the parent stays in control of loading state,
// errors, and the roof-analysis data that also feeds side info panels.
//
// Panel target count comes from the engine (parent passes it in). The
// multi-segment distribution logic decides how many go on each face.
//
// Server counterpart: server/routes/threed.js → GET /api/threed/tileset-config

import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import { publicApi } from '../../../services/api';
import {
  computePanelGridOnSegment,
  selectViableSegments,
  annotateOpposingFaces,
  categoriseNoViableReason,
  distributePanels,
  enrichSegmentsWithFaceDimensions,
  deduplicateOverlappingFootprints,
} from './panelGrid';
import { addPanelEntities } from './cesiumPanelEntities';
import { nzGeoidSeparationMetres } from '../../../lib/nzGeoid';
// Legend swatch on the 3D view shares the same gradient as the sidebar
// SolarQualityScoreCard so the two visualisations describe one scale.
import { gradientCssStops, yieldToColor } from './panelColorScale';
import 'cesium/Build/Cesium/Widgets/widgets.css';

// Compass label from azimuth degrees (0=N clockwise). V6 measurement card.
const COMPASS_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function azToCompass(az) {
  if (!Number.isFinite(az)) return '—';
  return COMPASS_DIRS[Math.round(((az % 360) + 360) % 360 / 45) % 8];
}

// NZ local time → UTC Date. Hardcoded UTC+12 (NZST); DST ignored — customers
// are picking "roughly noon on a summer day" for shadow context, not to the
// minute, and the +/- 1h DST offset doesn't materially change the story.
// Uses Date.UTC which handles negative-hour wrap correctly (e.g. 05:00 NZ
// = -07:00 UTC → wraps to 17:00 previous day, still gives the right sun
// position when Cesium computes it).
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Installation animation timeline — 30 s customer-education sequence.
// Timestamps are cumulative from t=0 (animation start). Each step's
// end is implied by the NEXT step's t (last step ends at TOTAL_MS).
// Captions are what the customer reads during each phase.
const INSTALL_TOTAL_MS = 30000;
const INSTALL_STEPS = [
  { t: 0,     caption: 'Your roof, before we start',                                      short: 'Bare roof' },
  { t: 2000,  caption: 'Step 1 · Rails installed  (~2–4 hours)',                          short: 'Rails' },
  { t: 6000,  caption: 'Step 2 · Panels click onto rails  (~1 day for typical install)',   short: 'Panels' },
  { t: 12000, caption: 'Step 3 · Inverter installed near your meter box  (~2 hours)',      short: 'Inverter' },
  { t: 16000, caption: 'Step 4 · Battery mounted in your garage  (~2 hours)',              short: 'Battery' },
  { t: 20000, caption: 'Step 5 · EV charger fitted on your driveway  (~1 hour)',            short: 'EV charger' },
  { t: 24000, caption: 'Solar energy powering your home',                                   short: 'Powered' },
  { t: 28000, caption: 'Powered by GoldenRay Solar',                                        short: 'Done' },
];
const NZ_UTC_OFFSET_H = 12;
function nzMonthHourToUtcDate(month, hour) {
  const wholeH = Math.floor(hour);
  const minutes = Math.round((hour - wholeH) * 60);
  // Use year 2026 mid-month as a representative day. Sun position for a
  // given calendar date varies little year to year (< arc-minute at this
  // scale), so any recent year works.
  return new Date(Date.UTC(2026, month - 1, 15, wholeH - NZ_UTC_OFFSET_H, minutes, 0));
}
function formatSunTime(month, hour) {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${MONTH_NAMES[month - 1]} 15 · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} NZ`;
}

// Sun altitude + azimuth for observer at (lat, lng) on a given UTC date.
// Standard astronomical formulae (Meeus-approximation) — accurate to ~0.5°,
// well within what a compass indicator needs. Returns:
//   altitude 0-90° above horizon (negative = sun below horizon)
//   azimuth  0-360° from N clockwise (0=N, 90=E, 180=S, 270=W)
//
// Used to drive the SunCompass indicator so the customer sees where the
// sun actually IS at any chosen time — Google Photorealistic 3D Tiles
// have baked shadows that don't respond to Cesium's shadow map, so this
// compass is the primary sun-path visualisation.
function sunPositionForDate(utcDate, latitudeDeg, longitudeDeg) {
  const jd = utcDate.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0 + 0.0008;
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const meanLongitude   = (280.460 + 0.9856474 * n) % 360;
  const meanAnomaly     = ((357.528 + 0.9856003 * n) % 360) * D2R;
  const eclipticLongitude = meanLongitude
    + 1.915 * Math.sin(meanAnomaly)
    + 0.020 * Math.sin(2 * meanAnomaly);
  const eclipticRad = eclipticLongitude * D2R;
  const obliquity   = 23.44 * D2R;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticRad));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticRad),
    Math.cos(eclipticRad),
  );
  // Greenwich Mean Sidereal Time (in degrees)
  const gmstDeg = ((18.697374558 + 24.06570982441908 * n) % 24) * 15;
  const lst = (gmstDeg + longitudeDeg) * D2R;
  const hourAngle = lst - rightAscension;
  const latRad = latitudeDeg * D2R;
  const altRad = Math.asin(
    Math.sin(latRad) * Math.sin(declination) +
    Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle),
  );
  const azRad = Math.atan2(
    -Math.sin(hourAngle),
    Math.tan(declination) * Math.cos(latRad) - Math.sin(latRad) * Math.cos(hourAngle),
  );
  return {
    altitude: altRad * R2D,
    azimuth:  ((azRad * R2D) + 360) % 360,
  };
}

// Compact cardinal-direction label from a 0-360 azimuth.
function cardinalFromAzimuth(azDeg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N'];
  return dirs[Math.round((azDeg % 360) / 45)];
}

// Combine shade state (entity.__isShaded) + Before/After opacity into a
// single material assignment. Both the B2 shade-compute effect and the V1
// opacity effect call this so their writes are consistent — no race
// where one clobbers the other's alpha.
//
// opacity ≤ 0.02 → hide the box entirely (`show=false`). Rendering at
// alpha ~0 leaves faint outline artifacts in Cesium's translucent pass.
// opacity > 0.02 → material + outline alpha both set to opacity.
function setPanelMaterial(Cesium, entity, opacity) {
  if (!entity?.box) return;
  const showIt = opacity > 0.02;
  entity.box.show = showIt;
  if (!showIt) return;
  // Colour precedence:
  //   1. __isShaded → dark near-black (shadow state overrides everything)
  //   2. __heatmapColor → per-panel yield-heatmap colour (Week 8 Feature A)
  //   3. default navy fallback (no yield data / colorFn not used)
  const hex = entity.__isShaded
    ? '#04081A'
    : (entity.__heatmapColor || '#0B2A5C');
  const fill = Cesium.Color.fromCssColorString(hex);
  fill.alpha = opacity;
  entity.box.material = fill;
  // Outline slightly dimmer so it doesn't fight the panel fill visually.
  const outline = Cesium.Color.fromCssColorString('#FFFFFF');
  outline.alpha = opacity * 0.7;
  entity.box.outlineColor = outline;
}

// Convert a sun altitude/azimuth (degrees, observer-local) into a WORLD-
// SPACE unit direction vector at a given panel position. Used for Feature
// B2's raycast to detect per-panel occlusion.
//
// Steps:
//   1. Build the direction in local East-North-Up:
//        East  = sin(az) * cos(alt)
//        North = cos(az) * cos(alt)
//        Up    = sin(alt)
//   2. Get the ENU→ECEF (world Cartesian) rotation at panel position via
//      Cesium.Transforms.eastNorthUpToFixedFrame().
//   3. Multiply the ENU direction by the rotation to get a world-space
//      unit vector pointing FROM the panel TOWARD the sun.
function computeSunDirectionEcef(Cesium, panelCartesian, sunAltDeg, sunAzDeg) {
  const altRad = sunAltDeg * Math.PI / 180;
  const azRad  = sunAzDeg  * Math.PI / 180;
  const cosAlt = Math.cos(altRad);
  const enuDir = new Cesium.Cartesian3(
    Math.sin(azRad) * cosAlt,   // East
    Math.cos(azRad) * cosAlt,   // North
    Math.sin(altRad),           // Up
  );
  const enuToEcef = Cesium.Transforms.eastNorthUpToFixedFrame(panelCartesian);
  // Rotation-only extract — Matrix4 → Matrix3 for the linear part.
  const rot = Cesium.Matrix4.getMatrix3(enuToEcef, new Cesium.Matrix3());
  const ecefDir = Cesium.Matrix3.multiplyByVector(rot, enuDir, new Cesium.Cartesian3());
  return Cesium.Cartesian3.normalize(ecefDir, ecefDir);
}

// Small SVG compass indicator — shows where the sun is at the chosen
// timeline moment. Independent of Cesium (pure SVG), so it renders even
// when the baked-lit 3D tiles don't visibly change under the shadow map.
function SunCompass({ altitude, azimuth }) {
  const size = 84, cx = size / 2, cy = size / 2, r = size / 2 - 10;
  const belowHorizon = altitude < 0;
  const altNorm = Math.max(0, altitude) / 90;
  // Higher altitude → sun icon closer to centre (zenith), lower → near horizon ring.
  const sunR = r * (1 - altNorm);
  const azRad = azimuth * Math.PI / 180;
  const sunX = cx + sunR * Math.sin(azRad);
  const sunY = cy - sunR * Math.cos(azRad);
  return (
    <div className="bg-black/70 backdrop-blur-md rounded-lg p-2 flex flex-col items-center">
      <svg width={size} height={size} className="block">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
        <text x={cx}      y="10"         textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.55)">N</text>
        <text x={size-6}  y={cy+3}       textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.55)">E</text>
        <text x={cx}      y={size-4}     textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.55)">S</text>
        <text x="6"       y={cy+3}       textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.55)">W</text>
        <circle cx={cx} cy={cy} r="1.5" fill="rgba(255,255,255,0.35)" />
        <circle cx={sunX} cy={sunY} r="6"
          fill={belowHorizon ? '#4a3f2e' : '#FFB84D'}
          stroke={belowHorizon ? 'none' : '#D9531E'} strokeWidth="1.5"
          opacity={belowHorizon ? 0.5 : 1} />
        {!belowHorizon && [0, 60, 120, 180, 240, 300].map(a => {
          const rad = a * Math.PI / 180;
          return (
            <line key={a}
              x1={sunX + 9  * Math.sin(rad)} y1={sunY - 9  * Math.cos(rad)}
              x2={sunX + 12 * Math.sin(rad)} y2={sunY - 12 * Math.cos(rad)}
              stroke="#FFB84D" strokeWidth="1.5" />
          );
        })}
      </svg>
      <div className="text-[9px] font-mono text-white/85 mt-0.5 whitespace-nowrap">
        {belowHorizon
          ? 'Sun below horizon'
          : `${Math.round(altitude)}° ${cardinalFromAzimuth(azimuth)}`}
      </div>
    </div>
  );
}

/**
 * @param {object}  props
 * @param {{latitude,longitude}} props.coords    camera target (customer's roof)
 * @param {Array}   [props.segments=[]]           Google Solar segments (from analyse)
 * @param {Array}   [props.solarPanels=[]]        Google Solar suggested panels
 *   (from analyse) — used to derive real face dimensions per segment
 *   (see enrichSegmentsWithFaceDimensions), so panels don't overflow the
 *   bbox-envelope-only estimate.
 * @param {boolean} [props.showPanels=false]      render panel entities?
 * @param {number}  [props.panelTargetCount=0]    total panels to distribute
 * @param {number}  [props.panelWatts]            STC watts of the panel model
 *   the composer picked (from `tiers[recommended_index].panel.watts`).
 *   Threaded through to panelGrid so per-panel yield is computed against
 *   the REAL panel spec (Phono 595W etc.) rather than a 340 W/m² fallback
 *   estimate. Feeds the heatmap colour scale.
 * @param {number}  [props.panelLongM]  physical panel long-side (m). When
 *   provided, replaces panelGrid's 1.65 fallback so 3D boxes render at
 *   the picked panel's true footprint (e.g. Phono 595W ≈ 1.879 m).
 * @param {number}  [props.panelShortM] physical panel short-side (m).
 *   Fallback: 0.99 m.
 * @param {number}  [props.maxSegments=3]         max faces to distribute across
 * @param {string}  [props.height='60vh']         container CSS height
 * @param {string}  [props.className]             extra classes for container
 * @param {(placement) => void} [props.onPlacementReady]  called with the
 *   {allocations, totalRendered} once panels are on the scene, so parent
 *   can update the "Why X panels?" / roof-analysis side panels.
 */
export default function Cesium3DView({
  coords,
  segments = [],
  solarPanels = [],
  showPanels = false,
  panelTargetCount = 0,
  panelWatts = null,
  panelLongM = null,
  panelShortM = null,
  maxSegments = 3,
  height = '60vh',
  className = '',
  onPlacementReady,
  // Building polygon from OSM/LINZ — array of rings, each ring is
  // [[lng, lat], ...]. Used by the installation animation to place
  // markers on the customer's ACTUAL house (not offset from address
  // coord which lands on neighbours in townhouse rows). Optional —
  // marker placement falls back to fixed offsets if not provided.
  building = null,
  // 2026-08-20 (B1 Tier UX Fix D): visualise battery + EV hardware on the
  // ground next to the house so the 3D scene reflects the selected system
  // config. Booleans toggle the entities' `.show`. Independent from the
  // install-animation billboard markers above — these are always-on
  // ground-truth 3D boxes / cylinders sized to real hardware footprint.
  showBattery = false,
  showEv = false,
}) {
  const containerRef  = useRef(null);
  const viewerRef     = useRef(null);
  // Cesium namespace ref — populated inside the main effect (dynamic import).
  // The sun-time / play-animation effects need Cesium.JulianDate without
  // re-importing, so we stash the module reference for cross-effect access.
  const cesiumRef     = useRef(null);
  const [status,   setStatus]   = useState('loading');   // loading | ready | error
  const [error,    setError]    = useState(null);
  const [attribution, setAttribution] = useState('');
  // Week-8 overlay state (panels themselves stay realistic dark navy — the
  // yield story is told via three complementary surfaces instead of by
  // tinting the panels):
  //   - yieldRange:  top-right compact reference legend so customers glance
  //                  it while rotating/panning the 3D scene. Same 300-900
  //                  NZ anchor + your-roof marker as the sidebar card.
  //                  null when we lack real per-address yield data.
  //   - hoverInfo:   per-panel tooltip that follows the cursor. Independent
  //                  of the legend — always active as long as entities exist.
  const [yieldRange, setYieldRange] = useState(null);
  const [hoverInfo,  setHoverInfo]  = useState(null);
  // V6 · click-to-inspect measurement card. Populated on LEFT_CLICK on a
  // panel entity — clones the panel's __panelData (az/pitch/dims/yield),
  // the parent segment (for area), and a live count of panels on the
  // SAME face. Card renders as a fixed-position tooltip near the click.
  const [selectedFace, setSelectedFace] = useState(null);

  // Installation Animation · Phase 1 (2026-08-18). Customer-education
  // 30 s sequence: bare roof → rails → panels → inverter → battery → EV
  // → energy flows → powered. Refs are used for the RAF loop + Cesium
  // entity handles (no re-render needed each tick); step + progress are
  // state so the caption overlay + progress bar re-render smoothly.
  const [installStep,     setInstallStep]     = useState(-1);   // -1 = not playing
  const [installProgress, setInstallProgress] = useState(0);
  const installRafRef        = useRef(null);
  const installMarkersRef    = useRef({});                       // {inverter, battery, ev}
  // 2026-08-20 (B1 Tier UX Fix D) — real 3D box/cylinder entities on the
  // ground next to the house, gated on `showBattery` / `showEv` props so
  // customer sees the physical hardware appear/disappear as they pick tiers.
  const groundHardwareRef    = useRef({});                       // {batteryBox, evPedestal, car}
  const installPrevOpacityRef = useRef(null);
  // Rail entities created per-panel on animation start; removed on stop.
  // Each rail is a thin metallic bar wider than its panel, positioned
  // just below the panel altitude. Shown at step 1+; panels appear on
  // top at step 2 so the sequence reads "rails go up → panels click on".
  const installRailsRef      = useRef([]);
  // Camera state saved at animation start so we can restore the exact
  // pose the user had (they may have rotated/tilted before clicking).
  const installPrevCameraRef  = useRef(null);

  // Week-8 Feature B1 — sun/shadow timeline state.
  //   - sunMonth: 1-12 (NZ month), default June (winter — dramatic shadows)
  //   - sunHour:  5-20 (NZ local hour, 0.25 step), default 14 (mid-afternoon)
  //   - isPlaying: true while the "play a day" rAF loop is running
  // Cesium's shadow map + viewer.clock recompute shadows automatically each
  // frame based on the sun position derived from clock time + earth rotation.
  // We only set the clock; Cesium does the rest.
  const [sunMonth,  setSunMonth]  = useState(6);
  const [sunHour,   setSunHour]   = useState(14);
  const [isPlaying, setIsPlaying] = useState(false);
  // Sun altitude/azimuth for the customer's lat/lng at the chosen time.
  // Drives the SunCompass indicator overlay. Recomputed by the same effect
  // that syncs viewer.clock, so slider changes update the compass in step.
  const [sunPosition, setSunPosition] = useState(null);
  // Feature B2 — ref to the panel entities so the shade-compute effect can
  // iterate them without duplicating the render pipeline. Panel entities
  // are built inside the async pipeline and stored here at the end of it.
  // cesiumRef is already declared above (line 221) — shared with the
  // sun-time / play-animation effects, don't redeclare.
  const panelEntitiesRef = useRef([]);
  // Throttle bookkeeping for the shade-compute effect: `lastFireRef` is a
  // performance.now() timestamp of the last successful shade compute, and
  // `pendingTimerRef` is the currently-scheduled setTimeout handle (null
  // when nothing is pending). Together these implement a leading-plus-
  // trailing throttle — during continuous changes (e.g. "Play a day"
  // sweeping sunHour at 60fps) we still fire every ~300ms instead of
  // being permanently debounced-away.
  const lastFireRef      = useRef(0);
  const pendingTimerRef  = useRef(null);
  // How many panels are currently shaded at the chosen sun position. Feeds
  // the timeline strip footer so the customer sees "3 of 17 panels shaded
  // right now" as they scrub through the day.
  const [shadedCount, setShadedCount] = useState(0);

  // Feature V1 — Before/After slider. 0 = panels invisible ("empty roof"),
  // 1 = fully installed. Panels fade linearly between. Ref version so the
  // shade-compute effect can read the current opacity without adding it to
  // its dep array (would cause 17 raycasts per slider tick — wasteful).
  const [panelOpacity, setPanelOpacity] = useState(1);
  const panelOpacityRef = useRef(1);
  useEffect(() => { panelOpacityRef.current = panelOpacity; }, [panelOpacity]);

  // V6 · ESC to dismiss the measurement card. Only wires up while the
  // card is open so we don't add a global listener for every keystroke
  // when no card is showing.
  useEffect(() => {
    if (!selectedFace) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSelectedFace(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedFace]);

  // Installation Animation · start / stop / tick. Sequence is a RAF loop
  // that (a) updates step + progress state for the caption + progress
  // bar, (b) sets panelOpacity in step 2 (panels fade in), (c) toggles
  // Cesium marker entity .show at steps 3/4/5. Markers are created on
  // start and removed on stop so we don't leave them hanging around
  // between plays. Positions are approximated with tiny lat/lng offsets
  // from the customer's coords — Phase 2 will use OSM building polygon
  // vertices for real placement (garage side, driveway edge, etc.).
  const startInstallation = () => {
    if (installStep >= 0) return;    // already playing
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || viewer.isDestroyed()) return;

    installPrevOpacityRef.current = panelOpacity;
    setSelectedFace(null);           // dismiss V6 card if open
    // 2026-08-19 — for the real-time staggered install feel, we control
    // per-entity visibility via entity.show (not opacity). Panels stay
    // at panelOpacity=1 throughout so their MATERIAL is fully rendered
    // when we flip show=true. Bare-roof step is achieved by hiding
    // every panel entity individually up-front; tick then reveals them
    // one-by-one during step 2.
    setPanelOpacity(1);
    for (const e of panelEntitiesRef.current) e.show = false;
    if (!viewer.isDestroyed()) viewer.scene.requestRender();

    // Save the camera's current view so we can restore it after the
    // animation ends. Storing position (world-space Cartesian3) +
    // orientation (heading/pitch/roll in radians) is enough for
    // camera.setView to restore exactly.
    installPrevCameraRef.current = {
      destination: viewer.camera.position.clone(),
      orientation: {
        heading: viewer.camera.heading,
        pitch:   viewer.camera.pitch,
        roll:    viewer.camera.roll,
      },
    };

    // Sample ground altitude at the customer's coord so markers land ON
    // the 3D-tile mesh. CLAMP_TO_GROUND doesn't work here — that mode
    // needs a terrain provider, and Google Photorealistic 3D Tiles is
    // NOT terrain (it's a tileset). Same pattern the AddressStage anchor
    // uses. Passive sampleHeight reads the last-rendered depth buffer;
    // by the time customer hits Play, tiles are painted and the sample
    // succeeds. Fallback to 0 keeps things surviving even if it doesn't.
    let groundAlt = 0;
    try {
      const h = viewer.scene.sampleHeight(
        Cesium.Cartographic.fromDegrees(coords.longitude, coords.latitude, 0),
      );
      if (Number.isFinite(h)) groundAlt = h;
    } catch (e) {
      console.warn('[install-anim] sampleHeight failed, markers may float:', e?.message || e);
    }

    // Compute marker positions. Strategy: cluster all 3 tightly around
    // the address coord (~3-6 m offsets) so they stay on the customer's
    // own building even in townhouse rows.
    //
    // Why NOT the OSM/LINZ polygon: for townhouse rows the polygon
    // covers the WHOLE row as one big footprint. Using bbox corners
    // then puts INVERTER on one end of the row and BATTERY at the
    // other — landing on neighbours' units instead of the customer's.
    // Even the polygon centroid can be off-unit for asymmetric rows.
    //
    // Tight-cluster placement (all within ~8 m of address coord):
    //   INVERTER    → 3 m EAST  of coord (side wall — meter typical)
    //   BATTERY     → 3 m WEST  of coord (opposite side / garage)
    //   EV CHARGER  → 6 m SOUTH of coord (driveway assumption)
    // Building polygon is still passed as a prop for future use (real
    // meter/garage/driveway placement would need floorplan data or
    // OSM tag hints we don't parse yet).
    const cosLatRad = Math.cos(coords.latitude * Math.PI / 180);
    const mk = (dLatM, dLngM) => ({
      lat: coords.latitude  + dLatM / 111320,
      lng: coords.longitude + dLngM / (111320 * cosLatRad),
    });
    // SVG icon markers — coloured circle + white glyph, encoded as
    // base64 data URI (URI-encoded SVG can fail on certain characters).
    // Explicit width/height on the <svg> so Cesium rasterizes at the
    // right base size, not the browser default 300x150.
    const iconSVG = (fillHex, glyphPath) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="${fillHex}" stroke="white" stroke-width="4"/><g fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">${glyphPath}</g></svg>`;
      // btoa needs ASCII input — our SVG here has no unicode so it's safe.
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    };
    // Glyph paths in a 64x64 viewport centred at 32,32.
    const INVERTER_ICON = iconSVG('#0B76D9',
      '<path d="M34 18 L20 36 L30 36 L26 46 L44 28 L34 28 Z" fill="white" stroke="none"/>',
    );
    const BATTERY_ICON = iconSVG('#5C8B4A',
      '<rect x="18" y="26" width="26" height="16" rx="2" fill="none"/>' +
      '<rect x="44" y="30" width="4" height="8" rx="1" fill="white" stroke="none"/>' +
      '<rect x="22" y="30" width="4" height="8" fill="white" stroke="none"/>' +
      '<rect x="28" y="30" width="4" height="8" fill="white" stroke="none"/>' +
      '<rect x="34" y="30" width="4" height="8" fill="white" stroke="none"/>',
    );
    const EV_ICON = iconSVG('#D9531E',
      '<rect x="22" y="30" width="20" height="16" rx="3" fill="none"/>' +
      '<line x1="27" y1="30" x2="27" y2="22"/>' +
      '<line x1="37" y1="30" x2="37" y2="22"/>' +
      '<path d="M32 46 L32 52" />',
    );

    const markerPositions = {
      inverter: { ...mk( 0,  3), hex: '#0B76D9', text: 'INVERTER',   icon: INVERTER_ICON },  // 3 m east
      battery:  { ...mk( 0, -3), hex: '#5C8B4A', text: 'BATTERY',    icon: BATTERY_ICON  },  // 3 m west
      ev:       { ...mk(-6,  0), hex: '#D9531E', text: 'EV CHARGER', icon: EV_ICON       },  // 6 m south
    };

    const mkMarkerAt = ({ lat, lng, hex, text, icon }) => viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lng, lat, groundAlt + 2),
      billboard: {
        image: icon,
        width: 52,
        height: 52,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text,
        font: 'bold 13px sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL,
        pixelOffset: new Cesium.Cartesian2(0, -60),  // above the icon (icon anchored bottom)
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString(hex).withAlpha(0.95),
        backgroundPadding: new Cesium.Cartesian2(10, 6),
      },
      show: false,
    });

    installMarkersRef.current = {
      inverter: mkMarkerAt(markerPositions.inverter),
      battery:  mkMarkerAt(markerPositions.battery),
      ev:       mkMarkerAt(markerPositions.ev),
    };

    // Rail entities — one thin metallic bar per panel, positioned just
    // BELOW the panel with the same orientation. Wider than the panel
    // (20% overhang) so adjacent panels' rails visually overlap into
    // continuous stripes on the roof. Amber outline matches the energy
    // pulse for visual continuity. Shown at step 1+; panels appear on
    // top at step 2. On stop, rails removed with markers.
    const rails = [];
    for (const panel of panelEntitiesRef.current) {
      const pData = panel.__panelData;
      if (!pData?.center?.longitude || !pData?.center?.latitude) continue;
      const panelLong  = Number(pData.dimensions?.longM)  || 1.65;
      const panelShort = Number(pData.dimensions?.shortM) || 0.99;
      const railWidth  = panelLong * 1.15;  // 15% wider than panel — creates continuous appearance
      const railDepth  = 0.08;              // 8 cm across-slope (small)
      const railHeight = 0.05;              // 5 cm vertical thickness
      const railAlt    = (Number(pData.center.altitude) || 0) - 0.02;   // 2 cm below panel base
      const railPos    = Cesium.Cartesian3.fromDegrees(
        pData.center.longitude,
        pData.center.latitude,
        railAlt,
      );
      // Same HeadingPitchRoll as panels: heading=azimuth, roll=-pitch
      const hpr = new Cesium.HeadingPitchRoll(
        Cesium.Math.toRadians(Number(pData.azimuthDeg) || 0),
        0,
        Cesium.Math.toRadians(-(Number(pData.pitchDeg) || 0)),
      );
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(railPos, hpr);
      const rail = viewer.entities.add({
        position: railPos,
        orientation,
        box: {
          dimensions: new Cesium.Cartesian3(railWidth, railDepth, railHeight),
          material: Cesium.Color.fromCssColorString('#D9D3C8'),   // bright silver/chrome — pops against dark tiles
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#F4A83B'),  // amber for visibility
          outlineWidth: 4,   // thicker (was 2) — reads clearly at distance
          shadows: Cesium.ShadowMode.RECEIVE_ONLY,
        },
        show: false,
      });
      rails.push(rail);
    }
    installRailsRef.current = rails;

    // ── Ground hardware entities (Tier UX Fix D, 2026-08-20) ─────────────
    // Real physical hardware placed next to the house so the 3D reflects
    // the customer's chosen tier's config:
    //   - Battery box (BYD HVM sized): 0.60 × 0.30 × 1.20 m on north side
    //   - EV pedestal (Wattpilot):     0.20 × 0.20 × 1.20 m in driveway
    //   - Car placeholder (behind EV): 4.50 × 1.85 × 1.50 m
    // .show controlled by `showBattery` / `showEv` props via the syncing
    // useEffect below. Hidden initially — the props-sync effect flips them
    // once the tier config lands.
    //
    // Positions:
    //   Battery: 4 m NORTH of coords (typical side-wall location where
    //            installers put the ESS to keep it out of driveway sight)
    //   EV:      6 m SOUTH-EAST of coords (assumed driveway)
    //   Car:     ~8 m SOUTH-EAST of coords (parked in front of pedestal)
    const batteryPos = Cesium.Cartesian3.fromDegrees(
      coords.longitude,
      coords.latitude + 4 / 111320,
      groundAlt + 0.6,   // half-height so the box sits ON the ground
    );
    const batteryEntity = viewer.entities.add({
      position: batteryPos,
      box: {
        dimensions: new Cesium.Cartesian3(0.60, 0.30, 1.20),
        material:   Cesium.Color.fromCssColorString('#374151'),   // gunmetal
        outline:    true,
        outlineColor: Cesium.Color.fromCssColorString('#111827'),
        outlineWidth: 2,
        shadows: Cesium.ShadowMode.CAST_AND_RECEIVE,
      },
      label: {
        text: 'BATTERY',
        font: 'bold 11px sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL,
        pixelOffset: new Cesium.Cartesian2(0, -70),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#374151').withAlpha(0.9),
        backgroundPadding: new Cesium.Cartesian2(8, 4),
      },
      show: false,
    });

    // EV pedestal — a narrow cylinder in orange (Wattpilot brand-adjacent).
    const evOffsetLat = -5 / 111320;
    const evOffsetLng =  5 / (111320 * cosLatRad);
    const evPos = Cesium.Cartesian3.fromDegrees(
      coords.longitude + evOffsetLng,
      coords.latitude  + evOffsetLat,
      groundAlt + 0.6,
    );
    const evPedestalEntity = viewer.entities.add({
      position: evPos,
      cylinder: {
        length: 1.2,
        topRadius:    0.10,
        bottomRadius: 0.10,
        material:     Cesium.Color.fromCssColorString('#D9531E'),   // GoldenRay orange
        outline:      true,
        outlineColor: Cesium.Color.fromCssColorString('#7C2D12'),
        outlineWidth: 2,
        shadows: Cesium.ShadowMode.CAST_AND_RECEIVE,
      },
      label: {
        text: 'EV CHARGER',
        font: 'bold 11px sans-serif',
        fillColor: Cesium.Color.WHITE,
        style: Cesium.LabelStyle.FILL,
        pixelOffset: new Cesium.Cartesian2(0, -70),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#D9531E').withAlpha(0.95),
        backgroundPadding: new Cesium.Cartesian2(8, 4),
      },
      show: false,
    });

    // Car placeholder — a low box roughly parallel to the driveway line
    // (perpendicular to house). Behind the pedestal from the house.
    const carPos = Cesium.Cartesian3.fromDegrees(
      coords.longitude + (7 / (111320 * cosLatRad)),
      coords.latitude  + (-6 / 111320),
      groundAlt + 0.75,
    );
    const carEntity = viewer.entities.add({
      position: carPos,
      box: {
        dimensions: new Cesium.Cartesian3(4.50, 1.85, 1.50),
        material:   Cesium.Color.fromCssColorString('#475569'),   // slate
        outline:    true,
        outlineColor: Cesium.Color.fromCssColorString('#1F2937'),
        outlineWidth: 2,
        shadows: Cesium.ShadowMode.CAST_AND_RECEIVE,
      },
      show: false,
    });

    groundHardwareRef.current = {
      batteryBox:  batteryEntity,
      evPedestal:  evPedestalEntity,
      car:         carEntity,
    };

    const startTime = performance.now();
    // Store starting heading so we can slowly orbit ~60° over 30s.
    // Cesium heading is in radians; positive = clockwise from north.
    const orbitStartHeadingRad = viewer.camera.heading;
    const orbitTotalDeg        = 60;                     // ~2°/s
    const orbitTotalRad        = orbitTotalDeg * Math.PI / 180;
    // Center of orbit — the customer's property, at ROOF-level altitude
    // (groundAlt sampled above). lookAt binds camera to this centre so
    // the scene rotates around the house. Without the altitude, orbit
    // pivots at sea level → camera ends up looking at the ground far
    // below the roof for NZ addresses (Auckland is ~40m above MSL).
    const orbitCenter = Cesium.Cartesian3.fromDegrees(coords.longitude, coords.latitude, groundAlt + 5);
    const orbitPitch  = Cesium.Math.toRadians(-45);
    const orbitRange  = 60;

    const tick = (now) => {
      const elapsed = now - startTime;
      if (elapsed >= INSTALL_TOTAL_MS) {
        stopInstallation(true);
        return;
      }
      const frac = elapsed / INSTALL_TOTAL_MS;
      setInstallProgress(frac * 100);
      // Find current step (last step whose t <= elapsed)
      let idx = 0;
      for (let i = INSTALL_STEPS.length - 1; i >= 0; i--) {
        if (elapsed >= INSTALL_STEPS[i].t) { idx = i; break; }
      }
      setInstallStep(idx);

      // Real-time staggered install feel — rails go up one-by-one in
      // step 1, panels click on one-by-one in step 2. Reveal timing is
      // linear: entity[i] appears at step_start + (i/N) * step_duration.
      // Both are per-entity entity.show flips (fast; no material
      // rebuild). panelOpacity stays at 1 so panels are full-material
      // when their entity.show flips true.
      const rails  = installRailsRef.current;
      const panels = panelEntitiesRef.current;
      let requestNeeded = false;

      if (idx === 0) {
        // Bare roof — everything hidden. Redundant with startInstallation
        // (already hid), but keeps state consistent if user drags time.
        for (const rail of rails) if (rail?.show) { rail.show = false; requestNeeded = true; }
        for (const e of panels)  if (e?.show)    { e.show    = false; requestNeeded = true; }
      } else if (idx === 1) {
        // Rails going up — reveal one by one across step 1's duration
        const stepStart = INSTALL_STEPS[1].t;
        const stepDur   = INSTALL_STEPS[2].t - stepStart;
        const inStep    = elapsed - stepStart;
        const N = rails.length;
        for (let i = 0; i < N; i++) {
          const revealAt = N > 0 ? (i / N) * stepDur : 0;
          const shouldShow = inStep >= revealAt;
          if (rails[i]?.show !== shouldShow) { rails[i].show = shouldShow; requestNeeded = true; }
        }
        // Panels stay hidden
        for (const e of panels) if (e?.show) { e.show = false; requestNeeded = true; }
      } else if (idx === 2) {
        // All rails visible; panels click on one-by-one
        for (const rail of rails) if (!rail?.show) { rail.show = true; requestNeeded = true; }
        const stepStart = INSTALL_STEPS[2].t;
        const stepDur   = INSTALL_STEPS[3].t - stepStart;
        const inStep    = elapsed - stepStart;
        const N = panels.length;
        for (let i = 0; i < N; i++) {
          const revealAt = N > 0 ? (i / N) * stepDur : 0;
          const shouldShow = inStep >= revealAt;
          if (panels[i]?.show !== shouldShow) { panels[i].show = shouldShow; requestNeeded = true; }
        }
      } else {
        // idx >= 3 — everything installed
        for (const rail of rails) if (!rail?.show) { rail.show = true; requestNeeded = true; }
        for (const e of panels)  if (!e?.show)    { e.show    = true; requestNeeded = true; }
      }

      const m = installMarkersRef.current;
      if (m.inverter && m.inverter.show !== (idx >= 3)) { m.inverter.show = idx >= 3; requestNeeded = true; }
      if (m.battery  && m.battery.show  !== (idx >= 4)) { m.battery.show  = idx >= 4; requestNeeded = true; }
      if (m.ev       && m.ev.show       !== (idx >= 5)) { m.ev.show       = idx >= 5; requestNeeded = true; }

      if (requestNeeded && !viewer.isDestroyed()) viewer.scene.requestRender();

      // Slow camera orbit — 60° over 30s. lookAt is SYNCHRONOUS (unlike
      // viewer.zoomTo which starts an internal animation each call — that
      // was the bug in the first Phase 1.5 attempt). Camera positions
      // instantly per frame at the requested heading/pitch/range around
      // the property centre.
      if (!viewer.isDestroyed()) {
        const heading = orbitStartHeadingRad + frac * orbitTotalRad;
        viewer.camera.lookAt(orbitCenter, new Cesium.HeadingPitchRange(
          heading, orbitPitch, orbitRange,
        ));
      }

      installRafRef.current = requestAnimationFrame(tick);
    };
    installRafRef.current = requestAnimationFrame(tick);
  };

  const stopInstallation = (finished) => {
    if (installRafRef.current) cancelAnimationFrame(installRafRef.current);
    installRafRef.current = null;
    setInstallStep(-1);
    setInstallProgress(0);
    // Restore ALL panel entities to visible (tick may have hidden
    // some via entity.show=false for the stagger effect). Then restore
    // panel opacity — finished=true → panels stay fully installed;
    // skip → restore previous opacity. The panelOpacity useEffect
    // handles material repaint if opacity actually changed.
    for (const e of panelEntitiesRef.current) e.show = true;
    const restore = installPrevOpacityRef.current;
    setPanelOpacity(finished ? 1 : (restore != null ? restore : 1));
    installPrevOpacityRef.current = null;
    // Tear down markers + rails + release camera lock + restore camera pose
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (viewer && !viewer.isDestroyed()) {
      for (const e of Object.values(installMarkersRef.current)) {
        if (e) viewer.entities.remove(e);
      }
      for (const rail of installRailsRef.current) {
        if (rail) viewer.entities.remove(rail);
      }
      // CRITICAL: lookAt binds camera to a local reference frame. Must
      // release it (identity matrix) BEFORE calling flyTo/setView, else
      // the restore silently no-ops and mouse interaction stays locked.
      if (Cesium) {
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
      }
      // Restore the camera to where the user had it before hitting Play.
      // flyTo with duration 0.8s = gentle transition back.
      const prev = installPrevCameraRef.current;
      if (prev) {
        viewer.camera.flyTo({
          destination: prev.destination,
          orientation: prev.orientation,
          duration: 0.8,
        });
      }
    }
    installMarkersRef.current = {};
    installRailsRef.current = [];
    installPrevCameraRef.current = null;
  };

  // Cleanup on unmount — cancel RAF + remove entities.
  useEffect(() => {
    return () => {
      if (installRafRef.current) cancelAnimationFrame(installRafRef.current);
      // (Entities are cleaned up automatically when the viewer is destroyed
      //  in the mount effect's teardown — no need to touch them here.)
    };
  }, []);

  // Everything the component mounts happens once per (placeId/coords) change —
  // we intentionally recreate the viewer when the coord changes rather than
  // trying to reuse it.
  useEffect(() => {
    if (!coords?.latitude || !coords?.longitude) return;
    let cancelled = false;
    let viewer = null;
    // Screen-space event handler for the heatmap hover tooltip. Created in
    // pass 2 once entities exist, torn down in the effect cleanup so the
    // handler + its closure over `viewer` don't leak on address change.
    let hoverHandler = null;
    // Reset overlays synchronously so a stale legend / tooltip from the
    // previous address doesn't linger while the new pipeline runs.
    setYieldRange(null);
    setHoverInfo(null);
    // Feature B2: drop stale panel entities so the shade effect doesn't
    // try to update materials on entities from the previous viewer (which
    // gets destroyed in cleanup). Refilled at the end of the render pass.
    panelEntitiesRef.current = [];
    setShadedCount(0);
    // V1: reset Before/After slider to fully installed on address change.
    setPanelOpacity(1);
    panelOpacityRef.current = 1;

    (async () => {
      try {
        if (import.meta.env.DEV) console.log('[Cesium3DView] step 1 — fetching tileset config');
        // 1. Server hands us the tileset URL with the API key baked in
        //    (key never touches the browser directly).
        const { data: cfg } = await publicApi.get('/threed/tileset-config');
        if (cancelled) return;
        setAttribution(cfg.attribution || '');
        if (import.meta.env.DEV) console.log('[Cesium3DView] step 2 — Cesium namespace ready');

        // 2. Cesium is imported statically at the top of this file. We used to
        //    do `await import('cesium')` here, but vite-plugin-cesium marks
        //    'cesium' as external and swaps it for the global `window.Cesium`
        //    (loaded via <script src="/cesium/Cesium.js"> injected into the
        //    HTML), so a dynamic import gave zero lazy-loading benefit AND
        //    tripped a TDZ bug when Rollup + externalGlobals + terser collapsed
        //    the local `const Cesium` and the rewritten global into the same
        //    scope (produced `const p = await Promise.resolve(p)` in the
        //    minified bundle — self-reference in the RHS → TDZ throw).
        cesiumRef.current = Cesium;
        if (cancelled) return;
        if (import.meta.env.DEV) console.log('[Cesium3DView] step 3 — creating viewer');

        // 3. Create viewer. All Cesium's default widgets are disabled —
        //    we want a clean scene inside the parent's container.
        viewer = new Cesium.Viewer(containerRef.current, {
          timeline:             false,
          animation:            false,
          geocoder:             false,
          baseLayerPicker:      false,
          homeButton:           false,
          sceneModePicker:      false,
          navigationHelpButton: false,
          fullscreenButton:     false,
          infoBox:              false,
          selectionIndicator:   false,
          baseLayer:            false,   // Photorealistic 3D Tiles include ground
          skyBox:               false,
          skyAtmosphere:        false,
        });
        viewerRef.current = viewer;
        viewer.scene.globe.show = false;
        // Feature B1 — sun-driven shadow map + global lighting.
        //
        // Reality check: Google Photorealistic 3D Tiles ship with baked
        // shading in their diffuse textures. Cesium's shadow map can't
        // "un-shadow" or "re-shadow" those textures — it only affects
        // NEW shading on receiving surfaces. So on the 3D tiles the
        // effect is subtle. It DOES darken our overlaid panels when a
        // neighbouring building/tree mesh occludes the sun ray to them.
        //
        // The primary sun-path visualisation is therefore the SunCompass
        // indicator (top-left overlay) — pure SVG, works regardless of
        // tile baked lighting.
        //
        // enableLighting=true tells Cesium to modulate the globe / tile
        // colours by the sun direction (subtle day-side-lit effect); no
        // harm even though the globe primitive itself is hidden.
        // Explicit SunLight is the default but making it explicit removes
        // ambiguity if a future Cesium update changes defaults.
        viewer.shadowMap.enabled     = true;
        viewer.shadowMap.softShadows = true;
        viewer.shadowMap.darkness    = 0.35;   // 0 = pitch black, 1 = no shadow
        viewer.scene.globe.enableLighting = true;
        viewer.scene.light = new Cesium.SunLight();
        // Dev-only: expose the viewer so puppeteer tests can inspect entities.
        if (import.meta.env.DEV) window.__cesiumViewer = viewer;

        // 4. Load Photorealistic 3D Tileset from Google.
        if (import.meta.env.DEV) console.log('[Cesium3DView] step 4 — loading Photorealistic 3D Tileset');
        const tileset = await Cesium.Cesium3DTileset.fromUrl(cfg.tileset_url, {
          showCreditsOnScreen: true,
        });
        if (cancelled) { viewer.destroy(); return; }
        // Photorealistic 3D Tiles both cast (from buildings/trees) AND receive
        // (roof surface darkens under adjacent-tree shadow) — that's what
        // makes the "watch shadows move" story visible on the customer's roof.
        tileset.shadows = Cesium.ShadowMode.CAST_AND_RECEIVE;
        viewer.scene.primitives.add(tileset);
        if (import.meta.env.DEV) console.log('[Cesium3DView] step 5 — tileset added, setting camera');

        // 5. Position camera above the coord — straight-down first so tiles
        //    start loading before we do anything else (mesh height sampling
        //    for panels needs the tiles present).
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(coords.longitude, coords.latitude, 200),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch:   Cesium.Math.toRadians(-90),
            roll:    0,
          },
        });

        // Publish INITIAL debug state right away so tests can see camera
        // status even if downstream panel work hangs. Updated later once
        // everything settles.
        if (import.meta.env.DEV) {
          publishDebugState(Cesium, viewer, [], [], coords);
        }

        // 6. If we're showing panels, run the multi-segment pipeline.
        //    Otherwise just fly to a nice angled view and stop.
        if (!showPanels || !segments?.length || !panelTargetCount) {
          // Angled view for the "here's your house" confirmation.
          // Sample the mesh at the target coord to find ACTUAL ground
          // elevation, then place the camera ABOVE THAT (not at absolute
          // ellipsoid altitude — that was the bug where 6 Woodacre showed
          // black because ground is ~100m and my old 120m camera was only
          // 20m above ground, below Cesium's LOD for that area).
          setTimeout(async () => {
            if (viewer.isDestroyed()) return;
            let groundH = 0;
            try {
              const [sample] = await viewer.scene.sampleHeightMostDetailed([
                Cesium.Cartographic.fromDegrees(coords.longitude, coords.latitude, 0),
              ]);
              if (Number.isFinite(sample?.height)) groundH = sample.height;
            } catch { /* ignore, fall back to 0 */ }
            if (viewer.isDestroyed()) return;
            // 2026-08-18 — pin+label removed. The customer already placed
            // the pin on the Leaflet PreviewStage; here we just frame the
            // building tight so their roof fills the shot. Invisible anchor
            // entity so zoomTo has an object to center on, but nothing
            // renders (no dot, no label). Range 40m + pitch -55° gives a
            // top-down-leaning shot where the pinned building dominates.
            const anchorEntity = viewer.entities.add({
              id: '__customer_anchor',
              position: Cesium.Cartesian3.fromDegrees(coords.longitude, coords.latitude, groundH),
            });
            viewer.zoomTo(anchorEntity, new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians(25),
              Cesium.Math.toRadians(-55),
              40,
            ));
          }, 1500);
          if (!cancelled) setStatus('ready');
          // Dev-only debug hook (AddressStage / no-panels branch).
          if (import.meta.env.DEV) {
            // Wait for the flyTo animation to settle before snapshotting.
            setTimeout(() => {
              if (!viewer.isDestroyed()) publishDebugState(Cesium, viewer, [], [], coords);
            }, 3500);
          }
          return;
        }

        // Fix 10 debug overlay (2026-08-27) — draw the OSM/LINZ building
        // polygon on the 3D scene when URL contains ?debug=polygon so we
        // can visually diagnose whether the outline actually wraps the
        // customer's visible roof or drifts onto neighbouring structures.
        // Off by default so real customers never see it.
        const debugPolygonOn =
          typeof window !== 'undefined' && (
            new URLSearchParams(window.location.search).get('debug') === 'polygon'
            || window.localStorage?.getItem('gr-debug-polygon') === '1'
          );
        const ringDbg = building?.polygon?.[0];
        if (debugPolygonOn && Array.isArray(ringDbg) && ringDbg.length >= 3) {
          try {
            const positions = ringDbg.map(([lng, lat]) =>
              Cesium.Cartesian3.fromDegrees(lng, lat, 0));
            viewer.entities.add({
              id: '__osm_polygon_debug',
              polyline: {
                positions,
                width: 5,
                material: Cesium.Color.ORANGE.withAlpha(0.95),
                clampToGround: true,
              },
            });
            console.log(`[Fix 10 debug] OSM polygon drawn — ${ringDbg.length} vertices`);
          } catch (e) {
            console.warn(`[Fix 10 debug] polygon draw threw: ${e?.message || e}`);
          }
        }

        // 7. Enrich segments with real face dimensions derived from Google's
        //    OWN solarPanels[] (projected into each segment's roof-axis frame).
        //    This replaces the bbox-based dimension estimate that caused the
        //    75 Mahia Road overflow — Google's suggested panels stay ON the
        //    real face, so their extent IS the real face's usable extent.
        const enriched = enrichSegmentsWithFaceDimensions(segments, solarPanels);

        // Filter to viable segments (skip south-facing, too small, wrong pitch).
        // Fix 9 (2026-08-27): pass ALL viable segments to distributePanels
        // (was slice(0, maxSegments)=3). The new NZ-standard fill algorithm
        // sorts internally by orientation priority (N first) and only
        // consumes as many faces as it needs to place the target. Keeping
        // a hard slice would starve the algorithm of the smaller N faces
        // that outrank W/E for solar placement even when smaller.
        // maxSegments prop kept as a safety upper bound (capped at 8).
        // Bug 1 fix (2026-08-31) — S-inclusion fallback.
        //
        // Default: skip S-facing segments (poor NZ yield). But when the
        // primary-orientation pass returns too little viable area (< 20 m²,
        // roughly < 10 panels of capacity), the customer's ONLY significant
        // roof might be S-facing. Real installers still put panels on such
        // roofs — just at lower yield.
        //
        // Example: 12A Knox Rd Hillpark — LiDAR found:
        //   128 m² S-facing (skipped by default)
        //    25 m² S-facing (skipped)
        //    16 m² W-facing (viable)
        // With default skipSouth=true, only the 16 m² pad is viable →
        // panels placed on a ground-level shed. With this fallback, we
        // include S and place panels on the actual 128 m² main house
        // roof — visibly correct, honest yield.
        let viable = selectViableSegments(enriched);
        const primaryAreaM2 = viable.reduce((sum, s) => sum + (s?.stats?.areaMeters2 || 0), 0);
        const S_INCLUSION_THRESHOLD_M2 = 20;
        if (primaryAreaM2 < S_INCLUSION_THRESHOLD_M2) {
          const withSouth = selectViableSegments(enriched, { skipSouth: false });
          const withSouthArea = withSouth.reduce((sum, s) => sum + (s?.stats?.areaMeters2 || 0), 0);
          if (withSouthArea > primaryAreaM2) {
            console.log(`[Cesium3DView] primary viable area ${primaryAreaM2.toFixed(0)}m² < ${S_INCLUSION_THRESHOLD_M2}m² threshold; retrying with S-facing included (yields ${withSouthArea.toFixed(0)}m²).`);
            viable = withSouth;
          }
        }
        if (!viable.length) {
          // Tag error with a softReason so the UI branches to
          // customer-friendly copy + site-survey CTA (P5 fix 2026-08-31 —
          // 160 Carroll Street single wall-pitch=74.7° case).
          const err = new Error(
            `No viable roof segments (all ${enriched.length} were south-facing, too small, or wrong pitch).`
          );
          err.softReason = categoriseNoViableReason(enriched);
          throw err;
        }

        // Bug 6 fix wire-up (2026-08-31) — inter-face overlap dedupe.
        // The helper has existed in panelGrid.js since Round 4 but was
        // never called; David Crescent Karori surfaced the consequence
        // — 4 planes' panel arrays visually stack on top of each other
        // when adjacent faces have similar azimuth. Drop segments whose
        // footprint overlaps a larger neighbour's by ≥50% BEFORE
        // distributePanels allocates, so we don't paint 2 layers of
        // panels on the same physical roof area.
        const beforeDedupe = viable.length;
        viable = deduplicateOverlappingFootprints(viable, { overlapPct: 0.5 });
        if (viable.length < beforeDedupe) {
          console.log(`[Cesium3DView] overlap-dedupe: ${beforeDedupe} viable segments → ${viable.length} after dropping ${beforeDedupe - viable.length} overlapping smaller footprints`);
        }

        // Ridge setback wire-up (2026-08-31) — mark segments that have an
        // opposing-face sibling on the same building. computePanelGridOnSegment
        // reads _hasOpposingFace to reserve 0.8 m of depth on the ridge side
        // so panels don't cross the ridge into the other face.
        annotateOpposingFaces(viable);

        const topSegments = viable.slice(0, Math.max(maxSegments, 8));
        // 2026-08-18 (V6 diagnostic fix) — pass REAL panel footprint to
        // distributePanels. Previously it used the hardcoded fallback
        // 1.65×0.99 = 1.63 m², which UNDER-estimates the space a modern
        // panel takes (Phono 595W = 2.28×1.13 = 2.58 m²). The primary-
        // face-capacity check would say "yes we can fit 17" then
        // computePanelGridOnSegment with the real dims would only fit 15,
        // silently dropping 2 panels. Now they match.
        const realFootprintLong  = Number.isFinite(panelLongM)  && panelLongM  > 0 ? panelLongM  : 1.65;
        const realFootprintShort = Number.isFinite(panelShortM) && panelShortM > 0 ? panelShortM : 0.99;
        const realFootprintM2    = realFootprintLong * realFootprintShort;
        // Fix 9 (2026-08-27): minPerSeg bumped from 3 → 4 to match the
        // Fronius MPPT string minimum (also referenced in AS/NZS 4777.1
        // typical residential inverters). A "3-panel array" isn't a real
        // MPPT string; below 4 the inverter can't operate. Combined with
        // the orientation-first fill algorithm above, this gives us
        // real-installer placement behaviour.
        const allocations = distributePanels(topSegments, panelTargetCount, 4, realFootprintM2, realFootprintLong, realFootprintShort);
        if (!allocations.length) {
          throw new Error(`Panel distribution returned empty for ${topSegments.length} segments.`);
        }

        // Wait for Cesium tiles around the target to finish streaming, then
        // wait for at least one actual render frame — the depth buffer must
        // be populated for viewer.scene.sampleHeight() (synchronous) to work.
        // tilesLoaded === true is NECESSARY but NOT SUFFICIENT: Cesium can
        // report tiles loaded before the render pass has painted them, and
        // sampleHeight reads the depth buffer of the LAST rendered frame.
        await waitForTilesLoaded(tileset, viewer, 15_000, () => cancelled);
        if (cancelled) { viewer.destroy(); return; }
        // Force render → wait for postRender to guarantee the depth buffer
        // contains the tile mesh under our sample points. Do this twice so
        // any deferred tile-processing work finishes before we sample.
        for (let i = 0; i < 2; i++) {
          if (cancelled || viewer.isDestroyed()) break;
          viewer.scene.requestRender();
          await new Promise((resolve) => {
            const removeListener = viewer.scene.postRender.addEventListener(() => {
              removeListener();
              resolve();
            });
          });
        }
        if (cancelled) { viewer.destroy(); return; }

        // 2026-08-18 — force target tiles to load BEFORE per-panel sampling.
        // Root cause of the "black QuoteStage" bug: passive scene.sampleHeight
        // reads whatever's in the depth buffer of the last render pass. If
        // that pass was a wide overview shot that didn't include the target
        // building at high enough LOD, every per-panel sample returns
        // undefined. Panels then stay at Google-Solar MSL altitude (~30 m
        // below Cesium's ellipsoidal mesh in NZ due to geoid separation),
        // and the subsequent zoomTo(allEntities, ...) frames a bounding
        // sphere whose centre is UNDER the tile mesh → camera ends up
        // inside the building looking at unlit back-faces → BLACK scene.
        // Fix: one batched sampleHeightMostDetailed at each segment centre
        // (typically 1-5 calls) forces the tiles into the frustum + depth
        // buffer. The passive per-panel loop below then finds real data.
        // Wrapped in try so PVGIS-style transient tile failures don't kill
        // the whole render — the fallback ladders below still catch them.
        try {
          const segmentCentreCartos = allocations
            .map(({ segment }) => segment?.center)
            .filter(c => Number.isFinite(c?.latitude) && Number.isFinite(c?.longitude))
            .map(c => Cesium.Cartographic.fromDegrees(c.longitude, c.latitude, 0));
          if (segmentCentreCartos.length > 0) {
            await viewer.scene.sampleHeightMostDetailed(segmentCentreCartos);
          }
        } catch (e) {
          console.warn('[Cesium3DView] sampleHeightMostDetailed(segmentCentres) threw — panels may fall back:', e?.message || e);
        }
        if (cancelled || viewer.isDestroyed()) { viewer.destroy?.(); return; }

        // Per-segment: compute idealized grid → sample mesh height PER PANEL
        // using scene.sampleHeight (SYNCHRONOUS, depth-buffer based) →
        // position each panel just above its local mesh height.
        //
        // Why sampleHeight not sampleHeightMostDetailed:
        //   - sampleHeightMostDetailed is ASYNC + can trigger additional
        //     LOD tile requests + can hang indefinitely even after
        //     tilesLoaded === true. For 75 Mahia this timed out reliably
        //     and left all panels stranded at Google's stale 2016 plane
        //     altitude, causing depth-fight with the current mesh (the
        //     "patchy panels" bug). Above we use it ONCE at segment
        //     centres just to prime tile loading — cheap + bounded.
        //   - sampleHeight (Cesium ≥1.87) reads the current frame's depth
        //     buffer. Fast, deterministic, never hangs. Only requirement:
        //     the sample point must be within the current view frustum —
        //     satisfied by the prime call above.
        const allEntities = [];
        let totalRendered = 0;
        const perSegmentReport = [];
        let anyStaleMesh = false;
        // Pass 1: prepare each segment's panel array (mesh sampling, altitude
        // adjust, stale-mesh detect). Defer the actual addPanelEntities call
        // to pass 2 so we can compute a SHARED yield min/max across every
        // panel — a per-segment scale would hide the fact that a NE face
        // gets less kWh than an N face on the same house.
        // Panel physical dimensions: prefer real values threaded from the
        // composer's picked panel (via props), fall back to the legacy
        // 1.65×0.99 defaults if not supplied. This is what makes the 3D
        // box entities render at true footprint size.
        const effectivePanelLongM  = Number.isFinite(panelLongM)  && panelLongM  > 0 ? panelLongM  : 1.65;
        const effectivePanelShortM = Number.isFinite(panelShortM) && panelShortM > 0 ? panelShortM : 0.99;

        const pendingRenders = [];
        for (const { segment, count } of allocations) {
          // Attach the composer's picked panel wattage so per-panel yield
          // math uses real spec (e.g. Phono 595W) instead of the panelGrid
          // area-based fallback (~340 W/m²). Mutating the segment is safe
          // — it's a fresh object from enrichSegmentsWithFaceDimensions.
          if (Number.isFinite(panelWatts) && panelWatts > 0) {
            segment._panelCapacityWatts = panelWatts;
          }
          // Fix 10 (2026-08-27) — pass the building polygon (OSM/LINZ
          // outline from the roof analyse endpoint) so panels get
          // shifted + clipped to inside the roof. Fixes the "panels
          // floating in the alley" bug on houses where Google Solar's
          // segment center sits near a polygon edge (e.g. 10 Newnham).
          const polygonRing = building?.polygon?.[0] || null;
          const segPanels = computePanelGridOnSegment(
            segment, effectivePanelLongM, effectivePanelShortM, count, polygonRing);
          if (!segPanels.length) continue;

          // SAVE original altitudes (Google Solar plane / LiDAR fitted plane
          // in MSL) BEFORE mesh sampling. Needed for the partial-sample
          // fallback below — if some panels get mesh samples but others
          // don't (transient 503 from tile.googleapis.com, edge-of-coverage,
          // etc.), the failed ones would otherwise stay at MSL altitude
          // while the successful ones are at Cesium ellipsoidal, producing
          // a ~30 m altitude mismatch across the panel array. Visually this
          // looks like the array is warped or half-buried.
          const originalAltitudes = segPanels.map(p => Number(p.center.altitude) || 0);

          // Sample each panel's mesh height synchronously (Cesium ellipsoidal
          // altitudes — this is the viewer's native reference frame, so panels
          // placed at these heights sit correctly on the rendered mesh).
          // We do NOT compare these to segment.planeHeightAtCenterMeters
          // directly because Google Solar reports MSL / LiDAR uses LINZ vertical
          // datum — both differ from WGS84 ellipsoidal by ~30 m in NZ (geoid
          // separation). A naive delta check treats this reference offset as
          // "stale imagery" and drops panels underground; that was a
          // regression on 75 Mahia in the earlier iteration.
          //
          // ── FIX 2026-08-31 ──────────────────────────────────────────
          // Root cause of Knox/David/Ramphal "panels missing or floating"
          // bugs: sync `scene.sampleHeight` reads the last-rendered depth
          // buffer, which often still shows LOW-DETAIL BASE TILES for the
          // target address at the moment we call it. sampleHeight returns
          // the FLAT base-tile height (e.g. 73m for Knox, 250m for David),
          // panels get placed there, then when high-detail tiles finish
          // loading the ACTUAL pitched roof appears at a different
          // altitude. Panels stay stuck at the flat-tile altitude:
          //   - Knox: 73m was ground level → panels visible in grass
          //   - David: 250m was flat-base → real roof at 253-260m →
          //           panels buried beneath actual roof mesh, invisible
          //
          // Diagnostic (2026-08-31) proved this: all 3 addresses had
          // sampledCount == segPanels.length (all samples "succeeded"),
          // but staleMeshDetected=true was flagged. Kelburn (working)
          // had staleMeshDetected=false.
          //
          // Fix: use `sampleHeightMostDetailed` (ASYNC, awaits highest-
          // LOD tiles for the queried positions) instead of sync
          // `sampleHeight`. Bounded with a 6s timeout so we don't hang
          // on transient tile failures — timeout falls back to sync
          // sampleHeight + accepts the staleness risk (better a chance
          // of correct placement than no render at all).
          let sampledCount = 0;
          const meshHeights = [];
          {
            const cartosToSample = segPanels.map(p =>
              Cesium.Cartographic.fromDegrees(p.center.longitude, p.center.latitude));
            let sampledCartos = null;
            try {
              // Race: sampleHeightMostDetailed vs 6s timeout
              const result = await Promise.race([
                viewer.scene.sampleHeightMostDetailed([...cartosToSample]),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
              ]);
              sampledCartos = result;
            } catch (e) {
              console.warn(`[Cesium3DView] sampleHeightMostDetailed(perPanel) failed for seg az=${segment.azimuthDegrees?.toFixed(0)}°: ${e?.message || e} — falling back to sync sampleHeight`);
              sampledCartos = null;
            }
            for (let i = 0; i < segPanels.length; i++) {
              let h = null;
              if (sampledCartos && Number.isFinite(sampledCartos[i]?.height)) {
                h = sampledCartos[i].height;
              } else {
                // Fallback: sync sampleHeight (last-rendered depth buffer)
                const carto = Cesium.Cartographic.fromDegrees(
                  segPanels[i].center.longitude, segPanels[i].center.latitude);
                const syncH = viewer.scene.sampleHeight(carto);
                if (Number.isFinite(syncH)) h = syncH;
              }
              if (Number.isFinite(h)) {
                meshHeights.push(h);
                sampledCount++;
              } else {
                meshHeights.push(null);
              }
            }
          }

          // STALE-MESH DETECTOR that survives the geoid-offset false positive.
          // Idea: for a real roof at pitch θ, mesh heights across the panel
          // grid MUST vary by (depthM × sin θ) — the down-slope drop.
          // If the Cesium mesh sample variance is ≪ expected, the mesh
          // isn't showing a tilted roof — it's showing flat ground/pad
          // (imagery predates the building). Compare RELATIVE variance,
          // not absolute altitude, so the reference-frame offset drops out.
          let staleMeshDetected = false;
          let meshVarianceM = null;
          let expectedVarianceM = null;
          if (sampledCount >= 3) {
            const valid = meshHeights.filter(Number.isFinite);
            meshVarianceM = Math.max(...valid) - Math.min(...valid);
            const pitchRad = ((segment.pitchDegrees || 0) * Math.PI) / 180;
            const depthM = Number(segment._faceDimensions?.depthAcrossSlopeM)
              || Math.sqrt(Number(segment.stats?.areaMeters2) || 0);
            expectedVarianceM = depthM * Math.abs(Math.sin(pitchRad));
            // Flag when the mesh looks essentially FLAT but the roof isn't:
            //   - the roof has meaningful pitch (>4°, i.e. would produce
            //     >~0.3 m of altitude variation over a typical 5 m depth)
            //   - AND the mesh variance is a small fraction of that
            if (expectedVarianceM > 0.4 && meshVarianceM < expectedVarianceM * 0.35) {
              staleMeshDetected = true;
              anyStaleMesh = true;
              console.warn(`[Cesium3DView] mesh appears FLAT (${meshVarianceM.toFixed(2)} m variance) but segment az=${segment.azimuthDegrees?.toFixed(0)}° pitch=${segment.pitchDegrees?.toFixed(1)}° expects ${expectedVarianceM.toFixed(2)} m — Cesium imagery likely predates current roof. Panels shown at sampled-mesh position for visibility; UI shows warning banner.`);
            }
          }

          // Fallback for the rare case sampleHeight returned undefined for
          // every panel. Try a single sample at segment centre — one point
          // is much more likely to succeed than a batch.
          let fallbackReference = null;
          if (sampledCount === 0) {
            const centerCarto = Cesium.Cartographic.fromDegrees(
              segment.center.longitude, segment.center.latitude,
            );
            const centreH = viewer.scene.sampleHeight(centerCarto);
            if (Number.isFinite(centreH)) {
              // Delta between mesh (Cesium ellipsoidal) and Google plane (MSL) —
              // includes both the local geoid separation AND any height-above-
              // ground offset. Applied uniformly, it calibrates the plane math
              // into the mesh reference frame.
              const google = Number(segment.planeHeightAtCenterMeters) || 0;
              fallbackReference = { mesh: centreH, google, delta: centreH - google };
              console.log(`[Cesium3DView] per-panel samples all failed for segment az=${segment.azimuthDegrees?.toFixed(0)}°; centre-sample delta=${fallbackReference.delta.toFixed(2)} m`);
            } else {
              console.warn(`[Cesium3DView] all mesh samples failed for segment az=${segment.azimuthDegrees?.toFixed(0)}° — panels will use Google Solar plane altitude with 60 cm lift as safety`);
            }
          }

          // PARTIAL-SAMPLE BRIDGE. If some panels sampled cleanly and others
          // didn't (transient tile 503 seen on Hillsborough Road, edge of
          // coverage, etc.), compute the median mesh-vs-MSL delta from the
          // panels that DID sample, and apply that delta to the panels that
          // didn't. Without this, missing-sample panels stay at MSL altitude
          // while sampled panels are at Cesium ellipsoidal — a ~30 m gap in
          // NZ that visually warps the array.
          let partialDelta = null;
          if (sampledCount > 0 && sampledCount < segPanels.length) {
            const deltas = [];
            for (let i = 0; i < segPanels.length; i++) {
              if (Number.isFinite(meshHeights[i])) {
                deltas.push(meshHeights[i] - originalAltitudes[i]);
              }
            }
            const sorted = [...deltas].sort((a, b) => a - b);
            partialDelta = sorted[Math.floor(sorted.length / 2)];
            console.log(`[Cesium3DView] partial-sample: ${sampledCount}/${segPanels.length} sampled, median delta ${partialDelta.toFixed(2)} m applied to ${segPanels.length - sampledCount} missing panels`);
          }

          // Round 4 (2026-08-26) — Bug 7/8. Compute the NZ geoid separation
          // ONCE per segment as the last-resort correction. When none of
          // mesh sample / partial bridge / centre sample succeeded, the
          // pre-fix code left altitude at raw MSL, which sits ~14-37 m
          // below Cesium's ellipsoidal frame in NZ — panels appear on the
          // sky / underground / floating over the wrong roof (Queenstown,
          // Waikanae reports). Applying the coarse geoid table shrinks
          // the last-resort error from ~30 m to ~3 m so panels at least
          // sit near the mesh surface.
          const segGeoidSep = nzGeoidSeparationMetres(
            segment.center.latitude, segment.center.longitude,
          );
          let geoidFallbackUsed = false;

          // Fix 8 (2026-08-27) — SEGMENT-UNIFORM altitude.
          //
          // Previous behaviour: each panel used its OWN per-panel mesh
          // sample when available. On real hip roofs the Cesium mesh
          // isn't perfectly flat — texture noise + edge artifacts +
          // photogrammetry wobble mean neighbouring samples differ by
          // 5-20 cm even on a "flat" face. Result: neighbouring panels
          // sat at slightly different heights, panels appeared warped /
          // sliced / non-rectangular in the rendered scene (customer
          // report on 10 Newnham Terrace Christchurch, 2026-08-27).
          //
          // Real solar panels install on flat rails on the roof —
          // physical reality is a clean flat plane, not per-panel
          // undulation. So we now compute ONE segment-wide altitude
          // delta (median of all successful per-panel samples) and
          // apply it uniformly to every panel on that segment. Panels
          // form a clean geometric plane aligned with the mesh at
          // the segment's centre-of-mass, matching how they'd
          // physically install.
          //
          // Fallback chain (in priority order):
          //   1. Median of successful per-panel samples on this segment
          //   2. Centre-sample delta (from fallbackReference)
          //   3. NZ geoid separation (for regions where mesh sampling
          //      fully failed — Queenstown/Waikanae style)
          //
          // originalAltitudes[i] already encodes each panel's tilt +
          // within-segment offset (v × sin(pitch)) — applying a UNIFORM
          // delta preserves the panel-to-panel geometry of the tilted
          // plane while snapping the whole thing into the mesh frame.
          //
          // Even when staleMeshDetected=true we STILL use the mesh
          // position (panels visibly on stale surface, banner explains).
          const successfulDeltas = [];
          for (let i = 0; i < segPanels.length; i++) {
            if (Number.isFinite(meshHeights[i])) {
              successfulDeltas.push(meshHeights[i] - originalAltitudes[i]);
            }
          }
          let uniformDelta = null;
          let deltaSource = null;
          if (successfulDeltas.length > 0) {
            successfulDeltas.sort((a, b) => a - b);
            uniformDelta = successfulDeltas[Math.floor(successfulDeltas.length / 2)];
            deltaSource = 'segment-median';
          } else if (fallbackReference) {
            uniformDelta = fallbackReference.delta;
            deltaSource = 'centre-sample';
          } else {
            uniformDelta = segGeoidSep;
            deltaSource = 'nz-geoid';
            geoidFallbackUsed = true;
          }

          segPanels.forEach((p, i) => {
            p.center.altitude = originalAltitudes[i] + uniformDelta;
          });
          if (successfulDeltas.length > 0) {
            const spread = successfulDeltas[successfulDeltas.length - 1] - successfulDeltas[0];
            if (spread > 0.5) {
              console.log(`[Cesium3DView] segment-uniform altitude: az=${segment.azimuthDegrees?.toFixed(0)}°, median delta ${uniformDelta.toFixed(2)}m (raw sample spread was ${spread.toFixed(2)}m — flattened for clean geometry)`);
            }
          }
          // Diag 2026-08-31 — enabled via URL ?debug=panels or localStorage['gr-debug-panels']='1'.
          // Dumps per-segment altitude decision so we can trace Bug 1 (Knox floating panels)
          // + Bug 3 (David/Ramphal panels never appear). Off by default; safe for prod.
          const _debugPanels =
            typeof window !== 'undefined' && (
              new URLSearchParams(window.location.search).get('debug') === 'panels'
              || window.localStorage?.getItem('gr-debug-panels') === '1'
            );
          if (_debugPanels) {
            const meshOrig = segPanels.map((p, i) => ({
              lat: p.center.latitude.toFixed(6),
              lng: p.center.longitude.toFixed(6),
              origAlt: Number(originalAltitudes[i].toFixed(2)),
              meshH: meshHeights[i] != null ? Number(meshHeights[i].toFixed(2)) : null,
              finalAlt: Number(p.center.altitude.toFixed(2)),
            }));
            console.log(`[panels-diag] segment az=${Math.round(segment.azimuthDegrees)}° pitch=${segment.pitchDegrees?.toFixed(1)}° area=${segment.stats?.areaMeters2?.toFixed(0)}m² source=${segment._source || 'google'}`);
            console.log(`[panels-diag]   segments planeH=${segment.planeHeightAtCenterMeters?.toFixed(2)}m centre=${segment.center.latitude.toFixed(6)},${segment.center.longitude.toFixed(6)}`);
            console.log(`[panels-diag]   deltaSource=${deltaSource} uniformDelta=${uniformDelta.toFixed(2)}m sampledCount=${sampledCount}/${segPanels.length} staleMesh=${staleMeshDetected}`);
            console.log(`[panels-diag]   per-panel altitudes: ${JSON.stringify(meshOrig).slice(0, 800)}`);
          }
          if (geoidFallbackUsed) {
            console.warn(`[Cesium3DView] geoid-fallback: segment az=${segment.azimuthDegrees?.toFixed(0)}° at (${segment.center.latitude.toFixed(4)}, ${segment.center.longitude.toFixed(4)}) — applied ${segGeoidSep.toFixed(1)} m NZ geoid correction to raw MSL. Mesh sampling failed for every panel + centre — Cesium tiles likely still loading. Refresh may help.`);
          }

          const anySampled = sampledCount > 0 || fallbackReference != null;
          const lift = anySampled ? 0.30 : 0.60;

          // Defer render — collect what pass 2 needs.
          pendingRenders.push({
            segment,
            segPanels,
            lift,
            report: {
              orientation:     segment._viability?.orientation,
              needsTiltFrames: !!segment._viability?.needsTiltFrames,
              azimuthDeg:      segment.azimuthDegrees,
              pitchDeg:        segment.pitchDegrees,
              areaM2:          segment.stats?.areaMeters2,
              panels:          segPanels.length,
              meshSamplesHit:  sampledCount,
              meshSampleTotal: segPanels.length,
              fallbackUsed:    deltaSource || (sampledCount === 0
                                 ? (fallbackReference
                                     ? 'centre-sample'
                                     : (geoidFallbackUsed ? 'nz-geoid' : 'none'))
                                 : (partialDelta != null ? 'partial-sample-bridge' : null)),
              geoidCorrectionM: geoidFallbackUsed ? Number(segGeoidSep.toFixed(1)) : null,
              partialBridgeDeltaM: partialDelta != null ? Number(partialDelta.toFixed(2)) : null,
              staleMesh:       staleMeshDetected,
              meshVarianceM:   meshVarianceM != null ? Number(meshVarianceM.toFixed(2)) : null,
              expectedVarianceM: expectedVarianceM != null ? Number(expectedVarianceM.toFixed(2)) : null,
              liftM:           lift,
              faceDimSource:   segment._faceDimensions?.source || 'bbox',
            },
          });
        }

        // Pass 2: render every panel in the realistic dark-navy fallback,
        // and compute the median per-panel yield so the top-right legend
        // can show a "your roof: X kWh/panel/yr" marker on the NZ scale.
        // 2026-08-19 · Panel yield heatmap REVERTED per user feedback
        // ("does not look good"). Infrastructure (__heatmapColor field
        // + setPanelMaterial precedence + yieldToColor import) kept in
        // place — re-enable by uncommenting the heatmapColorFn line
        // + passing colorFn in the addPanelEntities call below.
        for (const { segPanels, lift, report } of pendingRenders) {
          const entities = addPanelEntities(Cesium, viewer, segPanels, {
            altitudeOffsetM: lift,
            thicknessM: 0.05,
            color: '#0B2A5C',
            outlineColor: '#FFFFFF',
          });
          allEntities.push(...entities);
          totalRendered += segPanels.length;
          perSegmentReport.push(report);
        }

        // Median across real-source panels (excludes 'placeholder' — those
        // carry the panelGrid legacy 500 kWh sentinel, not a real reading,
        // and would drag the marker sideways). Median rather than mean
        // for outlier-resistance on multi-face installs.
        const observedYields = pendingRenders
          .flatMap(r => r.segPanels)
          .filter(p => p.yieldSource !== 'placeholder' && Number.isFinite(p.yieldEstEnergyKwh))
          .map(p => p.yieldEstEnergyKwh)
          .sort((a, b) => a - b);
        if (!cancelled) {
          setYieldRange(observedYields.length ? {
            scaleMin:    300,   // NZ S-facing worst-case per-panel yield
            scaleMax:    900,   // ideal N-facing modern-panel ceiling
            yourRoofKwh: observedYields[Math.floor(observedYields.length / 2)],
          } : null);
        }

        // Screen-space hover picking for the per-panel yield tooltip.
        // Wire it once entities exist (pick can't hit anything before then).
        // The tooltip is standalone here — panels aren't coloured, but
        // customers can still hover to see individual panel kWh + source.
        if (allEntities.length && !cancelled && !viewer.isDestroyed()) {
          hoverHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
          hoverHandler.setInputAction((movement) => {
            if (viewer.isDestroyed()) return;
            const picked = viewer.scene.pick(movement.endPosition);
            const panel = picked?.id?.__panelData;
            if (panel && Number.isFinite(panel.yieldEstEnergyKwh)) {
              setHoverInfo({
                x: movement.endPosition.x,
                y: movement.endPosition.y,
                yieldKwh: panel.yieldEstEnergyKwh,
                source:   panel.yieldSource || null,
              });
            } else {
              // Clear only when we were previously showing something —
              // avoids a React re-render every frame of mouse movement
              // over empty scene.
              setHoverInfo((cur) => (cur == null ? cur : null));
            }
          }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

          // V6 · LEFT_CLICK — pick the panel under the cursor and open
          // the measurement card with plane stats. Clicks on empty space
          // (no panel picked) clear the card. Same handler as MOUSE_MOVE
          // so we don't spin up a second ScreenSpaceEventHandler for one
          // input action.
          hoverHandler.setInputAction((click) => {
            if (viewer.isDestroyed()) return;
            const picked = viewer.scene.pick(click.position);
            const panel = picked?.id?.__panelData;
            if (!panel) { setSelectedFace(null); return; }
            // Count panels on the SAME face — group by azimuth+pitch (both
            // paths tag panels with these). Tolerance 0.1° swallows any
            // float drift from panelGrid or Google Solar rounding.
            const az = Number(panel.azimuthDeg);
            const pt = Number(panel.pitchDeg);
            const sameFace = (d) =>
              d && Math.abs((Number(d.azimuthDeg) || 0) - az) < 0.1
                && Math.abs((Number(d.pitchDeg)   || 0) - pt) < 0.1;
            const panelCount = panelEntitiesRef.current.filter(e => sameFace(e?.__panelData)).length;
            // Best-effort segment lookup for area — LiDAR panels carry
            // `_sourceSegment`; Google Solar panels carry `segmentIndex`
            // and we fall back to the segments prop.
            const srcSeg = panel._sourceSegment
              || (Number.isFinite(panel.segmentIndex) && segments?.[panel.segmentIndex])
              || null;
            const areaM2 = srcSeg?.stats?.areaMeters2;
            const segIdx = Number.isFinite(panel.segmentIndex)
              ? panel.segmentIndex
              : (srcSeg && segments?.indexOf(srcSeg));
            setSelectedFace({
              screenX:      click.position.x,
              screenY:      click.position.y,
              segmentIndex: Number.isFinite(segIdx) && segIdx >= 0 ? segIdx : null,
              azimuth:      az,
              pitch:        pt,
              areaM2:       Number.isFinite(areaM2) ? areaM2 : null,
              panelCount,
              perPanelKwh:  Number.isFinite(panel.yieldEstEnergyKwh) ? panel.yieldEstEnergyKwh : null,
              yieldSource:  panel.yieldSource || null,
              panelLongM:   panel.dimensions?.longM,
              panelShortM:  panel.dimensions?.shortM,
            });
          }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

          // MOUSE_MOVE stops firing when the cursor leaves the canvas, so a
          // panel-hover tooltip would freeze at its last position. Add a
          // native mouseleave listener to clear it. Handler is removed as
          // part of ScreenSpaceEventHandler.destroy() teardown below.
          const clearOnLeave = () => setHoverInfo(null);
          viewer.scene.canvas.addEventListener('mouseleave', clearOnLeave);
          hoverHandler.__cleanupLeave = () =>
            viewer.scene.canvas.removeEventListener('mouseleave', clearOnLeave);
        }

        // 8. Frame the whole panel cluster. Use viewer.zoomTo(entities, hpr)
        //    which handles altitude RELATIVE to the entity positions — safer
        //    than fromDegrees(lng, lat, height) which uses absolute ellipsoid
        //    height and can put the camera underground if you get the ground
        //    elevation wrong.
        //
        //    Steeper pitch (-70°) shows more of the roof so panels on ALL
        //    faces are visible from above (not hidden behind the front face).
        //    Range 40m gives a tight residential-roof framing where the
        //    panels + roof fill most of the frame (was 80m → too far, panels
        //    looked tiny for houses with wider panel spread).
        setTimeout(() => {
          if (!viewer.isDestroyed() && allEntities.length) {
            viewer.zoomTo(allEntities, new Cesium.HeadingPitchRange(
              Cesium.Math.toRadians((allocations[0].segment.azimuthDegrees || 0) + 30),
              Cesium.Math.toRadians(-55),   // less steep so panel tilt is visible, not just tops
              40,
            ));
          }
        }, 300);

        if (!cancelled) {
          // Publish panel entities to the ref BEFORE flipping status=ready
          // so the shade-compute effect (which runs on status change) finds
          // them immediately, not on a follow-up render.
          panelEntitiesRef.current = allEntities.filter(e => e.__panelData);
          setStatus('ready');
          onPlacementReady?.({
            totalRendered,
            perSegment: perSegmentReport,
            skippedSegments: segments.length - allocations.length,
            // Any segment where the Cesium mesh diverges >2m from what
            // Google Solar / LiDAR reports as the roof plane altitude.
            // When true, the UI should tell the customer the 3D aerial
            // may pre-date current construction — panel positions are
            // taken from the newer roof-detection data instead.
            staleMeshDetected: anyStaleMesh,
          });
          // Dev-only debug hook — puppeteer tests read this via page.evaluate()
          // to verify the Cesium scene without relying on WebGL screenshots.
          // Production builds strip this whole block.
          if (import.meta.env.DEV) {
            // Wait for flyTo animation to settle before final snapshot.
            setTimeout(() => {
              if (!viewer.isDestroyed()) {
                publishDebugState(Cesium, viewer, allEntities, allocations, coords);
              }
            }, 3500);
          }
        }
      } catch (e) {
        console.error('[Cesium3DView] failed:', e);
        if (!cancelled) {
          // Preserve any softReason tag from the panel-layout thrower so
          // the error UI can pick friendly copy (P5 fix 2026-08-31 —
          // Carroll Street single-wall-segment case).
          const errMsg = e?.response?.data?.error || e?.message || String(e);
          const softReason = e?.softReason || null;
          setError(softReason ? { message: errMsg, softReason } : errMsg);
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (hoverHandler) {
        if (typeof hoverHandler.__cleanupLeave === 'function') hoverHandler.__cleanupLeave();
        if (!hoverHandler.isDestroyed()) hoverHandler.destroy();
      }
      hoverHandler = null;
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords?.latitude, coords?.longitude, showPanels, panelTargetCount, panelWatts, panelLongM, panelShortM, maxSegments, solarPanels?.length]);

  // ── Tier UX Fix D (2026-08-20): sync ground-hardware entity visibility
  // with the selected tier's config. Runs whenever `showBattery` or
  // `showEv` props change. Guarded on viewer readiness — the main effect
  // creates the entities on first render; this effect just flips .show.
  //
  // Bug 3 fix (2026-08-24): must call viewer.scene.requestRender() after
  // mutating entity.show or Cesium's on-demand render mode (the default in
  // this codebase) will keep displaying the previous frame — customer
  // switches tier cards but the 3D scene never repaints. Every other
  // useEffect in this file that mutates entities calls requestRender()
  // (see lines 414, 760, 1046, 1507, 1612, 1638, 1678); this one was the
  // only miss.
  useEffect(() => {
    const g = groundHardwareRef.current;
    if (!g) return undefined;
    if (g.batteryBox) g.batteryBox.show = !!showBattery;
    if (g.evPedestal) g.evPedestal.show = !!showEv;
    if (g.car)        g.car.show        = !!showEv;
    if (viewerRef.current && !viewerRef.current.isDestroyed()) {
      viewerRef.current.scene.requestRender();
    }
    return undefined;
  }, [showBattery, showEv, status]);

  // ── Feature B1: sync viewer.clock + SunCompass with slider state ───────
  // Runs whenever the sliders move (or after the viewer becomes ready).
  // Cesium's SunLight reads viewer.clock every frame to position the sun,
  // so setting the clock is enough for the shadow map to recompute.
  // Also computes altitude/azimuth for the SunCompass indicator so the
  // two visualisations stay in step.
  useEffect(() => {
    const utcDate = nzMonthHourToUtcDate(sunMonth, sunHour);
    // Compass computation is Cesium-free — always runs, even before viewer
    // is ready (compass renders as soon as coords land).
    if (Number.isFinite(coords?.latitude) && Number.isFinite(coords?.longitude)) {
      setSunPosition(sunPositionForDate(utcDate, coords.latitude, coords.longitude));
    }
    // Viewer clock update only when the 3D scene is up.
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || viewer.isDestroyed()) return;
    if (status !== 'ready') return;
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(utcDate);
    // Force one render so the shadow map picks up the new sun position
    // immediately — Cesium's requestRenderMode default only renders on
    // explicit request or scene change.
    viewer.scene.requestRender();
  }, [sunMonth, sunHour, status, coords?.latitude, coords?.longitude]);

  // ── Feature B1: "play a day" rAF animation ─────────────────────────────
  // When isPlaying flips true, sweep sunHour from 5 → 20 over ~12 seconds,
  // then auto-stop (isPlaying → false). Single pass, not looping — user
  // hits play again to replay. Uses rAF so playback is smooth at the
  // browser's frame rate, respects reduced-motion via a straight linear
  // ramp (no bounce / ease). Cancels cleanly if the user un-plays mid-loop
  // or the component unmounts.
  useEffect(() => {
    if (!isPlaying) return;
    const START_HOUR   = 5;
    const END_HOUR     = 20;
    const DURATION_MS  = 12000;
    const startedAt    = performance.now();
    let rafHandle = 0;
    const tick = (now) => {
      const t = Math.min(1, (now - startedAt) / DURATION_MS);
      setSunHour(START_HOUR + (END_HOUR - START_HOUR) * t);
      if (t < 1) {
        rafHandle = requestAnimationFrame(tick);
      } else {
        setIsPlaying(false);   // reached end, stop
      }
    };
    rafHandle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafHandle);
  }, [isPlaying]);

  // ── V1 · Play-a-day handler with auto-restore-panels ─────────────────
  // Pause: just flip isPlaying off — simple.
  // Play from full opacity: flip isPlaying on — normal path.
  // Play from partially-visible or empty roof: first smoothly animate
  // panelOpacity → 1 over ~300ms so the customer sees panels appear,
  // THEN start the day sweep. Prevents the "play does nothing visible"
  // dead-end when the Before/After slider is at empty.
  const handlePlayClick = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (panelOpacity >= 0.95) {
      setIsPlaying(true);
      return;
    }
    // Restore-then-play animation.
    const startOpacity = panelOpacity;
    const startedAt = performance.now();
    const DURATION_MS = 300;
    const tick = (now) => {
      const t = Math.min(1, (now - startedAt) / DURATION_MS);
      const eased = startOpacity + (1 - startOpacity) * t;
      setPanelOpacity(eased);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        setPanelOpacity(1);
        setIsPlaying(true);
      }
    };
    requestAnimationFrame(tick);
  };

  // ── Feature B2: per-panel shade dimming via raycast ────────────────────
  // For each rendered panel, cast a ray from just above the panel toward the
  // sun and check whether Cesium's 3D-tile mesh (buildings / trees) blocks
  // the line of sight. Shaded panels get a near-black material; sunlit
  // panels stay dark navy. Also feeds `shadedCount` for the timeline footer.
  //
  // THROTTLE (300ms floor) rather than a plain debounce. A debounce would
  // keep resetting every frame during "Play a day" (sunHour changes at
  // 60fps) and NEVER actually fire — panels would stay unchanged through
  // the whole animation, only updating after it stopped. The throttle
  // fires immediately if it's been > 300ms since the last fire, otherwise
  // it schedules exactly one deferred fire at the throttle boundary.
  //
  // Sun below horizon → skip raycast entirely, mark all panels shaded.
  // Skips when panelEntitiesRef is empty (before render) or the viewer
  // isn't ready.
  useEffect(() => {
    if (!sunPosition) return;
    if (status !== 'ready') return;

    const THROTTLE_MS = 300;

    const runShadeCompute = () => {
      lastFireRef.current = performance.now();
      pendingTimerRef.current = null;

      const viewer = viewerRef.current;
      const Cesium = cesiumRef.current;
      const entities = panelEntitiesRef.current;
      if (!viewer || !Cesium || viewer.isDestroyed()) return;
      if (!entities || entities.length === 0) return;

      const opacity = panelOpacityRef.current;

      // Sun below horizon → whole scene is night, every panel shaded.
      if (sunPosition.altitude <= 0) {
        entities.forEach(e => {
          e.__isShaded = true;
          setPanelMaterial(Cesium, e, opacity);
        });
        setShadedCount(entities.length);
        viewer.scene.requestRender();
        return;
      }

      let shaded = 0;
      for (const entity of entities) {
        const panelCartesian = entity.position?.getValue?.(Cesium.JulianDate.now());
        if (!panelCartesian) continue;

        // Lift the ray origin 1m in world-up so the ray doesn't hit the
        // panel's own roof surface immediately below it.
        const carto = Cesium.Cartographic.fromCartesian(panelCartesian);
        const rayOriginCarto = new Cesium.Cartographic(carto.longitude, carto.latitude, carto.height + 1.0);
        const rayOrigin = Cesium.Cartographic.toCartesian(rayOriginCarto);
        const sunDir = computeSunDirectionEcef(
          Cesium, rayOrigin, sunPosition.altitude, sunPosition.azimuth,
        );
        const ray = new Cesium.Ray(rayOrigin, sunDir);
        // Exclude the panel itself so the ray doesn't self-hit if the
        // 1m lift wasn't quite enough on very steep pitches.
        const picked = viewer.scene.pickFromRay(ray, [entity]);
        entity.__isShaded = !!picked;
        if (entity.__isShaded) shaded++;
        setPanelMaterial(Cesium, entity, opacity);
      }
      setShadedCount(shaded);
      viewer.scene.requestRender();
    };

    const timeSinceLast = performance.now() - lastFireRef.current;
    // Cancel any queued fire — either we're about to fire now (leading edge)
    // or we'll re-queue below (trailing edge). Prevents duplicate fires.
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }

    if (timeSinceLast >= THROTTLE_MS) {
      // Leading edge — fire immediately (throttle window has elapsed).
      runShadeCompute();
    } else {
      // Trailing edge — fire once at the end of the current throttle window.
      pendingTimerRef.current = setTimeout(runShadeCompute, THROTTLE_MS - timeSinceLast);
    }

    return () => {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [sunPosition, status]);

  // ── V1: Before/After slider — apply opacity to all panels ──────────────
  // Cheap effect (no raycasts) — just walks the existing entity list and
  // rewrites material + outline alpha via setPanelMaterial (which also
  // toggles show=false at near-zero opacity to avoid rendering artifacts).
  // Reads entity.__isShaded so it composes with the current shade state
  // — a shaded panel at 50% opacity stays near-black and half-transparent,
  // not lit-navy at 50%.
  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    const entities = panelEntitiesRef.current;
    if (!viewer || !Cesium || viewer.isDestroyed() || !entities?.length) return;
    for (const entity of entities) setPanelMaterial(Cesium, entity, panelOpacity);
    viewer.scene.requestRender();
  }, [panelOpacity, status]);

  return (
    <div className={`rounded-2xl overflow-hidden shadow-2xl border border-[#E3D9C4] bg-black ${className}`}>
      {/* ── 3D scene ─────────────────────────────────────────────────────── */}
      <div className="relative" style={{ height }}>
        <div ref={containerRef} className="absolute inset-0" />

        {/* Loading spinner over the scene */}
        {status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-sm z-10">
            <div className="text-center text-white">
              <div className="w-10 h-10 mx-auto mb-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <div className="text-xs font-mono opacity-80">
                {showPanels ? 'Loading 3D roof · placing panels…' : 'Loading 3D view of your home…'}
              </div>
            </div>
          </div>
        )}

        {/* Error state (P5 fix 2026-08-31 — softened for customer-facing
            single-segment / small-building / no-viable cases like Carroll
            Street. Tech detail hidden by default; ?debug=1 reveals it.) */}
        {status === 'error' && (() => {
          const isObj = typeof error === 'object' && error !== null;
          const softReason = isObj ? error.softReason : null;
          const rawMsg    = isObj ? error.message    : error;
          const showTech  = typeof window !== 'undefined'
            && new URLSearchParams(window.location.search).has('debug');
          let title, body;
          switch (softReason) {
            case 'no-roof-plane':
              title = 'This looks like a wall, not a roof.';
              body  = "The imagery we have here only shows one steep face (looks more like a wall than a slanted roof), so our automatic panel-layout can't work with it. A site survey will confirm your actual roof and give you an exact quote.";
              break;
            case 'roof-too-small':
              title = 'Your roof is smaller than our auto-layout can handle.';
              body  = 'Roofs under ~10 m² of usable area get better placement from a technician in person. A quick site survey will confirm what fits and give you an exact quote.';
              break;
            case 'all-south-facing':
              title = 'Every face on this roof is south-facing.';
              body  = "In New Zealand, south-facing panels get about a third of the yield of a north-facing roof. A technician can look at options like tilt-frames, ground-mount, or a partial install to make it worth it.";
              break;
            default:
              title = "We couldn't lay panels on this roof automatically.";
              body  = 'This can happen for unusual roof shapes, obstructions, or coverage gaps in the imagery. A technician site survey is the fastest path to an accurate quote.';
          }
          return (
            <div className="absolute inset-0 grid place-items-center bg-[#F4EEE1]/95 backdrop-blur-sm z-10 p-6 text-center">
              <div className="max-w-md text-[#2B2A28]">
                <div className="text-base font-semibold mb-2">{title}</div>
                <div className="text-sm text-[#55504A] mb-4">{body}</div>
                <a
                  href="/book-survey"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#D9531E] text-white text-sm font-semibold hover:bg-[#B84418] transition"
                >
                  Book a site survey &rarr;
                </a>
                {showTech && rawMsg && (
                  <details className="mt-4 text-left">
                    <summary className="text-xs text-[#8B8377] cursor-pointer">Technical detail (debug mode)</summary>
                    <div className="mt-1 text-[11px] font-mono text-[#55504A] bg-[#E3D9C4]/40 rounded p-2 whitespace-pre-wrap">
                      {rawMsg}
                    </div>
                  </details>
                )}
              </div>
            </div>
          );
        })()}

        {/* Google attribution (required) */}
        {attribution && (
          <div className="absolute bottom-2 left-2 right-2 z-10 text-[10px] font-mono text-white/70 bg-black/60 rounded px-2 py-1 pointer-events-none">
            {attribution}
          </div>
        )}

        {/* Sun compass — top-left corner. Primary sun-path indicator; independent
            of Cesium's shadow map (which is limited by Google Photorealistic
            3D Tiles' baked lighting). Renders as soon as coords land.
            Dimmed during installation animation so the sequence takes focus. */}
        {status === 'ready' && showPanels && sunPosition && (
          <div className={`absolute top-3 left-3 z-20 pointer-events-none transition-opacity duration-500 ${installStep >= 0 ? 'opacity-10' : 'opacity-100'}`}>
            <SunCompass altitude={sunPosition.altitude} azimuth={sunPosition.azimuth} />
          </div>
        )}

        {/* V1 · Before/After vertical slider — bottom-LEFT.
            Anchored to `bottom-14` so it always clears the Google attribution
            at bottom-2 with ~40px gap. Sits on the LEFT edge below the sun
            compass (top-3) — left side has more vertical room than the right
            (which is dominated by the wide yield legend). Container is
            intentionally compact (~200px tall) so it never runs into the
            compass above.

            writing-mode + direction hacks are the modern cross-browser way
            to rotate a native range input while keeping keyboard, aria,
            and touch semantics intact. -webkit-appearance is a fallback
            for older Chromium builds. */}
        {status === 'ready' && showPanels && (
          <div className={`absolute left-3 bottom-14 z-20 pointer-events-auto transition-opacity duration-500 ${installStep >= 0 ? 'opacity-10 pointer-events-none' : ''}`}>
            {/* Slider disabled while "Play a day" is running so the two
                controls don't fight — fading panels mid-play would be
                confusing (customer can't tell shade from opacity). Visual
                dim + not-allowed cursor hint at the reason. Also dimmed
                during installation animation (opacity controlled by the
                sequence, not user input). */}
            <div className={`bg-black/70 backdrop-blur-md rounded-lg px-2 py-2 flex flex-col items-center gap-1.5 shadow-lg transition-opacity
              ${isPlaying ? 'opacity-40' : 'opacity-100'}
            `}>
              <div className="text-[9px] font-mono uppercase tracking-widest text-white/70 whitespace-nowrap">
                With solar
              </div>
              <input
                type="range"
                min="0" max="100" step="1"
                value={Math.round(panelOpacity * 100)}
                onChange={(e) => setPanelOpacity(Number(e.target.value) / 100)}
                disabled={isPlaying}
                className={`accent-amber-400 ${isPlaying ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                style={{
                  writingMode: 'vertical-lr',
                  WebkitAppearance: 'slider-vertical',
                  width: '20px',
                  height: '130px',
                  direction: 'rtl',   // top = 100 (with solar), bottom = 0 (empty)
                }}
                title={isPlaying
                  ? 'Slider paused while day-sweep is playing'
                  : `Panels: ${Math.round(panelOpacity * 100)}% visible`}
              />
              <div className="text-[9px] font-mono uppercase tracking-widest text-white/70 whitespace-nowrap">
                Empty roof
              </div>
              <div className="text-[10px] font-mono text-amber-300 tabular-nums">
                {Math.round(panelOpacity * 100)}%
              </div>
            </div>
          </div>
        )}

        {/* Top-right yield legend — compact glanceable reference paired with
            the sidebar SolarQualityScoreCard. Shows the NZ 300-900 kWh scale
            with a white marker at the customer's median panel yield so they
            know where their roof sits without leaving the 3D view. Dimmed
            during installation animation. */}
        {status === 'ready' && yieldRange && (
          <div className={`absolute top-3 right-3 z-20 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-2 pointer-events-none transition-opacity duration-500 ${installStep >= 0 ? 'opacity-10' : 'opacity-100'}`}>
            <div className="text-[11px] font-semibold text-white/90 mb-2 tracking-wide uppercase">
              Yield per panel
            </div>
            <div
              className="relative h-2.5 w-44 rounded"
              style={{ background: `linear-gradient(to right, ${gradientCssStops()})` }}
            >
              {Number.isFinite(yieldRange.yourRoofKwh) && (
                <div
                  className="absolute -top-1 w-1 h-4 bg-white rounded-sm shadow"
                  style={{
                    left: `calc(${Math.max(0, Math.min(100,
                      ((yieldRange.yourRoofKwh - yieldRange.scaleMin) /
                       (yieldRange.scaleMax - yieldRange.scaleMin)) * 100
                    )).toFixed(1)}% - 2px)`,
                  }}
                  title={`Your roof: ~${Math.round(yieldRange.yourRoofKwh)} kWh/panel/yr`}
                />
              )}
            </div>
            <div className="flex justify-between mt-1 text-[10px] font-mono text-white/70">
              <span>{yieldRange.scaleMin} kWh</span>
              <span>{yieldRange.scaleMax} kWh</span>
            </div>
            <div className="mt-1.5 text-[10px] font-mono text-amber-300">
              Your roof: ~{Math.round(yieldRange.yourRoofKwh)} kWh/panel/yr
            </div>
            <div className="text-[9px] font-mono text-white/40 leading-tight">
              NZ residential spectrum · S-facing → ideal N
            </div>
          </div>
        )}

        {/* V6 · Measurement card — click any panel to open. Shows
            compass direction, azimuth, pitch, plane area, panel count on
            this face, per-panel yield, panel physical dimensions. Card
            position clamped to container. Close via X or ESC. Clicking
            an empty area of the canvas also dismisses (LEFT_CLICK
            handler clears selectedFace when nothing is picked). */}
        {selectedFace && (
          <div
            className="absolute z-40 w-72 bg-white border border-[#E3D9C4] rounded-xl shadow-2xl overflow-hidden animate-[fadeIn_150ms_ease-out]"
            style={{
              left: Math.min(
                Math.max(8, selectedFace.screenX + 20),
                (containerRef.current?.clientWidth  || 9999) - 296,
              ),
              top:  Math.min(
                Math.max(8, selectedFace.screenY + 20),
                (containerRef.current?.clientHeight || 9999) - 320,
              ),
            }}
          >
            <div className="flex items-start justify-between px-4 py-3 border-b border-[#E3D9C4] bg-gradient-to-r from-[#F4EEE1] to-[#FBF7F0]">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">
                  Face {selectedFace.segmentIndex != null ? `#${selectedFace.segmentIndex + 1}` : ''}
                </div>
                <div className="text-lg font-serif font-bold text-[#1A1614] leading-tight">
                  {azToCompass(selectedFace.azimuth)}-facing
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFace(null)}
                className="p-1.5 -mt-1 -mr-1 rounded-full hover:bg-white/60 text-[#55504A] text-lg leading-none"
                aria-label="Close"
                title="Close (Esc)"
              >
                &times;
              </button>
            </div>
            <div className="p-4 space-y-2.5 text-sm">
              <div className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 items-baseline">
                <span className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono">Azimuth</span>
                <span className="font-mono tabular-nums text-[#1A1614] text-right">
                  {Math.round(selectedFace.azimuth)}&deg;
                </span>
                <span className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono">Pitch</span>
                <span className="font-mono tabular-nums text-[#1A1614] text-right">
                  {selectedFace.pitch != null ? `${selectedFace.pitch.toFixed(1)}°` : '—'}
                </span>
                {selectedFace.areaM2 != null && (
                  <>
                    <span className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono">Face area</span>
                    <span className="font-mono tabular-nums text-[#1A1614] text-right">
                      {selectedFace.areaM2.toFixed(1)} m&sup2;
                    </span>
                  </>
                )}
                <span className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono">Panels here</span>
                <span className="font-serif font-bold text-lg text-[#D9531E] text-right tabular-nums leading-none">
                  {selectedFace.panelCount}
                </span>
                {selectedFace.panelLongM && selectedFace.panelShortM && (
                  <>
                    <span className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono">Panel size</span>
                    <span className="font-mono tabular-nums text-[#1A1614] text-right text-xs">
                      {selectedFace.panelLongM.toFixed(2)} &times; {selectedFace.panelShortM.toFixed(2)} m
                    </span>
                  </>
                )}
              </div>
              {selectedFace.perPanelKwh != null && selectedFace.yieldSource !== 'placeholder' && (
                <div className="mt-3 pt-3 border-t border-[#F0E6D0]">
                  <div className="text-[10px] uppercase tracking-wider text-[#8B8377] font-mono mb-0.5">
                    Yield &mdash; per panel
                  </div>
                  <div className="flex items-baseline gap-1">
                    <div className="font-serif font-bold text-2xl text-[#D9531E] tabular-nums leading-none">
                      {Math.round(selectedFace.perPanelKwh)}
                    </div>
                    <div className="text-sm text-[#8B8377]">kWh/yr</div>
                  </div>
                  {selectedFace.yieldSource && (
                    <div className="text-[9px] text-[#8B8377] font-mono mt-1">
                      {selectedFace.yieldSource === 'pvgis'                    ? 'PVGIS satellite'
                       : selectedFace.yieldSource === 'google_sunshine_median' ? 'Google Solar'
                       : selectedFace.yieldSource}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-4 py-2 border-t border-[#F0E6D0] bg-[#FBF7F0] text-[9px] text-[#8B8377] font-mono uppercase tracking-wider">
              Click another panel to switch &middot; Esc to close
            </div>
            {/* Local keyframes for the card fade-in — scoped by unique name. */}
            <style>{`
              @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
          </div>
        )}

        {/* ── Installation Animation overlays (Phase 1) ─────────────────
            When installStep >= 0: caption strip lower-centre, progress bar
            at very bottom, Skip button top-right. Everything else on the
            3D dims to 15% via installStep-conditional classes below so
            the customer's eye locks onto the sequence. */}
        {installStep >= 0 && (
          <>
            {/* Keyframes scoped to the install overlay — only mounted
                while animation is playing. Names prefixed so they don't
                collide with fadeIn (used by V6 card). Iteration 3: full-
                screen additive flash (mix-blend-mode: screen) is far more
                visible against the busy 3D scene than a subtle overlay
                — screen mode BRIGHTENS pixels underneath rather than
                tinting them, so the pulse reads as "light energy". */}
            <style>{`
              @keyframes installPowerFlash {
                0%,100% { opacity: 0.0; }
                20%     { opacity: 0.75; }
                50%     { opacity: 0.35; }
                80%     { opacity: 0.75; }
              }
              @keyframes installPowerRing {
                0%   { transform: translate(-50%, -50%) scale(0.15); opacity: 0.9; }
                100% { transform: translate(-50%, -50%) scale(1.6);  opacity: 0.0; }
              }
              @keyframes installRailsPulse {
                0%,100% { transform: scale(1);    opacity: 0.9; }
                50%     { transform: scale(1.08); opacity: 1;    box-shadow: 0 0 32px rgba(244,168,59,0.6); }
              }
            `}</style>
            {/* Energy-flow overlay — visible at steps 6 & 7. Two layers:
                (1) full-scene additive golden flash pulsing (mix-blend-
                mode: screen makes it BRIGHTEN the tiles like a light
                source rather than tinting them);
                (2) 3 concentric expanding rings, staggered, giving a
                "radar sweep / energy radiating" feel. All pointer-
                events-none so Skip button still clickable. */}
            {installStep >= 6 && (
              <div
                className="absolute inset-0 z-30 pointer-events-none overflow-hidden"
                aria-hidden="true"
              >
                {/* Layer 1: full-scene brightness pulse (additive) */}
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'radial-gradient(circle at center, rgba(255,190,80,0.9) 0%, rgba(244,168,59,0.5) 30%, rgba(217,83,30,0.15) 60%, rgba(217,83,30,0) 85%)',
                    mixBlendMode: 'screen',
                    animation: 'installPowerFlash 1.6s ease-in-out infinite',
                  }}
                />
                {/* Layer 2: three expanding rings, staggered */}
                {[0, 0.5, 1.0].map((delay, i) => (
                  <div
                    key={i}
                    className="absolute top-1/2 left-1/2 rounded-full pointer-events-none"
                    style={{
                      width:  'min(70vh, 70vw)',
                      height: 'min(70vh, 70vw)',
                      border: '3px solid rgba(255,180,60,0.85)',
                      boxShadow: '0 0 40px rgba(244,168,59,0.55), inset 0 0 40px rgba(244,168,59,0.4)',
                      mixBlendMode: 'screen',
                      animation: `installPowerRing 1.5s ease-out ${delay}s infinite`,
                    }}
                  />
                ))}
              </div>
            )}

            {/* Skip button — top-right, above yield legend (which is dimmed) */}
            <button
              type="button"
              onClick={() => stopInstallation(false)}
              className="absolute top-3 right-3 z-40 px-3 py-1.5 rounded-full bg-black/80 hover:bg-black text-white text-xs font-semibold backdrop-blur-sm transition"
            >
              Skip &times;
            </button>

            {/* Caption strip — BOTTOM of the 3D, above the progress bar,
                so the scene stays fully visible during the animation
                (was centre-of-viewport before which planted a big text
                block right over the roof and blocked what customers came
                here to see). Uses a compact horizontal layout: small
                chip + caption on ONE line where possible. */}
            <div className="absolute inset-x-0 bottom-4 z-40 flex justify-center pointer-events-none px-6">
              <div className="max-w-3xl bg-black/70 backdrop-blur-md rounded-2xl px-5 py-3 shadow-lg flex items-center gap-3 flex-wrap justify-center">
                <div className="text-[9px] uppercase tracking-widest text-white/70 font-mono font-semibold whitespace-nowrap">
                  Watch how your system installs
                </div>
                <div className="text-white/40 hidden md:inline">|</div>
                <div className="text-sm md:text-base font-serif font-semibold text-white leading-snug text-center">
                  {INSTALL_STEPS[installStep]?.caption}
                </div>
              </div>
            </div>

            {/* Progress bar — very bottom edge of scene */}
            <div className="absolute inset-x-0 bottom-0 z-40 h-1.5 bg-black/40 pointer-events-none">
              <div
                className="h-full bg-gradient-to-r from-[#F4A83B] to-[#D9531E] transition-all"
                style={{ width: `${installProgress.toFixed(1)}%`, transition: 'width 100ms linear' }}
              />
            </div>
          </>
        )}

        {/* Hover tooltip — follows the cursor, shows the picked panel's
            yield + source. Offsets +12px so it doesn't sit under the cursor
            arrow. Clamped to container so it never bleeds off-screen. */}
        {hoverInfo && (
          <div
            className="absolute z-30 bg-black/85 text-white text-[11px] font-mono px-2 py-1 rounded shadow pointer-events-none whitespace-nowrap"
            style={{
              left: Math.min(hoverInfo.x + 12, (containerRef.current?.clientWidth  || 9999) - 150),
              top:  Math.min(hoverInfo.y + 12, (containerRef.current?.clientHeight || 9999) - 40),
            }}
          >
            <div className="font-semibold">{Math.round(hoverInfo.yieldKwh)} kWh / yr</div>
            {hoverInfo.source && (
              <div className="text-[9px] opacity-70">
                {hoverInfo.source === 'pvgis'                   ? 'PVGIS · satellite'
                 : hoverInfo.source === 'google_sunshine_median' ? 'Google Solar'
                 : hoverInfo.source}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Feature B1 sun/shadow timeline strip (Layout A: BELOW the 3D area) ─
          Sits as a sibling of the 3D scene so it never obscures the panels
          or the roof imagery. Cream card styling matches the sidebar cards
          (SolarQualityScoreCard, WhyThisManyPanelsPanel) so the whole 3D
          hero block reads as one composed unit.

          Only shown when panels are rendered — no timeline on AddressStage.
          Preset chips trimmed 5→3 per UX review; sliders cover sunrise/sunset. */}
      {status === 'ready' && showPanels && (
        <div className="border-t border-[#E3D9C4] bg-[#F4EEE1] px-4 py-3">
          <div className="flex items-center justify-between gap-3 mb-2.5 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">
                Sun &middot; Shadow timeline
              </div>
              <div className="text-sm font-mono text-[#1A1614] mt-0.5">
                {formatSunTime(sunMonth, sunHour)}
                {sunPosition && (
                  <span className="text-[#8B8377] ml-2 text-xs">
                    · Sun {sunPosition.altitude > 0
                      ? `${Math.round(sunPosition.altitude)}° ${cardinalFromAzimuth(sunPosition.azimuth)}`
                      : 'below horizon'}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handlePlayClick}
              className="text-xs px-3 py-1.5 rounded bg-[#D9531E] hover:bg-[#B84418] text-white font-semibold transition"
            >
              {isPlaying ? '⏸ Pause' : '▶ Play a day'}
            </button>
          </div>

          {/* Preset chips — quick jumps for the most-asked-about moments. */}
          <div className="flex flex-wrap gap-1.5 mb-2.5">
            {[
              { label: 'Winter afternoon', apply: () => { setSunMonth(6);  setSunHour(15); } },
              { label: 'Midday',           apply: () => setSunHour(12) },
              { label: 'Summer noon',      apply: () => { setSunMonth(12); setSunHour(12); } },
            ].map(p => (
              <button
                key={p.label}
                type="button"
                onClick={p.apply}
                className="text-[11px] px-2.5 py-1 rounded bg-white border border-[#E3D9C4] hover:bg-[#F9F5EA] text-[#55504A] font-mono transition"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Month + hour sliders. accent-amber-500 tints the thumb + track
              fill so they read on the cream background. */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="text-[10px] text-[#8B8377] w-11 uppercase tracking-wide">Month</div>
              <input
                type="range"
                min="1" max="12" step="1"
                value={sunMonth}
                onChange={(e) => setSunMonth(Number(e.target.value))}
                className="flex-1 accent-amber-500 cursor-pointer"
              />
              <div className="text-[10px] font-mono text-[#1A1614] w-10 text-right">
                {MONTH_NAMES[sunMonth - 1]}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-[10px] text-[#8B8377] w-11 uppercase tracking-wide">Hour</div>
              <input
                type="range"
                min="5" max="20" step="0.25"
                value={sunHour}
                onChange={(e) => setSunHour(Number(e.target.value))}
                className="flex-1 accent-amber-500 cursor-pointer"
              />
              <div className="text-[10px] font-mono text-[#1A1614] w-10 text-right">
                {String(Math.floor(sunHour)).padStart(2, '0')}:{String(Math.round((sunHour - Math.floor(sunHour)) * 60)).padStart(2, '0')}
              </div>
            </div>
          </div>

          {/* Shade footer — live per-panel raycast summary. Complements
              the compass by giving customers a concrete "X of Y panels
              shaded right now" number as they scrub through the day. */}
          <div className="mt-2 flex items-baseline justify-between gap-3 text-[11px]">
            <div className="text-[#8B8377] leading-snug">
              Compass (top-left) shows sun position. Roof imagery has baked
              shadows from Google's original aerial capture.
            </div>
            {panelEntitiesRef.current?.length > 0 && (
              <div className="font-mono text-[#1A1614] whitespace-nowrap">
                <span className={shadedCount > 0 ? 'text-[#D9531E]' : 'text-emerald-700'}>
                  {shadedCount}
                </span>
                <span className="text-[#8B8377]"> of {panelEntitiesRef.current.length} panels shaded</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Installation Animation trigger strip (Phase 1) ────────────
          New section below the sun timeline strip. Big orange primary
          button; explains what the 30 s animation shows. Only visible
          when we're rendering panels (matches the timeline strip guard)
          and NOT already playing. Idempotent — clicking while playing
          is no-op via startInstallation guard, but we also hide the
          button to avoid confusion. */}
      {status === 'ready' && showPanels && installStep < 0 && (
        <div className="border-t border-[#E3D9C4] bg-gradient-to-r from-[#FBF7F0] to-[#F4EEE1] px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-[#D9531E] font-bold">
              How it installs
            </div>
            <div className="text-sm text-[#1A1614] mt-0.5">
              30-second walk-through &mdash; rails, panels, inverter, battery, EV charger, powered on.
            </div>
          </div>
          <button
            type="button"
            onClick={startInstallation}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#D9531E] hover:bg-[#B84418] text-white font-semibold text-sm shadow-lg shadow-orange-500/25 transition"
          >
            <span aria-hidden="true">&#9654;</span> Watch installation (30&nbsp;s)
          </button>
        </div>
      )}
    </div>
  );
}

// ── Dev-only debug hook ──────────────────────────────────────────────────
// Puppeteer end-to-end tests read window.__cesium3DState via page.evaluate()
// to verify the scene without relying on flaky WebGL screenshots. Reads
// Cesium's ground-truth camera + entity state directly.
//
// Production builds (import.meta.env.DEV === false) never call this.
function publishDebugState(Cesium, viewer, entities, allocations, coords) {
  try {
    const carto = viewer.camera.positionCartographic;
    const entityPositions = (entities || []).map(e => {
      const cart = e.position?.getValue?.(Cesium.JulianDate.now());
      if (!cart) return null;
      const c = Cesium.Cartographic.fromCartesian(cart);
      return {
        latitude:  Cesium.Math.toDegrees(c.latitude),
        longitude: Cesium.Math.toDegrees(c.longitude),
        altitude:  c.height,
      };
    }).filter(Boolean);

    // How many distinct spatial clusters do the entities form? Naive check:
    // sort by lat, count "gaps" > 3m. Catches the "all panels clumped" bug.
    const latClusterCount = countClusters(entityPositions.map(p => p.latitude), 3 / 111_320);
    const lngClusterCount = countClusters(entityPositions.map(p => p.longitude), 3 / (111_320 * Math.cos((carto.latitude || 0))));

    window.__cesium3DState = {
      timestamp:   new Date().toISOString(),
      requestedCoords: coords,
      camera: {
        latitude:  Cesium.Math.toDegrees(carto.latitude),
        longitude: Cesium.Math.toDegrees(carto.longitude),
        height:    carto.height,
        headingDeg: Cesium.Math.toDegrees(viewer.camera.heading),
        pitchDeg:   Cesium.Math.toDegrees(viewer.camera.pitch),
      },
      entityCount: entityPositions.length,
      entityPositions,   // full list for detailed asserts
      clusters: {
        lat: latClusterCount,
        lng: lngClusterCount,
      },
      allocations: (allocations || []).map(a => ({
        orientation: a.segment?._viability?.orientation,
        count:       a.count,
        areaM2:      a.segment?.stats?.areaMeters2,
      })),
      sceneSize: {
        width:  viewer.canvas.width,
        height: viewer.canvas.height,
      },
    };
  } catch (e) {
    window.__cesium3DState = { error: e.message };
  }
}

function countClusters(sortedish, gapThreshold) {
  if (!sortedish.length) return 0;
  const sorted = [...sortedish].sort((a, b) => a - b);
  let clusters = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > gapThreshold) clusters++;
  }
  return clusters;
}

// ── waitForTilesLoaded ────────────────────────────────────────────────────
// Poll tileset.tilesLoaded until true, or until we exceed timeoutMs. Cesium's
// tilesLoaded flips true when EVERY currently-requested tile has finished
// loading — this is the ground truth for "is the mesh actually here" and is
// far more reliable than an arbitrary setTimeout wait.
//
// The previous 1.5 s blind wait fired well before tiles arrived, which meant
// sampleHeightMostDetailed had nothing to sample and either hung or returned
// no-hits — panels then rendered against Google Solar's stale (2016) fitted
// plane altitude, mismatching the current tile mesh and producing the
// patchy-panels bug.
async function waitForTilesLoaded(tileset, viewer, timeoutMs, isCancelled) {
  const started = Date.now();
  return new Promise(resolve => {
    const tick = () => {
      if (isCancelled?.()) return resolve();
      if (viewer.isDestroyed()) return resolve();
      if (tileset?.tilesLoaded) return resolve();
      if (Date.now() - started > timeoutMs) {
        console.warn(`[Cesium3DView] tilesLoaded did not settle in ${timeoutMs}ms — sampling with what's loaded so far`);
        return resolve();
      }
      // 200 ms poll — fast enough to catch tilesLoaded promptly, slow enough
      // that we're not busy-waiting.
      setTimeout(tick, 200);
    };
    tick();
  });
}

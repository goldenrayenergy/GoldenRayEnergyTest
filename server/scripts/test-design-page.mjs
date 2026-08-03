// ────────────────────────────────────────────────────────────────────────────
// test-design-page.mjs
//
// Contract tests for the client-side design tool surface. Client modules
// depend on Vite's `import.meta.env` which doesn't work in Node, so we
// verify the file structure + expected exports via source inspection
// rather than dynamic import. Matches the pattern used elsewhere for
// client-only modules that can't be loaded in the regression runner.
//
// Covers:
//   • pmDesignsApi.js exports pmDesignsAPI with .get() and .save()
//   • pmDesignsApi.js exports emptyDesignState() with the Phase 3a shape
//   • URL paths match the backend routes registered in server/routes/pm/index.js
//   • Save flow includes optimistic-concurrency version handling
//   • DesignPage.jsx is wired to the /pm/quotes/:id/design route
//   • DesignPage.jsx imports Fabric, uses signed roof URL, has pan/zoom, autosave
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../');

let pass = 0;
let fail = 0;
const failures = [];
function assert(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}

console.log('test-design-page\n');

const svc = fs.readFileSync(path.join(REPO_ROOT, 'client/src/pm/services/pmDesignsApi.js'), 'utf8');
const page = fs.readFileSync(path.join(REPO_ROOT, 'client/src/pm/pages/DesignPage.jsx'), 'utf8');
const pmApp = fs.readFileSync(path.join(REPO_ROOT, 'client/src/pm/PmApp.jsx'), 'utf8');
const routesIndex = fs.readFileSync(path.join(REPO_ROOT, 'server/routes/pm/index.js'), 'utf8');
const routesFile = fs.readFileSync(path.join(REPO_ROOT, 'server/routes/pm/designs.js'), 'utf8');

// ── pmDesignsApi.js — service contract ────────────────────────────────────
{
  console.log('\n▸ pmDesignsApi.js exports');
  assert('exports pmDesignsAPI',       /export const pmDesignsAPI/.test(svc));
  // Phase 3b moved emptyDesignState into utils/designState.js — pmDesignsApi
  // now re-exports it for backwards compatibility with existing callers.
  assert('re-exports emptyDesignState from utils/designState',
    /export\s*\{[^}]*emptyDesignState[^}]*\}\s+from\s+['"]\.\.\/utils\/designState['"]/.test(svc));
  assert('imports the shared api',     /import api from ['"]\.\.\/\.\.\/services\/api['"]/.test(svc));

  assert('pmDesignsAPI has get()',     /get:\s*\(\s*quoteId\s*\)/.test(svc));
  assert('pmDesignsAPI has save()',    /save:\s*\(/.test(svc));

  assert('get URL is /pm/quotes/:id/design',
    /api\.get\(`\/pm\/quotes\/\$\{quoteId\}\/design`/.test(svc));
  assert('save uses PUT',              /api\.put\(`\/pm\/quotes\/\$\{quoteId\}\/design`/.test(svc));
  assert('save sends state + version', /\{\s*state,\s*version\s*\}/.test(svc));

  assert('get() accepts 200/204/404 via validateStatus',
    /validateStatus:\s*s\s*=>\s*s\s*===\s*200[\s\S]*204[\s\S]*404/.test(svc));
}

// ── emptyDesignState + migration shape (Phase 3b — designState.js) ──────
{
  console.log('\n▸ designState.js — Phase 3b schema');
  const dsPath = path.join(REPO_ROOT, 'client/src/pm/utils/designState.js');
  const ds = fs.readFileSync(dsPath, 'utf8');

  assert('SCHEMA_VERSION = 2',                       /SCHEMA_VERSION = 2/.test(ds));
  assert('exports emptyDesignState',                 /export function emptyDesignState/.test(ds));
  assert('exports migrateDesignState',               /export function migrateDesignState/.test(ds));
  assert('emptyState includes view identity',        /view:\s*\{\s*zoom:\s*1\.0/.test(ds));
  assert('emptyState includes roof.faces=[]',        /roof:\s*\{\s*faces:\s*\[\]/.test(ds));
  assert('emptyState includes panels=[]',            /panels:\s*\[\]/.test(ds));
  assert('emptyState includes arrays=[]',            /arrays:\s*\[\]/.test(ds));

  assert('has makeRoofFace helper',                  /export function makeRoofFace/.test(ds));
  assert('has makePanel helper',                     /export function makePanel/.test(ds));
  assert('has makeObstruction helper',               /export function makeObstruction/.test(ds));
  assert('has makeArray helper',                     /export function makeArray/.test(ds));

  assert('removeFace cascades to panels',
    /export function removeFace[\s\S]{0,600}state\.panels\.filter/.test(ds),
    'removing a face must remove its panels (referential integrity)');
  assert('removePanel prunes empty arrays',
    /export function removePanel[\s\S]{0,600}filter\s*\(\s*a\s*=>\s*a\.panelIds\.length\s*>\s*0\s*\)/.test(ds));

  // DesignPage should call migrateDesignState when loading existing designs
  assert('DesignPage runs migrateDesignState on load',
    /migrateDesignState\(dResp\.data\.state\)/.test(page),
    'saved states from Phase 3a (schemaVersion < 2) must be migrated on load');
}

// ── Backend route registration matches client URL ─────────────────────────
{
  console.log('\n▸ Backend URL contract');
  assert('/quotes/:id/design GET registered',
    /router\.get\(['"]\/:id\/design['"]/.test(routesFile));
  assert('/quotes/:id/design PUT registered',
    /router\.put\(['"]\/:id\/design['"]/.test(routesFile));
  assert('designs router mounted on /quotes in index.js',
    /designsRoutes/.test(routesIndex) && /router\.use\(['"]\/quotes['"]\s*,\s*designsRoutes\)/.test(routesIndex));
}

// ── DesignPage.jsx wiring ─────────────────────────────────────────────────
{
  console.log('\n▸ DesignPage.jsx');
  assert('imports fabric',              /import\s+\*\s+as\s+fabric\s+from\s+['"]fabric['"]/.test(page));
  assert('imports pmDesignsAPI',        /import\s+\{[^}]*pmDesignsAPI[^}]*\}\s+from\s+['"]\.\.\/services\/pmDesignsApi['"]/.test(page));
  assert('imports emptyDesignState',    /import\s+\{[^}]*emptyDesignState[^}]*\}\s+from\s+['"]\.\.\/services\/pmDesignsApi['"]/.test(page));
  assert('imports pmContactsAPI',       /import\s+\{[^}]*pmContactsAPI[^}]*\}\s+from\s+['"]\.\.\/services\/pmQuotesApi['"]/.test(page));

  assert('creates fabric.Canvas',       /new\s+fabric\.Canvas\(/.test(page));
  assert('loads image via fabric.Image.fromURL', /fabric\.Image\.fromURL\(/.test(page));
  assert('uses roof_image_signed_url',  /roof_image_signed_url/.test(page));

  assert('registers mouse:wheel for zoom',  /canvas\.on\(['"]mouse:wheel['"]/.test(page));
  assert('registers mouse:down for pan',    /canvas\.on\(['"]mouse:down['"]/.test(page));
  assert('registers mouse:move for pan',    /canvas\.on\(['"]mouse:move['"]/.test(page));
  assert('registers mouse:up for pan',      /canvas\.on\(['"]mouse:up['"]/.test(page));

  assert('has AUTOSAVE_DEBOUNCE_MS',    /AUTOSAVE_DEBOUNCE_MS/.test(page));
  assert('has clampZoom helper',        /function clampZoom/.test(page));
  assert('handles 409 stale save',      /409/.test(page) && /server_version/.test(page));
  assert('shows "No roof image" fallback', /No roof image/i.test(page));

  assert('disposes canvas on unmount',  /canvas\.dispose\(\)/.test(page));

  // ── Regression: viewport restore bug ────────────────────────────────
  // Bug: previously restored saved pan/zoom on load, which caused
  // accumulated pan from prior sessions to push image + overlays off-centre.
  // Fix: don't restore view state in Phase 3a (comment explaining lives in the
  // file). Also don't set dirty from pan/zoom.
  assert('regression: does NOT restore saved viewport',
    !/canvas\.setZoom\(z\)[\s\S]{0,100}vpt\[4\]\s*=\s*view\.panX/.test(page),
    'Phase 3a must not restore saved viewport (causes off-centre bug)');
  assert('regression: mouse:up does not setDirty',
    !/mouse:up[\s\S]{0,300}setDirty\(true\)/.test(page),
    'pan should not dirty design in Phase 3a');
  assert('regression: mouse:wheel does not setDirty',
    !/mouse:wheel[\s\S]{0,400}setDirty\(true\)/.test(page),
    'zoom should not dirty design in Phase 3a');

  // ── Layout robustness ──────────────────────────────────────────────
  assert('uses ResizeObserver for container size changes',
    /new ResizeObserver/.test(page),
    'must react to container resize, not only window resize');
  assert('uses getBoundingClientRect for accurate measurement',
    /getBoundingClientRect/.test(page));
  assert('overlay helpers return created objects for later cleanup',
    /return created/.test(page),
    'overlayRoofFaces / overlayTraceInProgress both return the array so layoutAndDraw can remove them on next redraw');
  assert('layoutAndDraw clears old overlays before redrawing',
    /overlayObjectsRef[\s\S]{0,200}c\.remove/.test(page));

  // ── Regression: Fabric v6+ origin default change ───────────────────
  // Bug: Fabric v6+ changed default originX/originY from 'left'/'top' to
  // 'center'/'center'. Our positioning math assumed top-left origin. This
  // put the image's CENTRE (not top-left) at (left, top), pushing most of
  // the image off-canvas — Fabric then auto-adjusted the viewport to
  // compensate, which put every overlay in the wrong place. Fix: define
  // a TL_ORIGIN constant and spread it into every shape that uses
  // top-left positioning (image, polygon, lines, pin text, placeholder
  // shapes). Shapes intentionally centred on a point (segment labels,
  // property ring) explicitly keep originX/Y = 'center'.
  assert('regression: TL_ORIGIN constant defined',
    /const TL_ORIGIN = \{\s*originX:\s*['"]left['"],\s*originY:\s*['"]top['"]/.test(page),
    'must define TL_ORIGIN to counteract Fabric v6+ centre-origin default');
  assert('regression: image uses top-left origin',
    /fabric\.Image\.fromURL[\s\S]{0,400}\.\.\.TL_ORIGIN/.test(page),
    'image .set() must spread TL_ORIGIN so left/top are treated as top-left corner');
  // Regression removed: crosshair lines + "◉ Customer property" pin were Phase 3a
  // scaffolding, deleted once roof-face polygons + manual tracing became the
  // primary interaction. The tile is already centred on the customer's property
  // and the top bar shows their name/address — the marker only obscured the roof.
  assert('regression: debug markers stripped from production',
    !/DEBUG-MARKERS/.test(page),
    'debug console.log + red/blue/green markers must not ship');

  // ── Regression: Fabric v7 pointer API ────────────────────────────────
  // Bug: canvas.getPointer(e) was removed in Fabric v7. The old call throws
  // silently inside Fabric's event dispatch, so mouse:down entered the tracing
  // branch, hit the throw, no vertex was ever added, and no error surfaced.
  // Fix: use canvas.getScenePoint(e) — the v7 replacement that returns the
  // pointer in world coords (post viewport-transform), which is what our
  // image-space math expects.
  assert('regression: uses Fabric v7 getScenePoint, not getPointer',
    /canvas\.getScenePoint\(opt\.e\)/.test(page)
      && !/canvas\.getPointer\(opt\.e\)/.test(page),
    'Fabric v7 removed canvas.getPointer — must use getScenePoint');

  // ── Regression: canvas isolated in its own wrapper div ───────────────
  // Bug: Fabric wraps <canvas> in a .canvas-container div at init, which
  // mutates the parent's children behind React's back. React later crashed
  // with NotFoundError on insertBefore when a conditional sibling (the
  // trace-mode instruction bar) tried to mount, because its reference node
  // (the original <canvas>) was no longer a direct child.
  // Fix: put <canvas> inside its own dedicated wrapper div so Fabric's
  // mutations don't touch the outer container's React-managed children.
  assert('regression: canvas is isolated in its own wrapper div',
    /<div className="absolute inset-0">\s*<canvas ref=\{canvasElRef\} \/>\s*<\/div>/.test(page),
    'Fabric mutates DOM behind React — canvas must live in its own wrapper');

  // ── Property marker removed (was Phase 3a scaffolding) ────────────────
  assert('property marker (crosshair + "◉ Customer property" pin) removed',
    !/['"`]◉ Customer property/.test(page)
      && !/function overlayRoofSegments\(/.test(page),
    'Phase 3a marker was superseded by roof-face polygons + manual tracing');
  assert('face-tracing does not import segment helpers (still deferred)',
    !/import\s*\{[^}]*(segmentBboxToPolygon|segmentLabel)[^}]*\}\s*from\s*['"]\.\.\/utils\/roofOverlay/.test(page),
    'segment helpers stay in roofOverlay.js for later panel-placement phases');

  // ── Auto-zoom to customer's roof (fixes "showing whole neighbourhood") ──
  assert('auto-zoom: autoZoomToRoof helper defined',
    /function autoZoomToRoof\(/.test(page),
    'need a helper that zooms Fabric viewport onto the roof segments');
  assert('auto-zoom: unions segment boundingBoxes',
    /boundingBox[\s\S]{0,600}minPx[\s\S]{0,600}maxPx/.test(page),
    'auto-zoom must union all segment bboxes to find the roof extent');
  assert('auto-zoom: applies zoom via setViewportTransform',
    /autoZoomToRoof[\s\S]{0,3000}setViewportTransform\(\[\s*zoom,\s*0,\s*0,\s*zoom/.test(page),
    'must set viewport transform with the computed zoom factor');
  assert('auto-zoom: runs only once (hasAutoZoomedRef guard)',
    /hasAutoZoomedRef/.test(page),
    'must not re-zoom on every resize — that would fight user manual zoom');
  assert('auto-zoom: fill fraction constant defined',
    /AUTO_ZOOM_FILL_FRACTION\s*=\s*0\.[567]/.test(page),
    'the roof should fill ~70% of canvas — enough context to spot obstructions');
  assert('reset view button re-fits to roof (not identity)',
    /zoomFit[\s\S]{0,400}autoZoomToRoof/.test(page),
    'Reset view button should re-run autoZoomToRoof so rep gets useful default');

  // ── Migration 040: per-analysis tile radius + auto-refetch ─────────
  assert('uses radiusForAnalysis (not hardcoded ROOF_TILE_RADIUS_METERS)',
    /radiusForAnalysis\(roofAnalysis\)/.test(page)
    // Only the FALLBACK constant name is allowed (declaration inside a helper);
    // any bare `ROOF_TILE_RADIUS_METERS` (no _FALLBACK suffix) as a coord-math
    // argument would mean we regressed away from per-analysis radius.
    && !/radiusMeters:\s*ROOF_TILE_RADIUS_METERS(?!_FALLBACK)/.test(page),
    'client must read tile_radius_m from the stored row, not use a hardcoded constant');
  assert('fallback radius constant is 50m',
    /FALLBACK_TILE_RADIUS_METERS\s*=\s*50/.test(page),
    'pre-migration rows have tile_radius_m=null; fallback to 50m keeps them rendering');
  assert('auto-refetches when stored radius exceeds threshold',
    /REFETCH_THRESHOLD_METERS[\s\S]{0,600}pmDesignsAPI\.refetchRoofImage/.test(page),
    'if tile_radius_m > threshold (or null), fire refetch on load');
  assert('refetch is non-blocking (fire-and-forget with catch)',
    /pmDesignsAPI\.refetchRoofImage[\s\S]{0,600}\.catch/.test(page),
    'refetch failure must not block the design page');
  assert('image-load effect is separate from canvas init',
    /layoutAndDrawRef/.test(page) && /Image-load effect/i.test(page),
    'canvas init + image load must be split — image-load effect uses layoutAndDrawRef to invoke layout without full re-init');
  assert('resets hasAutoZoomedRef when roofAnalysis changes',
    /roofAnalysisRef\.current[\s\S]{0,100}hasAutoZoomedRef\.current\s*=\s*false/.test(page),
    'refetched (tighter) tile must trigger a fresh auto-zoom fit');
  assert('has refetching state indicator',
    /refetching[\s\S]{0,600}Fetching sharper aerial/.test(page),
    'UI shows a small pill while the tile upgrade is in progress');

  // ── LINZ attribution + source-aware header (Migration 041 follow-up) ──
  assert('imageryLabel helper is source-aware',
    /function imageryLabel[\s\S]{0,500}imagery_source\s*===\s*['"]linz['"]/.test(page),
    'header label branches on imagery_source (LINZ vs Google Solar)');
  assert('shows LINZ attribution in footer when source=linz',
    /imagery_source\s*===\s*['"]linz['"][\s\S]{0,300}Aerial imagery: LINZ/.test(page),
    'LINZ terms require visible attribution');
  assert('header uses imageryLabel not raw imagery_quality',
    /\{imageryLabel\(roofAnalysis\)/.test(page),
    'header should call the helper — using raw imagery_quality misleads for LINZ tiles');

  // ── Phase 3b.2 — Trace-from-Google button + roof-face polygon overlay ──
  assert('imports importGoogleSegments helper',
    /import\s+\{[^}]*importGoogleSegments[^}]*\}\s+from\s+['"]\.\.\/utils\/designState['"]/.test(page),
    'DesignPage must import the segments→faces helper');
  assert('has importFromGoogle handler',
    /const importFromGoogle = useCallback/.test(page),
    'click handler for "Trace from Google" must be present');
  assert('handler dirties the design (autosave)',
    /importFromGoogle[\s\S]{0,400}setDirty\(true\)/.test(page),
    'importing faces is a real content change — must trigger autosave');
  assert('handler triggers redraw via layoutAndDrawRef',
    /importFromGoogle\s*=\s*useCallback[\s\S]{0,1200}layoutAndDrawRef\.current\?\.\(\)/.test(page),
    'polygons only appear if we redraw after mutation');
  assert('shows "Trace from Google" pill when faceCount is 0',
    /faceCount === 0[\s\S]{0,900}Trace from Google/.test(page),
    'pill visible only when no faces imported yet');
  assert('pill hidden after faces imported',
    /faceCount > 0[\s\S]{0,200}roof face/.test(page),
    'once imported, show the count instead of the button');

  assert('overlayRoofFaces helper defined',
    /function overlayRoofFaces\(/.test(page),
    'need a helper that renders face polygons on the canvas');
  assert('overlayRoofFaces colours google vs manual differently',
    /google_solar[\s\S]{0,600}rgba\(245, 166, 35[\s\S]{0,200}rgba\(74, 124, 89/.test(page),
    'visual distinction between imported vs traced faces');
  assert('layoutAndDraw stitches roof-face polygons into overlayObjectsRef',
    /overlayRoofFaces\(\{[\s\S]{0,300}stateRef\.current/.test(page),
    'faces must be drawn every layout so they survive resize/refetch');

  // ── Phase 3b.3 — manual roof-face tracing ────────────────────────────
  assert('imports makePixelToLatLng inverse',
    /import\s+\{[^}]*makePixelToLatLng[^}]*\}\s+from\s+['"]\.\.\/utils\/roofOverlay['"]/.test(page),
    'manual tracing needs canvas-pixel → lat/lng conversion');
  assert('imports makeRoofFace + addFace',
    /import\s+\{[^}]*makeRoofFace[^}]*\}\s+from\s+['"]\.\.\/utils\/designState['"]/.test(page)
    && /import\s+\{[^}]*addFace[^}]*\}\s+from\s+['"]\.\.\/utils\/designState['"]/.test(page),
    'finishTrace calls makeRoofFace + addFace to persist the traced polygon');

  assert('trace mode state (React + ref)',
    /const \[isTracing, setIsTracing\]/.test(page)
    && /isTracingRef = useRef\(false\)/.test(page),
    'React state drives UI, ref lets stable canvas handlers read current mode');
  assert('traceVerticesRef holds in-progress vertices',
    /traceVerticesRef = useRef\(\[\]\)/.test(page));
  assert('finishTraceRef bridges React callback to canvas dblclick handler',
    /finishTraceRef = useRef\(null\)/.test(page)
    && /finishTraceRef\.current = finishTrace/.test(page));

  assert('startTrace / cancelTrace / finishTrace defined',
    /const startTrace = useCallback/.test(page)
    && /const cancelTrace = useCallback/.test(page)
    && /const finishTrace = useCallback/.test(page));
  assert('finishTrace rejects <3 vertices',
    /finishTrace = useCallback[\s\S]{0,600}vertices\.length < 3/.test(page),
    'a polygon needs at least 3 corners');
  assert('finishTrace calls makeRoofFace with source=manual',
    /finishTrace[\s\S]{0,800}makeRoofFace\(\{\s*source:\s*['"]manual['"]/.test(page));
  assert('finishTrace dirties the design (autosave)',
    /finishTrace[\s\S]{0,1000}setDirty\(true\)/.test(page));

  assert('mouse:down adds vertex when tracing (not pan)',
    /mouse:down[\s\S]{0,3000}isTracingRef\.current[\s\S]{0,1500}traceVerticesRef\.current\.push/.test(page),
    'clicks in trace mode add vertices instead of starting a pan');
  assert('mouse:dblclick finishes the trace',
    /mouse:dblclick[\s\S]{0,400}finishTraceRef\.current/.test(page));
  // Escape-key handler order-agnostic: both the addEventListener('keydown')
  // AND an Escape → cancelTrace mapping must exist within a small window.
  assert('Esc cancels an in-progress trace',
    /Escape[\s\S]{0,100}cancelTrace\(\)/.test(page)
    && /window\.addEventListener\(['"]keydown['"]/.test(page),
    'Esc must interrupt tracing');

  assert('overlayTraceInProgress helper defined',
    /function overlayTraceInProgress\(/.test(page),
    'renders in-progress vertices + connecting lines');
  assert('overlayTraceInProgress shows dashed closing line when >=3 vertices',
    /points\.length >= 3[\s\S]{0,800}strokeDashArray/.test(page),
    'visualises the polygon that Finish will save');

  assert('Trace face button rendered when image present + not tracing',
    /roofAnalysis\?\.roof_image_signed_url[\s\S]{0,300}!isTracing[\s\S]{0,600}Trace face/.test(page));
  assert('Trace mode instruction bar rendered when isTracing=true',
    /isTracing\s*&&[\s\S]{0,600}Tracing roof face[\s\S]{0,1200}Finish[\s\S]{0,400}Cancel/.test(page));
  assert('Finish button disabled with <3 vertices',
    /disabled=\{traceVertexCount\s*<\s*3\}/.test(page));
}

// ── Phase 3b.4 — panel palette + drop + overlay + footer ─────────────────
{
  console.log('\n▸ Phase 3b.4 — panel palette + drop');
  assert('imports useCatalogueOptions hook (default export)',
    /import\s+useCatalogueOptions\s+from\s+['"]\.\.\/hooks\/useCatalogueOptions['"]/.test(page),
    'the hook is a default export — named-import destructure would evaluate to undefined');
  assert('imports makePanel + addPanel + faceContainingPoint + totalKilowatts',
    /import\s*\{[\s\S]{0,600}makePanel[\s\S]{0,200}addPanel[\s\S]{0,200}faceContainingPoint[\s\S]{0,200}totalKilowatts[\s\S]{0,800}\}\s*from\s*['"]\.\.\/utils\/designState['"]/.test(page));
  assert('armedPanelSku state + ref (mouse handler reads ref)',
    /\[armedPanelSku,\s*setArmedPanelSku\]\s*=\s*useState\(null\)/.test(page)
      && /armedPanelSkuRef\s*=\s*useRef\(null\)/.test(page)
      && /armedPanelSkuRef\.current\s*=\s*armedPanelSku/.test(page));
  assert('panelCount + totalKw reactive state',
    /\[panelCount,\s*setPanelCount\]/.test(page)
      && /\[totalKw,\s*setTotalKw\]/.test(page));
  assert('panelCatalogueBySku Map built via useMemo',
    /panelCatalogueBySku\s*=\s*useMemo/.test(page)
      && /for \(const p of catalogue\?\.panels[\s\S]{0,100}m\.set\(p\.sku/.test(page));

  assert('mouse:down: drop panel when armed + face contains click',
    /armedPanelSkuRef\.current[\s\S]{0,900}faceContainingPoint[\s\S]{0,2600}makePanel\(/.test(page),
    'drop uses faceContainingPoint to attach panel to the clicked face');
  assert('drop uses face.azimuthDegrees for panel rotation',
    /rotationDegrees:\s*typeof face\.azimuthDegrees\s*===\s*['"]number['"]/.test(page),
    'panels default to the face azimuth so they look roof-aligned out of the box');
  assert('drop dirties the design (autosave)',
    /addPanel\(stateRef\.current[\s\S]{0,400}setDirty\(true\)/.test(page));

  assert('overlayPanels helper defined',
    /function overlayPanels\(/.test(page));
  assert('overlayPanels sizes rectangle by catalogue length_mm × width_mm',
    /overlayPanels[\s\S]{0,2500}length_mm[\s\S]{0,500}width_mm/.test(page));
  assert('overlayPanels renders a Fabric.Group (body Rect + centre busbar Line + optional label) with rotation',
    /overlayPanels[\s\S]{0,6000}new fabric\.Group\(children,[\s\S]{0,800}angle:\s*Number\(panel\.rotationDegrees\)/.test(page)
      && /children\s*=\s*\[body,\s*busbar\]/.test(page),
    'realistic panel = darker fill Rect + silver frame + centre busbar line + auto-number label (if in array), grouped so rotation applies to all');
  assert('panels are drag-only: selectable=true, hasControls=false, all locks set',
    /overlayPanels[\s\S]{0,4000}selectable:\s*true[\s\S]{0,200}hasControls:\s*false[\s\S]{0,200}lockScalingX:\s*true[\s\S]{0,200}lockRotation:\s*true/.test(page),
    'panels must be draggable but not scalable or free-rotatable');
  assert('overlayPanels body uses dark navy fill + silver frame',
    /body\s*=\s*new fabric\.Rect\([\s\S]{0,600}fill:[\s\S]{0,200}rgba\(15,\s*29,\s*58/.test(page)
      && /body\s*=\s*new fabric\.Rect\([\s\S]{0,600}stroke:[\s\S]{0,200}#C4C9D4/.test(page));
  assert('layoutAndDraw stitches face grid + panels + trace into overlayObjectsRef',
    /\[\s*\.\.\.facePolys,\s*\.\.\.gridObjs,\s*\.\.\.panelObjs,\s*\.\.\.traceObjects\s*\]/.test(page));

  // ── Regression: layoutAndDraw releases Fabric's active object before rebuild ──
  // Bug (fixed): calling c.remove() on Fabric's currently-active object (e.g.
  // a panel the rep just finished dragging) left it as a phantom on the
  // canvas — Fabric still tracked it via _activeObject/_currentTransform, so
  // the "removed" group rendered alongside the fresh replacement, producing
  // visible duplicates in different shades of blue after every drag.
  assert('regression: layoutAndDraw discards the active object before rebuilding overlays',
    /const layoutAndDraw[\s\S]{0,3000}discardActiveObject\(\)[\s\S]{0,1500}for\s*\(const obj of overlayObjectsRef\.current\)\s*c\.remove\(obj\)/.test(page),
    'without discardActiveObject, dragged panels stack as phantoms on the canvas');

  // ── Phase 3b.9 — ghost panel preview replaces static grid overlay ───
  assert('ghost-panel preview: maybeUpdateGhostPanel + hideGhostPanel helpers',
    /const hideGhostPanel\s*=\s*\(\)\s*=>/.test(page)
      && /const maybeUpdateGhostPanel\s*=\s*\(opt\)\s*=>/.test(page));
  assert('ghost preview reuses the drop-rule engine to colour valid vs invalid drops',
    /maybeUpdateGhostPanel[\s\S]{0,3000}checkPanelDropRules\([\s\S]{0,600}valid\s*=\s*ruleCheck\.ok/.test(page),
    'ghost turns red when the snap position would be rejected by rules; green when it would drop cleanly');
  assert('mouse:move updates the ghost when armed + not tracing + not panning',
    /mouse:move[\s\S]{0,600}armedPanelSkuRef\.current[\s\S]{0,300}maybeUpdateGhostPanel/.test(page));
  assert('mouse:out hides the ghost when the pointer leaves the canvas',
    /canvas\.on\(['"]mouse:out['"][\s\S]{0,300}hideGhostPanel\(\)/.test(page));
  assert('un-arming the palette dismisses the ghost',
    /!armedPanelSku[\s\S]{0,100}hideGhostPanelRef\.current\?\.\(\)/.test(page));
  assert('successful drop dismisses the ghost so it doesn\'t overlap the new panel',
    /addPanel\(stateRef\.current[\s\S]{0,600}hideGhostPanelRef\.current\?\.\(\)/.test(page));

  assert('PanelPalette component defined',
    /function PanelPalette\(/.test(page));
  assert('PanelPalette groups panels by brand',
    /PanelPalette[\s\S]{0,1200}byBrand\s*=\s*new Map\(\)/.test(page));
  assert('PanelPalette shows loading + error states',
    /Loading catalogue/.test(page) && /Couldn't load panel catalogue/.test(page));
  assert('armed card gets a visual highlight',
    /armed\s*\?[\s\S]{0,300}bg-blue-50/.test(page));

  assert('armed-panel indicator overlay rendered on canvas region',
    /armedPanelSku\s*&&[\s\S]{0,900}Click a roof face to drop/.test(page));
  assert('Esc un-arms the panel',
    /armedPanelSku[\s\S]{0,600}Escape[\s\S]{0,100}setArmedPanelSku\(null\)/.test(page));

  assert('sidebar palette shows Panels + System + Est. output stats',
    /PanelPalette[\s\S]{0,4000}\{panelCount\s*\?\?\s*0\}[\s\S]{0,1000}\(totalKw\s*\?\?\s*0\)\.toFixed[\s\S]{0,1000}totalKwh/.test(page),
    'live design totals live in the sidebar (next to palette) not the footer');
  assert('footer no longer duplicates the Panels/System/Est stats (moved to sidebar)',
    !/<span>Panels:\s*<b/.test(page),
    'footer should be purely technical status');

  // ── Phase 3b.6 — grid snap wired into the drop handler ───────────────
  assert('imports snapToFaceGrid + polygonCentroidLL + PANEL_GRID_GAP_MM',
    /import\s*\{[\s\S]{0,800}snapToFaceGrid[\s\S]{0,100}polygonCentroidLL[\s\S]{0,100}PANEL_GRID_GAP_MM[\s\S]{0,600}\}\s*from\s*['"]\.\.\/utils\/designState['"]/.test(page));
  assert('drop handler snaps click to face-aligned grid before makePanel',
    /snapToFaceGrid\(\{[\s\S]{0,800}faceAzimuthDegrees:\s*face\.azimuthDegrees[\s\S]{0,3000}makePanel\(/.test(page),
    'raw click must be snapped so identical panels on a face tile edge-to-edge');
  assert('snap uses catalogue panel dims (length_mm, width_mm) with default fallback',
    /snapToFaceGrid\([\s\S]{0,900}panelLengthMm:\s*Number\(spec\?\.length_mm\)\s*\|\|\s*DEFAULT_PANEL_LENGTH_MM/.test(page));
  assert('snap uses PANEL_GRID_GAP_MM (not a hard-coded number)',
    /snapToFaceGrid\([\s\S]{0,1000}gapMm:\s*PANEL_GRID_GAP_MM/.test(page));
  assert('panel.center passed to makePanel is the snapped centre',
    /snappedCenter\s*=\s*snapToFaceGrid\([\s\S]{0,3000}center:\s*snappedCenter/.test(page));
  assert('finishTrace infers face azimuth from polygon (manual faces get real azimuth)',
    /finishTrace[\s\S]{0,800}inferAzimuthFromPolygon\(vertices\)[\s\S]{0,300}makeRoofFace\(\{\s*source:\s*['"]manual['"][\s\S]{0,200}azimuthDegrees/.test(page),
    'without inferred azimuth, grid stays north-aligned on rotated roofs');
  // Phase 3b.9 — dedup silent-skip removed. Same-cell repeats are now
  // caught by checkPanelDropRules (overlap-panel reason) which flashes a
  // human-readable toast, so the rep sees WHY nothing dropped. Assert the
  // silent skip is gone.
  assert('regression: no silent dedup skip in drop handler (rule engine covers it with a toast)',
    !/const isDupe\s*=\s*stateRef\.current\.panels\.some/.test(page),
    'silent dedup made drops vanish with no feedback; must be gone in favour of rule-engine reject-toast');

  // ── Phase 3b.7 (part) — click-to-select + Delete-key removal ─────────
  assert('imports removePanel',
    /import\s*\{[\s\S]{0,800}removePanel[\s\S]{0,800}\}\s*from\s*['"]\.\.\/utils\/designState['"]/.test(page));
  assert('selectedPanelIds state + ref (multi-select for array grouping)',
    /\[selectedPanelIds,\s*setSelectedPanelIds\]\s*=\s*useState\(\[\]\)/.test(page)
      && /selectedPanelIdsRef\s*=\s*useRef\(\[\]\)/.test(page)
      && /selectedPanelIdsRef\.current\s*=\s*selectedPanelIds/.test(page),
    'Phase 3b.9 upgraded single-panel selection to a multi-set so panels can be shift-clicked into an array group');
  assert('overlayPanels stashes panelId on each rendered panel object',
    /overlayPanels[\s\S]{0,4000}(rect|group)\.data\s*=\s*\{\s*panelId:\s*panel\.id/.test(page),
    'mouse:down needs data.panelId to identify which panel was clicked (whether we store the id on a plain Rect or a Group wrapping the panel visual)');
  assert('overlayPanels renders selected panels with highlight stroke (multi-select via selectedSet)',
    /overlayPanels[\s\S]{0,3000}isSelected\s*=\s*selectedSet\.has\(panel\.id\)/.test(page)
      && /overlayPanels[\s\S]{0,3000}isSelected\s*\?[\s\S]{0,300}strokeWidth/.test(page));
  assert('mouse:down: click on a panel selects it (with Shift/Ctrl additive)',
    /clickedPanelId\s*=\s*opt\.target\?\.data\?\.panelId[\s\S]{0,500}additive\s*=[\s\S]{0,200}shiftKey[\s\S]{0,600}setSelectedPanelIds/.test(page),
    'Shift+click or Ctrl+click toggles panel membership in the selection (needed for array creation)');
  assert('mouse:down: click on empty area clears selection',
    /selectedPanelIdsRef\.current\?\.length[\s\S]{0,300}setSelectedPanelIds\(\[\]\)/.test(page));
  assert('deleteSelectedPanel handler removes ALL selected panels + updates count/kW/dirty',
    /deleteSelectedPanel\s*=\s*useCallback\([\s\S]{0,800}for \(const id of ids\)\s*next\s*=\s*removePanel\(next,\s*id\)[\s\S]{0,600}setSelectedPanelIds\(\[\]\)/.test(page),
    'multi-select delete iterates removePanel across every selected id');
  assert('Delete + Backspace keys trigger deleteSelectedPanel',
    /['"]Delete['"][\s\S]{0,50}['"]Backspace['"][\s\S]{0,200}deleteSelectedPanel\(\)/.test(page));
  assert('keydown handler ignores INPUT/TEXTAREA (rep is typing)',
    /INPUT[\s\S]{0,80}TEXTAREA[\s\S]{0,80}isContentEditable/.test(page));
  assert('selection hint bar rendered with Delete button (single OR multi)',
    /selectedPanelIds\.length\s*>\s*0[\s\S]{0,3000}deleteSelectedPanel/.test(page));
  assert('layoutAndDraw passes selectedPanelIds into overlayPanels',
    /overlayPanels\(\{[\s\S]{0,600}selectedPanelIds:\s*selectedPanelIdsRef\.current/.test(page));

  // ── Phase 3b.11 — panel auto-numbering render ────────────────────────
  assert('imports buildPanelLabelMap',
    /import\s*\{[\s\S]{0,900}buildPanelLabelMap[\s\S]{0,200}\}\s*from\s*['"]\.\.\/utils\/designState['"]/.test(page));
  assert('layoutAndDraw passes buildPanelLabelMap(state) into overlayPanels',
    /overlayPanels\(\{[\s\S]{0,900}panelLabels:\s*buildPanelLabelMap\(stateRef\.current\)/.test(page));
  assert('overlayPanels wraps panelLabels in a Map + only renders label when present',
    /const labels\s*=\s*panelLabels instanceof Map\s*\?\s*panelLabels\s*:\s*new Map\(\)/.test(page)
      && /const labelText\s*=\s*labels\.get\(panel\.id\)[\s\S]{0,200}if \(labelText\)/.test(page),
    'un-arrayed panels stay un-labelled');
  assert('label is a Fabric.Text pushed into the Group children',
    /new fabric\.Text\(labelText[\s\S]{0,600}children\.push\(label\)/.test(page));

  // ── Phase 3b.9 — array grouping + naming ─────────────────────────────
  assert('imports makeArray + addArray + removeArray',
    /import\s*\{[\s\S]{0,600}makeArray[\s\S]{0,200}addArray[\s\S]{0,200}removeArray[\s\S]{0,600}\}\s*from\s*['"]\.\.\/utils\/designState['"]/.test(page));
  assert('createArrayFromSelection handler defined',
    /createArrayFromSelection\s*=\s*useCallback\([\s\S]{0,600}makeArray\(\{\s*name:\s*trimmed,\s*panelIds/.test(page));
  assert('suggestArrayName uses face azimuth compass when panels sit on one face',
    /suggestArrayName[\s\S]{0,600}azimuthToCompass\(face\?\.azimuthDegrees\)/.test(page),
    'default name is North array / SW array etc so rep doesn\'t have to think');
  assert('multi-select hint bar shows Create-array button when >1 panels selected',
    /selectedPanelIds\.length\s*!==\s*1[\s\S]{0,1200}Create array/.test(page)
      || /selectedPanelIds\.length\s*===\s*1[\s\S]{0,1500}Create array/.test(page));
  assert('sidebar renders arrays list when arrays > 0',
    /Array\.isArray\(arrays\)\s*&&\s*arrays\.length\s*>\s*0[\s\S]{0,600}Arrays\s*\(\{arrays\.length\}/.test(page));
  assert('array row click selects all its panels',
    /onSelectArray\?\.\(a\.id\)/.test(page));
  assert('array row delete button offers un-group vs delete-panels confirm',
    /deleteArrayKeepPanels[\s\S]{0,300}removeArray\(stateRef\.current,\s*arrayId\)/.test(page)
      && /deleteArrayAndPanels\s*=\s*useCallback\([\s\S]{0,600}for \(const pid of arr\.panelIds\)\s*next\s*=\s*removePanel\(next,\s*pid\)/.test(page),
    'un-group keeps panels; delete-panels iterates removePanel across every panelId (which cascades arrays too)');
  assert('array row shows inline confirm with 3 choices',
    /confirmingArrayId\s*===\s*a\.id[\s\S]{0,2000}Un-group only[\s\S]{0,600}Delete panels[\s\S]{0,600}Cancel/.test(page));

  // ── Phase 3b.9 — delete-face (sidebar list + delete-face mode) ──────
  assert('imports removeFace helper',
    /import\s*\{[\s\S]{0,600}removeFace[\s\S]{0,600}\}\s*from\s*['"]\.\.\/utils\/designState['"]/.test(page));
  assert('isDeletingFace state + ref (mouse:down reads ref)',
    /\[isDeletingFace,\s*setIsDeletingFace\]\s*=\s*useState\(false\)/.test(page)
      && /isDeletingFaceRef\s*=\s*useRef\(false\)/.test(page)
      && /isDeletingFaceRef\.current\s*=\s*isDeletingFace/.test(page));
  assert('deleteFaceById handler cascades panels + arrays via removeFace',
    /deleteFaceById\s*=\s*useCallback\([\s\S]{0,900}removeFace\(st,\s*faceId\)[\s\S]{0,300}setFaceCount[\s\S]{0,300}setPanelCount/.test(page),
    'must update panelCount + kW + kWh totals because removeFace cascades panels');
  assert('deleteFaceById confirms with the rep (unless skipped)',
    /deleteFaceById[\s\S]{0,900}window\.confirm/.test(page));
  assert('mouse:down: delete-face mode intercepts before drop/select',
    /isDeletingFaceRef\.current[\s\S]{0,600}faceContainingPoint\(stateRef\.current[\s\S]{0,300}deleteFaceById\(face\.id\)/.test(page));
  assert('Esc exits delete-face mode',
    /isDeletingFace[\s\S]{0,300}Escape[\s\S]{0,100}setIsDeletingFace\(false\)/.test(page));
  assert('header renders Delete-face toggle button (visible when faceCount > 0)',
    /faceCount\s*>\s*0[\s\S]{0,600}setIsDeletingFace\(v\s*=>\s*!v\)/.test(page));
  assert('delete-face instruction bar rendered when mode active',
    /isDeletingFace\s*&&\s*!isTracing[\s\S]{0,600}Delete a roof face/.test(page));
  assert('sidebar renders Roof faces list with per-row delete',
    /Array\.isArray\(faces\)\s*&&\s*faces\.length\s*>\s*0[\s\S]{0,600}Roof faces[\s\S]{0,3000}onDeleteFace\?\.\(f\.id\)/.test(page));

  // ── Phase 3b.8 — drop rules (setback + no-overlap + obstruction) ─────
  assert('imports checkPanelDropRules + DROP_REASON_HUMAN + DEFAULT_FACE_SETBACK_M',
    /import\s*\{[\s\S]{0,800}checkPanelDropRules[\s\S]{0,200}DROP_REASON_HUMAN[\s\S]{0,200}DEFAULT_FACE_SETBACK_M[\s\S]{0,100}\}\s*from\s*['"]\.\.\/utils\/designState['"]/.test(page));
  assert('drop handler runs the rule engine before makePanel',
    /snappedCenter[\s\S]{0,2000}checkPanelDropRules\(\{[\s\S]{0,2000}\}\);[\s\S]{0,800}makePanel\(/.test(page),
    'setback + overlap + obstruction checks must gate the drop, not run after');
  assert('drop rule uses face.setbackMetres with DEFAULT fallback',
    /setbackMetres:\s*Number\.isFinite\(face\?\.setbackMetres\)\s*\?\s*face\.setbackMetres\s*:\s*DEFAULT_FACE_SETBACK_M/.test(page),
    'engineer overrides on face setback (Phase 3d) must be honoured when present');
  assert('rejected drop flashes a hint via flashDropReject',
    /if\s*\(!ruleCheck\.ok\)[\s\S]{0,200}flashDropReject\(ruleCheck\.reason\)/.test(page));
  assert('dropRejectReason state + auto-dismiss timer',
    /\[dropRejectReason,\s*setDropRejectReason\]\s*=\s*useState\(null\)/.test(page)
      && /dropRejectTimerRef\s*=\s*useRef\(null\)/.test(page)
      && /setTimeout\(\(\)\s*=>\s*setDropRejectReason\(null\),\s*2500\)/.test(page));
  assert('reject-hint toast rendered when dropRejectReason set (uses human message)',
    /dropRejectReason\s*&&[\s\S]{0,500}DROP_REASON_HUMAN\[dropRejectReason\]/.test(page));
  assert('flashDropReject clears any pending timer before starting a new one',
    /flashDropReject\s*=[\s\S]{0,300}clearTimeout\(dropRejectTimerRef\.current\)/.test(page),
    'rapid rejects must not stack timers');
  assert('cleanup effect clears the drop-reject timer on unmount',
    /useEffect\(\(\)\s*=>\s*\(\)\s*=>\s*\{[\s\S]{0,300}clearTimeout\(dropRejectTimerRef\.current\)/.test(page));

  // ── Phase 3b.8 (irradiance) — surface Google Solar sunshine data ─────
  assert('imports totalAnnualKwh + estimateFaceSunshine',
    /import\s*\{[\s\S]{0,800}totalAnnualKwh[\s\S]{0,200}estimateFaceSunshine[\s\S]{0,600}\}\s*from\s*['"]\.\.\/utils\/designState['"]/.test(page));
  assert('totalKwh state + setter',
    /\[totalKwh,\s*setTotalKwh\]\s*=\s*useState\(0\)/.test(page));
  assert('load effect + catalogue-refresh effect + drop + delete all recompute totalKwh',
    (page.match(/setTotalKwh\(totalAnnualKwh\(/g) || []).length >= 4,
    'totalKwh must re-mirror at every state mutation site: load, catalogue arrival, drop, delete');
  assert('sidebar shows estimated annual output in MWh/yr',
    /Est\.\s*output[\s\S]{0,600}\(\(totalKwh\s*\?\?\s*0\)\s*\/\s*1000\)\.toFixed\(1\)[\s\S]{0,100}MWh\/yr/.test(page),
    'sidebar stat block converts totalKwh to MWh for readability at typical residential sizes');

  // ── Phase 3b.7 remainder — drag-to-move + P↔L toggle ────────────────
  assert('canvas listens for object:modified to accept panel drags',
    /canvas\.on\(['"]object:modified['"]/.test(page));
  assert('drag-completed handler snaps to grid + runs rule check + reverts on failure',
    /object:modified[\s\S]{0,3000}snapToFaceGrid\([\s\S]{0,1000}checkPanelDropRules\([\s\S]{0,1500}flashDropReject/.test(page),
    'drag reuses the exact drop-rule engine so a move can\'t leave the design invalid');
  assert('overlap check excludes the panel being dragged (stateSansSelf)',
    /object:modified[\s\S]{0,3000}stateSansSelf\s*=\s*\{\s*\.\.\.st,\s*panels:\s*st\.panels\.filter\(p\s*=>\s*p\.id\s*!==\s*panelId\)/.test(page),
    'else dragging any distance would self-overlap');

  assert('toggleSelectedPanelOrientation handler defined',
    /toggleSelectedPanelOrientation\s*=\s*useCallback\(/.test(page));
  assert('toggle validates the new orientation before committing',
    /toggleSelectedPanelOrientation[\s\S]{0,800}nextOrientation[\s\S]{0,600}checkPanelDropRules\([\s\S]{0,600}!check\.ok[\s\S]{0,200}flashDropReject/.test(page));
  assert('R key triggers the orientation toggle',
    /['"]r['"][\s\S]{0,60}['"]R['"][\s\S]{0,200}toggleSelectedPanelOrientation\(\)/.test(page));
  assert('single-select hint bar mentions drag + R + P↔L button',
    /selectedPanelIds\.length\s*===\s*1[\s\S]{0,1200}Drag to move[\s\S]{0,300}R to rotate[\s\S]{0,500}toggleSelectedPanelOrientation/.test(page));
  assert('overlayRoofFaces label includes per-face irradiance when known',
    /face\.sunshineKwhPerKwPerYear[\s\S]{0,300}kWh\/kW\/yr/.test(page));

  // ── Regression: captureCanvasState must preserve roof/panels/arrays ──
  // Bug: the Phase 3a helper returned only { view, canvas } and was never
  // updated when Phase 3b added the design data model. Autosave silently
  // wiped every traced face and dropped panel 2s after each change — the
  // Fabric polygon stayed on screen (stale render) but stateRef.current
  // lost the data, so subsequent clicks reported "no face at this point".
  assert('regression: captureCanvasState spreads stateRef.current so roof/panels/arrays survive save',
    /captureCanvasState\s*=\s*useCallback\([\s\S]{0,1200}\.\.\.base[\s\S]{0,400}view,\s*canvas:\s*\{\s*serialized/.test(page),
    'must return {...stateRef.current, view, canvas} — else Phase 3b sections get stripped');

  // Server-side contract: catalogue route must expose panel dimensions so the
  // palette can render at real-world size on the canvas.
  const cat = fs.readFileSync(path.join(REPO_ROOT, 'server/routes/pm/catalogue.js'), 'utf8');
  assert('catalogue /options exposes panel length_mm + width_mm',
    /panels[\s\S]{0,1000}length_mm:\s*p\.length_mm[\s\S]{0,200}width_mm:\s*p\.width_mm/.test(cat));

  const loader = fs.readFileSync(path.join(REPO_ROOT, 'server/services/pm/proposalEngine/catalogue/dbLoader.js'), 'utf8');
  assert('mapPanel passes physical dimensions through',
    /mapPanel[\s\S]{0,2000}length_mm:\s*num\(s\.length_mm\)[\s\S]{0,200}width_mm:\s*num\(s\.width_mm\)/.test(loader));
}

// ── PmApp.jsx route wiring ────────────────────────────────────────────────
{
  console.log('\n▸ Route registration in PmApp.jsx');
  assert('imports DesignPage',          /import\s+DesignPage\s+from\s+['"]\.\/pages\/DesignPage['"]/.test(pmApp));
  assert('registers quotes/:id/design', /path=["']quotes\/:id\/design["']\s+element=\{<DesignPage/.test(pmApp));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

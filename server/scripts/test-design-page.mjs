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
  assert('overlayRoofSegments returns created objects for later cleanup',
    /return created/.test(page));
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
  assert('regression: crosshair lines use top-left origin',
    (page.match(/new fabric\.Line\([^)]+,\s*\{[^}]*\.\.\.TL_ORIGIN/g) || []).length >= 2,
    'both crosshair lines must use TL_ORIGIN');
  assert('regression: property pin text uses top-left origin',
    /new fabric\.Text\('◉ Customer property'[\s\S]{0,200}\.\.\.TL_ORIGIN/.test(page),
    '"Customer property" pin must use TL_ORIGIN');
  assert('regression: debug markers stripped from production',
    !/DEBUG-MARKERS/.test(page),
    'debug console.log + red/blue/green markers must not ship');

  // ── Phase 3a scope: property marker only, segments deferred to 3b ────
  assert('phase 3a: does NOT draw segment polygons (deferred to 3b)',
    !/new fabric\.Polygon/.test(page),
    'segment polygons cluttered the small NZ roof — moved to Phase 3b when they become the panel-drop target');
  assert('phase 3a: does NOT import segment helpers from roofOverlay',
    !/import\s*\{[^}]*(segmentBboxToPolygon|segmentLabel)[^}]*\}\s*from\s*['"]\.\.\/utils\/roofOverlay/.test(page),
    'segment helpers stay in roofOverlay.js for Phase 3b re-import');

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
    /radiusForAnalysis\(roofAnalysis\)/.test(page) && !/ROOF_TILE_RADIUS_METERS(?!\s*=\s*const)/.test(page),
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

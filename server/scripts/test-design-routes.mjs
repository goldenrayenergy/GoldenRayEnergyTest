// ────────────────────────────────────────────────────────────────────────────
// test-design-routes.mjs
//
// Offline integration tests for server/routes/pm/designs.js.
// Uses in-memory fake supabase + a live express harness to verify the
// GET/PUT contract end-to-end without hitting the real DB.
//
// Covers:
//   • GET returns 404 when quote doesn't exist
//   • GET returns 204 when quote exists but no design
//   • GET returns 200 with row when design exists
//   • PUT first-save requires version=0, inserts with version=1
//   • PUT first-save with wrong version returns 409
//   • PUT update with correct version bumps and returns 200
//   • PUT update with stale version returns 409 + server_version
//   • PUT with missing state returns 400
//   • PUT with malformed version returns 400
//   • PUT with unknown quote returns 404
//   • Missing auth token returns 401
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

// IMPORTANT: env.js captures JWT_SECRET at module-load. We must set it BEFORE
// importing anything that transitively imports env.js. Static ES-module imports
// are hoisted, so we use dynamic import() after setting the env below.
process.env.JWT_SECRET = 'test-secret-min32chars-for-hs256-1234';
process.env.NODE_ENV = 'test';

const { default: express }          = await import('express');
const { default: http }             = await import('node:http');
const { default: jwt }              = await import('jsonwebtoken');
const designsMod                    = await import('../routes/pm/designs.js');
const designsRouter                 = designsMod.default;
const { __setSupabaseForTests, __setRefetchDepsForTests } = designsMod;

const TEST_TOKEN = jwt.sign({ id: 'test-user-1', role: 'admin' }, process.env.JWT_SECRET);

let pass = 0;
let fail = 0;
const failures = [];
function assert(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}

console.log('test-design-routes\n');

// ── Fake Supabase — quotes + designs tables ───────────────────────────────
function makeFakeSupabase({ quotes = [], designs = [] } = {}) {
  const state = { quotes: [...quotes], designs: [...designs] };
  let nextDesignId = designs.length + 1;

  function from(table) {
    let filters = [];
    let mode = null;
    let insertRow = null;
    let updatePatch = null;

    const chain = {
      select(_c) { mode = mode || 'select'; return chain; },
      eq(k, v) { filters.push([k, v]); return chain; },
      insert(row) { mode = 'insert'; insertRow = row; return chain; },
      update(patch) { mode = 'update'; updatePatch = patch; return chain; },

      async maybeSingle() {
        const rows = state[table] || [];
        const match = rows.find(r => filters.every(([k, v]) => r[k] === v));
        return { data: match || null, error: null };
      },
      async single() {
        if (mode === 'insert') {
          const now = new Date().toISOString();
          const created = { id: String(nextDesignId++), created_at: now, updated_at: now, ...insertRow };
          state[table].push(created);
          return { data: created, error: null };
        }
        if (mode === 'update') {
          const rows = state[table] || [];
          const match = rows.find(r => filters.every(([k, v]) => r[k] === v));
          if (match) Object.assign(match, updatePatch);
          return { data: match || null, error: null };
        }
        const rows = state[table] || [];
        const match = rows.find(r => filters.every(([k, v]) => r[k] === v));
        return { data: match || null, error: null };
      },
    };
    return chain;
  }
  return { from, _peek: () => state };
}

function makeApp(fakeSb) {
  __setSupabaseForTests(fakeSb);
  const app = express();
  app.use(express.json());
  app.use('/api/pm/quotes', designsRouter);
  return app;
}

async function req(app, method, path, body, { withAuth = true } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, async () => {
      const { port } = server.address();
      try {
        const headers = { 'content-type': 'application/json' };
        if (withAuth) headers['authorization'] = `Bearer ${TEST_TOKEN}`;
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        resolve({ status: res.status, data });
      } catch (e) { reject(e); }
      finally { server.close(); }
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════
{
  console.log('\n▸ GET /api/pm/quotes/:id/design');

  {
    const sb = makeFakeSupabase({ quotes: [], designs: [] });
    const r = await req(makeApp(sb), 'GET', '/api/pm/quotes/no-such/design');
    assert('unknown quote → 404', r.status === 404, `got ${r.status}`);
  }

  {
    const sb = makeFakeSupabase({ quotes: [{ id: 'Q1' }], designs: [] });
    const r = await req(makeApp(sb), 'GET', '/api/pm/quotes/Q1/design');
    assert('quote exists, no design → 204', r.status === 204, `got ${r.status}`);
  }

  {
    const now = new Date().toISOString();
    const sb = makeFakeSupabase({
      quotes: [{ id: 'Q2' }],
      designs: [{ id: 'D1', quote_id: 'Q2', state: { view: { zoom: 1.5 } }, version: 3, created_at: now, updated_at: now }],
    });
    const r = await req(makeApp(sb), 'GET', '/api/pm/quotes/Q2/design');
    assert('design exists → 200', r.status === 200, `got ${r.status}`);
    assert('design exists → version=3', r.data?.version === 3);
    assert('design exists → state carries through', r.data?.state?.view?.zoom === 1.5);
  }
}

{
  console.log('\n▸ PUT — first-save path');

  {
    const sb = makeFakeSupabase({ quotes: [{ id: 'Q3' }], designs: [] });
    const r = await req(makeApp(sb), 'PUT', '/api/pm/quotes/Q3/design', {
      state: { view: { zoom: 1, panX: 0, panY: 0 }, canvas: { serialized: null } },
      version: 0,
    });
    assert('first-save with v=0 → 201', r.status === 201, `got ${r.status}`);
    assert('first-save → version bumps to 1', r.data?.version === 1, `got ${r.data?.version}`);
    assert('first-save → quote_id preserved', r.data?.quote_id === 'Q3');
    assert('first-save → row persisted in fake DB', sb._peek().designs.length === 1);
  }

  {
    const sb = makeFakeSupabase({ quotes: [{ id: 'Q4' }], designs: [] });
    const r = await req(makeApp(sb), 'PUT', '/api/pm/quotes/Q4/design', {
      state: {}, version: 5,
    });
    assert('first-save with wrong version → 409', r.status === 409, `got ${r.status}`);
    assert('first-save wrong version → server_version=0 reported', r.data?.server_version === 0);
    assert('first-save wrong version → no row persisted', sb._peek().designs.length === 0);
  }
}

{
  console.log('\n▸ PUT — update path (optimistic concurrency)');

  {
    const sb = makeFakeSupabase({
      quotes: [{ id: 'Q5' }],
      designs: [{ id: 'D2', quote_id: 'Q5', state: { view: { zoom: 1 } }, version: 4 }],
    });
    const r = await req(makeApp(sb), 'PUT', '/api/pm/quotes/Q5/design', {
      state: { view: { zoom: 2.5 } }, version: 4,
    });
    assert('update correct version → 200', r.status === 200, `got ${r.status}`);
    assert('update → version bumps to 5', r.data?.version === 5, `got ${r.data?.version}`);
    assert('update → state persisted (zoom=2.5)', r.data?.state?.view?.zoom === 2.5);
  }

  {
    const sb = makeFakeSupabase({
      quotes: [{ id: 'Q6' }],
      designs: [{ id: 'D3', quote_id: 'Q6', state: {}, version: 7 }],
    });
    const r = await req(makeApp(sb), 'PUT', '/api/pm/quotes/Q6/design', {
      state: { view: { zoom: 3 } }, version: 5,
    });
    assert('stale save → 409', r.status === 409, `got ${r.status}`);
    assert('stale save → server_version=7', r.data?.server_version === 7);
    assert('stale save → client_version=5', r.data?.client_version === 5);
    assert('stale save → no version bump in DB', sb._peek().designs[0].version === 7);
  }
}

{
  console.log('\n▸ PUT — input validation');

  {
    const sb = makeFakeSupabase({ quotes: [{ id: 'Q7' }], designs: [] });
    const r = await req(makeApp(sb), 'PUT', '/api/pm/quotes/Q7/design', { version: 0 });
    assert('missing state → 400', r.status === 400, `got ${r.status}`);
  }

  {
    const sb = makeFakeSupabase({ quotes: [{ id: 'Q8' }], designs: [] });
    const r = await req(makeApp(sb), 'PUT', '/api/pm/quotes/Q8/design', { state: [], version: 0 });
    assert('state as array → 400', r.status === 400, `got ${r.status}`);
  }

  {
    const sb = makeFakeSupabase({ quotes: [{ id: 'Q9' }], designs: [] });
    const r = await req(makeApp(sb), 'PUT', '/api/pm/quotes/Q9/design', { state: {} });
    assert('missing version → 400', r.status === 400, `got ${r.status}`);
  }

  {
    const sb = makeFakeSupabase({ quotes: [{ id: 'Q10' }], designs: [] });
    const r = await req(makeApp(sb), 'PUT', '/api/pm/quotes/Q10/design', { state: {}, version: 1.5 });
    assert('float version → 400', r.status === 400, `got ${r.status}`);
  }

  {
    const sb = makeFakeSupabase({ quotes: [{ id: 'Q11' }], designs: [] });
    const r = await req(makeApp(sb), 'PUT', '/api/pm/quotes/Q11/design', { state: {}, version: -1 });
    assert('negative version → 400', r.status === 400, `got ${r.status}`);
  }

  {
    const sb = makeFakeSupabase({ quotes: [], designs: [] });
    const r = await req(makeApp(sb), 'PUT', '/api/pm/quotes/no-such/design', { state: {}, version: 0 });
    assert('PUT unknown quote → 404', r.status === 404, `got ${r.status}`);
  }
}

{
  console.log('\n▸ Auth');
  {
    const sb = makeFakeSupabase({ quotes: [{ id: 'Q12' }], designs: [] });
    const r = await req(makeApp(sb), 'GET', '/api/pm/quotes/Q12/design', null, { withAuth: false });
    assert('no bearer → 401', r.status === 401, `got ${r.status}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// POST /:id/refetch-roof-image — Migration 040 tile upgrade
// ═══════════════════════════════════════════════════════════════════════
{
  console.log('\n▸ POST /:id/refetch-roof-image');

  // Fake deps that record whether the pipeline was invoked
  function makeRefetchDeps({ allowed = true, callCount = 3, quota = 100,
                             fetchResult, computed = 18 } = {}) {
    let reserved = null, fetched = null;
    return {
      deps: {
        computeOptimalTileRadius: (segs) => { return computed; },
        quotaTracker: {
          reserveQuota: async (endpoint) => { reserved = endpoint; return { allowed, callCount, quota }; },
        },
        roofImagery: {
          fetchAndStoreRoofImage: async (args) => {
            fetched = args;
            return fetchResult || {
              ok: true, storageBucket: 'roof-images',
              storagePath: `${args.enquiryId}/rgb.png`,
              radiusMeters: args.radiusMeters, sizeBytes: 12345,
            };
          },
        },
      },
      peek: () => ({ reserved, fetched }),
    };
  }

  // Quote missing → 404
  {
    const sb = makeFakeSupabase({ quotes: [], designs: [] });
    __setRefetchDepsForTests(makeRefetchDeps().deps);
    const r = await req(makeApp(sb), 'POST', '/api/pm/quotes/no-such/refetch-roof-image');
    assert('unknown quote → 404', r.status === 404, `got ${r.status}`);
  }

  // Quote exists but no roof analysis for its contact → 404
  {
    const sb = makeFakeSupabase({
      quotes: [{ id: 'Q20', contact_id: 'C20' }],
    });
    // Add an empty roof_analyses list via installRoofAnalysis's setup path,
    // then remove the row we just installed so the lookup returns null.
    installRoofAnalysis(sb, 'DOES-NOT-EXIST', { id: 'stub' });
    sb._peek().roof_analyses.length = 0;
    __setRefetchDepsForTests(makeRefetchDeps().deps);
    const r = await req(makeApp(sb), 'POST', '/api/pm/quotes/Q20/refetch-roof-image');
    assert('no roof analysis → 404', r.status === 404, `got ${r.status}`);
  }

  // Analysis already tight (≤20m) → 204, no quota consumed
  {
    const sb = makeFakeSupabase({
      quotes: [{ id: 'Q21', contact_id: 'C21' }],
    });
    installRoofAnalysis(sb, 'C21', {
      id: 'A21', enquiry_id: 'E21', latitude: -36.9, longitude: 174.7,
      status: 'ok', tile_radius_m: 18, roof_segments: [],
    });
    const { deps, peek } = makeRefetchDeps();
    __setRefetchDepsForTests(deps);
    const r = await req(makeApp(sb), 'POST', '/api/pm/quotes/Q21/refetch-roof-image');
    assert('already tight → 204', r.status === 204, `got ${r.status}`);
    assert('already tight → no quota reserved', peek().reserved === null);
    assert('already tight → no fetch call', peek().fetched === null);
  }

  // Analysis with radius=50 → refetch fires
  {
    const sb = makeFakeSupabase({
      quotes: [{ id: 'Q22', contact_id: 'C22' }],
    });
    installRoofAnalysis(sb, 'C22', {
      id: 'A22', enquiry_id: 'E22', latitude: -36.9, longitude: 174.7,
      status: 'ok', tile_radius_m: 50,
      roof_segments: [{
        boundingBox: {
          ne: { latitude: -36.899, longitude: 174.701 },
          sw: { latitude: -36.901, longitude: 174.699 },
        },
        center: { latitude: -36.9, longitude: 174.7 },
      }],
    });
    const { deps, peek } = makeRefetchDeps({ computed: 15 });
    __setRefetchDepsForTests(deps);
    const r = await req(makeApp(sb), 'POST', '/api/pm/quotes/Q22/refetch-roof-image');
    assert('50m tile → 200', r.status === 200, `got ${r.status}`);
    assert('body.updated=true', r.data?.updated === true);
    assert('body.tile_radius_m matches computed', r.data?.tile_radius_m === 15);
    assert('quota was reserved', peek().reserved === 'dataLayers');
    assert('imagery fetch used computed radius', peek().fetched?.radiusMeters === 15);
  }

  // Pre-migration row (tile_radius_m=null) → refetch fires
  {
    const sb = makeFakeSupabase({
      quotes: [{ id: 'Q23', contact_id: 'C23' }],
    });
    installRoofAnalysis(sb, 'C23', {
      id: 'A23', enquiry_id: 'E23', latitude: -36.9, longitude: 174.7,
      status: 'ok', tile_radius_m: null, roof_segments: [],
    });
    const { deps, peek } = makeRefetchDeps({ computed: 22 });
    __setRefetchDepsForTests(deps);
    const r = await req(makeApp(sb), 'POST', '/api/pm/quotes/Q23/refetch-roof-image');
    assert('null radius → 200 (refetches)', r.status === 200, `got ${r.status}`);
    assert('null radius → uses fallback computed value', peek().fetched?.radiusMeters === 22);
  }

  // Quota exhausted → 429
  {
    const sb = makeFakeSupabase({
      quotes: [{ id: 'Q24', contact_id: 'C24' }],
    });
    installRoofAnalysis(sb, 'C24', {
      id: 'A24', enquiry_id: 'E24', latitude: -36.9, longitude: 174.7,
      status: 'ok', tile_radius_m: 50, roof_segments: [],
    });
    const { deps, peek } = makeRefetchDeps({ allowed: false, callCount: 100, quota: 100 });
    __setRefetchDepsForTests(deps);
    const r = await req(makeApp(sb), 'POST', '/api/pm/quotes/Q24/refetch-roof-image');
    assert('quota exhausted → 429', r.status === 429, `got ${r.status}`);
    assert('quota response includes callCount', r.data?.callCount === 100);
    assert('imagery fetch NOT called after quota fail', peek().fetched === null);
  }

  // Analysis in failed state → 409
  {
    const sb = makeFakeSupabase({
      quotes: [{ id: 'Q25', contact_id: 'C25' }],
    });
    installRoofAnalysis(sb, 'C25', {
      id: 'A25', enquiry_id: 'E25', latitude: -36.9, longitude: 174.7,
      status: 'failed', tile_radius_m: null, roof_segments: [],
    });
    __setRefetchDepsForTests(makeRefetchDeps().deps);
    const r = await req(makeApp(sb), 'POST', '/api/pm/quotes/Q25/refetch-roof-image');
    assert("failed analysis → 409", r.status === 409, `got ${r.status}`);
  }
}

// Helpers for the refetch-roof-image tests. The base makeFakeSupabase only
// carried quotes + designs tables; here we bolt on a roof_analyses lookup path.
function installRoofAnalysis(sb, contactId, row) {
  if (!sb._peek().roof_analyses) sb._peek().roof_analyses = [];
  sb._peek().roof_analyses.push({ contact_id: contactId, created_at: new Date().toISOString(), ...row });
  // Extend the .from() chain to handle roof_analyses reads + updates
  const origFrom = sb.from;
  sb.from = (t) => {
    if (t !== 'roof_analyses') return origFrom(t);
    let filters = []; let mode = null; let patch = null;
    const chain = {
      select: () => { mode = mode || 'select'; return chain; },
      eq: (k, v) => { filters.push([k, v]); return chain; },
      order: () => chain,
      limit: () => chain,
      update: (p) => { mode = 'update'; patch = p; return chain; },
      async maybeSingle() {
        const rows = sb._peek().roof_analyses;
        const match = rows.find(r => filters.every(([k, v]) => r[k] === v));
        return { data: match || null, error: null };
      },
      async single() {
        const rows = sb._peek().roof_analyses;
        const match = rows.find(r => filters.every(([k, v]) => r[k] === v));
        if (mode === 'update' && match) Object.assign(match, patch);
        return { data: match || null, error: null };
      },
    };
    return chain;
  };
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

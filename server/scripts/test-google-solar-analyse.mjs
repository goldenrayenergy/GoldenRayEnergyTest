// ────────────────────────────────────────────────────────────────────────────
// test-google-solar-analyse.mjs
//
// Offline integration tests for services/googleSolar/analyseRoof.js.
// Uses in-memory fake supabase + fake client + fake quota tracker to
// verify observable behaviour end-to-end without hitting Google or DB.
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import { createAnalyser, parseBuildingInsightsResponse } from '../services/googleSolar/analyseRoof.js';

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}

console.log('test-google-solar-analyse\n');

// ── Fake Supabase — roof_analyses only ─────────────────────────────────────
function makeFakeSupabase(seed = []) {
  const rows = [...seed];
  let nextId = seed.length + 1;
  function from(_t) {
    let filters = []; let mode = null; let insertRow = null; let updatePatch = null; let selectLimit = null;
    const chain = {
      select(_c) { mode = mode || 'select'; return chain; },
      eq(k, v) { filters.push([k, v]); return chain; },
      limit(n) { selectLimit = n; return chain; },
      insert(row) { mode = 'insert'; insertRow = row; return chain; },
      update(patch) { mode = 'update'; updatePatch = patch; return chain; },
      async maybeSingle() {
        const match = rows.find(r => filters.every(([k, v]) => r[k] === v));
        return { data: match || null, error: null };
      },
      async single() {
        if (mode === 'insert') {
          const created = { id: String(nextId++), ...insertRow };
          rows.push(created);
          return { data: created, error: null };
        }
        const match = rows.find(r => filters.every(([k, v]) => r[k] === v));
        return { data: match || null, error: null };
      },
      then(resolve) {
        if (mode === 'update') {
          const match = rows.find(r => filters.every(([k, v]) => r[k] === v));
          if (match) Object.assign(match, updatePatch);
        }
        resolve({ data: null, error: null });
      },
    };
    return chain;
  }
  return { from, _peek: () => rows };
}

// ── Fake client + quota tracker ────────────────────────────────────────────
const okResponse = {
  imageryQuality: 'HIGH',
  imageryDate: { year: 2024, month: 5, day: 15 },
  solarPotential: {
    maxArrayPanelsCount: 42,
    maxArrayAreaMeters2: 82.4,
    maxSunshineHoursPerYear: 1650.5,
    carbonOffsetFactorKgPerMwh: 421,
    roofSegmentStats: [
      { pitchDegrees: 22.3, azimuthDegrees: 45.1, stats: { areaMeters2: 41.2 } },
      { pitchDegrees: 22.3, azimuthDegrees: 225.1, stats: { areaMeters2: 41.2 } },
    ],
  },
};

const AKL = { latitude: -36.85, longitude: 174.76 };
const NOW = () => new Date('2026-07-29T10:00:00Z');
const silentLogger = { warn: () => {}, error: () => {} };
const stubAllowedQuota = { reserveQuota: async () => ({ allowed: true, callCount: 5, quota: 1000, isFirstOfMonth: false }) };

// ── Case 1: Feature flag off → skipped_flag row ─────────────────────────────
{
  const supabase = makeFakeSupabase();
  const analyser = createAnalyser({
    supabase, featureEnabled: false,
    client:       { buildingInsights: async () => { throw new Error('should not be called'); } },
    quotaTracker: { reserveQuota: async () => { throw new Error('should not be called'); } },
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e1', address: '1 Test St', ...AKL });
  assert('flag off returns skipped_flag', r.status === 'skipped_flag');
  const [row] = supabase._peek();
  assert('one row inserted', supabase._peek().length === 1);
  assert('row status=skipped_flag', row.status === 'skipped_flag');
  assert('row has address', row.address_used === '1 Test St');
  assert('row error_message set', row.error_message?.includes('off'));
}

// ── Case 2: Idempotency — prior row → returns without new insert ────────────
{
  const supabase = makeFakeSupabase([
    { id: 'existing', enquiry_id: 'e2', status: 'ok', address_used: '2 Prior Ln' },
  ]);
  let clientCalls = 0;
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => { clientCalls++; return { ok: true, data: okResponse }; } },
    quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e2', address: '2 New Ln', ...AKL });
  assert('idempotency returns existing status', r.status === 'ok');
  assert('idempotency returns existing id', r.id === 'existing');
  assert('no new row inserted', supabase._peek().length === 1);
  assert('client NOT called', clientCalls === 0);
}

// ── Case 3: Missing latitude → failed row with geocoding message ───────────
{
  const supabase = makeFakeSupabase();
  let clientCalls = 0;
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => { clientCalls++; return { ok: true, data: okResponse }; } },
    quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e3', address: '3 No Coord Rd' });
  assert('missing lat/lng returns failed', r.status === 'failed');
  const [row] = supabase._peek();
  assert('failed row inserted', row.status === 'failed');
  assert('failed row error mentions geocoding', row.error_message?.includes('geocoding'));
  assert('client NOT called', clientCalls === 0);
}

// ── Case 4: Quota denied → skipped_quota row ────────────────────────────────
{
  const supabase = makeFakeSupabase();
  let clientCalls = 0;
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => { clientCalls++; return { ok: true, data: okResponse }; } },
    quotaTracker: { reserveQuota: async () => ({ allowed: false, reason: 'quota_exhausted', callCount: 1000, quota: 1000 }) },
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e4', address: '4 Full Cap Ave', ...AKL });
  assert('quota denied returns skipped_quota', r.status === 'skipped_quota');
  const [row] = supabase._peek();
  assert('skipped_quota row inserted', row.status === 'skipped_quota');
  assert('error mentions quota', row.error_message?.includes('quota-exhausted'));
  assert('lat/lng preserved even when skipped', row.latitude === -36.85);
  assert('client NOT called', clientCalls === 0);
}

// ── Case 5: Happy path — HIGH succeeds on first attempt (single call) ──────
{
  const supabase = makeFakeSupabase();
  let clientCalls = [];
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async (args) => { clientCalls.push(args); return { ok: true, source: 'live', data: okResponse }; } },
    quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e5', address: '5 Happy Path Cres', contactId: 'c5', ...AKL });
  assert('happy path returns ok', r.status === 'ok');
  assert('happy path — HIGH tried first, no retry needed', clientCalls.length === 1);
  assert('happy path — HIGH quality requested', clientCalls[0].requiredQuality === 'HIGH');
  const [row] = supabase._peek();
  assert('row status=ok', row.status === 'ok');
  assert('row imagery_quality=HIGH', row.imagery_quality === 'HIGH');
  assert('row imagery_date=2024-05-15', row.imagery_date === '2024-05-15');
  assert('row max_array_panels_count=42', row.max_array_panels_count === 42);
  assert('row max_array_area_m2=82.4', row.max_array_area_m2 === 82.4);
  assert('row max_sunshine_hours=1650.5', row.max_sunshine_hours_per_year === 1650.5);
  // 421 kg/MWh → 0.421 kg/kWh
  assert('carbon offset converted MWh→kWh (0.421)', row.carbon_offset_factor_kg_per_kwh === 0.421);
  assert('roof_segments has 2 elements', Array.isArray(row.roof_segments) && row.roof_segments.length === 2);
  assert('raw_response preserved', row.raw_response?.solarPotential?.maxArrayPanelsCount === 42);
  assert('contact_id linked', row.contact_id === 'c5');
  assert('responded_at set', row.responded_at !== undefined);
}

// ── Case 5b: Cascade succeeds at MEDIUM (HIGH 404 → MEDIUM ok) ────────────
{
  const supabase = makeFakeSupabase();
  const clientCalls = [];
  const client = {
    buildingInsights: async (args) => {
      clientCalls.push(args);
      if (args.requiredQuality === 'HIGH')   return { ok: false, source: 'live', status: 404, error: 'not found' };
      if (args.requiredQuality === 'MEDIUM') return { ok: true,  source: 'live', data: { ...okResponse, imageryQuality: 'MEDIUM' } };
      return { ok: false, source: 'live', status: 404, error: 'should not reach LOW' };
    },
  };
  const analyser = createAnalyser({
    supabase, featureEnabled: true, client, quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e5b', address: '5b Suburb Rd', ...AKL });
  assert('cascade MEDIUM: status=ok', r.status === 'ok');
  assert('cascade MEDIUM: 2 client calls', clientCalls.length === 2);
  assert('cascade MEDIUM: 1st call was HIGH', clientCalls[0].requiredQuality === 'HIGH');
  assert('cascade MEDIUM: 2nd call was MEDIUM', clientCalls[1].requiredQuality === 'MEDIUM');
  const [row] = supabase._peek();
  assert('cascade MEDIUM: row imagery_quality=MEDIUM (from Google response)', row.imagery_quality === 'MEDIUM');
}

// ── Case 5c: Cascade succeeds at LOW (HIGH 404 → MEDIUM 404 → LOW ok) ─────
{
  const supabase = makeFakeSupabase();
  const clientCalls = [];
  const client = {
    buildingInsights: async (args) => {
      clientCalls.push(args);
      if (args.requiredQuality === 'LOW') return { ok: true, source: 'live', data: { ...okResponse, imageryQuality: 'LOW' } };
      return { ok: false, source: 'live', status: 404, error: 'not found' };
    },
  };
  const analyser = createAnalyser({
    supabase, featureEnabled: true, client, quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e5c', address: '5c Rural Rd', ...AKL });
  assert('cascade LOW: status=ok', r.status === 'ok');
  assert('cascade LOW: 3 client calls', clientCalls.length === 3);
  assert('cascade LOW: tiers tried HIGH→MEDIUM→LOW',
    clientCalls[0].requiredQuality === 'HIGH' &&
    clientCalls[1].requiredQuality === 'MEDIUM' &&
    clientCalls[2].requiredQuality === 'LOW');
}

// ── Case 6: All 3 tiers 404 → failed with no-coverage-at-any-quality ──────
{
  const supabase = makeFakeSupabase();
  const clientCalls = [];
  const client = { buildingInsights: async (args) => { clientCalls.push(args); return { ok: false, source: 'live', status: 404, error: 'No building found.' }; } };
  const analyser = createAnalyser({
    supabase, featureEnabled: true, client, quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e6', address: '6 Middle Of Nowhere', ...AKL });
  assert('all-404 cascade returns failed', r.status === 'failed');
  assert('all-404 cascade tried all 3 tiers', clientCalls.length === 3);
  const [row] = supabase._peek();
  assert('error prefixed no-coverage-at-any-quality', row.error_message?.startsWith('no-coverage-at-any-quality'));
  assert('error mentions attempted tiers', row.error_message?.includes('HIGH→MEDIUM→LOW'));
  assert('lat/lng preserved on failure', row.latitude === -36.85);
}

// ── Case 6b: Quota exhausts mid-cascade → stops early ─────────────────────
{
  const supabase = makeFakeSupabase();
  const clientCalls = [];
  const client = { buildingInsights: async (args) => { clientCalls.push(args); return { ok: false, source: 'live', status: 404, error: 'not found' }; } };
  let quotaCall = 0;
  const quotaTracker = {
    reserveQuota: async () => {
      quotaCall++;
      // 1st + 2nd allowed, 3rd denied — cascade should stop before LOW attempt
      if (quotaCall <= 2) return { allowed: true, callCount: quotaCall, quota: 1000 };
      return { allowed: false, reason: 'quota_exhausted', callCount: 1000, quota: 1000 };
    },
  };
  const analyser = createAnalyser({
    supabase, featureEnabled: true, client, quotaTracker,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e6b', address: '6b Rural Rd', ...AKL });
  assert('cascade+quota-exhaust: returns failed (not skipped_quota since first call succeeded)', r.status === 'failed');
  assert('cascade+quota-exhaust: only 2 client calls (LOW blocked by quota)', clientCalls.length === 2);
}

// ── Case 7: Client 500 on HIGH → failed, no retry (non-404 is terminal) ───
{
  const supabase = makeFakeSupabase();
  const clientCalls = [];
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async (args) => { clientCalls.push(args); return { ok: false, source: 'live', status: 500, error: 'Server error' }; } },
    quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e7', address: '7 Server Down St', ...AKL });
  assert('5xx returns failed', r.status === 'failed');
  assert('5xx no retry (single call)', clientCalls.length === 1);
  const [row] = supabase._peek();
  assert('error prefixed api-500', row.error_message?.startsWith('api-500'));
}

// ── Case 8: Client throws → failed with client-exception ────────────────────
{
  const supabase = makeFakeSupabase();
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => { throw new Error('unexpected'); } },
    quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e8', address: '8 Boom St', ...AKL });
  assert('client throw returns failed', r.status === 'failed');
  const [row] = supabase._peek();
  assert('error prefixed client-exception', row.error_message?.startsWith('client-exception'));
}

// ── Case 9: Boundary — missing enquiryId or address throws ────────────────
{
  const supabase = makeFakeSupabase();
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => ({ ok: true, data: okResponse }) },
    quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  let threw = false;
  try { await analyser.analyseRoof({ address: 'x', ...AKL }); } catch { threw = true; }
  assert('missing enquiryId throws', threw === true);
  threw = false;
  try { await analyser.analyseRoof({ enquiryId: 'e9', ...AKL }); } catch { threw = true; }
  assert('missing address throws', threw === true);
}

// ── Case 10: Factory rejects missing deps ───────────────────────────────────
{
  let threw = false;
  try { createAnalyser({ client: {}, quotaTracker: {} }); } catch { threw = true; }
  assert('factory throws without supabase', threw === true);
  threw = false;
  try { createAnalyser({ supabase: {}, quotaTracker: {} }); } catch { threw = true; }
  assert('factory throws without client', threw === true);
  threw = false;
  try { createAnalyser({ supabase: {}, client: {} }); } catch { threw = true; }
  assert('factory throws without quotaTracker', threw === true);
}

// ── Phase 2 imagery cases (Commit P) ───────────────────────────────────────
// These verify the imagery follow-up: after buildingInsights success,
// analyseRoof invokes roofImagery.fetchAndStoreRoofImage and stores its
// result on the row without ever failing the parent analysis.

const stubAllowedQuotaDual = {
  reserveQuota: async (endpoint) => ({ allowed: true, callCount: 1, quota: 1000, endpoint }),
};

// ── Case IMG-1: Imagery success → row gets roof_image_* columns set ────────
{
  const supabase = makeFakeSupabase();
  const NOW_IMG = () => new Date('2026-08-01T10:00:00Z');
  const roofImagery = {
    fetchAndStoreRoofImage: async () => ({
      ok: true, storagePath: 'e-img/rgb.png', storageBucket: 'roof-images',
      sizeBytes: 12345, imageryQuality: 'MEDIUM', imageryDate: { year: 2024, month: 5, day: 15 },
    }),
  };
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => ({ ok: true, source: 'live', data: okResponse }) },
    quotaTracker: stubAllowedQuotaDual,
    roofImagery,
    now: NOW_IMG, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e-img', address: '1 Img St', ...AKL });
  assert('imagery success: outer returns ok', r.status === 'ok');
  const [row] = supabase._peek();
  assert('imagery success: primary status still ok', row.status === 'ok');
  assert('imagery success: roof_image_storage_path set', row.roof_image_storage_path === 'e-img/rgb.png');
  assert('imagery success: roof_image_storage_bucket set', row.roof_image_storage_bucket === 'roof-images');
  assert('imagery success: roof_image_fetched_at set', row.roof_image_fetched_at !== undefined);
  assert('imagery success: no error message', row.roof_image_error_message === undefined);
}

// ── Case IMG-2: Imagery quota denied → error message set, not fatal ────────
{
  const supabase = makeFakeSupabase();
  const quotaTracker = {
    reserveQuota: async (endpoint) => {
      if (endpoint === 'buildingInsights') return { allowed: true, callCount: 1, quota: 1000 };
      if (endpoint === 'dataLayers') return { allowed: false, reason: 'quota_exhausted', callCount: 500, quota: 500 };
      return { allowed: true, callCount: 1, quota: 1000 };
    },
  };
  let imageryCalled = false;
  const roofImagery = {
    fetchAndStoreRoofImage: async () => { imageryCalled = true; return { ok: true }; },
  };
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => ({ ok: true, source: 'live', data: okResponse }) },
    quotaTracker, roofImagery, now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e-img-q', address: 'q', ...AKL });
  assert('imagery quota-denied: outer still ok', r.status === 'ok');
  const [row] = supabase._peek();
  assert('imagery quota-denied: primary status ok', row.status === 'ok');
  assert('imagery quota-denied: roof_image_error_message set', row.roof_image_error_message?.startsWith('imagery-quota-exhausted'));
  assert('imagery quota-denied: fetcher NOT called', imageryCalled === false);
  assert('imagery quota-denied: no storage path set', row.roof_image_storage_path === undefined);
}

// ── Case IMG-3: Imagery fetcher returns non-ok → error message set ────────
{
  const supabase = makeFakeSupabase();
  const roofImagery = {
    fetchAndStoreRoofImage: async () => ({
      ok: false, reason: 'tile-fetch-500', error: 'server error',
    }),
  };
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => ({ ok: true, source: 'live', data: okResponse }) },
    quotaTracker: stubAllowedQuotaDual, roofImagery,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e-img-f', address: 'f', ...AKL });
  assert('imagery fail: outer still ok', r.status === 'ok');
  const [row] = supabase._peek();
  assert('imagery fail: primary status ok', row.status === 'ok');
  assert('imagery fail: error message includes reason prefix', row.roof_image_error_message?.startsWith('imagery-tile-fetch-500'));
  assert('imagery fail: error message includes original error', row.roof_image_error_message?.includes('server error'));
}

// ── Case IMG-4: Imagery fetcher throws → error message set ─────────────────
{
  const supabase = makeFakeSupabase();
  const roofImagery = {
    fetchAndStoreRoofImage: async () => { throw new Error('unexpected crash'); },
  };
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => ({ ok: true, source: 'live', data: okResponse }) },
    quotaTracker: stubAllowedQuotaDual, roofImagery,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e-img-t', address: 't', ...AKL });
  assert('imagery throw: outer still ok', r.status === 'ok');
  const [row] = supabase._peek();
  assert('imagery throw: error message includes throw prefix', row.roof_image_error_message?.startsWith('imagery-fetcher-throw'));
  assert('imagery throw: error includes original message', row.roof_image_error_message?.includes('unexpected crash'));
}

// ── Case IMG-5: roofImagery NOT injected → imagery step skipped entirely ──
{
  const supabase = makeFakeSupabase();
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => ({ ok: true, source: 'live', data: okResponse }) },
    quotaTracker: stubAllowedQuota,
    // roofImagery deliberately omitted — should not throw, imagery just skipped
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e-img-none', address: 'none', ...AKL });
  assert('no imagery dep: outer still ok (backward compat)', r.status === 'ok');
  const [row] = supabase._peek();
  assert('no imagery dep: no roof_image_* columns touched', row.roof_image_storage_path === undefined && row.roof_image_error_message === undefined);
}

// ── Case IMG-6: Imagery does NOT run when buildingInsights failed ─────────
{
  const supabase = makeFakeSupabase();
  let imageryCalled = false;
  const roofImagery = { fetchAndStoreRoofImage: async () => { imageryCalled = true; return { ok: true }; } };
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => ({ ok: false, source: 'live', status: 404, error: 'no data' }) },
    quotaTracker: stubAllowedQuotaDual, roofImagery,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e-img-bf', address: 'bf', ...AKL });
  assert('BI failed → outer status failed', r.status === 'failed');
  assert('BI failed → imagery NOT attempted', imageryCalled === false);
}

// ── Case 11: parseBuildingInsightsResponse — direct unit test ──────────────
{
  const parsed = parseBuildingInsightsResponse(okResponse);
  assert('parse: imagery_quality', parsed.imagery_quality === 'HIGH');
  assert('parse: date formatted', parsed.imagery_date === '2024-05-15');
  assert('parse: carbon converted (0.421)', parsed.carbon_offset_factor_kg_per_kwh === 0.421);
  assert('parse: segments length', parsed.roof_segments.length === 2);
}
{
  const parsed = parseBuildingInsightsResponse({});
  assert('parse empty: quality null', parsed.imagery_quality === null);
  assert('parse empty: date null', parsed.imagery_date === null);
  assert('parse empty: panels null', parsed.max_array_panels_count === null);
  assert('parse empty: segments []', Array.isArray(parsed.roof_segments) && parsed.roof_segments.length === 0);
}
{
  const parsed = parseBuildingInsightsResponse({ solarPotential: { carbonOffsetFactorKgPerMwh: 0 } });
  assert('parse: 0 carbon → 0 not null', parsed.carbon_offset_factor_kg_per_kwh === 0);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

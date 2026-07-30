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

// ── Case 5: Happy path — full analysis stored ok with parsed fields ────────
{
  const supabase = makeFakeSupabase();
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => ({ ok: true, source: 'live', data: okResponse }) },
    quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e5', address: '5 Happy Path Cres', contactId: 'c5', ...AKL });
  assert('happy path returns ok', r.status === 'ok');
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

// ── Case 6: Client 404 → failed with no-building-at-location ────────────────
{
  const supabase = makeFakeSupabase();
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => ({ ok: false, source: 'live', status: 404, error: 'No building found.' }) },
    quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e6', address: '6 Middle Of Nowhere', ...AKL });
  assert('404 returns failed', r.status === 'failed');
  const [row] = supabase._peek();
  assert('error prefixed no-building-at-location', row.error_message?.startsWith('no-building-at-location'));
  assert('lat/lng preserved on failure', row.latitude === -36.85);
}

// ── Case 7: Client 500 → failed with api-500 prefix ────────────────────────
{
  const supabase = makeFakeSupabase();
  const analyser = createAnalyser({
    supabase, featureEnabled: true,
    client:       { buildingInsights: async () => ({ ok: false, source: 'live', status: 500, error: 'Server error' }) },
    quotaTracker: stubAllowedQuota,
    now: NOW, logger: silentLogger,
  });
  const r = await analyser.analyseRoof({ enquiryId: 'e7', address: '7 Server Down St', ...AKL });
  assert('5xx returns failed', r.status === 'failed');
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

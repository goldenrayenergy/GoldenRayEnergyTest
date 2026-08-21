// ────────────────────────────────────────────────────────────────────────────
// test-google-solar-quota.mjs
//
// Offline unit tests for services/googleSolar/quotaTracker.js.
// Uses an in-memory fake Supabase client to test observable behaviour
// (Rule 5 — test behaviour, not implementation).
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import { createQuotaTracker, monthKey } from '../services/googleSolar/quotaTracker.js';

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push({ label, detail });
    console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`);
  }
}

console.log('test-google-solar-quota\n');

// ── Fake Supabase client — mirrors the small subset of the API we use ──────
// Implements: .from(table).select('*').eq(k,v).eq(k,v).maybeSingle() /
// .from(table).insert(row).select().single() /
// .from(table).update(patch).eq(k,v).select().single() (and without .select())
function makeFakeSupabase(seed = []) {
  const rows = [...seed];
  let nextId = seed.length + 1;

  function fromTable(_table) {
    let filters = [];
    let mode = null;           // 'select' | 'insert' | 'update'
    let insertRow = null;
    let updatePatch = null;
    const chain = {
      select() { mode = mode || 'select'; return chain; },
      eq(k, v) { filters.push([k, v]); return chain; },
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
        if (mode === 'update') {
          const match = rows.find(r => filters.every(([k, v]) => r[k] === v));
          if (!match) return { data: null, error: { message: 'not found' } };
          Object.assign(match, updatePatch);
          return { data: match, error: null };
        }
        const match = rows.find(r => filters.every(([k, v]) => r[k] === v));
        return { data: match || null, error: null };
      },
      // update() without a follow-up .select().single() is used by the
      // admin_notified_at write. Await'ing the chain returns { error }.
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
  return {
    from: fromTable,
    _peek: () => rows,           // test helper
  };
}

// Silent logger to keep test output tidy
const silentLogger = { warn: () => {}, error: () => {} };

// ── Case 1: First call of month creates row with count=1 ────────────────────
{
  const supabase = makeFakeSupabase();
  const tracker = createQuotaTracker({
    supabase,
    monthlyQuota: 100,
    alertAtPct: 80,
    now: () => new Date('2026-07-15T10:00:00Z'),
    notifyAdmin: async () => {},
    logger: silentLogger,
  });
  const r = await tracker.reserveQuota('buildingInsights');
  assert('first call allowed', r.allowed === true);
  assert('first call count=1', r.callCount === 1);
  assert('first call quota=100', r.quota === 100);
  assert('first call isFirstOfMonth=true', r.isFirstOfMonth === true);
  const rows = supabase._peek();
  assert('exactly one row created', rows.length === 1);
  assert('row yyyy_mm=2026-07', rows[0].yyyy_mm === '2026-07');
  assert('row endpoint=buildingInsights', rows[0].endpoint === 'buildingInsights');
  assert('row call_count=1', rows[0].call_count === 1);
  assert('row quota_limit=100', rows[0].quota_limit === 100);
}

// ── Case 2: Second call increments to count=2 ───────────────────────────────
{
  const supabase = makeFakeSupabase([
    { id: 'x', yyyy_mm: '2026-07', endpoint: 'buildingInsights', call_count: 1, quota_limit: 100, admin_notified_at: null },
  ]);
  const tracker = createQuotaTracker({
    supabase, monthlyQuota: 100, alertAtPct: 80,
    now: () => new Date('2026-07-15T11:00:00Z'),
    notifyAdmin: async () => {}, logger: silentLogger,
  });
  const r = await tracker.reserveQuota('buildingInsights');
  assert('second call allowed', r.allowed === true);
  assert('second call count=2', r.callCount === 2);
  assert('second call isFirstOfMonth=false', r.isFirstOfMonth === false);
  assert('row call_count now 2', supabase._peek()[0].call_count === 2);
}

// ── Case 3: Under quota but crossing alert threshold fires notify ──────────
{
  const supabase = makeFakeSupabase([
    { id: 'x', yyyy_mm: '2026-07', endpoint: 'buildingInsights', call_count: 79, quota_limit: 100, admin_notified_at: null },
  ]);
  let notifyCalledWith = null;
  const tracker = createQuotaTracker({
    supabase, monthlyQuota: 100, alertAtPct: 80,
    now: () => new Date('2026-07-15T12:00:00Z'),
    notifyAdmin: async (payload) => { notifyCalledWith = payload; },
    logger: silentLogger,
  });
  const r = await tracker.reserveQuota('buildingInsights');
  assert('crossing 80% allowed', r.allowed === true);
  assert('crossing 80% count=80', r.callCount === 80);
  // notifyAdmin is fired via Promise.resolve().then — let microtasks drain
  await new Promise(res => setImmediate(res));
  assert('notifyAdmin called', notifyCalledWith !== null);
  assert('notify payload has endpoint', notifyCalledWith?.endpoint === 'buildingInsights');
  assert('notify payload has callCount=80', notifyCalledWith?.callCount === 80);
  assert('notify payload has quota=100', notifyCalledWith?.quota === 100);
  assert('admin_notified_at now set', supabase._peek()[0].admin_notified_at !== null);
}

// ── Case 4: Once notified, next call does NOT re-notify ────────────────────
{
  const supabase = makeFakeSupabase([
    { id: 'x', yyyy_mm: '2026-07', endpoint: 'buildingInsights', call_count: 85, quota_limit: 100, admin_notified_at: '2026-07-15T12:00:00Z' },
  ]);
  let notifyCalls = 0;
  const tracker = createQuotaTracker({
    supabase, monthlyQuota: 100, alertAtPct: 80,
    now: () => new Date('2026-07-15T13:00:00Z'),
    notifyAdmin: async () => { notifyCalls++; },
    logger: silentLogger,
  });
  const r = await tracker.reserveQuota('buildingInsights');
  assert('post-notify call allowed', r.allowed === true);
  assert('post-notify count=86', r.callCount === 86);
  await new Promise(res => setImmediate(res));
  assert('notifyAdmin NOT re-fired', notifyCalls === 0);
}

// ── Case 5: At quota limit → denied, no increment, reason=quota_exhausted ──
{
  const supabase = makeFakeSupabase([
    { id: 'x', yyyy_mm: '2026-07', endpoint: 'buildingInsights', call_count: 100, quota_limit: 100, admin_notified_at: '2026-07-15T12:00:00Z' },
  ]);
  const tracker = createQuotaTracker({
    supabase, monthlyQuota: 100, alertAtPct: 80,
    now: () => new Date('2026-07-15T14:00:00Z'),
    notifyAdmin: async () => {}, logger: silentLogger,
  });
  const r = await tracker.reserveQuota('buildingInsights');
  assert('at cap denied', r.allowed === false);
  assert('at cap reason=quota_exhausted', r.reason === 'quota_exhausted');
  assert('at cap callCount reported', r.callCount === 100);
  assert('at cap quota reported', r.quota === 100);
  assert('at cap row unchanged', supabase._peek()[0].call_count === 100);
}

// ── Case 6: New month → new row created (rollover) ─────────────────────────
{
  const supabase = makeFakeSupabase([
    { id: 'x', yyyy_mm: '2026-06', endpoint: 'buildingInsights', call_count: 100, quota_limit: 100, admin_notified_at: '2026-06-15T12:00:00Z' },
  ]);
  const tracker = createQuotaTracker({
    supabase, monthlyQuota: 100, alertAtPct: 80,
    now: () => new Date('2026-07-01T00:00:01Z'),
    notifyAdmin: async () => {}, logger: silentLogger,
  });
  const r = await tracker.reserveQuota('buildingInsights');
  assert('new month allowed', r.allowed === true);
  assert('new month isFirstOfMonth=true', r.isFirstOfMonth === true);
  assert('new month count=1', r.callCount === 1);
  const rows = supabase._peek();
  assert('two rows now exist (old + new)', rows.length === 2);
  assert('new row is 2026-07', rows.find(r => r.yyyy_mm === '2026-07') !== undefined);
}

// ── Case 7: Different endpoints tracked independently within same month ────
{
  const supabase = makeFakeSupabase();
  const tracker = createQuotaTracker({
    supabase, monthlyQuota: 100, alertAtPct: 80,
    now: () => new Date('2026-07-15T15:00:00Z'),
    notifyAdmin: async () => {}, logger: silentLogger,
  });
  await tracker.reserveQuota('buildingInsights');
  await tracker.reserveQuota('dataLayers');
  const rows = supabase._peek();
  assert('two rows (one per endpoint)', rows.length === 2);
  assert('buildingInsights row exists', rows.find(r => r.endpoint === 'buildingInsights') !== undefined);
  assert('dataLayers row exists', rows.find(r => r.endpoint === 'dataLayers') !== undefined);
}

// ── Case 8: Endpoint arg validation ─────────────────────────────────────────
{
  const supabase = makeFakeSupabase();
  const tracker = createQuotaTracker({
    supabase, monthlyQuota: 100, alertAtPct: 80,
    now: () => new Date('2026-07-15T16:00:00Z'),
    notifyAdmin: async () => {}, logger: silentLogger,
  });
  let threw = false;
  try { await tracker.reserveQuota(); } catch { threw = true; }
  assert('missing endpoint throws', threw === true);
  threw = false;
  try { await tracker.reserveQuota(''); } catch { threw = true; }
  assert('empty endpoint throws', threw === true);
}

// ── Case 9: monthKey formatting ─────────────────────────────────────────────
{
  assert('monthKey Jan pads to 01', monthKey(new Date('2026-01-15T10:00:00Z')) === '2026-01');
  assert('monthKey Dec no pad artifact', monthKey(new Date('2026-12-31T10:00:00Z')) === '2026-12');
  assert('monthKey UTC-based (crossing NZ midnight)',
    monthKey(new Date('2026-07-31T23:59:59Z')) === '2026-07');
}

// ── Case 10: Factory rejects missing supabase ───────────────────────────────
{
  let threw = false;
  try { createQuotaTracker({}); } catch { threw = true; }
  assert('factory throws without supabase', threw === true);
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

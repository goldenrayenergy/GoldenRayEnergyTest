// Unit tests for the Supabase-backed quote rate limiter (2026-08-31 rewrite).
// Locks down policy behaviour so regressions surface immediately in CI:
//   • 3 unique addresses per IP per day
//   • Same address repeated same-day → free
//   • Admin cookie bypass → unlimited
//   • Cross-IP isolation
//   • Fail-open on Supabase read errors
//   • Fail-open when supabase client is null/absent
//   • addressKey() derives 'pid:<x>' from place_id, 'coord:<lat>,<lng>' otherwise
//   • 4dp coord rounding: nudges within the same 4dp bucket dedupe;
//     crossing a bucket boundary counts as a new address
//
// Uses `createQuoteRateLimit(mock)` factory so we can inject an in-memory
// mock supabase client without fighting ESM module immutability.
//
// Run:  node server/scripts/test-quote-rate-limit.mjs

import { addressKey, createQuoteRateLimit } from '../middleware/quoteRateLimit.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};

// ── Mock supabase client ──────────────────────────────────────────────────
function makeMockSupabase({ readError = null, writeError = null } = {}) {
  const rows = new Map();
  function rowKey(ip, nz_date, address_key) { return `${ip}|${nz_date}|${address_key}`; }
  return {
    _rows: rows,
    _setReadError(e) { readError = e; },
    _setWriteError(e) { writeError = e; },
    from(_table) {
      let filters = {};
      const q = {
        select(_cols) { return q; },
        eq(col, val) { filters[col] = val; return q; },
        upsert(row, _opts) {
          if (writeError) return Promise.resolve({ error: writeError });
          rows.set(rowKey(row.ip, row.nz_date, row.address_key), row);
          return Promise.resolve({ error: null });
        },
        delete() {
          return {
            gt() {
              rows.clear();
              return Promise.resolve({ error: null });
            },
            lt() {
              rows.clear();
              return Promise.resolve({ error: null });
            },
          };
        },
        then(resolve) {
          if (readError) { resolve({ data: null, error: readError }); return; }
          const matched = [];
          for (const r of rows.values()) {
            let ok = true;
            for (const [k, v] of Object.entries(filters)) {
              if (r[k] !== v) { ok = false; break; }
            }
            if (ok) matched.push({ address_key: r.address_key });
          }
          resolve({ data: matched, error: null });
        },
      };
      return q;
    },
  };
}

async function callMiddleware(mw, { ip, cookies = '', body = {} } = {}) {
  const req = { ip, headers: { cookie: cookies }, body };
  const res = {
    _status: 200, _body: null,
    status(s) { this._status = s; return this; },
    json(b)   { this._body = b; return this; },
  };
  let calledNext = false;
  await mw(req, res, () => { calledNext = true; });
  return { status: res._status, body: res._body, calledNext };
}

// ────────────────────────────────────────────────────────────────────────
console.log('\n══ addressKey() derivation ══');
{
  assert(addressKey({ place_id: 'abc' }) === 'pid:abc',
    'place_id → pid:<id>');
  assert(addressKey({ latitude: -36.85, longitude: 174.75 }) === 'coord:-36.8500,174.7500',
    'lat/lng → coord:<lat>,<lng> (4dp)');
  assert(addressKey({ lat_override: -36.85, lng_override: 174.75 }) === 'coord:-36.8500,174.7500',
    'lat_override/lng_override fallback works');
  assert(addressKey({}) === 'unknown',
    'empty body → unknown');
  // Same 4dp bucket → dedupe (nudge is < 0.00005 of bucket boundary)
  const k1 = addressKey({ latitude: -36.85001, longitude: 174.75001 });
  const k2 = addressKey({ latitude: -36.85004, longitude: 174.75004 });
  assert(k1 === k2, 'nudges within the same 4dp bucket dedupe');
  // Crossing a bucket boundary → distinct keys (documented behaviour)
  const k3 = addressKey({ latitude: -36.8500, longitude: 174.7500 });
  const k4 = addressKey({ latitude: -36.8501, longitude: 174.7501 });
  assert(k3 !== k4, 'nudges across a 4dp boundary count as new address');
}

console.log('\n══ Policy: 3 addresses/day per IP ══');
{
  const mock = makeMockSupabase();
  const mw = createQuoteRateLimit(mock);
  const r1 = await callMiddleware(mw, { ip: '1.1.1.1', body: { place_id: 'A' } });
  assert(r1.calledNext && r1.status === 200, 'address 1 (new) → allowed');
  const r2 = await callMiddleware(mw, { ip: '1.1.1.1', body: { place_id: 'B' } });
  assert(r2.calledNext && r2.status === 200, 'address 2 (new) → allowed');
  const r3 = await callMiddleware(mw, { ip: '1.1.1.1', body: { place_id: 'C' } });
  assert(r3.calledNext && r3.status === 200, 'address 3 (new) → allowed');
  const r4 = await callMiddleware(mw, { ip: '1.1.1.1', body: { place_id: 'D' } });
  assert(!r4.calledNext && r4.status === 429, 'address 4 (new) → 429');
  assert(r4.body?.quotes_used_today === 3, '429 body reports quotes_used_today=3');
  assert(r4.body?.max_per_day === 3, '429 body reports max_per_day=3');
  assert(typeof r4.body?.book_survey_url === 'string', '429 body includes book_survey_url');
  assert(typeof r4.body?.reset_at_iso === 'string', '429 body includes reset_at_iso');
}

console.log('\n══ Repeat address today → free ══');
{
  const mock = makeMockSupabase();
  const mw = createQuoteRateLimit(mock);
  await callMiddleware(mw, { ip: '2.2.2.2', body: { place_id: 'X' } });
  await callMiddleware(mw, { ip: '2.2.2.2', body: { place_id: 'Y' } });
  await callMiddleware(mw, { ip: '2.2.2.2', body: { place_id: 'Z' } });
  // At cap. Repeat X — free.
  const rRepeat = await callMiddleware(mw, { ip: '2.2.2.2', body: { place_id: 'X' } });
  assert(rRepeat.calledNext && rRepeat.status === 200,
    'repeat same address after cap → free (customer refining own quote)');
  // 4th UNIQUE → blocked
  const rNew = await callMiddleware(mw, { ip: '2.2.2.2', body: { place_id: 'W' } });
  assert(!rNew.calledNext && rNew.status === 429, '4th UNIQUE address after cap → 429');
}

console.log('\n══ Admin cookie bypass ══');
{
  const mock = makeMockSupabase();
  const mw = createQuoteRateLimit(mock);
  let allowed = 0;
  for (let i = 0; i < 10; i++) {
    const r = await callMiddleware(mw, {
      ip: '3.3.3.3', cookies: 'gr-admin-bypass=1', body: { place_id: `addr${i}` },
    });
    if (r.calledNext) allowed++;
  }
  assert(allowed === 10, 'admin cookie → 10/10 addresses allowed (unlimited)');
  assert(mock._rows.size === 0, 'admin cookie bypass → zero DB writes');
}

console.log('\n══ Per-IP isolation ══');
{
  const mock = makeMockSupabase();
  const mw = createQuoteRateLimit(mock);
  await callMiddleware(mw, { ip: '4.4.4.4', body: { place_id: 'A1' } });
  await callMiddleware(mw, { ip: '4.4.4.4', body: { place_id: 'A2' } });
  await callMiddleware(mw, { ip: '4.4.4.4', body: { place_id: 'A3' } });
  const capped = await callMiddleware(mw, { ip: '4.4.4.4', body: { place_id: 'A4' } });
  assert(capped.status === 429, 'IP 4.4.4.4 hits cap at 4th address');
  const b1 = await callMiddleware(mw, { ip: '5.5.5.5', body: { place_id: 'B1' } });
  assert(b1.calledNext, 'IP 5.5.5.5 unaffected by IP 4.4.4.4 being capped');
}

console.log('\n══ Fail-open on DB read error ══');
{
  const mock = makeMockSupabase({ readError: { message: 'simulated DB outage' } });
  const mw = createQuoteRateLimit(mock);
  const r = await callMiddleware(mw, { ip: '6.6.6.6', body: { place_id: 'Z' } });
  assert(r.calledNext && r.status === 200,
    'Supabase read error → request allowed (fail-open, better than blocking quote flow)');
}

console.log('\n══ Fail-open when supabase client is null ══');
{
  const mw = createQuoteRateLimit(null);
  const r = await callMiddleware(mw, { ip: '7.7.7.7', body: { place_id: 'Z' } });
  assert(r.calledNext && r.status === 200,
    'null supabase → request allowed (fail-open)');
}

console.log('\n══ Cross-day isolation ══');
{
  // We can simulate a different day by pre-populating yesterday's rows;
  // middleware queries by today's date so those rows shouldn't count.
  const mock = makeMockSupabase();
  const yesterday = '2020-01-01';   // safely in the past
  mock._rows.set('9.9.9.9|' + yesterday + '|X', { ip: '9.9.9.9', nz_date: yesterday, address_key: 'X' });
  mock._rows.set('9.9.9.9|' + yesterday + '|Y', { ip: '9.9.9.9', nz_date: yesterday, address_key: 'Y' });
  mock._rows.set('9.9.9.9|' + yesterday + '|Z', { ip: '9.9.9.9', nz_date: yesterday, address_key: 'Z' });
  const mw = createQuoteRateLimit(mock);
  // Today's first request should still be allowed
  const r = await callMiddleware(mw, { ip: '9.9.9.9', body: { place_id: 'TODAY1' } });
  assert(r.calledNext && r.status === 200,
    'yesterdays 3 addresses do NOT block today (cross-day reset)');
}

console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━`);
if (fail > 0) process.exit(1);

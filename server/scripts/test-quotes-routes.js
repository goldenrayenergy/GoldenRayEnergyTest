// ────────────────────────────────────────────────────────────────────────────
// Day-4 routes — behaviour test with stub Supabase
//
// Exercises the full happy path + key failure modes against /api/pm/quotes
// without needing a real database. The stub captures every read/write so we
// can assert on the state that WOULD have been persisted.
//
// Run:  node server/scripts/test-quotes-routes.js
// ────────────────────────────────────────────────────────────────────────────

import express from 'express';
import jwt from 'jsonwebtoken';
import http from 'node:http';

// ── Stub supabaseAdmin BEFORE the route module is imported ────────────────
// Use Node ESM hooks via dynamic import after monkey-patching the config module.
// Simplest path: write to the global, then re-route in config/supabase.js via
// dynamic patching. Cleaner: build a fresh tiny stub and inject via import.

const stub = makeStub();

// Import the route module and inject our stub via the test seam.
const quotesModule = await import('../routes/pm/quotes.js');
quotesModule.__setSupabaseForTests(stub);
const quotesRoutes = quotesModule.default;

// ── Test users ────────────────────────────────────────────────────────────
// Read the actual JWT secret the middleware uses, so tokens validate.
const { default: env } = await import('../config/env.js');
const JWT_SECRET = env.jwt.secret;
function tokenFor(user) { return jwt.sign(user, JWT_SECRET); }
const REP = { id: 'user-rep-1', email: 'rep@gripl.co', role: 'sales_exec' };
const ADMIN = { id: 'user-admin-1', email: 'admin@gripl.co', role: 'admin' };

// ── Seed the stub with a contact ──────────────────────────────────────────
const CONTACT_ID = '00000000-0000-0000-0000-000000000001';
stub.tables.get('contacts').set(CONTACT_ID, {
  id: CONTACT_ID,
  name: 'Mr Naga Sai Krishna Avala',
  email: 'krishna@example.com',
  phone: '+64 21 000 0000',
});

// ── Boot the app ──────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use('/api/pm/quotes', quotesRoutes);
const server = http.createServer(app);
await new Promise(r => server.listen(0, r));
const port = server.address().port;

// ── Assertions ────────────────────────────────────────────────────────────
let pass = 0, fail = 0; const failures = [];
function check(label, cond, hint = '') {
  const mark = cond ? '✓' : '✗';
  console.log(`  ${mark} ${label}${cond ? '' : ' — ' + hint}`);
  if (cond) pass++; else { fail++; failures.push({ label, hint }); }
}
function section(t) { console.log(); console.log('━'.repeat(80)); console.log('  ' + t); console.log('━'.repeat(80)); }

async function req(method, path, { body, user } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      hostname: '127.0.0.1', port, path: `/api/pm${path}`, method,
      headers: {
        'Content-Type': 'application/json',
        ...(user ? { Authorization: 'Bearer ' + tokenFor(user) } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ── Reference spec (clean — should pass engine cleanly) ───────────────────
function specWithPrice(price) {
  return {
    customer: {
      full_name: 'Mr Naga Sai Krishna Avala',
      email: 'krishna@example.com',
      phone: '+64 21 000 0000',
      address: { street: '6 Woodacre St', suburb: 'Flat Bush', city: 'Auckland', region: 'auckland_vector' },
      property_ownership: 'mortgaged',
    },
    bills: { manual_entry: { annual_kwh: 13044, annual_spend: 3825,
                             variable_rate_per_kwh_incl_gst: 0.223, daily_fixed_charge_incl_gst: 2.52, buyback_rate: 0.09 }},
    system: {
      panel: { sku: 'PHN-PNL-595-DRC', count: 24 },
      inverter: { sku: 'FRN-INV-100-G24P-1P' },
      battery: { sku: 'BYD-BAT-276-HVM', module_count: 5 },
      smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
      string_topology: 'parallel',
      string_design: { panels_per_string: 6, string_count: 4 },
      cable_run_metres_estimate: 24,
      phase: 1,
    },
    pricing: { customer_price_inc_gst: price, stage: 'stage_1_estimate', final_mode: true,
               discount: { applied_nzd: 0, owner_approved: false, reason: null }},
    preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo',
                   financing: { choice: 'cash' }},
  };
}

console.log('━'.repeat(80));
console.log('  /api/pm/quotes — Day-4 route behaviour test');
console.log('━'.repeat(80));

// ── Auth gate ─────────────────────────────────────────────────────────────
section('Authentication & authorization');
{
  const r = await req('POST', '/quotes', { body: { contact_id: CONTACT_ID, spec: specWithPrice(50000) } });
  check('POST /quotes without token rejected (401)', r.status === 401, `got ${r.status}`);
}
{
  // Forbidden role (not in the allowed list — e.g. 'install_engineer')
  const r = await req('POST', '/quotes', { user: { id: 'u', role: 'install_engineer' },
                                            body: { contact_id: CONTACT_ID, spec: specWithPrice(50000) } });
  check('POST /quotes wrong role rejected (403)', r.status === 403, `got ${r.status}`);
}

// ── Create quote ──────────────────────────────────────────────────────────
section('Create + list + get');
let createdId, createdRef;
{
  const r = await req('POST', '/quotes', { user: REP, body: { contact_id: CONTACT_ID, spec: specWithPrice(50000) } });
  check('POST /quotes (clean spec, price $50k) → 201', r.status === 201, `got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  check('Response includes quote.quote_ref', !!r.body?.quote?.quote_ref, JSON.stringify(r.body).slice(0, 200));
  check('quote_ref format PR-AVALA-{year}-001', /^PR-AVALA-\d{4}-001$/.test(r.body?.quote?.quote_ref || ''), r.body?.quote?.quote_ref);
  check('Initial version is v1', r.body?.version?.version_number === 1, `got ${r.body?.version?.version_number}`);
  check('Initial version is_current = true', r.body?.version?.is_current === true);
  check('Margin floor reported as healthy at $50k', r.body?.engine?.margin_floor_status === 'healthy', `got ${r.body?.engine?.margin_floor_status}`);
  check('can_ship = true at $50k', r.body?.engine?.can_ship === true);
  check('3-scenario summary present', Array.isArray(r.body?.scenarios) && r.body.scenarios.length === 3);
  createdId = r.body?.quote?.id;
  createdRef = r.body?.quote?.quote_ref;
}
{
  // Empty spec is now ACCEPTED at create time (placeholder pattern). The
  // engine just reports config_errors in the response — actual blocking
  // happens at PATCH /spec and POST /generate.
  const r = await req('POST', '/quotes', { user: REP, body: { contact_id: CONTACT_ID, spec: { /* incomplete */ } } });
  check('POST /quotes with incomplete spec accepted (201)', r.status === 201, `got ${r.status}`);
  check('Response flags can_ship=false on incomplete spec', r.body?.engine?.can_ship === false);
  check('Response includes config_errors on incomplete spec',
        Array.isArray(r.body?.engine?.config_errors) && r.body.engine.config_errors.length > 0);
}
{
  const r = await req('POST', '/quotes', { user: REP, body: { contact_id: '00000000-0000-0000-0000-doesnotexist', spec: specWithPrice(50000) } });
  check('POST /quotes with missing contact → 404', r.status === 404, `got ${r.status}`);
}
{
  // After two preceding creates (clean spec → -001, incomplete spec → -002),
  // this third quote should land on -003.
  const r = await req('POST', '/quotes', { user: REP, body: { contact_id: CONTACT_ID, spec: specWithPrice(50000) } });
  check('Third quote ref increments to -003', /-003$/.test(r.body?.quote?.quote_ref || ''), `got ${r.body?.quote?.quote_ref}`);
}
{
  const r = await req('GET', '/quotes', { user: REP });
  check('GET /quotes list returns 200', r.status === 200, `got ${r.status}`);
  check('List contains both quotes (≥2)', Array.isArray(r.body) && r.body.length >= 2, `got ${r.body?.length}`);
}
{
  const r = await req('GET', `/quotes/${createdId}`, { user: REP });
  check('GET /quotes/:id returns 200', r.status === 200, `got ${r.status}`);
  check('GET /quotes/:id has current_version', !!r.body?.current_version);
  check('GET /quotes/:id has no pending_discount yet', r.body?.pending_discount === null);
}

// ── PATCH spec creates a new version, supersedes old ─────────────────────
section('PATCH spec / version bump');
{
  const r = await req('PATCH', `/quotes/${createdId}/spec`, { user: REP, body: { spec: specWithPrice(52000) } });
  check('PATCH /:id/spec → 200', r.status === 200, `got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  check('New version is v2', r.body?.version?.version_number === 2);
  check('New version is_current', r.body?.version?.is_current === true);
  check('Margin healthy at $52k', r.body?.engine?.margin_floor_status === 'healthy');
}
{
  const r = await req('GET', `/quotes/${createdId}/versions`, { user: REP });
  check('GET /:id/versions returns 200', r.status === 200);
  check('Versions list has 2 entries', Array.isArray(r.body) && r.body.length === 2, `got ${r.body?.length}`);
  const v1 = Array.isArray(r.body) ? r.body.find(v => v.version_number === 1) : null;
  check('v1 is_current = false (superseded)', v1?.is_current === false);
  check('v1 has superseded_at set', !!v1?.superseded_at);
}

// ── Validate endpoint ─────────────────────────────────────────────────────
section('Validate endpoint');
{
  const r = await req('POST', `/quotes/${createdId}/validate`, { user: REP });
  check('POST /:id/validate → 200', r.status === 200);
  check('Returns engine.engineering.passes', Array.isArray(r.body?.engine?.engineering?.passes));
  check('Returns 3 scenarios', r.body?.scenarios?.summary?.length === 3);
}

// ── Discount workflow ────────────────────────────────────────────────────
section('Discount approval workflow');
let discountReqId;
{
  // Drop price low so margin is below floor → request discount approval
  await req('PATCH', `/quotes/${createdId}/spec`, { user: REP, body: { spec: specWithPrice(50000) } });
  const r = await req('POST', `/quotes/${createdId}/discount-request`, {
    user: REP, body: { requested_amount_nzd: 12000, reason: 'Repeat customer, second install' },
  });
  check('POST /:id/discount-request → 201', r.status === 201, `got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  check('Returns projected_margin_pct', typeof r.body?.projected_margin_pct === 'number');
  check('Projected margin < 10% (below floor)', r.body?.projected_margin_pct < 10, `got ${r.body?.projected_margin_pct}`);
  discountReqId = r.body?.discount_request?.id;
}
{
  // Rep can't approve their own discount (admin-only)
  const r = await req('POST', `/quotes/${createdId}/discount-approve`, {
    user: REP, body: { decision: 'approved', discount_request_id: discountReqId },
  });
  check('Rep cannot approve discount (403)', r.status === 403, `got ${r.status}`);
}
{
  // Quote status was flipped to pending_owner_review
  const r = await req('GET', `/quotes/${createdId}`, { user: REP });
  check('Quote status flipped to pending_owner_review', r.body?.quote?.status === 'pending_owner_review', `got ${r.body?.quote?.status}`);
  check('GET surfaces pending_discount', r.body?.pending_discount?.id === discountReqId);
}
{
  // Admin rejects
  const r = await req('POST', `/quotes/${createdId}/discount-approve`, {
    user: ADMIN,
    body: { decision: 'rejected', discount_request_id: discountReqId, admin_notes: 'Above policy threshold' },
  });
  check('Admin can reject discount (200)', r.status === 200, `got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  check('Decision = rejected', r.body?.decision === 'rejected');
}
{
  // Quote returned to draft
  const r = await req('GET', `/quotes/${createdId}`, { user: REP });
  check('Quote status back to draft after rejection', r.body?.quote?.status === 'draft');
}
{
  // Raise a new request and approve it modified
  const r1 = await req('POST', `/quotes/${createdId}/discount-request`, {
    user: REP, body: { requested_amount_nzd: 8000, reason: 'Family of repeat customer' },
  });
  check('Second discount request → 201', r1.status === 201);
  const reqId = r1.body?.discount_request?.id;

  const r2 = await req('POST', `/quotes/${createdId}/discount-approve`, {
    user: ADMIN,
    body: { decision: 'approved_modified', approved_amount_nzd: 4000,
            discount_request_id: reqId, admin_notes: 'Approved at $4k cap' },
  });
  check('Approved at modified amount (200)', r2.status === 200);
  check('approved_amount_nzd = $4,000', r2.body?.approved_amount_nzd === 4000);
}
{
  const r = await req('GET', `/quotes/${createdId}`, { user: REP });
  check('Quote status now ready_to_generate', r.body?.quote?.status === 'ready_to_generate', `got ${r.body?.quote?.status}`);
  check('Current version has discount.owner_approved = true',
        r.body?.current_version?.spec?.pricing?.discount?.owner_approved === true);
  check('Current version applied discount = $4,000',
        r.body?.current_version?.spec?.pricing?.discount?.applied_nzd === 4000);
}

// ── DELETE / withdraw ────────────────────────────────────────────────────
section('Withdraw');
{
  const r = await req('DELETE', `/quotes/${createdId}`, { user: REP });
  check('DELETE /:id → 200', r.status === 200, `got ${r.status}`);
}
{
  const r = await req('GET', `/quotes/${createdId}`, { user: REP });
  check('Quote status = withdrawn after delete', r.body?.quote?.status === 'withdrawn');
}

// ── Audit log captured? ──────────────────────────────────────────────────
section('Audit trail');
const auditRows = [...stub.tables.get('quote_audit_log').values()].filter(r => r.quote_id === createdId);
check(`Audit log has entries for this quote (${auditRows.length} rows)`, auditRows.length >= 5);
const actions = new Set(auditRows.map(r => r.action));
for (const a of ['quote.created', 'spec.changed', 'validate.run', 'discount.requested', 'discount.approved', 'withdrawn']) {
  check(`Audit log contains "${a}"`, actions.has(a) || (a === 'discount.approved' && actions.has('discount.rejected')));
}

// ── Wrap up ──────────────────────────────────────────────────────────────
section('Summary');
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
server.close();
if (fail > 0) {
  for (const f of failures) console.log(`    ✗ ${f.label}  ${f.hint}`);
  process.exit(1);
}
console.log('  ✅ All Day-4 endpoints behave as expected.');

// ════════════════════════════════════════════════════════════════════════════
// Stub Supabase client — minimal in-memory implementation that supports the
// chained query shape used by the routes: from(table).select().eq().maybeSingle()
// + insert().select().single() + update().eq()
// ════════════════════════════════════════════════════════════════════════════
function makeStub() {
  const tables = new Map([
    ['contacts', new Map()],
    ['quotes', new Map()],
    ['quote_versions', new Map()],
    ['quote_audit_log', new Map()],
    ['discount_approvals', new Map()],
  ]);
  let seq = 1000;
  const newId = () => `id-${++seq}`;

  function from(tableName) {
    const t = tables.get(tableName);
    if (!t) throw new Error('Unknown table: ' + tableName);
    const ctx = { table: t, tableName, filters: [], orderBy: null, limit: null,
                  selectCols: '*', updateData: null, insertData: null, mode: 'select' };

    const matches = (row) => ctx.filters.every(f => {
      if (f.op === 'eq')    return row[f.col] === f.val;
      if (f.op === 'ilike') return typeof row[f.col] === 'string' && row[f.col].toLowerCase().includes(f.val.replace(/%/g, '').toLowerCase());
      return true;
    });
    const sortedRows = () => {
      let rows = [...t.values()].filter(matches);
      if (ctx.orderBy) {
        rows.sort((a, b) => {
          const av = a[ctx.orderBy.col], bv = b[ctx.orderBy.col];
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (ctx.orderBy.asc ? 1 : -1);
        });
      }
      if (ctx.limit) rows = rows.slice(0, ctx.limit);
      return rows;
    };

    const exec = async () => {
      if (ctx.mode === 'insert') {
        const rows = (Array.isArray(ctx.insertData) ? ctx.insertData : [ctx.insertData]).map(r => {
          const id = r.id || newId();
          const row = { id, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r };
          t.set(id, row);
          return row;
        });
        return { data: rows.length === 1 ? rows[0] : rows, error: null };
      }
      if (ctx.mode === 'update') {
        const rows = [...t.values()].filter(matches);
        for (const r of rows) t.set(r.id, { ...r, ...ctx.updateData, updated_at: new Date().toISOString() });
        return { data: rows, error: null };
      }
      // select
      return { data: sortedRows(), error: null };
    };

    const builder = {
      select(cols) { ctx.selectCols = cols || '*'; return builder; },
      insert(data) { ctx.mode = 'insert'; ctx.insertData = data; return builder; },
      update(data) { ctx.mode = 'update'; ctx.updateData = data; return builder; },
      eq(col, val) { ctx.filters.push({ op: 'eq', col, val }); return builder; },
      ilike(col, val) { ctx.filters.push({ op: 'ilike', col, val }); return builder; },
      order(col, opts = { ascending: true }) { ctx.orderBy = { col, asc: opts.ascending }; return builder; },
      limit(n) { ctx.limit = n; return builder; },
      single() { return exec().then(r => r.error ? r : { data: Array.isArray(r.data) ? r.data[0] : r.data, error: null }); },
      maybeSingle() { return exec().then(r => r.error ? r : { data: (Array.isArray(r.data) ? r.data[0] : r.data) || null, error: null }); },
      then(resolve, reject) { return exec().then(resolve, reject); },
    };
    return builder;
  }

  return { from, tables };
}

// ────────────────────────────────────────────────────────────────────────────
// Day-5 routes — behaviour test with stub Supabase + stub Storage + stub Resend
//
// Exercises:
//   POST /quotes/:id/generate         → engine → fake Storage upload
//   POST /quotes/:id/email            → dry-run + real (stubbed) send
//   POST /quotes/:id/sign             → signed PDF upload
//   POST /quotes/:id/counter-sign     → admin counter-signs
//   POST /quotes/:id/deposit          → deposit + handoff to projects_v2
//   GET  /quotes/:id/audit-log        → returns the trail
//   GET  /quotes/:id/pdf?kind=...     → returns signed URL
//
// Run:  node server/scripts/test-quote-actions-routes.js
// ────────────────────────────────────────────────────────────────────────────

import express from 'express';
import jwt from 'jsonwebtoken';
import http from 'node:http';

// ── Stubs ─────────────────────────────────────────────────────────────────
const stub = makeStub();
const storageStub = makeStorageStub();

// Inject before importing routes
const quotesModule = await import('../routes/pm/quotes.js');
quotesModule.__setSupabaseForTests(stub);
const quotesRoutes = quotesModule.default;

const quoteActionsModule = await import('../routes/pm/quote-actions.js');
quoteActionsModule.__setSupabaseForTests(stub);
const quoteActionsRoutes = quoteActionsModule.default;

const storageModule = await import('../services/pm/quoteStorageService.js');
storageModule.__setSupabaseForTests(storageStub);

const emailModule = await import('../services/pm/quoteEmailService.js');
const emailCalls = [];
emailModule.__setEmailSenderForTests(async (payload) => {
  emailCalls.push(payload);
  return { id: 'stub-msg-' + Date.now() };
});

// ── Auth ──────────────────────────────────────────────────────────────────
const { default: env } = await import('../config/env.js');
const JWT_SECRET = env.jwt.secret;
function tokenFor(user) { return jwt.sign(user, JWT_SECRET); }
const REP = { id: 'user-rep-1', email: 'rep@gripl.co', role: 'sales_exec' };
const ADMIN = { id: 'user-admin-1', email: 'admin@gripl.co', role: 'admin' };

// Seed contact
const CONTACT_ID = '00000000-0000-0000-0000-000000000001';
stub.tables.get('contacts').set(CONTACT_ID, {
  id: CONTACT_ID, name: 'Mr Naga Sai Krishna Avala',
  email: 'krishna@example.com', phone: '+64 21 000 0000',
});

// ── App ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '20mb' }));
app.use('/api/pm/quotes', quotesRoutes);     // CRUD first
app.use('/api/pm/quotes', quoteActionsRoutes); // lifecycle on same prefix
const server = http.createServer(app);
await new Promise(r => server.listen(0, r));
const port = server.address().port;

// ── Helpers ───────────────────────────────────────────────────────────────
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
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function spec(price = 50000) {
  return {
    customer: {
      full_name: 'Mr Naga Sai Krishna Avala', email: 'krishna@example.com', phone: '+64 21 000 0000',
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
      cable_run_metres_estimate: 24, phase: 1,
    },
    pricing: { customer_price_inc_gst: price, stage: 'stage_1_estimate', final_mode: true,
               discount: { applied_nzd: 0, owner_approved: false, reason: null }},
    preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo', financing: { choice: 'cash' }},
  };
}

console.log('━'.repeat(80));
console.log('  /api/pm/quotes — Day-5 lifecycle behaviour test');
console.log('━'.repeat(80));

// ── Create + generate ────────────────────────────────────────────────────
section('Generate (engine → PDFs → Storage)');
let quoteId, versionNumber;
{
  const create = await req('POST', '/quotes', { user: REP, body: { contact_id: CONTACT_ID, spec: spec() }});
  check('Quote created', create.status === 201);
  quoteId = create.body?.quote?.id;
  versionNumber = create.body?.version?.version_number;
}
{
  const r = await req('POST', `/quotes/${quoteId}/generate`, { user: REP });
  check('POST /:id/generate → 200', r.status === 200, `got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  check('customer_pdf storage_path present', !!r.body?.customer_pdf?.storage_path);
  check('customer_pdf sha256 present', /^[0-9a-f]{64}$/.test(r.body?.customer_pdf?.sha256 || ''));
  check('sales_console_pdf uploaded', !!r.body?.sales_console_pdf?.storage_path);
  check('duration_ms present', typeof r.body?.duration_ms === 'number');
}
{
  const r = await req('GET', `/quotes/${quoteId}`, { user: REP });
  check('Quote status flipped to generated', r.body?.quote?.status === 'generated', `got ${r.body?.quote?.status}`);
  check('Version has pricing_snapshot persisted', !!r.body?.current_version?.pricing_snapshot);
  check('Version has generated_at set', !!r.body?.current_version?.generated_at);
  check('Storage has customer + sales-console pdfs', storageStub.files.size >= 2, `got ${storageStub.files.size}`);
}

// ── Generate without can_ship → 409 ──────────────────────────────────────
section('Generate refuses can_ship=false specs');
{
  const lowPrice = await req('POST', '/quotes', { user: REP, body: { contact_id: CONTACT_ID, spec: spec(25000) }});
  const lowId = lowPrice.body?.quote?.id;
  const r = await req('POST', `/quotes/${lowId}/generate`, { user: REP });
  check('Generate refused for below-floor spec (409)', r.status === 409, `got ${r.status}`);
  check('block_reasons explained', Array.isArray(r.body?.block_reasons) && r.body.block_reasons.length > 0);
}

// ── Email (dry-run then real) ────────────────────────────────────────────
section('Email — dry-run then send');
{
  const r = await req('POST', `/quotes/${quoteId}/email`, { user: REP, body: { dry_run: true }});
  check('Email dry-run → 200', r.status === 200, `got ${r.status}`);
  check('dry_run flag returned true', r.body?.dry_run === true);
  check('would_send.to is customer email', r.body?.would_send?.to === 'krishna@example.com');
  check('would_send.subject starts with "Your Goldenray"', /^Your Goldenray/.test(r.body?.would_send?.subject || ''));
  check('No emails sent (dry-run)', emailCalls.length === 0);

  const after = await req('GET', `/quotes/${quoteId}`, { user: REP });
  check('Quote status still "generated" after dry-run', after.body?.quote?.status === 'generated');
}
{
  const r = await req('POST', `/quotes/${quoteId}/email`, { user: REP, body: { to: 'krishna@example.com' }});
  check('Email real send → 200', r.status === 200);
  check('dry_run flag false', r.body?.dry_run === false);
  check('provider_message_id returned', /^stub-msg-/.test(r.body?.provider_message_id || ''));
  check('Stub Resend was called once', emailCalls.length === 1, `got ${emailCalls.length}`);
  check('Email had PDF attachment', !!emailCalls[0]?.attachments?.length);

  const after = await req('GET', `/quotes/${quoteId}`, { user: REP });
  check('Quote status flipped to sent_to_customer', after.body?.quote?.status === 'sent_to_customer');
  check('valid_until is set', !!after.body?.quote?.valid_until);
}

// ── Sign ─────────────────────────────────────────────────────────────────
section('Customer signature');
const fakePdf = Buffer.from('%PDF-1.4\nFake signed PDF body that is at least 100 bytes long ' + 'x'.repeat(100));
{
  const r = await req('POST', `/quotes/${quoteId}/sign`, { user: REP, body: {
    signed_pdf_base64: fakePdf.toString('base64'),
    signed_at: '2026-06-10T10:00:00Z',
    signer_name: 'Mr Naga Sai Krishna Avala',
  }});
  check('POST /:id/sign → 200', r.status === 200, `got ${r.status}: ${JSON.stringify(r.body)}`);
  check('signed_pdf storage path returned', /signed-customer\.pdf$/.test(r.body?.signed_pdf?.storage_path || ''));

  const after = await req('GET', `/quotes/${quoteId}`, { user: REP });
  check('Quote status = signed', after.body?.quote?.status === 'signed');
  check('Version has signed_at + signer_name persisted', after.body?.current_version?.signer_name === 'Mr Naga Sai Krishna Avala');
}

// ── Counter-sign (admin only) ────────────────────────────────────────────
section('Counter-sign');
{
  const r = await req('POST', `/quotes/${quoteId}/counter-sign`, { user: REP, body: {
    counter_signer_name: 'Rajeshwar Reddy',
  }});
  check('Rep cannot counter-sign (403)', r.status === 403, `got ${r.status}`);
}
{
  const r = await req('POST', `/quotes/${quoteId}/counter-sign`, { user: ADMIN, body: {
    counter_signer_name: 'Rajeshwar Reddy',
  }});
  check('Admin counter-sign → 200', r.status === 200);

  const after = await req('GET', `/quotes/${quoteId}`, { user: REP });
  check('Quote status = counter_signed', after.body?.quote?.status === 'counter_signed');
  check('Version has counter_signer_name = Rajeshwar Reddy',
        after.body?.current_version?.counter_signer_name === 'Rajeshwar Reddy');
}

// ── Deposit ──────────────────────────────────────────────────────────────
section('Deposit received');
{
  const r = await req('POST', `/quotes/${quoteId}/deposit`, { user: REP, body: {
    deposit_amount_nzd: 5000, deposit_reference: 'BNZ-2026-001-DEP',
  }});
  check('Deposit recorded (no handoff) → 200', r.status === 200);
  check('status = deposit_received', r.body?.status === 'deposit_received');

  const after = await req('GET', `/quotes/${quoteId}`, { user: REP });
  check('Quote.deposit_amount_nzd = $5,000', Number(after.body?.quote?.deposit_amount_nzd) === 5000);
}
{
  // Handoff to projects_v2
  const r = await req('POST', `/quotes/${quoteId}/deposit`, { user: REP, body: {
    deposit_amount_nzd: 5000, handoff_to_pm: true,
  }});
  check('Handoff deposit blocked when already deposit_received (409)', r.status === 409, `got ${r.status}`);
}
// Demonstrate a fresh quote going all the way to handoff
{
  const q2 = await req('POST', '/quotes', { user: REP, body: { contact_id: CONTACT_ID, spec: spec() }});
  const id2 = q2.body?.quote?.id;
  await req('POST', `/quotes/${id2}/generate`, { user: REP });
  await req('POST', `/quotes/${id2}/email`, { user: REP });
  await req('POST', `/quotes/${id2}/sign`, { user: REP, body: {
    signed_pdf_base64: fakePdf.toString('base64'), signer_name: 'Test Signer',
  }});
  await req('POST', `/quotes/${id2}/counter-sign`, { user: ADMIN });
  const r = await req('POST', `/quotes/${id2}/deposit`, { user: ADMIN, body: {
    deposit_amount_nzd: 4500, handoff_to_pm: true,
  }});
  check('Full flow → handoff to projects_v2 (200)', r.status === 200, `got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  check('project_id returned', !!r.body?.project_id);
  check('status = handed_off', r.body?.status === 'handed_off');

  const projects = stub.tables.get('projects_v2');
  check('projects_v2 row created', projects.size >= 1);
}

// ── Audit log ────────────────────────────────────────────────────────────
section('Audit log');
{
  const r = await req('GET', `/quotes/${quoteId}/audit-log`, { user: REP });
  check('GET /:id/audit-log → 200', r.status === 200);
  check('Audit log has 5+ entries', Array.isArray(r.body) && r.body.length >= 5, `got ${r.body?.length}`);
  const actions = new Set(r.body.map(r => r.action));
  for (const a of ['quote.created', 'pdf.generated', 'email.sent', 'customer.signed', 'counter_signed', 'deposit.received']) {
    check(`Audit contains "${a}"`, actions.has(a));
  }
}

// ── PDF download URL ─────────────────────────────────────────────────────
section('PDF download (signed URL)');
{
  const r = await req('GET', `/quotes/${quoteId}/pdf?kind=customer`, { user: REP });
  check('GET /:id/pdf?kind=customer → 200', r.status === 200, `got ${r.status}: ${JSON.stringify(r.body)}`);
  check('Returns signed URL', /^https?:\/\//.test(r.body?.url || ''));
  check('Has ttl_sec', typeof r.body?.ttl_sec === 'number');
}
{
  const r = await req('GET', `/quotes/${quoteId}/pdf?kind=sales-console`, { user: REP });
  check('GET /:id/pdf?kind=sales-console → 200', r.status === 200);
}
{
  const r = await req('GET', `/quotes/${quoteId}/pdf?kind=bogus`, { user: REP });
  check('GET /:id/pdf?kind=bogus → 400', r.status === 400);
}

// ── Wrap up ──────────────────────────────────────────────────────────────
section('Summary');
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
server.close();
if (fail > 0) {
  for (const f of failures) console.log(`    ✗ ${f.label}  ${f.hint}`);
  process.exit(1);
}
console.log('  ✅ Day-5 lifecycle endpoints behave as expected.');

// ════════════════════════════════════════════════════════════════════════════
// Stubs (same shape as Day-4 test, plus a Storage facade)
// ════════════════════════════════════════════════════════════════════════════
function makeStub() {
  const tables = new Map([
    ['contacts', new Map()],
    ['quotes', new Map()],
    ['quote_versions', new Map()],
    ['quote_audit_log', new Map()],
    ['discount_approvals', new Map()],
    ['quote_email_log', new Map()],
    ['quote_run_log', new Map()],
    ['projects_v2', new Map()],
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

function makeStorageStub() {
  const files = new Map();
  return {
    files,
    storage: {
      from() {
        return {
          async upload(path, buf) { files.set(path, buf); return { error: null }; },
          async download(path) {
            const buf = files.get(path);
            if (!buf) return { error: { message: 'not found' }, data: null };
            return { data: { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }, error: null };
          },
          async createSignedUrl(path, ttl) {
            return { data: { signedUrl: `https://stub.supabase.co/storage/${path}?expires=${ttl}` }, error: null };
          },
        };
      },
      listBuckets: async () => ({ data: [{ name: 'pm-quotes' }] }),
      createBucket: async () => ({ error: null }),
    },
  };
}

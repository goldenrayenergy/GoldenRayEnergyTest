// ────────────────────────────────────────────────────────────────────────────
// End-to-end quote flow walker — against a LIVE local dev server.
//
// What it does:
//   1. Logs in as a rep + an admin (uses /api/auth/login)
//   2. Finds (or creates) a test contact
//   3. POST  /api/pm/quotes                         → create
//   4. POST  /api/pm/quotes/:id/validate            → confirm engine output
//   5. POST  /api/pm/quotes/:id/discount-request    → rep requests $4k discount (only if --discount)
//   6. POST  /api/pm/quotes/:id/discount-approve    → admin approves
//   7. POST  /api/pm/quotes/:id/generate            → engine + PDFs + Storage
//   8. POST  /api/pm/quotes/:id/email?dry_run=true  → email DRY-RUN (default)
//   9. POST  /api/pm/quotes/:id/email               → real send (only with --send-real)
//   10. POST /api/pm/quotes/:id/sign                → upload signed PDF
//   11. POST /api/pm/quotes/:id/counter-sign        → admin counter-signs
//   12. POST /api/pm/quotes/:id/deposit             → deposit + handoff to projects_v2
//   13. GET  /api/pm/quotes/:id/audit-log           → print full trail
//   14. GET  /api/pm/quotes/:id/pdf?kind=customer   → print signed download URL
//
// Pre-reqs:
//   • Server running:    cd server && npm run dev          (default: localhost:3001)
//   • MVP1_002 applied:  node server/db/apply-migration-MVP1-002.js
//   • Two real users in `users` table (set REP_EMAIL/REP_PASSWORD + ADMIN_EMAIL/ADMIN_PASSWORD)
//   • At least one contact (will be created if you pass --create-contact)
//
// Run examples:
//   # Dry-run email by default — safe
//   node server/scripts/e2e-quote-flow.js
//
//   # Actually send the email
//   node server/scripts/e2e-quote-flow.js --send-real
//
//   # Test the discount workflow too
//   node server/scripts/e2e-quote-flow.js --discount
//
//   # Custom server URL
//   API_BASE=https://my-pm-tool.vercel.app node server/scripts/e2e-quote-flow.js
// ────────────────────────────────────────────────────────────────────────────

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const REP_EMAIL    = process.env.REP_EMAIL    || 'rep@gripl.co';
const REP_PASSWORD = process.env.REP_PASSWORD || 'changeme';
const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'reddy@gripl.co';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

const flags = new Set(process.argv.slice(2));
const SEND_REAL = flags.has('--send-real');
const DO_DISCOUNT = flags.has('--discount');
const CREATE_CONTACT = flags.has('--create-contact');

// ── Tiny fetch wrapper ────────────────────────────────────────────────────
async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed;
  try { parsed = await res.json(); } catch { parsed = null; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  return r.token;
}

function banner(t) {
  console.log();
  console.log('━'.repeat(80));
  console.log(`  ${t}`);
  console.log('━'.repeat(80));
}

function info(k, v) { console.log(`  ${k.padEnd(22)} ${v}`); }

// ── Reference spec ────────────────────────────────────────────────────────
function spec(customerPrice = 50000, contactEmail = 'krishna@example.com') {
  return {
    customer: {
      full_name: 'Mr Naga Sai Krishna Avala',
      email: contactEmail,
      phone: '+64 21 000 0000',
      address: { street: '6 Woodacre Street', suburb: 'Flat Bush', city: 'Auckland',
                 postcode: '2019', region: 'auckland_vector' },
      icp_number: '1002175017LCB5D',
      property_ownership: 'mortgaged',
    },
    bills: { manual_entry: { annual_kwh: 13044, annual_spend: 3825, retailer: 'Mercury',
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
    pricing: { customer_price_inc_gst: customerPrice, stage: 'stage_1_estimate', final_mode: true,
               discount: { applied_nzd: 0, owner_approved: false, reason: null }},
    preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo',
                   financing: { choice: 'cash' }},
  };
}

// ── Walk ──────────────────────────────────────────────────────────────────
banner(`E2E quote flow against ${API_BASE}`);
info('Mode',            SEND_REAL ? '🔴 will send REAL email' : '🟢 email DRY-RUN only');
info('Discount path',   DO_DISCOUNT ? 'yes' : 'skipped (use --discount to test)');
info('Rep account',     REP_EMAIL);
info('Admin account',   ADMIN_EMAIL);

banner('Step 1 — Authenticate');
let repToken, adminToken;
try {
  repToken   = await login(REP_EMAIL, REP_PASSWORD);
  adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  info('Rep token',   repToken.slice(0, 24) + '…');
  info('Admin token', adminToken.slice(0, 24) + '…');
} catch (e) {
  console.error('✗ Login failed:', e.message);
  console.error('  Set REP_EMAIL/REP_PASSWORD + ADMIN_EMAIL/ADMIN_PASSWORD env vars.');
  process.exit(1);
}

banner('Step 2 — Find/create test contact');
let contactId, contactEmail;
{
  // Try existing first
  const contacts = await api('GET', '/api/contacts', { token: repToken }).catch(() => []);
  const existing = Array.isArray(contacts) ? contacts.find(c => /krishna/i.test(c.name || c.email || '')) : null;
  if (existing) {
    contactId = existing.id;
    contactEmail = existing.email || 'krishna@example.com';
    info('Reused contact', `${existing.name} (${contactId.slice(0, 8)}…)`);
  } else if (CREATE_CONTACT) {
    const c = await api('POST', '/api/contacts', { token: repToken, body: {
      name: 'Mr Naga Sai Krishna Avala (E2E test)',
      email: 'krishna-e2e@example.com',
      phone: '+64 21 000 0000',
    }});
    contactId = c.id;
    contactEmail = c.email;
    info('Created contact', `${c.name} (${contactId.slice(0, 8)}…)`);
  } else {
    console.error('✗ No contact found and --create-contact not passed.');
    console.error('  Re-run with --create-contact to make one, or seed `contacts` manually.');
    process.exit(1);
  }
}

banner('Step 3 — POST /api/pm/quotes  (create)');
let quoteId, quoteRef;
{
  const createSpec = DO_DISCOUNT ? spec(45000, contactEmail) : spec(50000, contactEmail);
  const r = await api('POST', '/api/pm/quotes', { token: repToken, body: {
    contact_id: contactId, spec: createSpec,
  }});
  quoteId = r.quote.id;
  quoteRef = r.quote.quote_ref;
  info('Quote ref',       quoteRef);
  info('Quote id',        quoteId);
  info('can_ship',        r.engine.can_ship);
  info('Margin status',   r.engine.margin_floor_status);
  info('Conservative net', '$' + Math.round(r.scenarios[0].lifetime_net_savings).toLocaleString());
  info('Expected net',     '$' + Math.round(r.scenarios[1].lifetime_net_savings).toLocaleString());
  info('Optimistic net',   '$' + Math.round(r.scenarios[2].lifetime_net_savings).toLocaleString());
}

banner('Step 4 — POST /api/pm/quotes/:id/validate');
{
  const r = await api('POST', `/api/pm/quotes/${quoteId}/validate`, { token: repToken });
  info('Passes',          r.engine.engineering.passes.length);
  info('Soft warnings',   r.engine.engineering.soft_warnings.length);
  info('Hard fails',      r.engine.engineering.hard_fails.length);
  info('Year-1 gen',      r.scenarios.expected.yr1.generation_kwh.toLocaleString() + ' kWh');
}

if (DO_DISCOUNT) {
  banner('Step 5 — POST discount-request (rep) + discount-approve (admin)');
  const reqR = await api('POST', `/api/pm/quotes/${quoteId}/discount-request`, {
    token: repToken,
    body: { requested_amount_nzd: 4000, reason: 'E2E test — repeat customer' },
  });
  info('Request id',        reqR.discount_request.id);
  info('Projected margin',  reqR.projected_margin_pct.toFixed(1) + '%');

  const apprR = await api('POST', `/api/pm/quotes/${quoteId}/discount-approve`, {
    token: adminToken,
    body: { decision: 'approved', discount_request_id: reqR.discount_request.id,
            admin_notes: 'E2E test approval' },
  });
  info('Decision',          apprR.decision);
  info('Approved amount',   '$' + apprR.approved_amount_nzd);
}

banner('Step 6 — POST /api/pm/quotes/:id/generate  (engine → PDFs → Storage)');
{
  const r = await api('POST', `/api/pm/quotes/${quoteId}/generate`, { token: repToken });
  info('Customer PDF',      r.customer_pdf.storage_path);
  info('Customer SHA256',   r.customer_pdf.sha256.slice(0, 16) + '…');
  info('Sales PDF',         r.sales_console_pdf.storage_path);
  info('Duration',          r.duration_ms + ' ms');
}

banner('Step 7 — POST /api/pm/quotes/:id/email  (DRY-RUN)');
{
  const r = await api('POST', `/api/pm/quotes/${quoteId}/email`, {
    token: repToken, body: { dry_run: true },
  });
  info('Would send to',     r.would_send.to);
  info('Subject',           r.would_send.subject);
  info('Attachment size',   r.would_send.attachment.size_bytes + ' bytes');
  info('Real email sent?',  'NO (dry-run)');
}

if (SEND_REAL) {
  banner('Step 8 — POST /api/pm/quotes/:id/email  (REAL SEND)');
  console.log('  🔴 About to actually send an email. Make sure the address is one you own.');
  const r = await api('POST', `/api/pm/quotes/${quoteId}/email`, {
    token: repToken, body: { to: contactEmail },
  });
  info('Sent to',           r.would_send.to);
  info('Resend msg id',     r.provider_message_id || '(stub)');
  info('NODE_ENV',          process.env.NODE_ENV || 'development (will redirect to EMAIL_TEST_RECIPIENT)');
} else {
  console.log('\n  ⏭  Skipping real email send (pass --send-real to actually send).');
}

banner('Step 9 — POST /api/pm/quotes/:id/sign  (fake signed PDF)');
{
  const fakeSigned = Buffer.from('%PDF-1.4\nFake E2E signed PDF body ' + 'x'.repeat(200));
  const r = await api('POST', `/api/pm/quotes/${quoteId}/sign`, { token: repToken, body: {
    signed_pdf_base64: fakeSigned.toString('base64'),
    signer_name: 'Mr Naga Sai Krishna Avala (E2E)',
    signed_at: new Date().toISOString(),
  }});
  info('Signed PDF SHA256', r.signed_pdf.sha256.slice(0, 16) + '…');
}

banner('Step 10 — POST /api/pm/quotes/:id/counter-sign  (admin)');
{
  const r = await api('POST', `/api/pm/quotes/${quoteId}/counter-sign`, {
    token: adminToken, body: { counter_signer_name: 'Rajeshwar Reddy (E2E)' },
  });
  info('Counter-signed',    'yes');
}

banner('Step 11 — POST /api/pm/quotes/:id/deposit  (with handoff)');
{
  const r = await api('POST', `/api/pm/quotes/${quoteId}/deposit`, {
    token: repToken,
    body: { deposit_amount_nzd: 4500, deposit_reference: 'E2E-TEST-' + Date.now(),
            handoff_to_pm: true },
  });
  info('Final status',      r.status);
  info('Project id',        r.project_id || '(none)');
}

banner('Step 12 — GET /api/pm/quotes/:id/audit-log');
{
  const log = await api('GET', `/api/pm/quotes/${quoteId}/audit-log`, { token: repToken });
  console.log(`  ${log.length} audit entries (most recent first):`);
  for (const row of log.slice(0, 12)) {
    console.log(`    ${row.occurred_at.slice(0, 19).replace('T', ' ')}  ${row.actor_role?.padEnd(12) || ''}  ${row.action}`);
  }
}

banner('Step 13 — GET signed download URLs');
for (const kind of ['customer', 'sales-console', 'signed-customer', 'counter-signed']) {
  try {
    const r = await api('GET', `/api/pm/quotes/${quoteId}/pdf?kind=${kind}`, { token: repToken });
    info(kind, r.url);
  } catch (e) {
    info(kind, '(not available)');
  }
}

banner('Done');
console.log(`  Quote ${quoteRef} walked the full lifecycle.`);
console.log(`  Open Supabase → quotes table → search for ${quoteRef} to see DB state.`);
console.log(`  Open the signed-customer.pdf URL above to download what would go to the customer.`);

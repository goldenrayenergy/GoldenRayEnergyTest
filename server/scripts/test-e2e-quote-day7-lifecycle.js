// ────────────────────────────────────────────────────────────────────────────
// Day 7 — full quote lifecycle e2e against a RUNNING local dev server.
//
// Walks every lifecycle endpoint the new QuoteDetailPage.jsx consumes:
//   1. POST  /auth/login               (admin JWT)
//   2. POST  /pm/quotes                (create from a real contact)
//   3. PATCH /pm/quotes/:id/spec       (set spec to a shippable state)
//   4. POST  /pm/quotes/:id/generate   (run engine + render PDFs)
//   5. GET   /pm/quotes/:id/pdf?kind=customer        (signed URL)
//   6. GET   /pm/quotes/:id/pdf?kind=sales-console   (signed URL)
//   7. POST  /pm/quotes/:id/email     (dry_run=true — no real send)
//   8. POST  /pm/quotes/:id/sign      (uploads a tiny dummy PDF)
//   9. POST  /pm/quotes/:id/counter-sign  (admin)
//  10. POST  /pm/quotes/:id/deposit   (handoff_to_pm=false to avoid creating projects_v2 row)
//  11. GET   /pm/quotes/:id/audit-log  (verify entries)
//  12. DELETE /pm/quotes/:id          (cleanup)
//
// This is the regression check Day 7's UI relies on. If any endpoint changes
// shape or status guards, this surfaces it before a browser smoke does.
//
// Run: node server/scripts/test-e2e-quote-day7-lifecycle.js
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const API = process.env.E2E_API_URL || 'http://localhost:5000/api';
const ADMIN_EMAIL = 'aroha@goldenray.co.nz';
const ADMIN_PASSWORD = 'admin123';

// A minimal valid PDF (the smallest legal PDF, ~ 600 bytes). Server only
// checks buffer.length > 100, so this is plenty.
const DUMMY_PDF_HEADER =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
  '2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
  'xref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000053 00000 n\n0000000098 00000 n\n' +
  'trailer<</Size 4/Root 1 0 R>>startxref\n150\n%%EOF\n';
const DUMMY_PDF_BASE64 = Buffer.from(DUMMY_PDF_HEADER).toString('base64');

let pass = 0, fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`); }
  else    { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

async function http(method, path, { token, body } = {}) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

// ── 1. Login ─────────────────────────────────────────────────────────────
console.log('\n━━━ 1. Login as admin ━━━');
const login = await http('POST', '/auth/login', {
  body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
});
check('login 200', login.status === 200, `status=${login.status}`);
const token = login.data?.token || login.data?.access_token;
check('token present', !!token);
if (!token) {
  console.error('Cannot proceed without auth token.');
  process.exit(1);
}

// ── 2. Find a contact that has a bill_analysis on file (cleanest path) ───
console.log('\n━━━ 2. Find a usable contact ━━━');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });
const { data: analyses } = await supabase
  .from('bill_analyses')
  .select('contact_id, recommended_system_kw, recommended_battery_kwh')
  .gt('recommended_system_kw', 0)
  .order('created_at', { ascending: false })
  .limit(1);
const contactId = analyses?.[0]?.contact_id;
check('contact with bill_analysis found', !!contactId, contactId);
if (!contactId) process.exit(1);

// ── 3. Create quote ──────────────────────────────────────────────────────
// Empty-spec body that matches client emptySpec() output. The server's
// composeThreeTiers populates the actual SKUs from the bill analysis.
console.log('\n━━━ 3. Create quote ━━━');
const emptySpec = {
  customer: {
    full_name: 'E2E Day-7 Test', email: 'e2e-day7@test.nz', phone: '021 0000000',
    address: { street: '', suburb: '', city: '', postcode: '', region: 'auckland_vector' },
    icp_number: '', property_ownership: 'own',
  },
  bills: { manual_entry: {
    annual_kwh: 12000, annual_spend: 3500, retailer: 'Mercury',
    variable_rate_per_kwh_incl_gst: 0.23, daily_fixed_charge_incl_gst: 2.5, buyback_rate: 0.09,
  }},
  system: {
    panel: { sku: null, count: null }, inverter: { sku: null }, battery: null,
    smart_meter: { sku: null, phase: 1 }, string_topology: null,
    string_design: { panels_per_string: null, string_count: null },
    cable_run_metres_estimate: 24, phase: 1,
  },
  pricing: {
    customer_price_inc_gst: 45000, stage: 'stage_1_estimate', final_mode: true,
    discount: { applied_nzd: 0, owner_approved: false, reason: null },
  },
  preferences: {
    backup_priority: 'whole_home_essentials', decision_makers: 'solo',
    financing: { choice: 'cash' },
  },
};
const create = await http('POST', '/pm/quotes', {
  token,
  body: { contact_id: contactId, spec: emptySpec, stage: 'stage_1_estimate' },
});
check('POST /pm/quotes 201', create.status === 201, `status=${create.status}`);
const quoteId = create.data?.quote?.id;
check('quote.id returned', !!quoteId, quoteId);
if (!quoteId) {
  console.error('Cannot proceed without quote.id.\n' + JSON.stringify(create.data, null, 2));
  process.exit(1);
}

// ── 4. PATCH spec — fill in required customer + address (composeThreeTiers
//       gives valid SKUs but doesn't write address fields), then re-save.
console.log('\n━━━ 4. Load created quote + PATCH address fields ━━━');
const loadCreated = await http('GET', `/pm/quotes/${quoteId}`, { token });
check('GET created 200', loadCreated.status === 200);
const composedSpec = loadCreated.data?.current_version?.spec;
check('composed spec has SKUs from catalogue', !!composedSpec?.system?.panel?.sku,
  composedSpec?.system?.panel?.sku || 'missing');

// Force a known-good single-tier system. composeThreeTiers occasionally
// produces DC/AC > 1.5 on this contact's bill analysis (engineering validator
// correctly rejects it); for the Day 7 e2e we override with a hand-picked
// system known to be in the live catalogue and within all engine envelopes.
const invSku = 'FRN-INV-100-G24-1P';   // 10 kW base GEN24 (non-Plus, no battery)
const pnlSku = 'PHN-PNL-475-QSR';      // 475W Quasar
const mtrSku = 'FRN-MTR-63-S1P';       // 1-phase 63A meter
const panelCount = 20;                  // DC = 9.5 kWp, DC/AC = 0.95, well within envelope
const shippableSpec = {
  ...composedSpec,
  customer: {
    ...(composedSpec.customer || {}),
    full_name: composedSpec.customer?.full_name || 'E2E Day-7 Test',
    email: composedSpec.customer?.email || 'e2e-day7@test.nz',
    address: {
      ...(composedSpec.customer?.address || {}),
      street: 'E2E 1 Test St',
      suburb: 'Mt Eden',
      city: 'Auckland',
      postcode: '1024',
      region: composedSpec.customer?.address?.region || 'auckland_vector',
    },
    property_ownership: composedSpec.customer?.property_ownership || 'own',
  },
  system: {
    panel: { sku: pnlSku, count: panelCount },
    inverter: { sku: invSku },
    battery: null,
    smart_meter: { sku: mtrSku, phase: 1 },
    string_topology: 'parallel',
    string_design: { topology: 'parallel', groups: [{ panels_per_string: 10, string_count: 2 }] },
    cable_run_metres_estimate: 24, phase: 1,
  },
  // Force single-tier for THIS test (multi-tier covered by a separate
  // check below — runs the same /generate path against a real multi-tier
  // quote to catch regression of the can_ship_all gate).
  tiers: undefined,
};

const patch = await http('PATCH', `/pm/quotes/${quoteId}/spec`, { token, body: { spec: shippableSpec } });
check('PATCH 200', patch.status === 200,
  patch.status !== 200 ? `status=${patch.status} body=${JSON.stringify(patch.data).slice(0,400)}` : '');
if (patch.data?.engine?.is_multi_tier) {
  check('all tiers can ship', patch.data?.engine?.can_ship_all === true,
    patch.data?.engine?.block_reasons?.join(' / ') || 'no blockers');
} else {
  check('engine can_ship', patch.data?.engine?.can_ship === true,
    patch.data?.engine?.block_reasons?.join(' / ') || 'no blockers');
}

// ── 5. Ensure Storage bucket exists (idempotent), then generate PDFs ────
console.log('\n━━━ 5. POST /generate ━━━');
const { ensureQuotesBucket } = await import('../services/pm/quoteStorageService.js');
try { await ensureQuotesBucket(); check('pm-quotes bucket present', true); }
catch (e)              { check('pm-quotes bucket present', false, e.message); }
const gen = await http('POST', `/pm/quotes/${quoteId}/generate`, { token });
check('generate 200', gen.status === 200,
  gen.status !== 200 ? `status=${gen.status} body=${JSON.stringify(gen.data).slice(0, 400)}` : '');
check('customer_pdf returned', !!gen.data?.customer_pdf?.storage_path);
check('sales_console_pdf returned', !!gen.data?.sales_console_pdf?.storage_path);

// ── 6. Get signed URLs ──────────────────────────────────────────────────
console.log('\n━━━ 6. GET /pdf ━━━');
const urlCust = await http('GET', `/pm/quotes/${quoteId}/pdf?kind=customer`, { token });
check('customer pdf URL 200', urlCust.status === 200);
check('url present', !!urlCust.data?.url);
const urlSales = await http('GET', `/pm/quotes/${quoteId}/pdf?kind=sales-console`, { token });
check('sales-console pdf URL 200', urlSales.status === 200);

// ── 7. Email (dry-run) ──────────────────────────────────────────────────
console.log('\n━━━ 7. POST /email (dry_run) ━━━');
const email = await http('POST', `/pm/quotes/${quoteId}/email`, {
  token,
  body: { to: 'e2e@test.nz', dry_run: true },
});
check('email dry-run 200', email.status === 200, `status=${email.status}`);
check('dry_run flag echoed', email.data?.dry_run === true);
check('would_send.to set', email.data?.would_send?.to === 'e2e@test.nz');

// Status should now be 'sent_to_customer' (NO — dry-run keeps status). Verify.
const afterEmail = await http('GET', `/pm/quotes/${quoteId}`, { token });
check('status unchanged on dry-run', afterEmail.data?.quote?.status === 'generated',
  `actual=${afterEmail.data?.quote?.status}`);

// ── 8. Upload customer-signed PDF ───────────────────────────────────────
console.log('\n━━━ 8. POST /sign ━━━');
const sign = await http('POST', `/pm/quotes/${quoteId}/sign`, {
  token,
  body: {
    signed_pdf_base64: DUMMY_PDF_BASE64,
    signer_name: 'E2E Customer',
    signed_at: new Date().toISOString(),
  },
});
check('sign 200', sign.status === 200, `status=${sign.status}`);
check('signed_pdf returned', !!sign.data?.signed_pdf?.storage_path);

const afterSign = await http('GET', `/pm/quotes/${quoteId}`, { token });
check('status → signed', afterSign.data?.quote?.status === 'signed',
  `actual=${afterSign.data?.quote?.status}`);

// ── 9. Counter-sign (admin only) ────────────────────────────────────────
console.log('\n━━━ 9. POST /counter-sign ━━━');
const counter = await http('POST', `/pm/quotes/${quoteId}/counter-sign`, {
  token,
  body: {
    counter_signed_pdf_base64: DUMMY_PDF_BASE64,
    counter_signer_name: 'Sarah Chen, Director',
  },
});
check('counter-sign 200', counter.status === 200, `status=${counter.status}`);
const afterCS = await http('GET', `/pm/quotes/${quoteId}`, { token });
check('status → counter_signed', afterCS.data?.quote?.status === 'counter_signed',
  `actual=${afterCS.data?.quote?.status}`);

// ── 10. Deposit (no handoff to keep projects_v2 clean) ─────────────────
console.log('\n━━━ 10. POST /deposit ━━━');
const deposit = await http('POST', `/pm/quotes/${quoteId}/deposit`, {
  token,
  body: {
    deposit_amount_nzd: 9600,
    deposit_reference: 'E2E-TEST-REF-001',
    handoff_to_pm: false,
  },
});
check('deposit 200', deposit.status === 200,
  `status=${deposit.status} response=${JSON.stringify(deposit.data)}`);
const afterDep = await http('GET', `/pm/quotes/${quoteId}`, { token });
check('status → deposit_received', afterDep.data?.quote?.status === 'deposit_received',
  `actual=${afterDep.data?.quote?.status}`);

// ── 11. Audit log ───────────────────────────────────────────────────────
console.log('\n━━━ 11. GET /audit-log ━━━');
const audit = await http('GET', `/pm/quotes/${quoteId}/audit-log`, { token });
check('audit-log 200', audit.status === 200);
const actions = (audit.data || []).map(r => r.action);
check('audit has pdf.generated',    actions.includes('pdf.generated'));
check('audit has email.dry_run',    actions.includes('email.dry_run'));
check('audit has customer.signed',  actions.includes('customer.signed'));
check('audit has counter_signed',   actions.includes('counter_signed'));
check('audit has deposit.received', actions.includes('deposit.received'));

// ── 12. Cleanup ─────────────────────────────────────────────────────────
console.log('\n━━━ 12. Cleanup ━━━');
// Withdraw isn't permitted from deposit_received — admin must use service-role.
// Just delete the rows via supabase to leave no test residue.
await supabase.from('quote_audit_log').delete().eq('quote_id', quoteId);
await supabase.from('quote_email_log').delete().eq('quote_id', quoteId);
await supabase.from('quote_run_log').delete().eq('quote_id', quoteId);
await supabase.from('quote_versions').delete().eq('quote_id', quoteId);
const { error: delErr } = await supabase.from('quotes').delete().eq('id', quoteId);
check('rows cleaned up', !delErr, delErr?.message);

// ── 13. Multi-tier /generate regression guard ──────────────────────────
// Multi-tier branch broke before because the handler checked engine.can_ship
// (singular) which is undefined for multi-tier output. This block creates a
// fresh multi-tier quote and verifies /generate returns 200, not 409.
console.log('\n━━━ 13. Multi-tier /generate regression guard ━━━');
const mtCreate = await http('POST', '/pm/quotes', {
  token,
  body: { contact_id: contactId, spec: emptySpec, stage: 'stage_1_estimate' },
});
check('multi-tier create 201', mtCreate.status === 201);
const mtQuoteId = mtCreate.data?.quote?.id;

if (mtQuoteId) {
  // Verify create produced a multi-tier spec
  const mtLoaded = await http('GET', `/pm/quotes/${mtQuoteId}`, { token });
  const mtSpec = mtLoaded.data?.current_version?.spec;
  const isMulti = Array.isArray(mtSpec?.tiers) && mtSpec.tiers.length > 0;
  check('create produced multi-tier spec', isMulti, isMulti ? `${mtSpec.tiers.length} tiers` : 'single-tier');

  // The composer may auto-pick a spec that violates DC/AC for high-usage
  // contacts (separate pre-existing engine concern). For this regression
  // guard we override every tier's system_overrides to a known-good system
  // so the test is verifying the /generate multi-tier ROUTE, not the
  // composer. Spec is verified ship-able by the catalogue + envelope rules.
  const KNOWN_GOOD_SYSTEM = {
    panel: { sku: 'PHN-PNL-475-QSR', count: 20 },
    inverter: { sku: 'FRN-INV-100-G24-1P' },
    battery: null,
    smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
    string_topology: 'parallel',
    string_design: { topology: 'parallel', groups: [{ panels_per_string: 10, string_count: 2 }] },
    cable_run_metres_estimate: 24, phase: 1,
  };
  const mtPatchSpec = {
    ...mtSpec,
    customer: {
      ...(mtSpec.customer || {}),
      full_name: 'E2E MT Test', email: 'mt@test.nz',
      address: {
        ...(mtSpec.customer?.address || {}),
        street: 'MT 1 Test St', suburb: 'Mt Eden', city: 'Auckland',
        postcode: '1024', region: 'auckland_vector',
      },
    },
    system: KNOWN_GOOD_SYSTEM,
    // Override every tier with EMPTY system_overrides — each tier inherits
    // the top-level KNOWN_GOOD_SYSTEM as-is. Goal of this test is to exercise
    // the multi-tier /generate ROUTE (can_ship_all gate + per-tier render),
    // not to test the composer or pricing math.
    // Override every tier with EMPTY system_overrides — each tier inherits
    // the top-level KNOWN_GOOD_SYSTEM as-is. Keep each tier's pricing block
    // with a stub customer_price_inc_gst (config validator requires it; PATCH
    // overwrites with the engine's LIST price anyway).
    tiers: mtSpec.tiers.map(t => ({
      ...t,
      system_overrides: {},
      pricing: { ...(t.pricing || {}), customer_price_inc_gst: 32000 },
    })),
  };
  const mtPatch = await http('PATCH', `/pm/quotes/${mtQuoteId}/spec`, {
    token, body: { spec: mtPatchSpec },
  });
  check('multi-tier PATCH 200', mtPatch.status === 200,
    mtPatch.status !== 200 ? `body=${JSON.stringify(mtPatch.data).slice(0, 300)}` : '');
  check('multi-tier can_ship_all', mtPatch.data?.engine?.can_ship_all === true,
    mtPatch.data?.engine?.block_reasons?.join(' / ') || 'no blockers');

  if (mtPatch.data?.engine?.can_ship_all) {
    const mtGen = await http('POST', `/pm/quotes/${mtQuoteId}/generate`, { token });
    check('multi-tier /generate 200 (was 409 before fix)', mtGen.status === 200,
      mtGen.status !== 200 ? `status=${mtGen.status} body=${JSON.stringify(mtGen.data).slice(0, 200)}` : '');
    check('multi-tier customer_pdf returned', !!mtGen.data?.customer_pdf?.storage_path);
    check('multi-tier sales_console_pdf returned', !!mtGen.data?.sales_console_pdf?.storage_path);

    // Verify pricing snapshot stored as multi-tier shape
    const afterGen = await http('GET', `/pm/quotes/${mtQuoteId}`, { token });
    const snap = afterGen.data?.current_version?.pricing_snapshot;
    check('multi-tier snapshot tagged is_multi_tier', snap?.is_multi_tier === true,
      `keys=${snap ? Object.keys(snap).join(',') : 'no snapshot'}`);
    check('multi-tier snapshot has recommended block', !!snap?.recommended?.totals,
      snap?.recommended_tier_label || '');
    check('multi-tier snapshot has all_tiers array', Array.isArray(snap?.all_tiers) && snap.all_tiers.length === 3,
      `len=${snap?.all_tiers?.length}`);
  } else {
    console.log('  (test fixture spec failed engineering — debug needed; multi-tier route untested)');
  }

  // Cleanup
  await supabase.from('quote_audit_log').delete().eq('quote_id', mtQuoteId);
  await supabase.from('quote_email_log').delete().eq('quote_id', mtQuoteId);
  await supabase.from('quote_run_log').delete().eq('quote_id', mtQuoteId);
  await supabase.from('quote_versions').delete().eq('quote_id', mtQuoteId);
  await supabase.from('quotes').delete().eq('id', mtQuoteId);
}

console.log(`\n━━━ ${pass} pass · ${fail} fail ━━━`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.label}: ${f.detail || ''}`);
  process.exit(1);
}

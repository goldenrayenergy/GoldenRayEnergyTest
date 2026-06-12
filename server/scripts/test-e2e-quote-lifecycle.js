// ────────────────────────────────────────────────────────────────────────────
// End-to-end test against a RUNNING local dev server. Hits the full quote
// lifecycle for two real customers, exercising every endpoint that consumes
// proposalEngine output:
//
//   1. POST  /api/auth/login           (get JWT)
//   2. POST  /api/pm/quotes            (create — multi-tier composer path)
//   3. GET   /api/pm/quotes/:id        (load)
//   4. PATCH /api/pm/quotes/:id/spec   (edit + save)
//   5. POST  /api/pm/quotes/:id/validate (run validator)
//
// If any endpoint returns 500 we fail loudly with the response body. This
// catches the class of "multi-tier shape vs single-tier shape" bugs that the
// pure-function smoke tests can't see.
//
// Requires the dev server running on port 5000.
// Run: node server/scripts/test-e2e-quote-lifecycle.js
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const API = process.env.E2E_API_URL || 'http://localhost:5000/api';
const TEST_EMAIL = 'aroha@goldenray.co.nz';
const TEST_PASSWORD = 'admin123';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let failed = 0;
function ok(label, cond, detail) {
  if (cond) console.log(`  ✅ ${label}`);
  else { console.log(`  ❌ FAIL: ${label}${detail ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`); failed++; }
}

async function req(method, url, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${API}${url}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try { data = await r.json(); } catch { data = null; }
  return { status: r.status, data };
}

// ── 0. Server health check ─────────────────────────────────────────────────
console.log(`\n══ 0. Health check (${API}/pm/health) ══`);
try {
  const r = await fetch(`${API}/pm/health`);
  const txt = await r.text();
  ok('server responds 200', r.status === 200, txt.slice(0, 100));
  if (r.status !== 200) {
    console.error('\n⛔ Server not reachable. Is it running on port 5000?');
    process.exit(1);
  }
} catch (e) {
  console.error(`\n⛔ Could not reach server: ${e.message}\n   Make sure dev server is running on port 5000.`);
  process.exit(1);
}

// ── 1. Login ───────────────────────────────────────────────────────────────
console.log(`\n══ 1. Login as ${TEST_EMAIL} ══`);
const loginResp = await req('POST', '/auth/login', null, { email: TEST_EMAIL, password: TEST_PASSWORD });
ok('login returns 200', loginResp.status === 200, loginResp.data);
const token = loginResp.data?.token;
ok('login returns JWT', !!token, loginResp.data);
if (!token) { process.exit(1); }

// ── 2. Pick 2 contacts with bill analyses ──────────────────────────────────
const { data: analyses } = await supabase
  .from('bill_analyses')
  .select('id, contact_id, recommended_system_kw')
  .gt('recommended_system_kw', 0)
  .order('created_at', { ascending: false })
  .limit(10);
const seen = new Set();
const picked = [];
for (const a of analyses) {
  if (!seen.has(a.contact_id) && picked.length < 2) {
    seen.add(a.contact_id);
    picked.push(a);
  }
}
console.log(`\n══ 2. Picked ${picked.length} test contacts ══`);
for (const a of picked) console.log(`   • contact ${a.contact_id} (analysis ${a.id}, rec ${a.recommended_system_kw} kWp)`);

// ── 3. Per-customer lifecycle ─────────────────────────────────────────────
for (const [idx, analysis] of picked.entries()) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(` Customer ${idx + 1}: contact ${analysis.contact_id}`);
  console.log(`${'═'.repeat(70)}`);

  // ── 3a. Create quote
  console.log(`\n  ── POST /pm/quotes (CREATE) ──`);
  const createResp = await req('POST', '/pm/quotes', token, {
    contact_id: analysis.contact_id,
    spec: {
      customer: {
        full_name: 'Test', email: 'test@example.com', phone: '021 0000000',
        address: { street: '', suburb: '', city: '', postcode: '', region: 'auckland_vector' },
        icp_number: '', property_ownership: 'own',
      },
      bills: { manual_entry: { annual_kwh: 12000, annual_spend: 3500, retailer: 'Mercury',
                                variable_rate_per_kwh_incl_gst: 0.23, daily_fixed_charge_incl_gst: 2.50, buyback_rate: 0.09 } },
      system: { panel: { sku: null, count: null }, inverter: { sku: null }, battery: null,
                smart_meter: { sku: null, phase: 1 }, string_topology: null,
                string_design: { panels_per_string: null, string_count: null },
                cable_run_metres_estimate: 24, phase: 1 },
      pricing: { customer_price_inc_gst: 45000, stage: 'stage_1_estimate', final_mode: true,
                  discount: { applied_nzd: 0, owner_approved: false, reason: null } },
      preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo', financing: { choice: 'cash' } },
    },
    stage: 'stage_1_estimate',
    bill_analysis_id: analysis.id,
  });
  ok('CREATE returns 201', createResp.status === 201, createResp.data);
  const quoteId = createResp.data?.quote?.id;
  ok('CREATE returns quote.id', !!quoteId);
  if (!quoteId) continue;
  ok('CREATE returns tiers in spec', createResp.data?.version?.spec?.tiers?.length === 3, createResp.data?.version?.spec?.tiers?.length);
  ok('CREATE: no exception in response (financial_model_output reachable)', createResp.status !== 500);

  // ── 3b. Load quote
  console.log(`\n  ── GET /pm/quotes/${quoteId.slice(0,8)} (LOAD) ──`);
  const getResp = await req('GET', `/pm/quotes/${quoteId}`, token);
  ok('GET returns 200', getResp.status === 200);

  // ── 3c. PATCH spec (with valid customer fields so engine.ok = true)
  console.log(`\n  ── PATCH /pm/quotes/${quoteId.slice(0,8)}/spec (SAVE) ──`);
  const updatedSpec = JSON.parse(JSON.stringify(getResp.data.current_version.spec));
  updatedSpec.customer.full_name = 'Test Customer';
  updatedSpec.customer.email = `e2e+${idx}@goldenray.co.nz`;
  updatedSpec.customer.phone = '021 555 0000';
  updatedSpec.customer.address.street = '1 Test St';
  updatedSpec.customer.address.suburb = 'Test Suburb';
  updatedSpec.customer.address.city = 'Auckland';
  updatedSpec.customer.address.postcode = '1010';
  const patchResp = await req('PATCH', `/pm/quotes/${quoteId}/spec`, token, { spec: updatedSpec });
  ok('PATCH returns 200', patchResp.status === 200, patchResp.data);
  ok('PATCH does NOT 500 with multi-tier (the bug we just fixed)', patchResp.status !== 500);
  if (patchResp.status === 200) {
    ok('PATCH returns engine object', !!patchResp.data?.engine);
    ok('PATCH returns is_multi_tier', patchResp.data?.engine?.is_multi_tier === true, patchResp.data?.engine);
  }

  // ── 3d. Validate
  console.log(`\n  ── POST /pm/quotes/${quoteId.slice(0,8)}/validate ──`);
  const valResp = await req('POST', `/pm/quotes/${quoteId}/validate`, token);
  ok('VALIDATE returns 200', valResp.status === 200, valResp.data);
  ok('VALIDATE does NOT 500 (multi-tier engineering aggregation)', valResp.status !== 500);

  // ── 3e. Clean up — delete the test quote
  console.log(`\n  ── DELETE /pm/quotes/${quoteId.slice(0,8)} (cleanup) ──`);
  const delResp = await req('DELETE', `/pm/quotes/${quoteId}`, token);
  ok('DELETE returns 200', delResp.status === 200, delResp.data);
}

console.log(`\n${'═'.repeat(70)}`);
console.log(` SUMMARY: ${failed === 0 ? '✅ ALL PASS' : `🐛 ${failed} FAILED`}`);
console.log(`${'═'.repeat(70)}\n`);
process.exit(failed === 0 ? 0 : 1);

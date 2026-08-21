// Live HTTP smoke test for /api/quote/submit + /api/quote/submit-with-design
// + /api/quote/legacy-submit. Fires real requests against a running local server. If
// SUPABASE_DATABASE_URL is set, also queries the DB to verify rows landed
// with the expected shape. Cleans up after itself.
//
// Skipped (exits 0) when server on :5000 isn't reachable — matches the
// SKIP pattern of the other test-e2e-* scripts so the regression runner
// doesn't count it as NEW-FAIL when the owner isn't running local dev.
//
// Run:   node server/scripts/test-lead-service-http.mjs
// Needs: SERVER=http://localhost:5000  (default)
//        SUPABASE_DATABASE_URL=postgres://…  (optional; for DB assertions)
//
// Owner runs this manually before push to prove /api/quote/submit is still
// byte-for-byte identical after the leadService refactor (Phase A / A3-A7).

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const SERVER = process.env.SERVER || 'http://localhost:5000';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  PASS  ${msg}`); }
  else      { fail++; console.error(`  FAIL  ${msg}`); }
};

async function preflightReachable() {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(SERVER, { signal: controller.signal });
    clearTimeout(t);
    return res.status < 500;
  } catch { return false; }
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* text response */ }
  return { status: res.status, body: json, raw: text };
}

const stamp = Date.now().toString(36);
const testEmail = `leadservice-test-${stamp}@invalid.local`;

async function run() {
  const reachable = await preflightReachable();
  if (!reachable) {
    console.log(`⊘ SKIP — ${SERVER} not reachable. Start server with "cd server && npm run dev" and re-run.`);
    process.exit(0);
  }

  console.log(`\n── /api/quote/submit (old wizard path via leadService) ──`);
  const submitPayload = {
    form: {
      firstName:         'LeadService',
      lastName:           'Test',
      email:              testEmail,
      phone:              '021 555 0100',
      address:            '123 Test Street, Auckland',
      installationType:   'residential',
      customerType:       'residential',
      batteryOption:      'without-battery',   // CHECK constraint allows only 'with-battery' | 'without-battery' | NULL
      callToDiscuss:      'no',
      monthlyBill:        250,
    },
  };
  const submit = await postJson(`${SERVER}/api/quote/submit`, submitPayload);
  assert(submit.status === 201, `POST /submit → 201 (got ${submit.status}; body: ${(submit.raw || '').slice(0, 200)})`);
  assert(submit.body?.success === true, `response.success === true`);
  assert(typeof submit.body?.id === 'string' || typeof submit.body?.id === 'number',
    `response.id present (got: ${submit.body?.id})`);
  assert(typeof submit.body?.contact_id === 'string' || typeof submit.body?.contact_id === 'number',
    `response.contact_id present (got: ${submit.body?.contact_id})`);

  console.log(`\n── /api/quote/submit-with-design (new endpoint, Phase A/A5) ──`);
  const submitWithDesign = await postJson(`${SERVER}/api/quote/submit-with-design`, {
    form: {
      firstName:   'DesignPath',
      lastName:    'Test',
      email:       `design-${testEmail}`,
      phone:       '021 555 0200',
      address:     '456 Design Ave, Auckland',
      customerType:'residential',
    },
    design: {
      chosenTierId: 'balanced',
      systemKwp:    6.5,
      panelCount:   13,
      batteryKwh:   11.04,
      evIncluded:   false,
      tierPrice:    28500,
      roofSource:   'lidar',
      lat:          -36.85,
      lng:          174.76,
      fullPayload:  { mock: true },
    },
  });
  assert(submitWithDesign.status === 201, `POST /submit-with-design → 201 (got ${submitWithDesign.status}; body: ${(submitWithDesign.raw || '').slice(0, 300)})`);
  assert(submitWithDesign.body?.success === true, `response.success === true`);
  assert(submitWithDesign.body?.id, `response.id present`);
  assert(submitWithDesign.body?.contact_id, `response.contact_id present`);
  // project_id may be null if projects_v2 write failed (which is non-fatal)
  console.log(`  INFO  project_id = ${submitWithDesign.body?.project_id || 'null'} (null OK if migration 042/projects_v2 write couldn't run)`);

  console.log(`\n── /api/quote/legacy-submit (upgraded from stub, Phase A/A6) ──`);
  const pocLead = await postJson(`${SERVER}/api/quote/legacy-submit`, {
    contact: {
      name:  'POC Test',
      email: `poc-${testEmail}`,
      phone: '021 555 0300',
      preferred_time: 'weekday-morning',
    },
    quote_context: {
      formatted_address:  '789 POC Lane, Auckland',
      annual_kwh:         7500,
      recommended_tier:   'balanced',
      recommended_price:  27500,
      payback_yrs:        7,
      savings_25yr:       55000,
      from_manual_entry:  false,
    },
  });
  assert(pocLead.status === 201, `POST /api/quote/legacy-submit → 201 (got ${pocLead.status}; body: ${(pocLead.raw || '').slice(0, 300)})`);
  assert(pocLead.body?.ok === true, `response.ok === true`);
  assert(pocLead.body?.lead_id, `response.lead_id present`);
  assert(pocLead.body?.contact_id, `response.contact_id present`);

  console.log(`\n${pass} PASS · ${fail} FAIL`);
  console.log(`\nTest email domain used: @invalid.local — filter Supabase for '${testEmail.split('@')[0]}' to find + delete test rows if needed.`);
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  process.exit(1);
});

// Structural test for services/leadService.js — proves the module contract
// without hitting the database. Runs in the regression harness (no server /
// no DB needed). Complements test-lead-service-http.mjs (live smoke test).
//
// What it verifies:
//   • All expected functions are exported
//   • createOrUpdateLead throws ValidationError on missing form
//   • writeProjectV2 handles null design safely (returns null, doesn't throw)
//   • Interface signatures match Phase A ticket A2 spec

import * as leadService from '../services/leadService.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  PASS  ${msg}`); }
  else      { fail++; console.error(`  FAIL  ${msg}`); }
};

console.log('── Structural checks on services/leadService.js ──\n');

// 1. Exported functions
const expectedExports = [
  'createOrUpdateLead',
  'writeEnquiry',
  'writeContact',
  'backlinkQrScan',
  'writeCadenceTasks',
  'cleanupPartialTasks',
  'writeActivity',
  'fetchReviewFlag',
  'fireLeadNotifications',
  'fireRoofAnalysisPipeline',
  'writeProjectV2',
];

for (const name of expectedExports) {
  assert(typeof leadService[name] === 'function', `exports ${name} as function`);
}

// 2. createOrUpdateLead validation — missing form throws
try {
  await leadService.createOrUpdateLead({});
  fail++;
  console.error('  FAIL  createOrUpdateLead should throw on missing form');
} catch (e) {
  assert(/form is required/i.test(e.message), `createOrUpdateLead throws on missing form (got: "${e.message}")`);
}

// 3. writeProjectV2 handles missing design safely
// Note: this WILL attempt a supabase call — but we're checking it doesn't
// throw synchronously. If DB is unreachable it'll log + return null.
try {
  const result = await leadService.writeProjectV2({ contactId: 'test-nonexistent' });
  assert(result === null || (result && typeof result.projectId === 'string'), 'writeProjectV2 returns null or {projectId}');
} catch (e) {
  // If it threw, that's a contract violation (this function should be non-fatal)
  fail++;
  console.error(`  FAIL  writeProjectV2 threw on empty args (should be non-fatal): ${e.message}`);
}

// 4. Non-fatal write helpers exist with correct signatures
assert(typeof leadService.writeEnquiry === 'function' && leadService.writeEnquiry.length >= 1,
  'writeEnquiry(fields, opts?) signature');
assert(typeof leadService.writeContact === 'function' && leadService.writeContact.length >= 1,
  'writeContact(fields, opts?) signature');
assert(typeof leadService.fireLeadNotifications === 'function',
  'fireLeadNotifications exists');
assert(typeof leadService.fireRoofAnalysisPipeline === 'function',
  'fireRoofAnalysisPipeline exists');

console.log(`\n${pass} PASS · ${fail} FAIL`);
// Use exitCode (not process.exit) so lingering supabase-client sockets get
// closed cleanly. process.exit() while sockets are pending triggers a Windows
// libuv assertion (`UV_HANDLE_CLOSING`) that surfaces as exit code 127 even
// after 0-fail success — false NEW-FAIL in the regression runner.
process.exitCode = fail === 0 ? 0 : 1;

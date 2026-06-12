// ────────────────────────────────────────────────────────────────────────────
// Smoke test for Session B field_limits cache + invalidate pipeline.
//
// Proves that:
//   1. ensureLoaded() pulls all 10 rows from migration 030's seed
//   2. getHardRange() returns DB-backed values (not STATIC_DEFAULTS) post-load
//   3. invalidate() forces a re-fetch on next ensureLoaded()
//   4. A live DB edit propagates to validateSpec / runEngine after invalidate
//
// Reverts the test edit at the end so the local DB state is unchanged.
//
// Run: node server/scripts/test-field-limits-cache.js
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const {
  ensureLoaded, invalidate, getHardRange, _peekCache, _resetForTest,
  STATIC_FIELD_LIMITS,
} = await import('../services/pm/proposalEngine/fieldLimits.js');
const { runEngine } = await import('../services/pm/proposalEngine/index.js');

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) { pass++; console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`); }
  else    { fail++; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

// ── 1. ensureLoaded fetches all 10 rows ────────────────────────────────────
console.log('\n━━━ 1. ensureLoaded() pulls all 10 rows from DB ━━━');
_resetForTest();
const cache = await ensureLoaded();
const paths = Object.keys(cache);
check('10 paths loaded', paths.length === 10, `got ${paths.length}: ${paths.join(', ')}`);
check('cache populated (not null)', !!_peekCache().cache);
check('panel count range from DB', getHardRange('system.panel.count')?.max === 60);

// ── 2. Values match seed ───────────────────────────────────────────────────
console.log('\n━━━ 2. DB values match migration seed ━━━');
for (const p of Object.keys(STATIC_FIELD_LIMITS)) {
  const expected = STATIC_FIELD_LIMITS[p];
  const actual = cache[p];
  const same = actual
    && actual.hard_min === expected.hard_min
    && actual.hard_max === expected.hard_max
    && actual.typical_min === expected.typical_min
    && actual.typical_max === expected.typical_max;
  check(p, same, same ? `${expected.hard_min}-${expected.hard_max}` : 'MISMATCH');
}

// ── 3. invalidate() forces re-fetch ────────────────────────────────────────
console.log('\n━━━ 3. invalidate() + DB edit propagates ━━━');
const ORIGINAL_PANEL_MAX = 60;
const NEW_PANEL_MAX = 999;

// Snapshot before mutating
const { data: snapshot } = await supabase
  .from('field_limits').select('*').eq('path', 'system.panel.count').single();

// Mutate DB directly (bypassing the API for this test — the API path is
// covered by test-field-limits-api below if you stand up the server)
await supabase.from('field_limits')
  .update({ hard_max: NEW_PANEL_MAX })
  .eq('path', 'system.panel.count');

// Without invalidate, cache is still stale within TTL window
const stalePeek = getHardRange('system.panel.count');
check('cache still stale before invalidate', stalePeek?.max === ORIGINAL_PANEL_MAX,
      `max=${stalePeek?.max} (expected ${ORIGINAL_PANEL_MAX})`);

// invalidate() then ensureLoaded() picks up new value
invalidate();
await ensureLoaded();
const freshPeek = getHardRange('system.panel.count');
check('cache shows new value after invalidate+reload', freshPeek?.max === NEW_PANEL_MAX,
      `max=${freshPeek?.max} (expected ${NEW_PANEL_MAX})`);

// ── 4. runEngine with new limit ────────────────────────────────────────────
console.log('\n━━━ 4. runEngine() picks up new limit ━━━');
const { loadCatalogueFromDb } = await import('../services/pm/proposalEngine/catalogue/dbLoader.js');
const catalogue = await loadCatalogueFromDb(supabase);
const baseSpec = {
  customer: { full_name: 'Smoke', email: 't@t.nz', address: {
    street: '1 Test St', suburb: 'Mt Eden', city: 'Auckland', postcode: '1024',
    region: 'auckland_vector',
  }},
  bills: { manual_entry: { annual_kwh: 12000, annual_spend: 3500, retailer: 'Mercury',
    variable_rate_per_kwh_incl_gst: 0.23, daily_fixed_charge_incl_gst: 2.5, buyback_rate: 0.09 }},
  system: {
    panel: { sku: 'PHN-PNL-475-QSR', count: 80 },   // ← would fail at old hard_max=60
    inverter: { sku: 'FRN-INV-100-G24-1P' },
    battery: null, smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
    string_topology: 'series',
    string_design: { topology: 'series', groups: [{ panels_per_string: 10, string_count: 8 }] },
    cable_run_metres_estimate: 24, phase: 1,
  },
  pricing: { customer_price_inc_gst: 50000, stage: 'stage_1_estimate', final_mode: false,
    discount: { applied_nzd: 0, owner_approved: false }},
  preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo', financing: { choice: 'cash' }},
};

const result = await runEngine(baseSpec, { catalogue });
// With hard_max=999 the engine should accept 80 panels (will still hit other
// engineering rules e.g. inverter sizing, but panel.count itself passes).
const panelCountErrors = (result.config_errors || []).filter(e => e.path === 'system.panel.count');
check('panel.count=80 NOT rejected with hard_max=999', panelCountErrors.length === 0,
      panelCountErrors.length > 0 ? panelCountErrors[0].message : 'no panel-count errors');

// ── 5. Revert DB to original ───────────────────────────────────────────────
console.log('\n━━━ 5. Revert DB to original ━━━');
await supabase.from('field_limits')
  .update({ hard_max: snapshot.hard_max })
  .eq('path', 'system.panel.count');
invalidate();
await ensureLoaded();
const restoredPeek = getHardRange('system.panel.count');
check('reverted to original hard_max', restoredPeek?.max === ORIGINAL_PANEL_MAX,
      `max=${restoredPeek?.max}`);

console.log(`\n━━━ ${pass} pass · ${fail} fail ━━━`);
if (fail > 0) process.exit(1);

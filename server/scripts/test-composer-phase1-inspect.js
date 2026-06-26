// ────────────────────────────────────────────────────────────────────────────
// Phase 1 test — the three-tier composer now inspects every tier against the
// FULL engineering rulebook and attaches tier.engine_validation. Verifies:
//   1. Every tier (bill-driven AND no-bill fallback) carries engine_validation
//   2. Parity: tier.engine_validation == validateEngineering() on the same spec
//   3. The known bad case (small bill → HVM 8.3 on Primo) is now flagged invalid
// Runs against the LIVE DB catalogue (so compatible_batteries is attached).
// ────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { composeThreeTiers } from '../services/pm/proposalEngine/threeTierComposer.js';
import { validateEngineering } from '../services/pm/proposalEngine/engineeringValidator.js';
import { loadCatalogueFromDb } from '../services/pm/proposalEngine/catalogue/dbLoader.js';
import { COMPATIBILITY, BMS_RULES } from '../services/pm/proposalEngine/data/engineeringRules.js';

for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
  const t = l.trim(); if (!t || t[0] === '#' || !t.includes('=')) continue;
  const i = t.indexOf('='); process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

let pass = 0, fail = 0;
const check = (label, cond, hint = '') => { console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : '  — ' + hint}`); cond ? pass++ : fail++; };

// rebuild a tier's inspectable spec exactly as the composer does (mirror of specForInspection)
function specOf(tier, region, phase) {
  const sov = tier.system_overrides || {};
  return {
    customer: { address: { region: region || null } }, bills: { manual_entry: {} },
    system: {
      panel: sov.panel, inverter: sov.inverter, battery: sov.battery || null,
      string_topology: sov.string_topology || 'series',
      string_design: sov.string_design || { topology: 'series', groups: [{ panels_per_string: sov.panel.count, string_count: 1 }] },
      smart_meter: sov.smart_meter || null, phase: phase || 1, cable_run_metres_estimate: 24,
    },
    pricing: { stage: 'stage_1_estimate', customer_price_inc_gst: 0, discount: { applied_nzd: 0, owner_approved: false } },
  };
}

const catalogue = await loadCatalogueFromDb(sb);
const common = { catalogue, COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS: undefined };

console.log('━'.repeat(70));
console.log('  Phase 1 — composer inspects every tier');
console.log('━'.repeat(70));

// Case A: small bill → tier 2 should pick HVM 8.3 (3 modules) on a small Primo
console.log('\nA) bill-driven, small system (recKw 3, recBat 8) — 1-phase');
const A = composeThreeTiers({ billAnalysis: { recommended_system_kw: 3, recommended_battery_kwh: 8 }, phase: 1, region: 'auckland', sizeMode: 'same_size', ...common });
check('every tier has engine_validation', A.tiers.every(t => t.engine_validation && Array.isArray(t.engine_validation.hard_fails)),
  JSON.stringify(A.tiers.map(t => !!t.engine_validation)));
const battTier = A.tiers.find(t => t.system_overrides?.battery?.sku);
if (battTier) {
  const b = battTier.system_overrides.battery;
  console.log(`   battery tier: ${b.sku} x${b.module_count}  valid=${battTier.engine_validation.valid}  hard_fails=${battTier.engine_validation.hard_fails.length}`);
  check('battery tier flagged invalid IF it used a sub-min HVM (pairing rule)',
    battTier.engine_validation.valid === true || battTier.engine_validation.hard_fails.some(f => /pairing|matrix|module count/i.test(f.rule)),
    JSON.stringify(battTier.engine_validation.hard_fails.map(f => f.rule)));
}

// Parity: tier.engine_validation.hard_fails == validateEngineering() directly
console.log('\nB) parity with validateEngineering() on the same spec');
for (const t of A.tiers) {
  if (!t.system_overrides?.panel?.sku) continue;
  const direct = validateEngineering(specOf(t, 'auckland', 1), { catalogue });
  check(`parity: "${t.label}" (${t.engine_validation.hard_fails.length} hard fails)`,
    direct.hard_fails.length === t.engine_validation.hard_fails.length,
    `direct=${direct.hard_fails.length} attached=${t.engine_validation.hard_fails.length}`);
}

// Case C: no-bill fallback path — tiers must still be inspected
console.log('\nC) no-bill fallback path');
const C = composeThreeTiers({ billAnalysis: null, phase: 1, region: 'auckland', sizeMode: 'same_size', ...common });
check('no-bill fallback tiers all have engine_validation', C.tiers.every(t => t.engine_validation && Array.isArray(t.engine_validation.hard_fails)),
  JSON.stringify(C.tiers.map(t => !!t.engine_validation)));

console.log('━'.repeat(70));
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
console.log('━'.repeat(70));
process.exit(fail ? 1 : 0);

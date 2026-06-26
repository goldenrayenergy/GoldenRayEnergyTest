// ────────────────────────────────────────────────────────────────────────────
// Phase 3 test — the composer REPAIRS failing tiers (step up inverter / shorten
// strings) and never emits a silent invalid. Verifies:
//   1. Realistic same-size scenarios (1ph ≤10kW, 3ph 8–30kW) → 0 blocked
//   2. A large 3-phase case (20kW) actually gets repaired (records repairs[])
//   3. The repair NEVER lies: ship_status 'ok' ⇒ engine_validation.valid === true
//   4. A genuinely impossible config (15kW on single-phase) → ship_status 'block'
// Runs against the live DB catalogue.
// ────────────────────────────────────────────────────────────────────────────
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { composeThreeTiers } from '../services/pm/proposalEngine/threeTierComposer.js';
import { loadCatalogueFromDb } from '../services/pm/proposalEngine/catalogue/dbLoader.js';
import { COMPATIBILITY, BMS_RULES } from '../services/pm/proposalEngine/data/engineeringRules.js';
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const t = l.trim(); if (!t || t[0] === '#' || !t.includes('=')) continue; const i = t.indexOf('='); process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, ''); }
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
let pass = 0, fail = 0;
const check = (l, c, h = '') => { console.log(`  ${c ? '✓' : '✗'} ${l}${c ? '' : '  — ' + h}`); c ? pass++ : fail++; };
const cat = await loadCatalogueFromDb(sb);
const common = { catalogue: cat, COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS: undefined };

console.log('━'.repeat(70));
console.log('  Phase 3 — composer self-repair');
console.log('━'.repeat(70));

// 1. Realistic same-size → 0 blocked
const scs = [];
for (const kw of [3, 4, 5, 6, 8, 10]) scs.push({ kw, phase: 1 });
for (const kw of [8, 10, 12, 15, 20, 25, 30]) scs.push({ kw, phase: 3 });
scs.push({ bill: null, phase: 1 }); scs.push({ bill: null, phase: 3 });
let allTiers = [], blocked = 0, lies = 0;
for (const s of scs) {
  const ba = s.bill === null ? null : { recommended_system_kw: s.kw, recommended_battery_kwh: Math.max(8, s.kw * 1.3) };
  const res = composeThreeTiers({ billAnalysis: ba, phase: s.phase, region: 'auckland', sizeMode: 'same_size', ...common });
  for (const t of res.tiers) {
    allTiers.push(t);
    if (t.ship_status === 'block') blocked++;
    if (t.ship_status === 'ok' && t.engine_validation?.valid !== true) lies++;  // ship_status must never lie
  }
}
check(`realistic same-size scenarios → 0 blocked (${allTiers.length} tiers)`, blocked === 0, `${blocked} blocked`);
check('ship_status never lies (ok ⇒ engine_validation.valid)', lies === 0, `${lies} lies`);

// 2. 20kW 3-phase actually repaired
const big = composeThreeTiers({ billAnalysis: { recommended_system_kw: 20, recommended_battery_kwh: 26 }, phase: 3, region: 'auckland', sizeMode: 'same_size', ...common }).tiers[0];
check('20kW 3-phase tier repaired (records repairs) & valid', (big.repairs?.length > 0) && big.engine_validation.valid === true,
  `repairs=${big.repairs?.length} valid=${big.engine_validation.valid}`);

// 3. Impossible config (15kW single-phase) → block (no silent invalid)
const imp = composeThreeTiers({ billAnalysis: { recommended_system_kw: 15, recommended_battery_kwh: 11 }, phase: 1, region: 'auckland', sizeMode: 'same_size', ...common });
const anyBlocked = imp.tiers.some(t => t.ship_status === 'block');
const noLie = imp.tiers.every(t => t.ship_status === 'ok' ? t.engine_validation.valid === true : true);
check('15kW on single-phase → at least one tier BLOCKED (correctly impossible)', anyBlocked, JSON.stringify(imp.tiers.map(t => t.ship_status)));
check('impossible case still never lies', noLie, '');

console.log('━'.repeat(70));
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
console.log('━'.repeat(70));
process.exit(fail ? 1 : 0);

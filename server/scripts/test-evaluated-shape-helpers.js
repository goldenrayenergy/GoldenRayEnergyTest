// ────────────────────────────────────────────────────────────────────────────
// Smoke test for evaluatedShape.js — verifies single-tier and multi-tier
// shapes are handled uniformly without crashes.
//
// Run: node server/scripts/test-evaluated-shape-helpers.js
// ────────────────────────────────────────────────────────────────────────────

import {
  getFinancialSummary, getMarginFloorStatus, getEngineeringOutput,
  getProjectMarginPct, getCanShip,
} from '../services/pm/proposalEngine/evaluatedShape.js';

let failed = 0;
const ok   = (label, cond) => { if (cond) console.log(`  ✅ ${label}`); else { console.log(`  ❌ FAIL: ${label}`); failed++; } };
const eq   = (label, actual, expected) => ok(`${label}  →  ${JSON.stringify(actual)} === ${JSON.stringify(expected)}`, actual === expected);

console.log('\n══ 1. Single-tier evaluated, ok=true ══');
{
  const evaluated = {
    ok: true,
    engine: {
      ok: true, config_valid: true, can_ship: true,
      cost: { margin_floor_status: 'healthy', totals: { project_margin_pct: 18.5 } },
      engineering: { hard_fails: [], soft_warnings: [{rule:'R1'}], passes: [{rule:'P1'}], unverified: [] },
    },
    scenarios: {
      summary: { yr1_savings: 3200 },
      expected: { yr1: { savings_nzd: 3200, payback_years: 7.4 } },
    },
  };
  const fin = getFinancialSummary(evaluated);
  ok('getFinancialSummary returns summary', fin?.summary?.yr1_savings === 3200);
  ok('getFinancialSummary returns headline', fin?.headline?.payback_years === 7.4);
  ok('NO by_tier for single-tier', !fin?.by_tier);
  eq('getMarginFloorStatus', getMarginFloorStatus(evaluated), 'healthy');
  eq('getProjectMarginPct', getProjectMarginPct(evaluated), 18.5);
  eq('getCanShip', getCanShip(evaluated), true);
  const eng = getEngineeringOutput(evaluated);
  eq('engineering hard_fails (none)', eng.hard_fails.length, 0);
  eq('engineering soft_warnings', eng.soft_warnings.length, 1);
}

console.log('\n══ 2. Single-tier evaluated, ok=false ══');
{
  const evaluated = {
    ok: false,
    engine: {
      ok: false, config_valid: false,
      config_errors: [{ path: 'customer.full_name', message: 'required' }],
    },
  };
  eq('getFinancialSummary returns null', getFinancialSummary(evaluated), null);
  eq('getMarginFloorStatus returns null', getMarginFloorStatus(evaluated), null);
  eq('getProjectMarginPct returns 0', getProjectMarginPct(evaluated), 0);
  eq('getCanShip returns false', getCanShip(evaluated), false);
  eq('getEngineeringOutput returns null', getEngineeringOutput(evaluated), null);
}

console.log('\n══ 3. Multi-tier evaluated, all tiers ok ══');
{
  const evaluated = {
    ok: true,
    engine: {
      ok: true, is_multi_tier: true, recommended_tier_id: 'tier-2',
      tiers: [
        { tier_id: 'tier-1', label: 'Solar only', is_recommended: false, can_ship: true,
          cost: { margin_floor_status: 'healthy', totals: { project_margin_pct: 22.0 } },
          engineering: { hard_fails: [], soft_warnings: [{rule:'R1'}], passes: [{rule:'P1a'}], unverified: [] } },
        { tier_id: 'tier-2', label: 'Solar + battery', is_recommended: true, can_ship: true,
          cost: { margin_floor_status: 'amber', totals: { project_margin_pct: 11.5 } },
          engineering: { hard_fails: [], soft_warnings: [{rule:'R2'}], passes: [{rule:'P2a'}], unverified: [] } },
        { tier_id: 'tier-3', label: 'Solar + battery + EV', is_recommended: false, can_ship: true,
          cost: { margin_floor_status: 'healthy', totals: { project_margin_pct: 19.0 } },
          engineering: { hard_fails: [], soft_warnings: [], passes: [{rule:'P3a'}], unverified: [] } },
      ],
    },
    tier_scenarios: [
      { summary: { yr1: 1100 }, expected: { yr1: { savings_nzd: 1100, payback_years: 9.0 } } },
      { summary: { yr1: 3300 }, expected: { yr1: { savings_nzd: 3300, payback_years: 7.4 } } },
      { summary: { yr1: 3700 }, expected: { yr1: { savings_nzd: 3700, payback_years: 7.0 } } },
    ],
  };
  const fin = getFinancialSummary(evaluated);
  ok('getFinancialSummary picks recommended tier summary', fin?.summary?.yr1 === 3300);
  ok('getFinancialSummary picks recommended headline', fin?.headline?.savings_nzd === 3300);
  eq('by_tier has 3 entries', Object.keys(fin?.by_tier || {}).length, 3);
  ok('by_tier[tier-2].is_recommended', fin.by_tier['tier-2'].is_recommended === true);

  eq('getMarginFloorStatus worst-case = amber', getMarginFloorStatus(evaluated), 'amber');
  eq('getProjectMarginPct worst-case = 11.5', getProjectMarginPct(evaluated), 11.5);
  eq('getCanShip all true', getCanShip(evaluated), true);

  const eng = getEngineeringOutput(evaluated);
  eq('engineering aggregated passes (3 tiers)', eng.passes.length, 3);
  eq('engineering aggregated soft_warnings', eng.soft_warnings.length, 2);
  ok('engineering tier-label-prefix', eng.passes[0].rule.startsWith('[Solar only]'));
  ok('is_aggregated flag set', eng.is_aggregated === true);
}

console.log('\n══ 4. Multi-tier with one tier blocked (hard_fail) ══');
{
  const evaluated = {
    ok: true,
    engine: {
      ok: true, is_multi_tier: true, recommended_tier_id: 'tier-2',
      tiers: [
        { tier_id: 'tier-1', label: 'Solar only', is_recommended: false, can_ship: false,
          cost: { margin_floor_status: 'below_floor', totals: { project_margin_pct: 5.0 } },
          engineering: { hard_fails: [{rule:'AS/NZS 5033', message: 'Voc'}], soft_warnings: [], passes: [], unverified: [] } },
        { tier_id: 'tier-2', label: 'Solar + battery', is_recommended: true, can_ship: true,
          cost: { margin_floor_status: 'healthy', totals: { project_margin_pct: 18.0 } },
          engineering: { hard_fails: [], soft_warnings: [], passes: [{rule:'P'}], unverified: [] } },
        { tier_id: 'tier-3', label: 'EV-ready', is_recommended: false, can_ship: true,
          cost: { margin_floor_status: 'amber', totals: { project_margin_pct: 11.0 } },
          engineering: { hard_fails: [], soft_warnings: [], passes: [], unverified: [] } },
      ],
    },
    tier_scenarios: [
      { summary: { yr1: 1100 }, expected: { yr1: { savings_nzd: 1100 } } },
      { summary: { yr1: 3300 }, expected: { yr1: { savings_nzd: 3300 } } },
      { summary: { yr1: 3700 }, expected: { yr1: { savings_nzd: 3700 } } },
    ],
  };
  eq('worst margin status = below_floor', getMarginFloorStatus(evaluated), 'below_floor');
  eq('worst margin pct = 5.0', getProjectMarginPct(evaluated), 5.0);
  eq('cannot ship (one tier can_ship=false)', getCanShip(evaluated), false);

  const eng = getEngineeringOutput(evaluated);
  eq('aggregated hard_fails', eng.hard_fails.length, 1);
  ok('hard_fail carries tier label', eng.hard_fails[0].tier_label === 'Solar only');
}

console.log('\n══ 5. Multi-tier evaluated, ok=false ══');
{
  const evaluated = { ok: false, engine: { ok: false, is_multi_tier: true,
    tiers: [
      { tier_id: 'tier-1', label: 'X', config_valid: false, config_errors: [{path: 'X', message: 'Y'}] },
    ],
  } };
  eq('getFinancialSummary returns null', getFinancialSummary(evaluated), null);
  ok('getEngineeringOutput non-null shape (aggregated)', !!getEngineeringOutput(evaluated));
}

console.log('\n══ 6. Defensive — null evaluated ══');
{
  eq('null → getFinancialSummary returns null', getFinancialSummary(null), null);
  eq('null → getMarginFloorStatus returns null', getMarginFloorStatus(null), null);
  eq('null → getProjectMarginPct returns 0', getProjectMarginPct(null), 0);
  eq('null → getCanShip returns false', getCanShip(null), false);
  eq('null → getEngineeringOutput returns null', getEngineeringOutput(null), null);
  eq('{} → no crash on getFinancialSummary', getFinancialSummary({}), null);
}

console.log('\n──── Summary ────');
console.log(`  ${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);

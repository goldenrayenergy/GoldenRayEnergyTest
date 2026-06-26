// ────────────────────────────────────────────────────────────────────────────
// Root-cause fix test — kwh_double_count_suspect is now corroborated by the
// implied unit rate, so a legitimate high-use (winter) month no longer trips a
// false SUSPECT.
//
//   • Genuine double-count (kWh inflated, rate ≈ half) → suspect SUSPECT
//   • Winter peak (high kWh, NORMAL rate)              → non-suspect heads-up
//   • High extrapolation but no variable_charge        → conservative SUSPECT
//   • Normal month (extrapolation < 1.8×)              → no warning at all
//
// Pure runCrossFieldValidators(parsed) — no DB, no PDF.
// ────────────────────────────────────────────────────────────────────────────
import { runCrossFieldValidators } from '../services/billOcrService.js';

let pass = 0, fail = 0;
const check = (l, c, h = '') => { console.log(`  ${c ? '✓' : '✗'} ${l}${c ? '' : '  — ' + h}`); c ? pass++ : fail++; };
const find = (ws, code) => ws.find(w => w.code === code);

console.log('━'.repeat(70));
console.log('  Bill double-count: now season-aware (rate-corroborated)');
console.log('━'.repeat(70));

// Common: ~60-day winter bill, rolling annual 9000 kWh. A 2-month winter peak of
// 2500 kWh extrapolates to ~15,200/yr (>1.8× 9000) — the old rule's false trigger.
const base = { days_in_period: 60, annual_kwh_rolling: 9000, kwh_total: 2800 };

// 1. Genuine double-count: kWh doubled, but $ charges normal → implied rate ≈ $0.10/kWh
const doubled = runCrossFieldValidators({ ...base, variable_charge_nzd: 280 }); // 280/2800 = $0.10
check('doubled kWh (rate ~$0.10) → kwh_double_count_suspect (suspect)',
  !!find(doubled, 'kwh_double_count_suspect') && find(doubled, 'kwh_double_count_suspect').suspect === true,
  JSON.stringify(doubled.map(w => w.code)));

// 2. Legit winter peak: high kWh AND high $ → normal rate ~$0.25/kWh → NOT suspect
const winter = runCrossFieldValidators({ ...base, variable_charge_nzd: 700 }); // 700/2800 = $0.25
check('winter peak (rate ~$0.25) → NOT suspect (seasonal heads-up instead)',
  !find(winter, 'kwh_double_count_suspect') && !!find(winter, 'kwh_high_vs_rolling_seasonal') &&
  find(winter, 'kwh_high_vs_rolling_seasonal').suspect === false,
  JSON.stringify(winter.map(w => ({ c: w.code, s: w.suspect }))));

// 3. No variable_charge to corroborate → stay conservative (suspect)
const noRate = runCrossFieldValidators({ ...base }); // no variable_charge_nzd
check('no rate to corroborate → conservative kwh_double_count_suspect',
  !!find(noRate, 'kwh_double_count_suspect'),
  JSON.stringify(noRate.map(w => w.code)));

// 4. Normal month (extrapolation < 1.8×) → no double-count warning at all
const normal = runCrossFieldValidators({ days_in_period: 30, annual_kwh_rolling: 9000, kwh_total: 750, variable_charge_nzd: 180 });
check('normal month → no double-count / seasonal warning',
  !find(normal, 'kwh_double_count_suspect') && !find(normal, 'kwh_high_vs_rolling_seasonal'),
  JSON.stringify(normal.map(w => w.code)));

console.log('━'.repeat(70));
console.log(`  RESULT: ${pass} passed, ${fail} failed`);
console.log('━'.repeat(70));
process.exit(fail ? 1 : 0);

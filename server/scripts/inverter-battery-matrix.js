// Pull active inverters + batteries from production Supabase, cross-reference
// with the engine's BMS_RULES + COMPATIBILITY map, and produce the live
// inverter ↔ battery compatibility matrix.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const { BMS_RULES, COMPATIBILITY } = await import('../services/pm/proposalEngine/data/engineeringRules.js');

// ── Active inverters ──────────────────────────────────────────────────────
const { data: invs } = await sb.from('products')
  .select('sku, brand, name, category, specs, is_active')
  .in('category', ['Inverters - Grid Tied', 'Inverters - Off Grid',
                   'Inverters - Commercial', 'Fronius Tauro Eco'])
  .eq('is_active', true)
  .order('sku');

// ── Active batteries ──────────────────────────────────────────────────────
const { data: bats } = await sb.from('products')
  .select('sku, brand, name, category, specs, is_active')
  .eq('category', 'Batteries - Lithium')
  .eq('is_active', true)
  .order('sku');

// Resolve hybrid-status -> battery_capable
function resolveBatteryCapable(s) {
  if (s.battery_capable === true || s.battery_capable === 'true') return true;
  if (s.is_plus_variant === true || s.is_plus_variant === 'true') return true;
  if (s.hybrid_status === 'ready' || s.hybrid_status === 'plus') return true;
  return false;
}

// Battery series eligible per engine (must be in BMS_RULES + chemistry LFP)
const supportedSeries = Object.keys(BMS_RULES);  // ['HVM','HVS','Reserva']

console.log('━'.repeat(110));
console.log(' Inverters (active in DB)');
console.log('━'.repeat(110));
console.log(`Total: ${invs.length}`);
let hybrid = 0, base = 0;
for (const inv of invs) {
  const cap = resolveBatteryCapable(inv.specs || {});
  if (cap) hybrid++; else base++;
}
console.log(`  hybrid-ready (battery_capable=true): ${hybrid}`);
console.log(`  base / non-hybrid:                  ${base}`);

console.log();
console.log('━'.repeat(110));
console.log(' Batteries (active in DB)');
console.log('━'.repeat(110));
for (const b of bats) {
  const s = b.specs || {};
  const series = s.series || s.family || '';
  const supported = supportedSeries.includes(series);
  const kwh = s.module_kwh ?? s.kwh_capacity ?? '?';
  console.log(`  ${(b.sku || '<null>').padEnd(22)}  brand=${(b.brand || '').padEnd(12)} series=${(series || '<none>').padEnd(8)} module=${kwh} kWh  engine-can-pick=${supported ? '✓' : '❌'}`);
}

// ── Build matrix ──────────────────────────────────────────────────────────
console.log();
console.log('━'.repeat(110));
console.log(' Inverter × Battery compatibility matrix (engine-actual)');
console.log('━'.repeat(110));
console.log('  Rules (Phase B tightened):');
console.log('    1. Inverter must be hybrid (battery_capable=true)');
console.log('    2. Battery series must be in BMS_RULES (HVM, HVS, or Reserva)');
console.log('    3. Battery chemistry must be LFP');
console.log('    4. Per-inverter override: COMPATIBILITY[inverter.sku].compatible_battery_series');
console.log();

const hybridInvs = invs.filter(inv => resolveBatteryCapable(inv.specs || {}));
const supportedBats = bats.filter(b => supportedSeries.includes(b.specs?.series || ''));

// Header row
const colWidth = 22;
const labels = supportedBats.map(b => `${b.specs?.series || ''} (${b.sku?.split('-').pop() || ''})`);
console.log(`  ${'INVERTER'.padEnd(28)}  ${labels.map(l => l.padEnd(colWidth)).join('')}`);
console.log(`  ${'-'.repeat(28)}  ${labels.map(() => '-'.repeat(colWidth)).join('')}`);

for (const inv of hybridInvs) {
  const allowed = COMPATIBILITY[inv.sku]?.compatible_battery_series;
  const row = supportedBats.map(b => {
    const series = b.specs?.series;
    // Allowed if (a) no explicit map, OR (b) series in the override list
    const ok = !allowed || allowed.length === 0 || allowed.includes(series);
    return (ok ? '✓ paired' : '— not allowed').padEnd(colWidth);
  });
  console.log(`  ${inv.sku.padEnd(28)}  ${row.join('')}`);
}

// ── Non-hybrid / base inverters ───────────────────────────────────────────
console.log();
console.log('━'.repeat(110));
console.log(' Non-hybrid inverters (no battery directly — license SKU needed for upgrade)');
console.log('━'.repeat(110));
const nonHybrid = invs.filter(inv => !resolveBatteryCapable(inv.specs || {}));
for (const inv of nonHybrid) {
  const s = inv.specs || {};
  const upgradeLic = s.upgrade_license_sku || '';
  console.log(`  ${(inv.sku || '<null>').padEnd(28)}  hybrid_status=${(s.hybrid_status || '').padEnd(10)} upgrade_license=${upgradeLic}`);
}

// ── Batteries the engine CANNOT pick today ────────────────────────────────
console.log();
console.log('━'.repeat(110));
console.log(' Batteries currently UN-pickable by engine (no BMS_RULES entry)');
console.log('━'.repeat(110));
const stranded = bats.filter(b => !supportedSeries.includes(b.specs?.series || ''));
for (const b of stranded) {
  const s = b.specs || {};
  console.log(`  ${(b.sku || '<null>').padEnd(22)}  brand=${(b.brand || '').padEnd(12)} series=${(s.series || s.family || '<blank>').padEnd(8)} — ${b.name?.slice(0, 50)}`);
}
console.log();
console.log('  To make these pickable: add BMS_RULES[series] entry in');
console.log('  server/services/pm/proposalEngine/data/engineeringRules.js');

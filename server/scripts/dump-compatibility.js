// One-off inspection: dump every inverter + battery row from live Supabase
// with the fields the engine uses to decide compatibility.
//
// Run: node server/scripts/dump-compatibility.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const INV_CATS = ['Inverters - Grid Tied', 'Inverters - Off Grid',
                  'Inverters - Commercial', 'Fronius Tauro Eco'];
const BAT_CATS = ['Batteries - Lithium'];

const { data: invs, error: e1 } = await sb.from('products')
  .select('sku, brand, name, category, is_active, specs')
  .in('category', INV_CATS)
  .order('sku');
if (e1) { console.error(e1); process.exit(1); }

const { data: bats, error: e2 } = await sb.from('products')
  .select('sku, brand, name, category, is_active, specs')
  .in('category', BAT_CATS)
  .order('sku');
if (e2) { console.error(e2); process.exit(1); }

console.log('━'.repeat(120));
console.log(`INVERTERS — ${invs.length} rows total (${invs.filter(i => i.is_active).length} active)`);
console.log('━'.repeat(120));
console.log(
  ['SKU'.padEnd(28), 'PH', 'kW'.padStart(5), 'hybrid_status'.padEnd(14),
   'is_plus'.padEnd(8), 'bat_cap'.padEnd(8), 'upg_license'.padEnd(20),
   'compatible_batteries_raw', 'active'].join(' | '));
console.log('-'.repeat(120));
for (const r of invs) {
  const s = r.specs || {};
  const phase = s.phase ?? '';
  const kw = s.ac_kw ?? s.rated_kw ?? s.kw_rating ?? '';
  const hs = s.hybrid_status ?? '';
  const isPlus = s.is_plus_variant ?? '';
  const batCap = s.battery_capable ?? '';
  const upg = s.upgrade_license_sku ?? '';
  const compat = s.compatible_batteries_raw ?? '';
  console.log([
    String(r.sku).padEnd(28),
    String(phase).padStart(2),
    String(kw).padStart(5),
    String(hs).padEnd(14),
    String(isPlus).padEnd(8),
    String(batCap).padEnd(8),
    String(upg).padEnd(20),
    String(compat).slice(0, 40),
    r.is_active ? 'Y' : 'N',
  ].join(' | '));
}

console.log();
console.log('━'.repeat(120));
console.log(`BATTERIES — ${bats.length} rows total (${bats.filter(b => b.is_active).length} active)`);
console.log('━'.repeat(120));
console.log(
  ['SKU'.padEnd(28), 'BRAND'.padEnd(10), 'series'.padEnd(10),
   'module_kwh'.padStart(10), 'chem'.padEnd(6), 'active'].join(' | '));
console.log('-'.repeat(120));
for (const r of bats) {
  const s = r.specs || {};
  console.log([
    String(r.sku).padEnd(28),
    String(r.brand || '').padEnd(10),
    String(s.series ?? s.family ?? '').padEnd(10),
    String(s.module_kwh ?? s.kwh_capacity ?? '').padStart(10),
    String(s.chemistry ?? 'LFP').padEnd(6),
    r.is_active ? 'Y' : 'N',
  ].join(' | '));
}

// ── Engine-eligibility summary ───────────────────────────────────────────────
console.log();
console.log('━'.repeat(120));
console.log('ENGINE-ELIGIBLE INVERTERS (is_active=true AND battery_capable resolved true)');
console.log('━'.repeat(120));

function resolveBatteryCapable(s) {
  if (s.battery_capable === true || s.battery_capable === 'true') return true;
  if (s.is_plus_variant === true || s.is_plus_variant === 'true') return true;
  if (s.hybrid_status === 'ready' || s.hybrid_status === 'plus') return true;
  return false;
}
const eligible = invs.filter(i => i.is_active && resolveBatteryCapable(i.specs || {}));
console.log(`Count: ${eligible.length}`);
for (const r of eligible) {
  const s = r.specs || {};
  console.log(`  ${r.sku.padEnd(28)}  ph=${s.phase || '?'}  ${s.ac_kw || s.rated_kw || '?'}kW   ${r.name}`);
}

const eligibleNoBattery = invs.filter(i => i.is_active && !resolveBatteryCapable(i.specs || {}));
console.log();
console.log(`Active inverters NOT battery-capable: ${eligibleNoBattery.length}`);
for (const r of eligibleNoBattery) {
  const s = r.specs || {};
  console.log(`  ${String(r.sku || '<null-sku>').padEnd(28)}  hybrid_status="${s.hybrid_status || ''}"  upgrade_license_sku="${s.upgrade_license_sku || ''}"`);
}

console.log();
console.log('━'.repeat(120));
console.log('BATTERY SERIES REPRESENTED');
console.log('━'.repeat(120));
const seriesSet = new Set();
for (const r of bats.filter(b => b.is_active)) {
  const s = r.specs || {};
  if (s.series || s.family) seriesSet.add(s.series || s.family);
}
console.log(`Active series: [${[...seriesSet].join(', ')}]`);
console.log(`Engine knows BMS rules for: [HVM, HVS, Reserva]`);
const unknown = [...seriesSet].filter(s => !['HVM', 'HVS', 'Reserva'].includes(s));
if (unknown.length) {
  console.log(`⚠  Series WITHOUT BMS rules (engine will skip them): [${unknown.join(', ')}]`);
}

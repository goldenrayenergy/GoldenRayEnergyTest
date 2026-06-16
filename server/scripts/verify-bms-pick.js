// Verify after dbLoader fix: BMS picker returns the real BMS, not the cable.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const { loadCatalogueFromDb } = await import('../services/pm/proposalEngine/catalogue/dbLoader.js');
const { findBmsForBattery } = await import('../services/pm/proposalEngine/catalogue/bosRoles.js');
const { buildBom } = await import('../services/pm/proposalEngine/bomBuilder.js');

const cat = await loadCatalogueFromDb(sb);

console.log('━'.repeat(80));
console.log('BMS_CONTROLLERS bucket after dbLoader fix:');
console.log('━'.repeat(80));
for (const [sku, item] of Object.entries(cat.BMS_CONTROLLERS)) {
  console.log(`  ${sku.padEnd(22)}  brand=${item.brand}  for_battery_series=${item.for_battery_series || '(none)'}  $${item.cost_nzd}`);
}

console.log();
console.log('━'.repeat(80));
console.log('findBmsForBattery() results per series:');
console.log('━'.repeat(80));
for (const series of ['HVM', 'HVS', 'Reserva']) {
  const pick = findBmsForBattery(cat, series);
  const ok = pick?.for_battery_series === series;
  console.log(`  ${series.padEnd(8)} → ${pick ? pick.sku : '(none)'}  ${ok ? '✓ correct' : '❌ wrong'}  ${pick ? '— ' + pick.name : ''}`);
}

console.log();
console.log('━'.repeat(80));
console.log('Full Krishan spec → BoM (HVM × 5 modules)');
console.log('━'.repeat(80));
const krishnaSpec = {
  customer: { full_name: 'Test', address: { region: 'auckland_vector' } },
  system: {
    panel: { sku: 'PHN-PNL-595-DRC', count: 17 },
    inverter: { sku: 'FRN-INV-100-G24P-1P' },
    battery: { sku: 'BYD-BAT-276-HVM', module_count: 5 },
    smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
    string_topology: 'series',
    cable_run_metres_estimate: 24,
    phase: 1,
  },
  pricing: { stage: 'stage_1_estimate', customer_price_inc_gst: 40500 },
};

const warnings = [];
const bom = buildBom(krishnaSpec, { catalogue: cat, warnings });
for (const item of bom) {
  console.log(`  ${String(item.sku).padEnd(22)} × ${String(item.qty).padStart(4)}  [${item.group}]  ${item.reason}`);
}
if (warnings.length) {
  console.log('\nBoM warnings:');
  for (const w of warnings) console.log(`  [${w.severity}] ${w.code}: ${w.message}`);
}

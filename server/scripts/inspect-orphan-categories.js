// Inspect the orphan categories: BMS, Battery Upgrade License, <null>, Monitoring.
// Are the missing BMS controllers actually here, just in the wrong-category bucket?
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const hr = (t) => { console.log(); console.log('━'.repeat(120)); console.log(' ' + t); console.log('━'.repeat(120)); };

const { data: bms } = await sb.from('products')
  .select('sku, brand, name, category, subcategory, cost_nzd, is_active, specs')
  .eq('category', 'BMS')
  .order('sku');
hr(`CATEGORY = 'BMS' (${bms.length} rows)`);
for (const r of bms || []) {
  console.log(`  sku=${r.sku || '<null>'}   brand=${r.brand}   active=${r.is_active}   cost=$${r.cost_nzd}`);
  console.log(`    name: ${r.name}`);
  console.log(`    subcategory: ${r.subcategory || '(none)'}`);
  console.log(`    specs.for_battery_series: ${r.specs?.for_battery_series || '(none)'}`);
  console.log(`    specs.series: ${r.specs?.series || '(none)'}`);
  console.log(`    full specs: ${JSON.stringify(r.specs || {})}`);
  console.log();
}

const { data: lic } = await sb.from('products')
  .select('sku, brand, name, category, cost_nzd, is_active, specs')
  .eq('category', 'Battery Upgrade License')
  .order('sku');
hr(`CATEGORY = 'Battery Upgrade License' (${lic.length} rows)`);
for (const r of lic || []) {
  console.log(`  sku=${r.sku}  active=${r.is_active}  cost=$${r.cost_nzd}  brand=${r.brand}`);
  console.log(`    name: ${r.name}`);
}

const { data: nulls } = await sb.from('products')
  .select('sku, brand, name, category, cost_nzd, is_active')
  .is('category', null)
  .order('sku');
hr(`CATEGORY = null (${nulls.length} rows) — currently invisible to engine`);
for (const r of nulls || []) {
  console.log(`  sku=${r.sku || '<null>'}  active=${r.is_active}  cost=$${r.cost_nzd}  brand=${r.brand}`);
  console.log(`    name: ${r.name?.slice(0, 90)}`);
}

const { data: mon } = await sb.from('products')
  .select('sku, brand, name, category, cost_nzd, is_active')
  .eq('category', 'Monitoring')
  .order('sku');
hr(`CATEGORY = 'Monitoring' (${mon.length} rows) — orphan, not in dbLoader category map`);
console.log('First 5:');
for (const r of mon.slice(0, 5)) {
  console.log(`  sku=${r.sku || '<null>'}  active=${r.is_active}  cost=$${r.cost_nzd}  ${r.name?.slice(0, 70)}`);
}
console.log(`...(+${Math.max(0, mon.length - 5)} more)`);

// ── BoS roles that are unmatched — show what's near-miss in Accessories ──
hr('Near-miss search for unmatched BoS roles in Accessories + Balance of System');
const { data: acc } = await sb.from('products')
  .select('sku, name, category, cost_nzd, is_active')
  .in('category', ['Accessories', 'Balance of System', 'Other Accessories'])
  .eq('is_active', true);

const tests = [
  { role: 'ac_spd', re: /SPD|surge/i },
  { role: 'dc_spd', re: /DC.*SPD|DC.*surge/i },
  { role: 'ac_cable_per_metre', re: /AC.*cable/i },
  { role: 'combiner_box', re: /combiner|string.*combine/i },
  { role: 'hot_water_diverter', re: /diverter|catch.power/i },
];
for (const t of tests) {
  console.log(`\n  role: ${t.role}`);
  const matches = acc.filter(r => t.re.test(r.name || ''));
  if (matches.length === 0) {
    console.log('    (no near matches)');
  } else {
    for (const m of matches.slice(0, 6)) {
      console.log(`    sku=${m.sku || '<null>'}  $${m.cost_nzd}  ${m.name?.slice(0, 85)}`);
    }
    if (matches.length > 6) console.log(`    ...(+${matches.length - 6} more)`);
  }
}

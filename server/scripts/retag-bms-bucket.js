// Re-tag the 5 leftover rows in `Battery Accessories` so the BMS bucket only
// contains real BMS controllers. Today's `Battery Accessories` rows are:
//   • Victron VE.Can to BYD CAN cable (sku: BYD-BAC-ACC-GEN)        → Cabling
//   • Victron VE.Can to Pylontech CAN cable (sku: VIC-BAC-ACC-GEN)  → Cabling
//   • ZYC SIMPO Indoor Cabinet (sku: ZYC-BAC-CAB10)                 → Battery Enclosures
//   • ZYC SIMPO Outdoor Cabinet 6 (null sku)                         → Battery Enclosures (+ assign SKU)
//   • ZYC SIMPO Outdoor Cabinet 10 (null sku)                        → Battery Enclosures (+ assign SKU)
//
// Why: after Phase B-1 the engine only matches BMS by exact
// specs.for_battery_series. These rows have empty for_battery_series so they
// wouldn't be matched even if left in the bucket. But moving them out:
//   1. Makes the catalogue self-documenting (BMS bucket = BMS units only)
//   2. Means the rows are reachable by future role-pickers (cabling /
//      enclosures) that don't currently see them because they're mis-bucketed
//
// Safety: dry-run by default, --apply to commit. Reads then updates by ID.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

console.log(`Mode: ${APPLY ? '🔧 APPLY (live write)' : '👀 DRY-RUN (no writes)'}`);
console.log();

// Plan:
//   match by name pattern → confirm category='Battery Accessories' + null SKU
//   → propose new category + assign SKU if null
const PLAN = [
  {
    matchName: /Victron VE\.Can.*CAN.*Cable.*BYD|Victron VE\.Can to CAN.*type A/i,
    newCategory: 'Balance of System',
    newSubcategory: 'Cabling',
    assignSku: null,   // SKU already present (BYD-BAC-ACC-GEN)
  },
  {
    matchName: /Victron VE\.Can.*type B|Pylontech/i,
    newCategory: 'Balance of System',
    newSubcategory: 'Cabling',
    assignSku: null,   // SKU already present (VIC-BAC-ACC-GEN)
  },
  {
    matchName: /SIMPO Indoor Cabinet 10/i,
    newCategory: 'Battery Enclosures',
    newSubcategory: null,
    assignSku: null,   // SKU already present (ZYC-BAC-CAB10)
  },
  {
    matchName: /SIMPO Outdoor Cabinet 6/i,
    newCategory: 'Battery Enclosures',
    newSubcategory: null,
    assignSku: 'ZYC-BAC-CAB06-OUT',   // currently null
  },
  {
    matchName: /SIMPO Outdoor Cabinet 10/i,
    newCategory: 'Battery Enclosures',
    newSubcategory: null,
    assignSku: 'ZYC-BAC-CAB10-OUT',   // currently null
  },
];

// ── Confirm SKU collisions for the SKU assignments ────────────────────────
const newSkus = PLAN.map(p => p.assignSku).filter(Boolean);
if (newSkus.length) {
  const { data: taken } = await sb.from('products').select('sku').in('sku', newSkus);
  if (taken?.length) {
    console.error('❌ Proposed SKU(s) already taken:');
    for (const r of taken) console.error(`  ${r.sku}`);
    process.exit(1);
  }
  console.log(`✓ Proposed SKUs ${newSkus.join(', ')} are free.`);
}

// ── Find candidate rows ───────────────────────────────────────────────────
const { data: candidates } = await sb.from('products')
  .select('id, sku, name, category, subcategory')
  .eq('category', 'Battery Accessories')
  .eq('is_active', true);

const matches = [];
for (const planEntry of PLAN) {
  const row = candidates?.find(r => planEntry.matchName.test(r.name || ''));
  if (!row) {
    console.error(`❌ No match for ${planEntry.matchName}`);
    process.exit(1);
  }
  matches.push({ row, planEntry });
}

console.log();
console.log('Plan:');
for (const { row, planEntry } of matches) {
  const newSku = planEntry.assignSku || row.sku || '<KEEP NULL>';
  console.log(`  id=${row.id}`);
  console.log(`    current sku=${row.sku || '<null>'}  → ${newSku}`);
  console.log(`    current category="${row.category}"  → "${planEntry.newCategory}"`);
  console.log(`    current subcategory="${row.subcategory || ''}"  → "${planEntry.newSubcategory || ''}"`);
  console.log(`    name: ${row.name.slice(0, 80)}`);
  console.log();
}

if (!APPLY) {
  console.log('Dry-run complete. Re-run with --apply to commit.');
  process.exit(0);
}

// ── Apply ─────────────────────────────────────────────────────────────────
console.log('Applying updates…');
for (const { row, planEntry } of matches) {
  const patch = {
    category: planEntry.newCategory,
    subcategory: planEntry.newSubcategory,
  };
  if (planEntry.assignSku) patch.sku = planEntry.assignSku;

  const { error } = await sb.from('products').update(patch).eq('id', row.id);
  if (error) { console.error(`❌ Update ${row.id} failed: ${error.message}`); process.exit(1); }
  console.log(`  ✓ ${row.id}  → category="${patch.category}"${patch.sku ? `, sku="${patch.sku}"` : ''}`);
}

// ── Verify the BMS bucket is now clean ───────────────────────────────────
console.log();
console.log('Verifying BMS bucket is clean…');
const { loadCatalogueFromDb } = await import('../services/pm/proposalEngine/catalogue/dbLoader.js');
const cat = await loadCatalogueFromDb(sb);
const bmsKeys = Object.keys(cat.BMS_CONTROLLERS);
console.log(`BMS_CONTROLLERS bucket now contains ${bmsKeys.length} rows:`);
for (const k of bmsKeys) {
  const item = cat.BMS_CONTROLLERS[k];
  console.log(`  ${k.padEnd(22)}  for_battery_series=${item.for_battery_series || '(none)'}  $${item.cost_nzd}`);
}

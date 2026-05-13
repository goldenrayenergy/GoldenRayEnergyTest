// ────────────────────────────────────────────────────────────────────────────
// Phase 1.2 — Workbook Importer
//
// Reads ~/Downloads/Goldenray_Supplier_Setup.xlsx (or a path passed as arg)
// and seeds the foundation tables from migration 019:
//   - suppliers
//   - products  (extends existing rows with supplier_id, wholesale_cost_nzd,
//                margin_target_pct, lead_time_days; inserts new rows if SKU
//                isn't in the catalogue yet)
//   - product_compatibility
//   - region_defaults
//   - cost_defaults
//
// Package_Templates sheet is DEFERRED to Phase 2 (3-quote engine) — the engine
// will use a rules-based bundler, with templates as an optional override later.
//
// Behaviour:
//   - Idempotent: upserts by natural key (short_code / sku / region_name / etc.)
//   - Skips rows whose `notes` column starts with "EXAMPLE"  unless --keep-examples flag
//   - Dry-run mode (--dry-run): parses + validates but doesn't write
//   - Validates required fields per sheet; rejects rows with errors
//   - Writes a per-sheet summary at the end
//
// Run:
//   node server/scripts/import-supplier-setup-xlsx.js              # default path
//   node server/scripts/import-supplier-setup-xlsx.js --dry-run    # validate only
//   node server/scripts/import-supplier-setup-xlsx.js path/to/file.xlsx
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import dotenv from 'dotenv';
import xlsx from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ── CLI args ────────────────────────────────────────────────────────────────
const args         = process.argv.slice(2);
const DRY_RUN      = args.includes('--dry-run');
const KEEP_EXAMPLES = args.includes('--keep-examples');
const fileArg      = args.find(a => !a.startsWith('--'));
const FILE_PATH    = fileArg
  ? path.resolve(fileArg)
  : path.join(os.homedir(), 'Downloads', 'Goldenray_Supplier_Setup.xlsx');

if (!existsSync(FILE_PATH)) {
  console.error(`✗ File not found: ${FILE_PATH}`);
  console.error('  Generate it first with: node server/scripts/build-supplier-setup-xlsx.js');
  process.exit(1);
}

// ── Supabase client (REST — avoids the direct-DB DNS issue) ─────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('✗ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env (needed for writes; use --dry-run to skip)');
  process.exit(1);
}
const supabase = (!DRY_RUN) ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

// ── Helpers ────────────────────────────────────────────────────────────────
function logSection(label) {
  console.log('\n' + '═'.repeat(76));
  console.log(' ' + label);
  console.log('═'.repeat(76));
}

function isExampleRow(row) {
  if (KEEP_EXAMPLES) return false;
  const n = (row.notes || row.Notes || '').toString();
  return /^\s*example/i.test(n);
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function int(v) {
  const n = num(v);
  return n == null ? null : Math.round(n);
}
function str(v) {
  if (v === '' || v == null) return null;
  return String(v).trim();
}
function bool(v) {
  if (v === '' || v == null) return null;
  const s = String(v).trim().toLowerCase();
  return ['true', 'yes', 'y', '1'].includes(s);
}

// Parse a sheet to objects keyed by snake_case header.
// Excel-generated headers come back as the human-readable labels we wrote in
// build-supplier-setup-xlsx.js. We normalise them back to the snake_case keys
// the importer expects.
function parseSheet(wb, sheetName, columnMap) {
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.warn(`  ⚠ Sheet "${sheetName}" not found — skipping`);
    return [];
  }
  const rawRows = xlsx.utils.sheet_to_json(ws, { defval: '' });
  return rawRows.map(raw => {
    const out = {};
    for (const [snakeKey, humanLabels] of Object.entries(columnMap)) {
      for (const label of humanLabels) {
        if (raw[label] !== undefined && raw[label] !== '') {
          out[snakeKey] = raw[label];
          break;
        }
      }
      if (!(snakeKey in out)) out[snakeKey] = '';
    }
    return out;
  });
}

// ── Read workbook ──────────────────────────────────────────────────────────
console.log(`\nReading ${FILE_PATH}`);
console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'LIVE WRITES'}${KEEP_EXAMPLES ? ' · keeping EXAMPLE rows' : ''}`);
const wb = xlsx.read(readFileSync(FILE_PATH), { type: 'buffer' });

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ SHEET — Suppliers                                                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝
logSection('SUPPLIERS');

const supplierRows = parseSheet(wb, 'Suppliers', {
  supplier_name:            ['Supplier Name'],
  short_code:               ['Short Code'],
  category_focus:           ['Category Focus'],
  tier:                     ['Tier (t1/t2/t3)', 'Tier'],
  contract_status:          ['Status (active/probation/paused)', 'Status'],
  contract_start_date:      ['Contract Start (YYYY-MM-DD)'],
  contract_renewal_date:    ['Renewal Date (YYYY-MM-DD)'],
  min_volume_target_yearly: ['Min Volume / Year'],
  volume_unit:              ['Volume Unit (panels/inverters/batteries/mixed)', 'Volume Unit'],
  marketing_cofund_pct:     ['Marketing Co-fund %'],
  rep_name:                 ['Rep / Account Manager'],
  rep_email:                ['Rep Email'],
  rep_phone:                ['Rep Phone'],
  notes:                    ['Notes'],
});

// Normalize tier values: accept "t1", "t1_strategic", "tier 1", "Tier-1" etc.
function normalizeTier(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (/t1|tier\s*-?\s*1|strategic/.test(s)) return 't1_strategic';
  if (/t2|tier\s*-?\s*2|volume/.test(s))    return 't2_volume';
  if (/t3|tier\s*-?\s*3|opportun/.test(s))  return 't3_opportunistic';
  return null;
}

const suppliersToImport = [];
const supplierErrors = [];

for (const r of supplierRows) {
  if (isExampleRow(r)) continue;
  if (!str(r.supplier_name) || !str(r.short_code)) continue;  // truly blank rows

  const tier = normalizeTier(r.tier);
  if (!tier) {
    supplierErrors.push(`${r.short_code || r.supplier_name}: invalid tier "${r.tier}"`);
    continue;
  }
  const contractStatus = ['active', 'probation', 'paused', 'terminated']
    .includes(String(r.contract_status || '').toLowerCase().trim())
    ? String(r.contract_status).toLowerCase().trim()
    : 'active';

  suppliersToImport.push({
    name:                     str(r.supplier_name),
    short_code:               str(r.short_code).toUpperCase(),
    category_focus:           str(r.category_focus),
    tier,
    contract_status:          contractStatus,
    contract_start_date:      str(r.contract_start_date),
    contract_renewal_date:    str(r.contract_renewal_date),
    min_volume_target_yearly: int(r.min_volume_target_yearly),
    volume_unit:              str(r.volume_unit),
    marketing_cofund_pct:     num(r.marketing_cofund_pct) || 0,
    rep_name:                 str(r.rep_name),
    rep_email:                str(r.rep_email),
    rep_phone:                str(r.rep_phone),
    notes:                    str(r.notes),
    is_active:                true,
  });
}

if (supplierErrors.length) {
  console.log(`  ⚠ ${supplierErrors.length} validation error(s):`);
  for (const e of supplierErrors) console.log(`     - ${e}`);
}

// Map for FK lookup (short_code → id, populated after upsert)
const supplierIdByShortCode = new Map();

if (!DRY_RUN && suppliersToImport.length) {
  const { data, error } = await supabase
    .from('suppliers')
    .upsert(suppliersToImport, { onConflict: 'short_code', ignoreDuplicates: false })
    .select('id, short_code');
  if (error) { console.error('  ✗ Upsert failed:', error.message); process.exit(1); }
  for (const row of (data || [])) supplierIdByShortCode.set(row.short_code, row.id);
}
console.log(`  ${DRY_RUN ? 'would write' : 'wrote'} ${suppliersToImport.length} supplier(s)`);

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ SHEET — Products                                                         ║
// ╚══════════════════════════════════════════════════════════════════════════╝
logSection('PRODUCTS');

const productRows = parseSheet(wb, 'Products', {
  sku:                  ['SKU'],
  product_name:         ['Product Name'],
  category:             ['Category (panel/inverter/battery/racking/bos)', 'Category'],
  supplier_short_code:  ['Supplier Short Code'],
  model_number:         ['Model Number'],
  wattage_w:            ['Wattage (W) — panels', 'Wattage'],
  kw_rating:            ['kW Rating — inverters', 'kW Rating'],
  kwh_capacity:         ['kWh Capacity — batteries', 'kWh Capacity'],
  phase:                ['Phase (1-phase/3-phase)', 'Phase'],
  wholesale_cost_nzd:   ['Wholesale Cost $NZ (your cost)', 'Wholesale Cost $NZ'],
  rrp_nzd:              ['Supplier RRP $NZ (optional)', 'Supplier RRP $NZ'],
  margin_target_pct:    ['Margin Target %'],
  lead_time_days:       ['Lead Time (days)'],
  datasheet_url:        ['Datasheet URL'],
  notes:                ['Notes'],
});

// Pre-load existing products so we know which to insert vs update
let existingProducts = new Map();
if (!DRY_RUN) {
  const { data, error } = await supabase.from('products').select('id, sku');
  if (error) { console.error('  ✗ Fetch existing products failed:', error.message); process.exit(1); }
  for (const p of (data || [])) existingProducts.set(p.sku, p.id);
}

let productUpdates = 0, productInserts = 0, productErrors = [];

for (const r of productRows) {
  if (isExampleRow(r)) continue;
  if (!str(r.sku)) continue;

  const sku = str(r.sku);
  let supplierId = null;
  if (r.supplier_short_code) {
    const shortCode = String(r.supplier_short_code).toUpperCase().trim();
    supplierId = supplierIdByShortCode.get(shortCode);
    if (!supplierId && !DRY_RUN) {
      productErrors.push(`SKU ${sku}: supplier short_code "${shortCode}" not found`);
      continue;
    }
  }

  // Common fields for both insert and update paths
  const productFields = {
    supplier_id:          supplierId,
    wholesale_cost_nzd:   num(r.wholesale_cost_nzd),
    margin_target_pct:    num(r.margin_target_pct),
    lead_time_days:       int(r.lead_time_days),
  };

  if (!DRY_RUN) {
    if (existingProducts.has(sku)) {
      // UPDATE — preserve existing name/category/etc, just update the new columns
      const { error } = await supabase
        .from('products')
        .update(productFields)
        .eq('sku', sku);
      if (error) { productErrors.push(`SKU ${sku}: ${error.message}`); continue; }
      productUpdates++;
    } else {
      // INSERT new product — needs full record
      const insert = {
        sku,
        name:        str(r.product_name) || sku,
        category:    str(r.category) || 'bos',
        cost_nzd:    num(r.wholesale_cost_nzd) || 0,  // legacy field, mirror wholesale for now
        sell_excl_gst_nzd: num(r.rrp_nzd),
        ...productFields,
      };
      const { error } = await supabase.from('products').insert(insert);
      if (error) { productErrors.push(`SKU ${sku}: ${error.message}`); continue; }
      productInserts++;
    }
  } else {
    if (existingProducts.has(sku)) productUpdates++; else productInserts++;
  }
}
if (productErrors.length) {
  console.log(`  ⚠ ${productErrors.length} error(s):`);
  for (const e of productErrors.slice(0, 10)) console.log(`     - ${e}`);
  if (productErrors.length > 10) console.log(`     ... and ${productErrors.length - 10} more`);
}
console.log(`  ${DRY_RUN ? 'would' : ''} update ${productUpdates}, insert ${productInserts}`);

// SKU → product_id map (for compatibility lookups)
const productIdBySku = new Map(existingProducts);
if (!DRY_RUN && productInserts > 0) {
  const { data } = await supabase.from('products').select('id, sku');
  for (const p of (data || [])) productIdBySku.set(p.sku, p.id);
}

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ SHEET — Compatibility                                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝
logSection('COMPATIBILITY');

const compatRows = parseSheet(wb, 'Compatibility', {
  pairing_type:    ['Pairing Type (panel_inverter / inverter_battery / inverter_meter)', 'Pairing Type'],
  product_a_sku:   ['Product A SKU'],
  product_a_name:  ['Product A Name'],
  product_b_sku:   ['Product B SKU'],
  product_b_name:  ['Product B Name'],
  string_min:      ['String Min (panels)', 'String Min'],
  string_max:      ['String Max (panels)', 'String Max'],
  voltage_range:   ['DC Voltage Range'],
  verified_by:     ['Verified By (Master Electrician)', 'Verified By'],
  verified_date:   ['Verified Date (YYYY-MM-DD)', 'Verified Date'],
  notes:           ['Notes'],
});

const compatToImport = [];
const compatErrors = [];
for (const r of compatRows) {
  if (isExampleRow(r)) continue;
  if (!str(r.product_a_sku) || !str(r.product_b_sku)) continue;

  const pt = String(r.pairing_type || '').trim().toLowerCase();
  if (!['panel_inverter', 'inverter_battery', 'inverter_meter'].includes(pt)) {
    compatErrors.push(`Pairing ${r.product_a_sku}↔${r.product_b_sku}: invalid pairing_type "${r.pairing_type}"`);
    continue;
  }

  const aId = productIdBySku.get(str(r.product_a_sku));
  const bId = productIdBySku.get(str(r.product_b_sku));
  if (!aId) { compatErrors.push(`Pairing: product_a_sku "${r.product_a_sku}" not found`); continue; }
  if (!bId) { compatErrors.push(`Pairing: product_b_sku "${r.product_b_sku}" not found`); continue; }

  compatToImport.push({
    pairing_type:  pt,
    product_a_id:  aId,
    product_b_id:  bId,
    string_min:    int(r.string_min),
    string_max:    int(r.string_max),
    voltage_range: str(r.voltage_range),
    verified_by:   str(r.verified_by),
    verified_at:   str(r.verified_date),
    notes:         str(r.notes),
  });
}

if (compatErrors.length) {
  console.log(`  ⚠ ${compatErrors.length} error(s):`);
  for (const e of compatErrors.slice(0, 10)) console.log(`     - ${e}`);
}

if (!DRY_RUN && compatToImport.length) {
  // Upsert by pairing_type + product_a_id + product_b_id
  const { error } = await supabase
    .from('product_compatibility')
    .upsert(compatToImport, { onConflict: 'pairing_type,product_a_id,product_b_id' });
  if (error) { console.error('  ✗ Upsert failed:', error.message); process.exit(1); }
}
console.log(`  ${DRY_RUN ? 'would write' : 'wrote'} ${compatToImport.length} pairing(s)`);

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ SHEET — Region_Defaults                                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝
logSection('REGION_DEFAULTS');

const regionRows = parseSheet(wb, 'Region_Defaults', {
  region_name:                       ['Region'],
  postcode_prefix:                   ['Postcode Prefix (e.g. 06=Auck)', 'Postcode Prefix'],
  sun_hours_daily:                   ['Sun Hours / Day (avg)', 'Sun Hours / Day'],
  avg_household_kwh_yearly:          ['Avg Household kWh / Year'],
  avg_monthly_bill_nzd:              ['Avg Monthly Bill $NZ'],
  typical_self_consumption_pct:      ['Typical Self-Consumption %'],
  with_battery_self_consumption_pct: ['Self-Consumption with Battery %'],
  irradiance_kwh_m2_yearly:          ['Irradiance kWh/m²/yr', 'Irradiance kWh/m2/yr'],
  notes:                             ['Notes'],
});

const regionsToImport = [];
for (const r of regionRows) {
  if (isExampleRow(r)) continue;
  if (!str(r.region_name)) continue;
  regionsToImport.push({
    region_name:                       str(r.region_name),
    postcode_prefix:                   str(r.postcode_prefix),
    sun_hours_daily:                   num(r.sun_hours_daily),
    avg_household_kwh_yearly:          int(r.avg_household_kwh_yearly),
    avg_monthly_bill_nzd:              num(r.avg_monthly_bill_nzd),
    typical_self_consumption_pct:      num(r.typical_self_consumption_pct),
    with_battery_self_consumption_pct: num(r.with_battery_self_consumption_pct),
    irradiance_kwh_m2_yearly:          int(r.irradiance_kwh_m2_yearly),
    notes:                             str(r.notes),
    is_active:                         true,
  });
}

if (!DRY_RUN && regionsToImport.length) {
  const { error } = await supabase
    .from('region_defaults')
    .upsert(regionsToImport, { onConflict: 'region_name' });
  if (error) { console.error('  ✗ Upsert failed:', error.message); process.exit(1); }
}
console.log(`  ${DRY_RUN ? 'would write' : 'wrote'} ${regionsToImport.length} region(s)`);

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ SHEET — Cost_Defaults                                                    ║
// ╚══════════════════════════════════════════════════════════════════════════╝
logSection('COST_DEFAULTS');

const costRows = parseSheet(wb, 'Cost_Defaults', {
  cost_type:  ['Cost Type'],
  cost_nzd:   ['Cost $NZ'],
  unit:       ['Unit (fixed / per_kw / per_panel / per_floor)', 'Unit'],
  applies_to: ['Applies To (all / residential / commercial / battery_only)', 'Applies To'],
  notes:      ['Notes'],
});

const costErrors = [];
const costsToImport = [];
for (const r of costRows) {
  if (isExampleRow(r)) continue;
  if (!str(r.cost_type)) continue;
  const unit       = String(r.unit || 'fixed').trim().toLowerCase();
  const appliesTo  = String(r.applies_to || 'all').trim().toLowerCase();

  if (!['fixed', 'per_kw', 'per_panel', 'per_floor'].includes(unit)) {
    costErrors.push(`${r.cost_type}: invalid unit "${r.unit}"`);
    continue;
  }
  if (!['all', 'residential', 'commercial', 'battery_only', 'multi_floor_only'].includes(appliesTo)) {
    costErrors.push(`${r.cost_type}: invalid applies_to "${r.applies_to}"`);
    continue;
  }

  costsToImport.push({
    cost_type:  str(r.cost_type),
    cost_nzd:   num(r.cost_nzd) || 0,
    unit,
    applies_to: appliesTo,
    notes:      str(r.notes),
    is_active:  true,
  });
}

if (costErrors.length) {
  console.log(`  ⚠ ${costErrors.length} error(s):`);
  for (const e of costErrors) console.log(`     - ${e}`);
}

if (!DRY_RUN && costsToImport.length) {
  // No natural unique key on cost_defaults, so wipe + replace within a single call set
  await supabase.from('cost_defaults').delete().eq('is_active', true);
  const { error } = await supabase.from('cost_defaults').insert(costsToImport);
  if (error) { console.error('  ✗ Insert failed:', error.message); process.exit(1); }
}
console.log(`  ${DRY_RUN ? 'would write' : 'wrote'} ${costsToImport.length} cost component(s)`);

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ Summary                                                                  ║
// ╚══════════════════════════════════════════════════════════════════════════╝
console.log('\n' + '═'.repeat(76));
console.log(' IMPORT COMPLETE' + (DRY_RUN ? ' (dry run — no DB writes)' : ''));
console.log('═'.repeat(76));
console.log(`  Suppliers              : ${suppliersToImport.length}`);
console.log(`  Products (updated)     : ${productUpdates}`);
console.log(`  Products (inserted)    : ${productInserts}`);
console.log(`  Compatibility pairings : ${compatToImport.length}`);
console.log(`  Region defaults        : ${regionsToImport.length}`);
console.log(`  Cost defaults          : ${costsToImport.length}`);
console.log('');
console.log('  Note: Package_Templates sheet was NOT imported — that data is consumed');
console.log('  by the 3-quote engine at runtime in Phase 2.');
console.log('');

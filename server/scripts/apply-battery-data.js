// Merges battery data from
//   docs/Products/Excel/Excel/Battery Master Database.xlsx
// into Supabase:
//   1. Spec-fills the existing battery module rows in `products.specs`
//      (capacity_kwh, usable_kwh, chemistry, etc.)
//   2. Populates the new `battery_systems` table from Sheet1 (13 system defs)
//   3. Populates `inverter_battery_compat` from Sheet2 (228 rows)
//
// REQUIRES migration 028_battery_systems_and_compat.sql to be applied first.
//
// USAGE:
//   node server/scripts/apply-battery-data.js --dry-run
//   node server/scripts/apply-battery-data.js              # writes

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  (process.env.SUPABASE_URL || '').replace(/['"]/g, ''),
  (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/['"]/g, ''),
);

const DRY_RUN = process.argv.includes('--dry-run');
const SOURCE_XLSX = path.resolve(__dirname, '../../docs/Products/Excel/Excel/Battery Master Database.xlsx');

// ── 1. Map external inverter SKU → canonical (re-use rules from inverter merge) ─
function canonicalInverterSku(extSku) {
  const s = (extSku || '').trim();
  // Strip trailing 'SC' that appears on some Symo SKUs (e.g. FR-SYMO-G24P-12.0SC)
  const sNorm = s.replace(/SC$/, '');
  let m;
  // Plus variants — match BOTH "GEN24-PLUS-" and the shorter "G24P-" used in compat sheet
  if ((m = sNorm.match(/^FR-PRIMO-(?:GEN24-PLUS|G24P)-(\d+\.?\d*)$/))) {
    return `FRN-INV-${Math.round(parseFloat(m[1]) * 10)}-G24P-1P`;
  }
  if ((m = sNorm.match(/^FR-PRIMO-(?:GEN24|G24)-(\d+\.?\d*)$/))) {
    return `FRN-INV-${Math.round(parseFloat(m[1]) * 10)}-G24`;
  }
  if ((m = sNorm.match(/^FR-SYMO-(?:GEN24-PLUSSC|GEN24-PLUS|G24P)-(\d+\.?\d*)$/))) {
    return `FRN-INV-${Math.round(parseFloat(m[1]) * 10)}-SYMP-3P`;
  }
  if ((m = sNorm.match(/^FR-SYMO-(?:GEN24SC|GEN24|G24)-(\d+\.?\d*)$/))) {
    return `FRN-INV-${Math.round(parseFloat(m[1]) * 10)}-SYMO`;
  }
  if ((m = sNorm.match(/^FR-VERTO-(?:PLUS|P)-(\d+\.?\d*)$/))) {
    return `FRN-INV-${Math.round(parseFloat(m[1]) * 10)}-VRTP-3P`;
  }
  if ((m = sNorm.match(/^FR-VERTO-(\d+\.?\d*)$/))) {
    return `FRN-INV-${Math.round(parseFloat(m[1]) * 10)}-VRTO-3P`;
  }
  return null;
}

// ── 2. Define which products compose which battery system ──────────────────
// Each system maps to its physical component SKUs (in products table).
// Component count is derived from system capacity / per-module capacity —
// the Min/Max Modules columns in Sheet1 refer to STACK ranges of the assembled
// unit, not the count of physical modules inside this particular SKU.
const MODULE_KWH = { Reserva: 3.15, HVS: 2.56, HVM: 2.76 };

function componentsFor(systemSku, capacityKwh) {
  if (systemSku.startsWith('FR-RES-')) {
    const qty = Math.round(capacityKwh / MODULE_KWH.Reserva);
    return [
      { sku: 'FRN-BAT-315-RSV', qty },               // N × 3.15 kWh modules
      { sku: 'FRN-BAC-ACC-RSV', qty: 1 },            // + 1 BMS
    ];
  }
  if (systemSku.startsWith('BYD-HVS-')) {
    const qty = Math.round(capacityKwh / MODULE_KWH.HVS);
    return [{ sku: 'BYD-BAT-256-HVS', qty }];
  }
  if (systemSku.startsWith('BYD-HVM-')) {
    const qty = Math.round(capacityKwh / MODULE_KWH.HVM);
    return [{ sku: 'BYD-BAT-276-HVM', qty }];
  }
  return [];
}

// ── 3. Read Battery Master Database ────────────────────────────────────────
function readSheets() {
  if (!fs.existsSync(SOURCE_XLSX)) throw new Error(`Source xlsx not found: ${SOURCE_XLSX}`);
  const wb = XLSX.readFile(SOURCE_XLSX);

  // Sheet1 — battery systems master (cols A-N: SKU, Brand, Model, Chemistry, Voltage Type, Usable kWh, Total kWh, ...)
  const sys = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { defval: null });

  // Sheet2 — compatibility matrix. Header on row 5 → use { range: 4 }
  const compat = XLSX.utils.sheet_to_json(wb.Sheets['Sheet2'], { range: 4, defval: null });

  // Sheet3 — deep battery specs (chemistry, voltage range, IP, CAN/RS485). Header on row 6 → { range: 5 }
  const deep = XLSX.utils.sheet_to_json(wb.Sheets['Sheet3'], { range: 5, defval: null });

  return { sys, compat, deep };
}

function parseBool(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === 'yes' || s === 'true') return true;
  if (s === 'no' || s === 'false') return false;
  return null;
}

// ── 4. Build battery_systems rows ──────────────────────────────────────────
function buildBatterySystems({ sys, deep }) {
  // Index Sheet3 by brand+model for enrichment (chemistry, voltage range, IP)
  const deepBy = {};
  for (const d of deep) {
    const key = `${(d['Brand'] || '').toLowerCase()}|${(d['Battery Model'] || '').toLowerCase()}`;
    deepBy[key] = d;
  }

  const out = [];
  for (const r of sys) {
    const sku = r['SKU']; if (!sku) continue;
    const brand = r['Brand'];
    const model = r['Model'];
    const deepKey = `${(brand || '').toLowerCase()}|${(model || '').toLowerCase()}`;
    const d = deepBy[deepKey] || {};

    // Family inference — first word of model
    const family = (model || '').split(' ')[0];

    const minModules = Number(r['Min Modules']) || 1;
    const maxModules = Number(r['Max Modules']) || 1;
    const capacityKwh = Number(r['Total kWh']) || null;
    const components = componentsFor(sku, capacityKwh);

    out.push({
      system_sku: sku,
      brand: brand,
      family,
      display_name: `${brand} ${model}`,
      capacity_kwh: Number(r['Total kWh']) || null,
      usable_kwh: Number(r['Usable kWh']) || null,
      chemistry: r['Chemistry'] || d['Chemistry'] || null,
      voltage_type: r['Voltage Type'] || null,
      voltage_min_v: d['Battery Voltage Min'] || null,
      voltage_max_v: d['Battery Voltage Max'] || null,
      min_modules: minModules,
      max_modules: maxModules,
      parallel_allowed: parseBool(r['Parallel Allowed']),
      max_parallel_towers: Number(r['Max Parallel Towers']) || null,
      warranty_years: Number(r['Warranty Years']) || null,
      soh_pct_at_warranty: Number(r['SOH %']) || null,
      throughput_mwh: r['Throughput MWh'] != null ? String(r['Throughput MWh']) : null,
      bms_included: parseBool(d['BMS Included']),
      indoor_rated: parseBool(d['Indoor Rated']),
      outdoor_rated: parseBool(d['Outdoor Rated']),
      ip_rating: d['IP Rating'] || null,
      bms_protocol_can: parseBool(d['CAN Protocol']),
      bms_protocol_rs485: parseBool(d['RS485 Protocol']),
      components: components,
      source: 'battery_master_database_v1',
      is_active: true,
    });
  }
  return out;
}

// ── 5. Build inverter_battery_compat rows ──────────────────────────────────
function buildCompatRows({ compat }) {
  const rows = [];
  const unmapped = new Set();
  for (const r of compat) {
    const extInv = r['Inverter SKU'];
    const batSku = r['Excel Sheet: Inverter_Battery_Compatibility'];   // exact header from Sheet2 row 5
    // Stop at non-data rows (sub-tables below) — when both inverter + battery are blank
    if (!extInv && !batSku) continue;
    if (!extInv) continue;
    // Skip the header row that re-appears (sheet_to_json sometimes returns it)
    if (extInv === 'Inverter SKU') continue;
    const canonical = canonicalInverterSku(extInv);
    if (!canonical) { unmapped.add(extInv); continue; }
    if (!batSku) continue;
    rows.push({
      inverter_sku: canonical,
      battery_system_sku: batSku,
      is_compatible: parseBool(r['Compatible']) ?? true,
      min_battery_kwh: Number(r['Min Battery']) || null,
      max_battery_kwh: Number(r['Max Battery']) || null,
      max_towers: Number(r['Max Towers']) || null,
      max_capacity_kwh: Number(r['Max Capacity']) || null,
      charge_kw: Number(r['Charge kW']) || null,
      discharge_kw: Number(r['Discharge kW']) || null,
      full_backup: parseBool(r['Full Backup']),
      source: 'battery_master_database_v1',
    });
  }
  return { rows, unmapped: [...unmapped] };
}

// ── 6. Spec-fill existing battery module rows in products ──────────────────
function buildModuleSpecs({ sys, deep }) {
  // Map current product SKUs to spec from Sheet1+Sheet3
  // FRN-BAT-315-RSV: each module is 3.15 kWh; use FR-RES-6.3 / 2 = 3.15 implicit
  const moduleSpecs = {
    'FRN-BAT-315-RSV': {
      capacity_kwh: 3.15,
      usable_kwh: 2.83,
      chemistry: 'LFP',
      voltage_type: 'HV',
      family: 'Reserva',
      stackable: true,
      modules_per_stack_min: 2,
      modules_per_stack_max: 5,
      bms_included: false,
      composes_systems: ['FR-RES-6.3', 'FR-RES-9.5', 'FR-RES-12.6', 'FR-RES-15.8'],
      spec_source: 'battery_master_database_v1',
    },
    'FRN-BAC-ACC-RSV': {
      chemistry: 'BMS only',
      family: 'Reserva',
      bms_included: true,
      role: 'bms',
      composes_systems: ['FR-RES-6.3', 'FR-RES-9.5', 'FR-RES-12.6', 'FR-RES-15.8'],
      spec_source: 'battery_master_database_v1',
    },
    'BYD-BAT-256-HVS': {
      capacity_kwh: 2.56,
      usable_kwh: 2.3,
      chemistry: 'LFP',
      voltage_type: 'HV',
      family: 'HVS',
      stackable: true,
      modules_per_stack_min: 2,
      modules_per_stack_max: 5,
      bms_included: true,
      composes_systems: ['BYD-HVS-5.1', 'BYD-HVS-7.7', 'BYD-HVS-10.2', 'BYD-HVS-12.8'],
      spec_source: 'battery_master_database_v1',
    },
    'BYD-BAT-276-HVM': {
      capacity_kwh: 2.76,
      usable_kwh: 2.48,
      chemistry: 'LFP',
      voltage_type: 'HV',
      family: 'HVM',
      stackable: true,
      modules_per_stack_min: 4,
      modules_per_stack_max: 8,
      bms_included: true,
      composes_systems: ['BYD-HVM-11.0', 'BYD-HVM-13.8', 'BYD-HVM-16.6', 'BYD-HVM-19.3', 'BYD-HVM-22.1'],
      spec_source: 'battery_master_database_v1',
    },
    'BYD-BAT-1540-LVL-A': {
      capacity_kwh: 15.4,
      usable_kwh: 13.86,
      chemistry: 'LFP',
      voltage_type: 'LV',
      family: 'LVL',
      stackable: false,
      bms_included: true,
      role: 'standalone_system',
      spec_source: 'battery_master_database_v1',
    },
    'FRW-BAT-500-ETW': {
      capacity_kwh: 5,
      usable_kwh: 4.5,
      chemistry: 'LFP',
      family: 'eTower',
      stackable: true,
      bms_included: true,
      spec_source: 'battery_master_database_v1',
    },
    'ZYC-BAT-512-SMP': {
      capacity_kwh: 5.12,
      usable_kwh: 4.61,
      chemistry: 'LFP',
      family: 'SIMPO',
      stackable: true,
      bms_included: true,
      spec_source: 'battery_master_database_v1',
    },
  };
  return moduleSpecs;
}

// ── 7. Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`APPLY-BATTERY-DATA  ${DRY_RUN ? '— DRY RUN' : '— WRITING TO SUPABASE'}`);
  console.log(`${'='.repeat(72)}\n`);

  const sheets = readSheets();
  console.log(`Sheet1 (systems master):       ${sheets.sys.length} rows`);
  console.log(`Sheet2 (compat matrix):        ${sheets.compat.length} rows`);
  console.log(`Sheet3 (deep specs):           ${sheets.deep.length} rows\n`);

  // Build the three datasets
  const batterySystems = buildBatterySystems(sheets);
  const { rows: compatRows, unmapped } = buildCompatRows(sheets);
  const moduleSpecs = buildModuleSpecs(sheets);

  console.log(`Built ${batterySystems.length} battery_systems rows`);
  console.log(`Built ${compatRows.length} inverter_battery_compat rows`);
  if (unmapped.length) console.log(`  ⚠ Unmapped inverter SKUs in compat matrix: ${unmapped.length}`);
  console.log(`Built ${Object.keys(moduleSpecs).length} module spec updates\n`);

  // Verify the new tables exist
  if (!DRY_RUN) {
    const { error: tblErr } = await supabase.from('battery_systems').select('id').limit(1);
    if (tblErr && tblErr.message.includes('does not exist')) {
      console.error('✗ battery_systems table does not exist. Apply migration 028 first:');
      console.error('  psql or paste 028_battery_systems_and_compat.sql into Supabase SQL Editor');
      process.exit(1);
    }
  }

  // Log dump
  const outDir = path.join(__dirname, 'out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, 'apply-battery-data.log'), JSON.stringify({
    timestamp: new Date().toISOString(), dry_run: DRY_RUN,
    counts: { battery_systems: batterySystems.length, compat: compatRows.length, modules: Object.keys(moduleSpecs).length },
    unmapped_inverter_skus: unmapped,
    battery_systems_preview: batterySystems.slice(0, 3),
    compat_preview: compatRows.slice(0, 5),
    module_specs: moduleSpecs,
  }, null, 2));
  console.log(`✓ Log: server/scripts/out/apply-battery-data.log\n`);

  if (DRY_RUN) {
    console.log('Preview — first 5 battery_systems rows:');
    for (const r of batterySystems.slice(0, 5)) {
      console.log(`  ${r.system_sku.padEnd(16)} ${r.display_name.padEnd(28)} cap=${r.capacity_kwh} family=${r.family} components=${JSON.stringify(r.components)}`);
    }
    console.log('\nPreview — first 5 compat rows:');
    for (const r of compatRows.slice(0, 5)) {
      console.log(`  ${r.inverter_sku.padEnd(24)} → ${r.battery_system_sku.padEnd(16)} min=${r.min_battery_kwh}kWh max=${r.max_battery_kwh}kWh charge=${r.charge_kw}kW`);
    }
    console.log('\nPreview — module spec writes:');
    for (const [sku, spec] of Object.entries(moduleSpecs)) {
      console.log(`  ${sku.padEnd(22)} ${Object.keys(spec).join(', ')}`);
    }
    console.log('\nDRY RUN — no writes performed.');
    return;
  }

  // Upsert battery_systems
  console.log(`Upserting ${batterySystems.length} battery_systems rows...`);
  const { error: bsErr } = await supabase.from('battery_systems').upsert(batterySystems, { onConflict: 'system_sku' });
  if (bsErr) { console.error('  ✗ battery_systems upsert failed:', bsErr.message); process.exit(1); }
  console.log(`  ✓ battery_systems: ${batterySystems.length} rows`);

  // Upsert inverter_battery_compat
  console.log(`Upserting ${compatRows.length} compat rows (in batches of 100)...`);
  let compatOk = 0;
  for (let i = 0; i < compatRows.length; i += 100) {
    const batch = compatRows.slice(i, i + 100);
    const { error } = await supabase.from('inverter_battery_compat').upsert(batch, { onConflict: 'inverter_sku,battery_system_sku' });
    if (error) { console.error(`  ✗ batch ${i}-${i+batch.length}: ${error.message}`); }
    else { compatOk += batch.length; }
  }
  console.log(`  ✓ inverter_battery_compat: ${compatOk}/${compatRows.length} rows`);

  // Spec-fill module products
  console.log(`Updating ${Object.keys(moduleSpecs).length} module product specs...`);
  for (const [sku, newSpec] of Object.entries(moduleSpecs)) {
    const { data: existing } = await supabase.from('products').select('id,specs').eq('sku', sku).maybeSingle();
    if (!existing) { console.log(`  ⚠ ${sku}: not found in products`); continue; }
    const merged = { ...(existing.specs || {}), ...newSpec };
    const { error } = await supabase.from('products').update({ specs: merged, updated_at: new Date().toISOString() }).eq('id', existing.id);
    if (error) { console.log(`  ✗ ${sku}: ${error.message}`); }
    else { console.log(`  ✓ ${sku}`); }
  }

  console.log(`\nDone.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

// Merges Fronius inverter specs from
//   docs/Products/Excel/Excel/Goldenray Energy Fronius Inverter Database,.xlsx
// into the `products.specs` jsonb column in Supabase.
//
// USAGE:
//   node server/scripts/apply-fronius-inverter-specs.js --dry-run
//   node server/scripts/apply-fronius-inverter-specs.js

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
const DEFAULT_PANEL_W = 475;
const SOURCE_XLSX = path.resolve(__dirname, '../../docs/Products/Excel/Excel/Goldenray Energy Fronius Inverter Database,.xlsx');

function canonicalCandidates(externalSku, family, ratedKw) {
  const size = Math.round(ratedKw * 10);
  const f = (family || '').trim().toUpperCase();
  if (f === 'GEN24') return [`FRN-INV-${size}-G24`, `FRN-INV-${size}-G24-1P`];
  if (f === 'GEN24 PLUS') return [`FRN-INV-${size}-G24P-1P`, `FRN-INV-${size}-G24P`];
  if (f === 'SYMO GEN24 SC') return [`FRN-INV-${size}-SYMO`, `FRN-INV-${size}-SYMO-3P`];
  if (f === 'SYMO GEN24 PLUS SC') return [`FRN-INV-${size}-SYMP-3P`, `FRN-INV-${size}-SYMP`];
  if (f === 'VERTO') return [`FRN-INV-${size}-VRTO-3P`, `FRN-INV-${size}-VRTO`];
  if (f === 'VERTO PLUS') return [`FRN-INV-${size}-VRTP-3P`, `FRN-INV-${size}-VRTP`];
  return [];
}

function parseBool(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === 'yes' || s === 'true' || s.startsWith('yes')) return true;
  if (s === 'no' || s === 'false') return false;
  return null;
}
function parsePhase(v) { if (!v) return null; const s = String(v).trim().toUpperCase(); if (s.startsWith('1')) return 1; if (s.startsWith('3')) return 3; return null; }
function parseHybridStatus(v) { if (!v) return null; const s = String(v).toLowerCase(); if (s.includes('upgrade')) return 'upgrade'; if (s.startsWith('yes')) return 'ready'; if (s.startsWith('no')) return 'none'; return null; }

function readExternalSheet() {
  if (!fs.existsSync(SOURCE_XLSX)) throw new Error(`Source xlsx not found: ${SOURCE_XLSX}`);
  const wb = XLSX.readFile(SOURCE_XLSX);
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { range: 4, defval: null });
}

function buildSpecFromRow(r) {
  const ratedKw = Number(r['Rated_kW']);
  const phase = parsePhase(r['Phase']);
  const mppts = Number(r['MPPTs']) || null;
  const maxDcKw = Number(r['Max DC kW']) || null;
  const hybridStatus = parseHybridStatus(r['Hybrid Ready']);
  const maxDcWPerMppt = mppts && maxDcKw ? Math.round((maxDcKw * 1000) / mppts) : null;
  const panelsPerMpptMax = maxDcWPerMppt ? Math.floor(maxDcWPerMppt / DEFAULT_PANEL_W) : null;
  const out = {
    rated_kw: Number.isFinite(ratedKw) ? ratedKw : null,
    phase, family: (r['Family'] || '').trim() || null,
    mppts, max_dc_kw: maxDcKw, max_dc_w_per_mppt: maxDcWPerMppt,
    panels_per_mppt_max: panelsPerMpptMax,
    panels_per_mppt_assumption_w: panelsPerMpptMax !== null ? DEFAULT_PANEL_W : null,
    hybrid_ready: hybridStatus === 'ready' || hybridStatus === 'upgrade',
    hybrid_status: hybridStatus,
    battery_add_later: parseBool(r['Battery Add Later']),
    vpp_compatible: parseBool(r['VPP Compatible']),
    compatible_batteries_raw: (r['Compatible Batteries'] || '').trim() || null,
    backup_type: (r['Backup Type'] || '').trim() || null,
    dc_spd: (r['DC SPD'] || '').trim() || null,
    ac_spd: (r['AC SPD'] || '').trim() || null,
    afci: parseBool(r['AFCI']),
    recommended_smart_meter: (r['Smart Meter'] || '').trim() || null,
    notes: (r['Notes'] || '').trim() || null,
    spec_source: 'fronius_inverter_database_v1',
  };
  for (const k of Object.keys(out)) {
    if (out[k] === null || out[k] === '' || (typeof out[k] === 'number' && !Number.isFinite(out[k]))) delete out[k];
  }
  return out;
}

async function main() {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`APPLY-FRONIUS-INVERTER-SPECS  ${DRY_RUN ? '— DRY RUN' : '— WRITING TO SUPABASE'}`);
  console.log(`${'='.repeat(72)}\n`);
  const externalRows = readExternalSheet();
  console.log(`Read ${externalRows.length} rows from external xlsx`);
  const { data: dbRows, error } = await supabase.from('products')
    .select('id,sku,name,category,subcategory,specs')
    .ilike('brand', 'Fronius').like('sku', 'FRN-INV-%').order('sku');
  if (error) { console.error('Supabase fetch failed:', error.message); process.exit(1); }
  const bySku = Object.fromEntries(dbRows.map(r => [r.sku, r]));
  console.log(`Loaded ${dbRows.length} catalogue inverter rows from Supabase\n`);
  const matched = [];
  for (const r of externalRows) {
    const ext = r['SKU']; const ratedKw = Number(r['Rated_kW']); const family = r['Family'];
    if (!ext || !Number.isFinite(ratedKw) || !family) continue;
    const candidates = canonicalCandidates(ext, family, ratedKw);
    const hit = candidates.find(c => bySku[c]);
    if (hit) {
      const spec = buildSpecFromRow(r);
      matched.push({ external_sku: ext, external_name: r['Name'], canonical_sku: hit, db_id: bySku[hit].id, new_spec: { ...(bySku[hit].specs || {}), ...spec } });
    }
  }
  console.log(`MATCHED ${matched.length} rows ready to write\n`);
  if (DRY_RUN) { console.log('DRY RUN — no writes performed.'); return; }
  let ok = 0, fail = 0;
  for (const m of matched) {
    const { error } = await supabase.from('products')
      .update({ specs: m.new_spec, updated_at: new Date().toISOString() })
      .eq('id', m.db_id);
    if (error) { console.log(`  FAIL ${m.canonical_sku}: ${error.message}`); fail++; }
    else { console.log(`  OK   ${m.canonical_sku}`); ok++; }
  }
  console.log(`\nDone. ${ok} updated, ${fail} failed.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

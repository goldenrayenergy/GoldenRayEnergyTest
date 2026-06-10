// Apply PRODUCT_SPECS_FILL.xlsx tabs (Racking, BoS, Battery Accessories)
// to the corresponding rows in Supabase products.specs jsonb.
//
// USAGE:
//   node server/scripts/apply-fill-sheet-specs.js --dry-run
//   node server/scripts/apply-fill-sheet-specs.js

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
const SOURCE = path.resolve(__dirname, '../../docs/Products/Excel/Excel/PRODUCT_SPECS_FILL.xlsx');

const SPEC_SOURCE = 'product_specs_fill_v1';

// Per-tab definition: which spec fields to extract from each row
const TABS = {
  '5 · Racking': {
    label: 'Racking',
    map: r => ({
      kind: r['kind (R)'] || null,
      roof_type: r['roof_type (R)'] || null,
      colour: r['colour (R)'] || null,
      length_mm: r['length_mm'] ? Number(r['length_mm']) : null,
    }),
  },
  '6 · BoS': {
    label: 'Balance of System',
    map: r => ({
      kind: r['kind (R)'] || null,
      type: r['type (R)'] || null,
      current_a: r['current_a (R)'] ? Number(r['current_a (R)']) : null,
      voltage_dc_max: r['voltage_dc_max'] ? Number(r['voltage_dc_max']) : null,
      phase: r['phase'] || null,
    }),
  },
  '8 · Battery Accessories': {
    label: 'Battery Accessories',
    map: r => ({
      kind: r['kind (R)'] || null,
      compatible_with: r['compatible_with (R)'] || null,
    }),
  },
};

async function main() {
  console.log(`\n${'='.repeat(64)}`);
  console.log(`APPLY-FILL-SHEET-SPECS  ${DRY_RUN ? '— DRY RUN' : '— WRITING'}`);
  console.log(`${'='.repeat(64)}\n`);

  if (!fs.existsSync(SOURCE)) { console.error('Source not found:', SOURCE); process.exit(1); }
  const wb = XLSX.readFile(SOURCE);

  let totalOk = 0, totalFail = 0, totalSkip = 0;
  for (const [tabName, conf] of Object.entries(TABS)) {
    const ws = wb.Sheets[tabName];
    if (!ws) { console.log(`  ⚠ Tab not found: ${tabName}`); continue; }
    const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
    console.log(`\n── ${conf.label} (${tabName}) — ${rows.length} rows in fill sheet ──`);
    for (const r of rows) {
      const sku = r['sku']; if (!sku) continue;
      const spec = conf.map(r);
      // Drop nulls / empty strings
      const cleaned = Object.fromEntries(Object.entries(spec).filter(([_, v]) => v !== null && v !== ''));
      if (Object.keys(cleaned).length === 0) {
        console.log(`  ⊘ ${sku.padEnd(24)} no spec data in fill sheet — skip`);
        totalSkip++; continue;
      }
      cleaned.spec_source = SPEC_SOURCE;
      const { data: existing } = await supabase.from('products').select('id,specs').eq('sku', sku).maybeSingle();
      if (!existing) {
        console.log(`  ⚠ ${sku.padEnd(24)} not in Supabase — skip`);
        totalSkip++; continue;
      }
      const merged = { ...(existing.specs || {}), ...cleaned };
      if (DRY_RUN) {
        console.log(`  ${sku.padEnd(24)} → ${Object.keys(cleaned).filter(k => k !== 'spec_source').join(', ')}`);
        continue;
      }
      const { error } = await supabase.from('products').update({ specs: merged, updated_at: new Date().toISOString() }).eq('id', existing.id);
      if (error) { console.log(`  ✗ ${sku}: ${error.message}`); totalFail++; }
      else { console.log(`  ✓ ${sku}`); totalOk++; }
    }
  }
  console.log(`\n${'─'.repeat(64)}`);
  if (DRY_RUN) console.log(`DRY RUN — would update rows across the three tabs.`);
  else console.log(`Done. ${totalOk} updated, ${totalFail} failed, ${totalSkip} skipped (no data or not in DB).`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

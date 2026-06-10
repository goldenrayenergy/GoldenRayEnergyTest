// Spec-fill smart meter rows in Supabase products.specs
// Source: PRODUCT_SPECS_FILL.xlsx tab 4 + derivable from SKU naming.
//
// USAGE:
//   node server/scripts/apply-smart-meter-specs.js --dry-run
//   node server/scripts/apply-smart-meter-specs.js

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  (process.env.SUPABASE_URL || '').replace(/['"]/g, ''),
  (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/['"]/g, ''),
);
const DRY_RUN = process.argv.includes('--dry-run');

const SPECS = {
  'FRN-MTR-63-S1P':   { phase: 1,    max_amps: 63,  family: 'Direct-Connect',    mount: 'DIN-rail', form_factor: 'compact',  bidirectional: true },
  'FRN-MTR-63-T3P':   { phase: 3,    max_amps: 63,  family: 'Direct-Connect',    mount: 'DIN-rail', form_factor: 'compact',  bidirectional: true },
  'FRN-MTR-100':      { phase: null, max_amps: 100, family: 'CT Clamp (Split-Core)', mount: 'Split-core 16mm bore', form_factor: 'ct-clamp', bidirectional: true, requires_meter_module: true },
  'FRN-MTR-250':      { phase: null, max_amps: 250, family: 'CT Clamp (Split-Core)', mount: 'Split-core 24mm bore', form_factor: 'ct-clamp', bidirectional: true, requires_meter_module: true },
  'FRN-MTR-400':      { phase: null, max_amps: 400, family: 'CT Clamp (Split-Core)', mount: 'Split-core 36mm bore', form_factor: 'ct-clamp', bidirectional: true, requires_meter_module: true },
  'FRN-MTR-IP-S3P':   { phase: '1 or 3', max_amps: null, family: 'IP — single or three phase', mount: 'External', form_factor: 'standalone', bidirectional: true, requires_333mv_ct: true },
  'FRN-MTR-WR-T3P':   { phase: 3,    max_amps: null, family: 'WR (wide-range) Three-Phase', mount: 'DIN-rail', form_factor: 'compact',  bidirectional: true, voltage_range: '100-600V' },
  'VIC-MTR-100':      { phase: 1,    max_amps: 100, family: 'ET112', mount: 'DIN-rail', form_factor: 'compact', bidirectional: true, direct_connect: true },
  'VIC-MTR-65-T3P':   { phase: 3,    max_amps: 65,  family: 'ET340', mount: 'DIN-rail', form_factor: 'compact', bidirectional: true, direct_connect: true },
};
const SPEC_SOURCE = 'product_specs_fill_v1';

async function main() {
  console.log(`\n${'='.repeat(64)}`);
  console.log(`APPLY-SMART-METER-SPECS  ${DRY_RUN ? '— DRY RUN' : '— WRITING'}`);
  console.log(`${'='.repeat(64)}\n`);
  let ok = 0, fail = 0, skip = 0;
  for (const [sku, spec] of Object.entries(SPECS)) {
    const { data: existing } = await supabase.from('products').select('id,specs,category').eq('sku', sku).maybeSingle();
    if (!existing) {
      console.log(`  ⚠ ${sku}: not found in products — skipped`);
      skip++; continue;
    }
    // Clean nulls; merge with existing
    const cleaned = Object.fromEntries(Object.entries(spec).filter(([_, v]) => v !== null && v !== ''));
    cleaned.spec_source = SPEC_SOURCE;
    const merged = { ...(existing.specs || {}), ...cleaned };
    if (DRY_RUN) {
      console.log(`  ${sku.padEnd(22)} [${existing.category}] → specs: ${Object.keys(cleaned).join(', ')}`);
      continue;
    }
    const { error } = await supabase.from('products').update({ specs: merged, updated_at: new Date().toISOString() }).eq('id', existing.id);
    if (error) { console.log(`  ✗ ${sku}: ${error.message}`); fail++; }
    else { console.log(`  ✓ ${sku}`); ok++; }
  }
  if (DRY_RUN) console.log(`\nDRY RUN — would update ${Object.keys(SPECS).length - skip} rows.`);
  else console.log(`\nDone. ${ok} updated, ${fail} failed, ${skip} skipped.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

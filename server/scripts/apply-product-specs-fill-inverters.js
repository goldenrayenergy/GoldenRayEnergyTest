// Apply PRODUCT_SPECS_FILL.xlsx tab "2 · Inverters" to Supabase products.specs.
// This is what I SHOULD have run before falling back to the external Fronius DB —
// the fill sheet has Primo Plus 8.0/10.0, Symo Plus 6/8/10, all Verto base + Plus,
// and 7 Victron inverters that the external DB didn't cover.
//
// MERGE semantics — existing spec keys preserved, new keys added.
//
// USAGE:
//   node server/scripts/apply-product-specs-fill-inverters.js --dry-run
//   node server/scripts/apply-product-specs-fill-inverters.js

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
const DEFAULT_PANEL_W = 475;
const SPEC_SOURCE = 'product_specs_fill_v1_inverters';

function parseHybrid(v) {
  if (!v) return { hybrid_ready: null, hybrid_status: null };
  const s = String(v).toLowerCase();
  if (s.includes('upgrade')) return { hybrid_ready: true,  hybrid_status: 'upgrade' };
  if (s.startsWith('yes'))    return { hybrid_ready: true,  hybrid_status: 'ready' };
  if (s.startsWith('no'))     return { hybrid_ready: false, hybrid_status: 'none'  };
  return { hybrid_ready: null, hybrid_status: null };
}

function parsePhase(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseYesNo(v) {
  if (!v) return null;
  const s = String(v).toLowerCase().trim();
  if (s === 'yes' || s === 'true') return true;
  if (s === 'no'  || s === 'false') return false;
  return null;
}

async function main() {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`APPLY-PRODUCT-SPECS-FILL-INVERTERS  ${DRY_RUN ? '— DRY RUN' : '— WRITING'}`);
  console.log(`${'='.repeat(72)}\n`);

  if (!fs.existsSync(SOURCE)) { console.error('Source not found:', SOURCE); process.exit(1); }
  const wb = XLSX.readFile(SOURCE);
  const ws = wb.Sheets['2 · Inverters'];
  if (!ws) { console.error('Tab "2 · Inverters" not found'); process.exit(1); }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  console.log(`Read ${rows.length} rows from tab 2 · Inverters`);

  let ok = 0, fail = 0, skipNoData = 0, skipNotFound = 0;
  for (const r of rows) {
    const sku = r['sku']; if (!sku) continue;
    const rated_kw = Number(r['rated_kw (R)']) || null;
    const phase    = parsePhase(r['phase (R)']);
    const { hybrid_ready, hybrid_status } = parseHybrid(r['hybrid_ready (R)']);
    const mppts    = Number(r['mppts (R)']) || null;
    const max_dc_kw = Number(r['max_dc_kw (R)']) || null;
    const vpp      = parseYesNo(r['vpp_compatible (R)']);
    const compat_batt = r['compatible_batteries (R)'] || null;
    const review   = r['review_status'] || null;
    const notes    = r['notes'] || null;

    // Skip rows where NOTHING was filled — pure header/blank rows in the sheet
    if (!rated_kw && !phase && !mppts && !max_dc_kw && hybrid_ready === null && vpp === null && !compat_batt) {
      skipNoData++; continue;
    }

    // Compute derived fields if we have the inputs
    const max_dc_w_per_mppt = mppts && max_dc_kw ? Math.round((max_dc_kw * 1000) / mppts) : null;
    const panels_per_mppt_max = max_dc_w_per_mppt ? Math.floor(max_dc_w_per_mppt / DEFAULT_PANEL_W) : null;

    const newSpec = {
      ...(rated_kw           != null && { rated_kw }),
      ...(phase              != null && { phase }),
      ...(hybrid_ready       != null && { hybrid_ready, hybrid_status }),
      ...(mppts              != null && { mppts }),
      ...(max_dc_kw          != null && { max_dc_kw }),
      ...(max_dc_w_per_mppt  != null && { max_dc_w_per_mppt }),
      ...(panels_per_mppt_max!= null && { panels_per_mppt_max, panels_per_mppt_assumption_w: DEFAULT_PANEL_W }),
      ...(vpp                != null && { vpp_compatible: vpp }),
      ...(compat_batt        && { compatible_batteries_raw: compat_batt }),
      ...(review             && { review_status: review }),
      ...(notes              && { notes }),
      spec_source: SPEC_SOURCE,
    };

    // Look up existing
    const { data: existing } = await supabase.from('products').select('id,specs').eq('sku', sku).maybeSingle();
    if (!existing) {
      console.log(`  ⚠ ${sku.padEnd(22)} not in Supabase — skip`);
      skipNotFound++; continue;
    }
    const merged = { ...(existing.specs || {}), ...newSpec };

    if (DRY_RUN) {
      const newKeys = Object.keys(newSpec).filter(k => k !== 'spec_source');
      console.log(`  ${sku.padEnd(22)} → ${newKeys.join(', ')}`);
      continue;
    }

    const { error } = await supabase.from('products').update({ specs: merged, updated_at: new Date().toISOString() }).eq('id', existing.id);
    if (error) { console.log(`  ✗ ${sku}: ${error.message}`); fail++; }
    else { console.log(`  ✓ ${sku}`); ok++; }
  }

  console.log(`\n${'-'.repeat(72)}`);
  if (DRY_RUN) console.log(`DRY RUN — would update ${rows.length - skipNoData - skipNotFound} rows.`);
  else console.log(`Done. ${ok} updated, ${fail} failed, ${skipNoData} blank rows, ${skipNotFound} not in DB.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

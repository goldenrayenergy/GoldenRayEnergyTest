// Ingest the user's filled Goldenray_Inverter_Actions_v2 action sheet:
//   - Sheet 2: subcategory backfill on 5 Verto base rows
//   - Sheet 5: category MOVES for 12 wrong-category rows
//                  + DEACTIVATE for 6 LC-Primo / LC-Symo license rows
//   - Sheet 6: INSERT 10 new Fronius inverters as is_active=false (no cost yet)
//
// USAGE:
//   node server/scripts/ingest-inverter-actions-v2.js --dry-run
//   node server/scripts/ingest-inverter-actions-v2.js

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
const sb = createClient(
  (process.env.SUPABASE_URL || '').replace(/['"]/g, ''),
  (process.env.SUPABASE_SERVICE_ROLE_KEY || '').replace(/['"]/g, ''),
);
const DRY = process.argv.includes('--dry-run');

// ── A. Sheet 2 — Subcategory backfill ─────────────────────────────────
const SUBCAT_FIXES = [
  'FRN-INV-150-VRTO-3P', 'FRN-INV-200-VRTO-3P', 'FRN-INV-250-VRTO-3P',
  'FRN-INV-300-VRTO-3P', 'FRN-INV-333-VRTO-3P',
];

// ── B. Sheet 5 — Wrong-category MOVES ─────────────────────────────────
// SKU/name → target category (per user's Sheet 5 fills)
const MOVES_BY_SKU = {
  'FRN-ADD-ACC-EXT':    'Accessories',
  'FRN-ADD-INS-G24':    'Accessories',
  'FRN-ADD-INS-SYMO':   'Accessories',
  'FRN-MTR-63-S1P':     'Smart Meters',     // user typed "Smart Merter" — corrected
  'FRN-MTR-63-T3P':     'Smart Meters',
  'FRN-RCK-FLR-TAUR-B': 'Accessories',
};
// Rows without SKU — match by name substring
const MOVES_BY_NAME = [
  { match: 'Gen24 Symo Full Backup Contactor', target: 'Accessories' },
  { match: 'Full Backup Relay - Fronius Gen24', target: 'Accessories' },
  { match: 'Victron Current Transformer 100A:50mA', target: 'Accessories' },
  { match: 'Label Kit for NZ - String Inverter', target: 'Accessories' },
  { match: 'Label - Shutdown procedure Main Switch', target: 'Accessories' },
  { match: 'Label Kit for NZ - Micro Inverter', target: 'Accessories' },
];

// ── C. Sheet 5 — DEACTIVATE 6 LC-Primo / LC-Symo licenses ─────────────
const LICENSE_DEACTIVATE_NAMES = [
  'LC-Primo GEN24 4.0',
  'LC-Primo GEN24 5.0',
  'LC-Primo GEN24 6.0',
  'LC-Primo GEN24 8.0',
  'LC-Primo GEN24 10.0',
  'LC- SYMO GEN24 6.0-12.0',
];

// ── D. Sheet 6 — INSERT 10 new Fronius inverters as is_active=false ───
// All from external Fronius Inverter Database. Specs already computed; cost null.
const NEW_INVERTERS = [
  { sku: 'FRN-INV-37-G24',       name: 'Fronius Primo GEN24 3.6',     family: 'GEN24',           kw: 3.6, phase: 1, subcat: 'Single Phase Hybrid' },
  { sku: 'FRN-INV-46-G24',       name: 'Fronius Primo GEN24 4.6',     family: 'GEN24',           kw: 4.6, phase: 1, subcat: 'Single Phase Hybrid' },
  { sku: 'FRN-INV-37-G24P-1P',   name: 'Fronius Primo GEN24 Plus 3.6',family: 'GEN24 Plus',      kw: 3.6, phase: 1, subcat: 'Single Phase Hybrid' },
  { sku: 'FRN-INV-46-G24P-1P',   name: 'Fronius Primo GEN24 Plus 4.6',family: 'GEN24 Plus',      kw: 4.6, phase: 1, subcat: 'Single Phase Hybrid' },
  { sku: 'FRN-INV-30-SYMO',      name: 'Fronius Symo GEN24 SC 3.0',   family: 'Symo GEN24 SC',   kw: 3,   phase: 3, subcat: 'Three Phase Hybrid' },
  { sku: 'FRN-INV-40-SYMO',      name: 'Fronius Symo GEN24 SC 4.0',   family: 'Symo GEN24 SC',   kw: 4,   phase: 3, subcat: 'Three Phase Hybrid' },
  { sku: 'FRN-INV-50-SYMO',      name: 'Fronius Symo GEN24 SC 5.0',   family: 'Symo GEN24 SC',   kw: 5,   phase: 3, subcat: 'Three Phase Hybrid' },
  { sku: 'FRN-INV-30-SYMP-3P',   name: 'Fronius Symo GEN24 Plus SC 3.0', family: 'Symo GEN24 Plus SC', kw: 3, phase: 3, subcat: 'Three Phase Hybrid' },
  { sku: 'FRN-INV-270-VRTO-3P',  name: 'Fronius Verto 27.0',          family: 'Verto',           kw: 27,  phase: 3, subcat: 'Three Phase Inverter' },
  { sku: 'FRN-INV-270-VRTP-3P',  name: 'Fronius Verto Plus 27.0',     family: 'Verto Plus',      kw: 27,  phase: 3, subcat: 'Three Phase Hybrid' },
];

async function main() {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`INGEST-INVERTER-ACTIONS-V2  ${DRY ? '— DRY RUN' : '— WRITING'}`);
  console.log(`${'='.repeat(72)}\n`);

  // ── A. Subcategory backfill ─────────────────────────────────────────
  console.log(`A) Subcategory backfill — 5 Verto base rows → "Three Phase Inverter"`);
  for (const sku of SUBCAT_FIXES) {
    if (DRY) { console.log(`   would UPDATE ${sku} SET subcategory='Three Phase Inverter'`); continue; }
    const { error } = await sb.from('products')
      .update({ subcategory: 'Three Phase Inverter', updated_at: new Date().toISOString() })
      .eq('sku', sku);
    console.log(`   ${error ? '✗' : '✓'} ${sku}` + (error ? ` (${error.message})` : ''));
  }

  // ── B. Wrong-category moves (by SKU) ─────────────────────────────────
  console.log(`\nB) Wrong-category MOVES by SKU — ${Object.keys(MOVES_BY_SKU).length} rows`);
  for (const [sku, target] of Object.entries(MOVES_BY_SKU)) {
    if (DRY) { console.log(`   would UPDATE ${sku} SET category='${target}'`); continue; }
    const { error } = await sb.from('products')
      .update({ category: target, updated_at: new Date().toISOString() })
      .eq('sku', sku);
    console.log(`   ${error ? '✗' : '✓'} ${sku.padEnd(22)} → ${target}` + (error ? ` (${error.message})` : ''));
  }

  // ── B2. Wrong-category moves (by name, no-SKU rows) ─────────────────
  console.log(`\nB2) Wrong-category MOVES by name — ${MOVES_BY_NAME.length} rows`);
  for (const m of MOVES_BY_NAME) {
    const { data: matches } = await sb.from('products')
      .select('id,name,category')
      .ilike('name', `%${m.match}%`)
      .or('category.ilike.%Inverter%,subcategory.ilike.%Inverter%')
      .eq('is_active', true);
    if (!matches || matches.length === 0) {
      console.log(`   ⚠ no match for "${m.match}"`);
      continue;
    }
    if (matches.length > 1) console.log(`   ⚠ multiple matches for "${m.match}" — updating all ${matches.length}`);
    for (const row of matches) {
      if (DRY) { console.log(`   would UPDATE id=${row.id.slice(0,8)}... name="${row.name.slice(0,40)}..." SET category='${m.target}'`); continue; }
      const { error } = await sb.from('products')
        .update({ category: m.target, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      console.log(`   ${error ? '✗' : '✓'} "${row.name.slice(0, 45)}" → ${m.target}`);
    }
  }

  // ── C. Deactivate licenses ──────────────────────────────────────────
  console.log(`\nC) DEACTIVATE — 6 LC-Primo / LC-Symo licenses`);
  for (const nameMatch of LICENSE_DEACTIVATE_NAMES) {
    const { data: matches } = await sb.from('products')
      .select('id,name')
      .ilike('name', `%${nameMatch}%`)
      .eq('is_active', true);
    if (!matches || matches.length === 0) {
      console.log(`   ⚠ no active match for "${nameMatch}"`);
      continue;
    }
    for (const row of matches) {
      if (DRY) { console.log(`   would UPDATE id=${row.id.slice(0,8)}... name="${row.name.slice(0,40)}..." SET is_active=false`); continue; }
      const { error } = await sb.from('products')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      console.log(`   ${error ? '✗' : '✓'} "${row.name.slice(0, 50)}" → is_active=false`);
    }
  }

  // ── D. Insert 10 new Fronius inverters as deactivated ───────────────
  console.log(`\nD) INSERT — 10 new Fronius inverters as is_active=false (awaiting cost)`);
  for (const inv of NEW_INVERTERS) {
    // First check if already exists (avoid duplicate insert)
    const { data: existing } = await sb.from('products').select('id,is_active').eq('sku', inv.sku).maybeSingle();
    if (existing) {
      console.log(`   ⚠ ${inv.sku.padEnd(22)} already exists (id=${existing.id.slice(0,8)}, active=${existing.is_active}) — skipping insert`);
      continue;
    }
    const row = {
      sku: inv.sku,
      name: inv.name,
      brand: 'Fronius',
      category: 'Inverters - Grid Tied',
      subcategory: inv.subcat,
      description: `${inv.name} — pending cost confirmation`,
      cost_nzd: null,
      default_margin_pct: 22,
      unit: 'EA',
      stock_status: 'unknown',
      qty_available: 0,
      moq: 1,
      availability_notes: 'Inactive — awaiting wholesale cost data',
      website_category: 'Inverters - Grid Tied',
      specs: {
        rated_kw: inv.kw,
        phase: inv.phase,
        family: inv.family,
        spec_source: 'fronius_inverter_database_v1_pending_cost',
        awaiting: ['cost_nzd'],
      },
      needs_review: 'awaiting_cost',
      source: 'manual',
      is_active: false,
    };
    if (DRY) { console.log(`   would INSERT ${inv.sku.padEnd(22)} ${inv.name}`); continue; }
    const { error } = await sb.from('products').insert(row);
    console.log(`   ${error ? '✗' : '✓'} ${inv.sku.padEnd(22)} ${inv.name}` + (error ? ` (${error.message})` : ''));
  }

  console.log(`\n${'-'.repeat(72)}`);
  if (DRY) console.log(`DRY RUN — nothing written.`);
  else console.log(`Done.`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

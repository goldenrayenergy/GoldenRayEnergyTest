// Comprehensive product-catalogue audit against live Supabase.
// What's filled, what's missing, what's broken, what's blocking the engine.
//
// Run: node server/scripts/catalogue-status.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const hr = (title) => { console.log(); console.log('━'.repeat(110)); console.log(`  ${title}`); console.log('━'.repeat(110)); };

const { data: products } = await sb.from('products')
  .select('id, sku, brand, name, category, subcategory, cost_nzd, default_margin_pct, is_active, specs, image_url, datasheet_url, updated_at');

console.log(`Total products in catalogue: ${products.length}`);
console.log(`  active:   ${products.filter(p => p.is_active).length}`);
console.log(`  inactive: ${products.filter(p => !p.is_active).length}`);

// ── By category breakdown ─────────────────────────────────────────────────
hr('CATEGORY BREAKDOWN (active only)');
const byCat = {};
for (const p of products.filter(p => p.is_active)) {
  byCat[p.category || '<null>'] = (byCat[p.category || '<null>'] || 0) + 1;
}
const sortedCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
console.log('Category'.padEnd(35) + ' | Count');
console.log('-'.repeat(45));
for (const [cat, count] of sortedCats) {
  console.log(`${String(cat).padEnd(35)} | ${count}`);
}

// ── Data-quality issues across the whole table ────────────────────────────
hr('DATA QUALITY — issues across all rows');
const issues = {
  nullSku: products.filter(p => !p.sku),
  nullName: products.filter(p => !p.name),
  nullCategory: products.filter(p => !p.category),
  nullCost: products.filter(p => p.cost_nzd == null && p.is_active),
  zeroCost: products.filter(p => p.cost_nzd === 0 && p.is_active),
  nullMargin: products.filter(p => p.default_margin_pct == null && p.is_active),
  noImage: products.filter(p => !p.image_url && p.is_active).length,
  noDatasheet: products.filter(p => !p.datasheet_url && p.is_active).length,
  emptySpecs: products.filter(p => (!p.specs || Object.keys(p.specs).length === 0) && p.is_active),
  numericSku: products.filter(p => p.sku && /^\d+$/.test(p.sku)),
};

console.log(`null SKU (active or inactive): ${issues.nullSku.length}`);
for (const p of issues.nullSku) console.log(`  - ${p.name?.slice(0, 80)} (${p.category}) active=${p.is_active}`);

console.log(`\nnumeric-only SKU (violates BRAND-TYPE-SIZE convention): ${issues.numericSku.length}`);
for (const p of issues.numericSku) console.log(`  - sku=${p.sku}  ${p.name?.slice(0, 70)} (${p.category})`);

console.log(`\nactive rows with NULL cost_nzd: ${issues.nullCost.length}`);
for (const p of issues.nullCost.slice(0, 8)) console.log(`  - ${p.sku} (${p.category}) — ${p.name?.slice(0, 60)}`);
if (issues.nullCost.length > 8) console.log(`  ... (+${issues.nullCost.length - 8} more)`);

console.log(`\nactive rows with cost_nzd = 0: ${issues.zeroCost.length}`);
for (const p of issues.zeroCost.slice(0, 8)) console.log(`  - ${p.sku} (${p.category})`);

console.log(`\nactive rows with null default_margin_pct: ${issues.nullMargin.length}`);
console.log(`active rows with empty specs: ${issues.emptySpecs.length}`);
console.log(`active rows missing image_url: ${issues.noImage}`);
console.log(`active rows missing datasheet_url: ${issues.noDatasheet}`);

// ── PANELS — spec completeness ────────────────────────────────────────────
hr('PANELS — engine-spec completeness');
const panels = products.filter(p => p.is_active && p.category === 'PV Modules');
console.log(`Active panels: ${panels.length}`);
const requiredPanelSpecs = ['watts', 'voc_stc', 'isc_stc', 'vmp_stc', 'imp_stc', 'voltage_temp_coef_pct_per_c'];
const altPanelSpecs = { watts: 'wattage_w', voc_stc: 'voc_v', isc_stc: 'isc_a', vmp_stc: 'vmp_v', imp_stc: 'imp_a', voltage_temp_coef_pct_per_c: 'temp_coeff_voc_pct_c' };
console.log('SKU'.padEnd(22) + ' | filled / required (' + requiredPanelSpecs.length + ')');
console.log('-'.repeat(70));
for (const p of panels) {
  const s = p.specs || {};
  const filled = requiredPanelSpecs.filter(k => s[k] != null || s[altPanelSpecs[k]] != null);
  const missing = requiredPanelSpecs.filter(k => s[k] == null && s[altPanelSpecs[k]] == null);
  const verdict = missing.length === 0 ? '✓ engine-ready' : '⚠ missing ' + missing.join(',');
  console.log(`${String(p.sku).padEnd(22)} | ${filled.length}/${requiredPanelSpecs.length}  ${verdict}`);
}

// ── INVERTERS — spec completeness ─────────────────────────────────────────
hr('INVERTERS — engine-spec completeness (top 10 / total)');
const inverters = products.filter(p => p.is_active && /Inverters/.test(p.category || ''));
console.log(`Active inverters: ${inverters.length}`);
const requiredInvSpecs = ['phase', 'ac_kw', 'uoc_max_v', 'mppt_v_min', 'idc_max_a_per_mppt', 'isc_max_a_mppt1', 'mppt_count', 'max_pv_kwp_standard'];
const altInvSpecs = { ac_kw: ['rated_kw','kw_rating'], mppt_count: ['mppts'], mppt_v_min: ['mpp_v_min','mppt_voltage_min'], max_pv_kwp_standard: ['max_dc_kw'] };
let invFullyFilled = 0;
const invDetail = [];
for (const p of inverters) {
  const s = p.specs || {};
  const has = (k) => s[k] != null || (altInvSpecs[k] && altInvSpecs[k].some(a => s[a] != null));
  const missing = requiredInvSpecs.filter(k => !has(k));
  if (missing.length === 0) invFullyFilled++;
  invDetail.push({ sku: p.sku, missing, hybrid: s.hybrid_status || '' });
}
console.log(`Fully-spec'd inverters: ${invFullyFilled} / ${inverters.length}`);
console.log();
console.log('SKU'.padEnd(22) + ' | hybrid_status | missing specs');
console.log('-'.repeat(95));
for (const r of invDetail.sort((a, b) => a.missing.length - b.missing.length)) {
  const verdict = r.missing.length === 0 ? '✓' : '⚠ ' + r.missing.join(',');
  console.log(`${String(r.sku || '<null>').padEnd(22)} | ${String(r.hybrid).padEnd(13)} | ${verdict}`);
}

// ── BATTERIES — engine readiness ─────────────────────────────────────────
hr('BATTERIES — engine readiness');
const bats = products.filter(p => p.is_active && p.category === 'Batteries - Lithium');
const knownSeries = ['HVM', 'HVS', 'Reserva'];
console.log('SKU'.padEnd(22) + ' | brand'.padEnd(13) + ' | series  | kwh    | chem | engine-can-pick?');
console.log('-'.repeat(95));
for (const p of bats) {
  const s = p.specs || {};
  const series = s.series || s.family || '';
  const kwh = s.module_kwh ?? s.kwh_capacity ?? '';
  const chem = s.chemistry || '?';
  const canPick = knownSeries.includes(series) && kwh && chem === 'LFP'
    ? '✓'
    : `❌ ${!series ? 'no series' : !knownSeries.includes(series) ? `series ${series} has no BMS_RULES` : !kwh ? 'no kwh' : ''}`;
  console.log(`${String(p.sku || '<null>').padEnd(22)} | ${String(p.brand || '').padEnd(11)} | ${String(series).padEnd(7)} | ${String(kwh).padEnd(6)} | ${String(chem).padEnd(4)} | ${canPick}`);
}

// ── BMS CONTROLLER bucket — the Phase A focus ─────────────────────────────
hr('BMS CONTROLLER bucket — Phase A focus');
const bmsRows = products.filter(p => p.is_active && (p.category === 'BYD- BMS' || p.category === 'Battery Accessories'));
console.log(`Rows in BMS buckets: ${bmsRows.length}`);
console.log('SKU'.padEnd(22) + ' | brand'.padEnd(12) + ' | category'.padEnd(22) + ' | for_battery_series | name');
console.log('-'.repeat(110));
for (const p of bmsRows) {
  const s = p.specs || {};
  console.log([
    String(p.sku || '<null>').padEnd(22),
    String(p.brand || '').padEnd(10),
    String(p.category).padEnd(20),
    String(s.for_battery_series || s.series || '').padEnd(18),
    String(p.name || '').slice(0, 50),
  ].join(' | '));
}
console.log();
console.log('  Engine expects for each series (from BMS_RULES):');
console.log('  HVM     → GEN-BAC-ACC-HVM (BYD HVM BMS+BCU)');
console.log('  HVS     → GEN-BAC-ACC-HVS (BYD HVS BMS+BCU)');
console.log('  Reserva → FRN-BAC-ACC-RSV (Fronius Reserva BMS controller)');
const hasHvmBms = bmsRows.find(p => (p.specs?.for_battery_series === 'HVM' || p.sku === 'GEN-BAC-ACC-HVM'));
const hasHvsBms = bmsRows.find(p => (p.specs?.for_battery_series === 'HVS' || p.sku === 'GEN-BAC-ACC-HVS'));
const hasRsvBms = bmsRows.find(p => (p.specs?.for_battery_series === 'Reserva' || p.sku === 'FRN-BAC-ACC-RSV'));
console.log();
console.log(`  HVM BMS in catalogue:     ${hasHvmBms ? '✓ ' + hasHvmBms.sku : '❌ MISSING'}`);
console.log(`  HVS BMS in catalogue:     ${hasHvsBms ? '✓ ' + hasHvsBms.sku : '❌ MISSING'}`);
console.log(`  Reserva BMS in catalogue: ${hasRsvBms ? '✓ ' + hasRsvBms.sku : '❌ MISSING'}`);

// ── SMART METERS ─────────────────────────────────────────────────────────
hr('SMART METERS');
const meters = products.filter(p => p.is_active && p.category === 'Smart Meters');
console.log(`Active smart meters: ${meters.length}`);
for (const p of meters) {
  const s = p.specs || {};
  console.log(`  ${String(p.sku).padEnd(20)}  phase=${s.phase || '?'}  amps=${s.amps || '?'}  cost=$${p.cost_nzd}`);
}

// ── BoS / accessories — counts only ──────────────────────────────────────
hr('BOS / ACCESSORIES — coverage');
const bosCategories = ['Balance of System','Racking & Mounting','Roof Seal','MC4','Tile Feet','Enclosure PV','Lable Kit','BYD- Accessories','Fronius- Accessories','Other Accessories','Accessories','Water Heater','MCB'];
const bosRows = products.filter(p => p.is_active && bosCategories.includes(p.category));
const byBosCat = {};
for (const p of bosRows) byBosCat[p.category] = (byBosCat[p.category] || 0) + 1;
for (const [c, n] of Object.entries(byBosCat).sort()) console.log(`  ${c.padEnd(30)}  ${n}`);

// ── Engine BoS role coverage (does the catalogue satisfy every role?) ────
hr('BOS ROLE COVERAGE — does catalogue satisfy every role bomBuilder needs?');
const { loadCatalogueFromDb } = await import('../services/pm/proposalEngine/catalogue/dbLoader.js');
const { findBosByRole, BOS_ROLES } = await import('../services/pm/proposalEngine/catalogue/bosRoles.js');
const catalogue = await loadCatalogueFromDb(sb);
console.log('Role'.padEnd(25) + ' | matched SKU                  | required?');
console.log('-'.repeat(85));
for (const [roleName, def] of Object.entries(BOS_ROLES)) {
  const item = findBosByRole(catalogue, roleName);
  console.log([
    roleName.padEnd(25),
    item ? `✓ ${item.sku.padEnd(28)}` : '❌ NO MATCH                   ',
    def.required ? 'required' : 'optional',
  ].join(' | '));
}

// ── Recent activity ──────────────────────────────────────────────────────
hr('RECENT ACTIVITY — top 10 most-recently-updated products');
const recent = [...products]
  .filter(p => p.updated_at)
  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  .slice(0, 10);
for (const p of recent) {
  console.log(`  ${p.updated_at.slice(0, 19)}  ${(p.sku || '<null>').padEnd(22)}  ${p.category}`);
}

console.log();
console.log('━'.repeat(110));
console.log('  Done.');
console.log('━'.repeat(110));

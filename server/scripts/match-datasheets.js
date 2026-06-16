// Match local datasheet PDFs to Supabase product SKUs.
// Heuristic: brand + product family + size markers in filename.
// Output: per-SKU best match + per-folder leftover (potential candidates).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

// ── Recursive PDF walker ──────────────────────────────────────────────────
function walkPdfs(dir) {
  const out = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkPdfs(full));
    else if (/\.pdf$/i.test(e.name)) out.push(full);
  }
  return out;
}

const ROOTS = [
  'C:/Users/ram33/OneDrive/Documents/GoldenRay_GitHub-Vercel/GoldenRayEnergy/docs/Products (2)/Products',
  'C:/Users/ram33/Downloads/Fronius_DatSheets',
];
const allPdfs = [];
for (const r of ROOTS) allPdfs.push(...walkPdfs(r));
console.log(`Found ${allPdfs.length} PDFs across ${ROOTS.length} roots.`);

// Normalize path separators so /folder/ checks work cross-platform.
function npath(p) { return p.replace(/\\/g, '/').toLowerCase(); }

function isLikelyDatasheet(p) {
  const lower = npath(p);
  if (lower.includes('/manuals/') || lower.includes('/warranty/')) return false;
  if (lower.includes('/compliance/') || lower.includes('/other documents/')) return false;
  if (lower.includes('/other/')) return false;
  return true;
}
function isInDataSheetsFolder(p) {
  return /\/data\s*sheets\//i.test(npath(p));
}
const candidates = allPdfs.filter(isLikelyDatasheet);
// Sort so `/data sheets/` files are tried FIRST (they're the real datasheets);
// brochures and others fall through as fallback.
candidates.sort((a, b) => {
  const da = isInDataSheetsFolder(a) ? 0 : 1;
  const db = isInDataSheetsFolder(b) ? 0 : 1;
  return da - db;
});
const brochures = allPdfs.filter(p => npath(p).includes('/brochures/'));

// ── Pull active products from Supabase ────────────────────────────────────
const { data: products } = await sb.from('products')
  .select('sku, brand, name, category, datasheet_url, is_active')
  .eq('is_active', true)
  .order('category');
console.log(`Active products in DB: ${products.length}`);

// ── Matchers ──────────────────────────────────────────────────────────────
// Each SKU gets one or more keyword regexes. First file (case-insensitive)
// whose basename matches ALL the regex tokens wins.
function basename(p) { return path.basename(p); }
function matchOne(tokens) {
  for (const p of candidates) {
    const b = basename(p).toLowerCase();
    if (tokens.every(t => b.includes(t.toLowerCase()))) return p;
  }
  // Fallback into brochures
  for (const p of brochures) {
    const b = basename(p).toLowerCase();
    if (tokens.every(t => b.includes(t.toLowerCase()))) return p;
  }
  return null;
}

// Static SKU → match-tokens table for the SKUs we care about
const SKU_MATCHERS = {
  // Panels
  'PHN-PNL-595-DRC': ['draco'],
  'PHN-PNL-475-QSR': ['quasar'],
  'REC-PNL-470-APX': ['alpha', 'pure-rx'],
  'REC-PNL-370':     ['twinpeak'],
  // Fronius Primo (single phase)
  'FRN-INV-30-G24':       ['gen24', 'primo'],
  'FRN-INV-30-G24P-1P':   ['gen24', 'primo'],
  'FRN-INV-40-G24':       ['gen24', 'primo'],
  'FRN-INV-40-G24P-1P':   ['gen24', 'primo'],
  'FRN-INV-50-G24':       ['gen24', 'primo'],
  'FRN-INV-50-G24P-1P':   ['gen24', 'primo'],
  'FRN-INV-60-G24':       ['gen24', 'primo'],
  'FRN-INV-60-G24P-1P':   ['gen24', 'primo'],
  'FRN-INV-80-G24-1P':    ['gen24', 'primo'],
  'FRN-INV-80-G24P-1P':   ['gen24', 'primo'],
  'FRN-INV-100-G24-1P':   ['gen24', 'primo'],
  'FRN-INV-100-G24P-1P':  ['gen24', 'primo'],
  // Fronius Symo (3 phase)
  'FRN-INV-60-SYMO':       ['symo', 'gen24'],
  'FRN-INV-60-SYMP-3P':    ['symo', 'gen24'],
  'FRN-INV-80-SYMO':       ['symo', 'gen24'],
  'FRN-INV-80-SYMP-3P':    ['symo', 'gen24'],
  'FRN-INV-100-SYMO':      ['symo', 'gen24'],
  'FRN-INV-100-SYMP-3P':   ['symo', 'gen24'],
  'FRN-INV-120-SYMO-3P':   ['symo', 'gen24'],
  'FRN-INV-120-SYMP-3P':   ['symo', 'gen24'],
  // Fronius Verto (3 phase commercial)
  'FRN-INV-150-VRTO-3P':   ['verto'],
  'FRN-INV-150-VRTP-3P':   ['verto'],
  'FRN-INV-200-VRTO-3P':   ['verto'],
  'FRN-INV-200-VRTP-3P':   ['verto'],
  'FRN-INV-250-VRTO-3P':   ['verto'],
  'FRN-INV-250-VRTP-3P':   ['verto'],
  'FRN-INV-300-VRTO-3P':   ['verto'],
  'FRN-INV-300-VRTP-3P':   ['verto'],
  'FRN-INV-333-VRTO-3P':   ['verto'],
  'FRN-INV-333-VRTP-3P':   ['verto'],
  // Fronius Tauro
  'FRN-INV-500-TAUE-3P':   ['tauro'],
  'FRN-INV-1000-TAUE-3P':  ['tauro'],
  // Victron MultiPlus
  'VIC-INV-30-MPII':       ['multiplus-ii'],
  'VIC-INV-50-MPII':       ['multiplus-ii'],
  'VIC-INV-100-MPII':      ['multiplus-ii'],
  'VIC-INV-150-MPII':      ['multiplus-ii'],
  // Victron Quattro
  'VIC-INV-80-QTRO':       ['quattro'],
  'VIC-INV-100-QTRO':      ['quattro'],
  'VIC-INV-150-QTRO':      ['quattro'],
  // Batteries
  'BYD-BAT-276-HVM':       ['byd', 'hvshvm', 'datasheet'],
  'BYD-BAT-256-HVS':       ['byd', 'hvshvm', 'datasheet'],
  'BYD-BAT-1540-LVL-A':    ['byd', 'lvl'],   // probably no datasheet locally
  'FRN-BAT-315-RSV':       ['froniusreserva'],
  'ZYC-BAT-512-SMP':       ['simpo-5000'],
  'FRW-BAT-500-ETW':       ['etw'],
  // BMS controllers
  'GEN-BAC-ACC-HVM':       ['byd', 'hvshvm'],   // shares the BYD HVS/HVM datasheet
  'GEN-BAC-ACC-HVS':       ['byd', 'hvshvm'],
  'FRN-BAC-ACC-RSV':       ['froniusreserva'],
  // Smart meters
  'FRN-MTR-63-S1P':        ['fronius_smart_meter'],
  'FRN-MTR-63-T3P':        ['fronius_smart_meter'],
  'FRN-MTR-WR-T3P':        ['fronius_smart_meter'],
  // EV charger
  'FRN-EV-WATTPILOT-11':   ['wattpilot'],
};

// ── Walk products and try to match ────────────────────────────────────────
let matched = 0, missing = 0;
const matchedSet = new Set();
const rows = [];
for (const p of products) {
  if (!p.sku) continue;
  const tokens = SKU_MATCHERS[p.sku];
  if (!tokens) {
    rows.push({ sku: p.sku, brand: p.brand, name: p.name, category: p.category, file: null, note: 'no matcher defined' });
    continue;
  }
  const hit = matchOne(tokens);
  if (hit) {
    matched++;
    matchedSet.add(hit);
    rows.push({ sku: p.sku, brand: p.brand, name: p.name, category: p.category, file: hit, note: null });
  } else {
    missing++;
    rows.push({ sku: p.sku, brand: p.brand, name: p.name, category: p.category, file: null, note: 'no local PDF' });
  }
}

// ── Output: matches by category ───────────────────────────────────────────
const byCat = rows.reduce((acc, r) => { (acc[r.category] = acc[r.category] || []).push(r); return acc; }, {});
const catOrder = ['PV Modules', 'Inverters - Grid Tied', 'Inverters - Off Grid',
                  'Inverters - Commercial', 'Fronius Tauro Eco', 'Batteries - Lithium',
                  'BMS', 'Smart Meters', 'EV Chargers Fronius', 'Battery Accessories',
                  'Battery Upgrade License', 'Balance of System', 'Battery Enclosures',
                  'Accessories', 'Racking & Mounting', 'Monitoring', 'BYD- Accessories',
                  'Fronius- Accessories', 'Other Accessories', 'MC4', 'MCB', 'Lable Kit',
                  'Tile Feet', 'Roof Seal', 'Enclosure PV', 'Water Heater'];
const seenCats = new Set();

for (const cat of catOrder) {
  if (!byCat[cat]) continue;
  seenCats.add(cat);
  console.log();
  console.log('─'.repeat(110));
  console.log(`  ${cat}  (${byCat[cat].length} active SKUs)`);
  console.log('─'.repeat(110));
  for (const r of byCat[cat]) {
    const fname = r.file ? path.basename(r.file) : (r.note || '');
    const status = r.file ? '✓' : '✗';
    console.log(`  ${status} ${r.sku.padEnd(22)}  ${r.brand?.slice(0,12).padEnd(12) || ''}  → ${fname}`);
  }
}

// Any categories not in catOrder
const otherCats = Object.keys(byCat).filter(c => !seenCats.has(c) && c);
if (otherCats.length) {
  console.log();
  console.log('Other categories (no matchers defined):');
  for (const c of otherCats) console.log(`  ${c.padEnd(40)} ${byCat[c].length} SKUs`);
}

console.log();
console.log('━'.repeat(110));
console.log(`SUMMARY: ${matched} matched · ${missing} missing local PDF · ${rows.length - matched - missing} no matcher defined`);
console.log(`Total PDFs scanned: ${allPdfs.length}  ·  identified as datasheets: ${candidates.length}  ·  used: ${matchedSet.size}`);
console.log('━'.repeat(110));

// ── Useful leftovers — datasheets we DIDN'T use ───────────────────────────
const unused = candidates.filter(p => !matchedSet.has(p))
  .filter(p => /datasheet|data.sheets|\.pdf$/i.test(p));   // narrow noise
const interesting = unused.filter(p => {
  const b = path.basename(p).toLowerCase();
  // Filter to ones that look like product datasheets vs random installation docs
  return /datasheet|^ds[-_]|reserva|gen24|primo|symo|verto|tauro|wattpilot|multiplus|quattro|byd|hvm|hvs|simpo|smart.meter|draco|quasar|n-peak|alpha/.test(b);
});
console.log();
console.log('Unused datasheets that look like product-facing PDFs (potential extras to upload):');
const folderTops = new Map();
for (const p of interesting) {
  const folder = path.dirname(p).split('/').slice(-3).join('/');
  if (!folderTops.has(folder)) folderTops.set(folder, []);
  folderTops.get(folder).push(path.basename(p));
}
for (const [folder, files] of [...folderTops.entries()].sort()) {
  console.log(`  📂 ${folder}`);
  for (const f of files.slice(0, 8)) console.log(`     - ${f}`);
  if (files.length > 8) console.log(`     ... (+${files.length - 8} more)`);
}

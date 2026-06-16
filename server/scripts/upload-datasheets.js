// Upload matched local datasheets to Supabase Storage + set products.datasheet_url.
//
// Storage layout:
//   bucket: product-datasheets (public, created if missing)
//   path:   <sanitized-original-filename>.pdf  (one upload per unique file —
//           many SKUs share the same datasheet, so we don't duplicate bytes)
//
// SKU → datasheet_url mapping: every matched SKU points to the public URL of
// its source file. Re-running is idempotent: existing files are upserted,
// datasheet_url is overwritten only when the URL would change.
//
// Usage:
//   node server/scripts/upload-datasheets.js          # dry-run
//   node server/scripts/upload-datasheets.js --apply  # commit
//
// SAFETY: this only mutates the `product-datasheets` storage bucket + the
// `datasheet_url` column on products. Nothing else.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');
const BUCKET = 'product-datasheets';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

console.log(`Mode: ${APPLY ? '🔧 APPLY (live writes)' : '👀 DRY-RUN (no writes)'}`);

// ── Same walker + matchers as match-datasheets.js ─────────────────────────
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
function npath(p) { return p.replace(/\\/g, '/').toLowerCase(); }

const ROOTS = [
  'C:/Users/ram33/OneDrive/Documents/GoldenRay_GitHub-Vercel/GoldenRayEnergy/docs/Products (2)/Products',
  'C:/Users/ram33/Downloads/Fronius_DatSheets',
];
const allPdfs = [];
for (const r of ROOTS) allPdfs.push(...walkPdfs(r));

function isLikelyDatasheet(p) {
  const lower = npath(p);
  if (lower.includes('/manuals/') || lower.includes('/warranty/')) return false;
  if (lower.includes('/compliance/') || lower.includes('/other documents/')) return false;
  if (lower.includes('/other/')) return false;
  return true;
}
function isInDataSheetsFolder(p) { return /\/data\s*sheets\//i.test(npath(p)); }

const candidates = allPdfs.filter(isLikelyDatasheet);
candidates.sort((a, b) => (isInDataSheetsFolder(a) ? 0 : 1) - (isInDataSheetsFolder(b) ? 0 : 1));
const brochures = allPdfs.filter(p => npath(p).includes('/brochures/'));

function matchOne(tokens) {
  for (const p of candidates) {
    const b = path.basename(p).toLowerCase();
    if (tokens.every(t => b.includes(t.toLowerCase()))) return p;
  }
  for (const p of brochures) {
    const b = path.basename(p).toLowerCase();
    if (tokens.every(t => b.includes(t.toLowerCase()))) return p;
  }
  return null;
}

// Matchers — same as match-datasheets.js, with the EV Charger fix
// (production DB has `FRN-EVC-220-WPF`, not `FRN-EV-WATTPILOT-11`)
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
  // Victron MultiPlus-II
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
  'FRN-BAT-315-RSV':       ['froniusreserva'],
  'ZYC-BAT-512-SMP':       ['simpo-5000'],
  // BMS controllers (share their battery's datasheet)
  'GEN-BAC-ACC-HVM':       ['byd', 'hvshvm', 'datasheet'],
  'GEN-BAC-ACC-HVS':       ['byd', 'hvshvm', 'datasheet'],
  'FRN-BAC-ACC-RSV':       ['froniusreserva'],
  // Smart meters (63A models — the others need separate datasheets)
  'FRN-MTR-63-S1P':        ['fronius_smart_meter'],
  'FRN-MTR-63-T3P':        ['fronius_smart_meter'],
  'FRN-MTR-WR-T3P':        ['fronius_smart_meter'],
  // EV charger — correct DB SKU is FRN-EVC-220-WPF
  'FRN-EVC-220-WPF':       ['wattpilot', 'datasheet'],
};

// ── Compute match plan ────────────────────────────────────────────────────
const { data: products } = await sb.from('products')
  .select('id, sku, datasheet_url')
  .eq('is_active', true);
const productBySku = new Map(products.map(p => [p.sku, p]));

const matches = [];        // [{ sku, sourceFile, productId, currentUrl }]
const sourceFiles = new Set();
for (const [sku, tokens] of Object.entries(SKU_MATCHERS)) {
  const product = productBySku.get(sku);
  if (!product) { console.log(`  skip ${sku} — not in DB`); continue; }
  const hit = matchOne(tokens);
  if (!hit) { console.log(`  skip ${sku} — no local match`); continue; }
  matches.push({ sku, sourceFile: hit, productId: product.id, currentUrl: product.datasheet_url });
  sourceFiles.add(hit);
}
console.log();
console.log(`Plan: upload ${sourceFiles.size} unique datasheets, update ${matches.length} product rows.`);
console.log();

// ── Storage upload plan ───────────────────────────────────────────────────
// One bucket-path per unique source file (deduped). Path = sanitized basename
// in a category-prefixed folder so the bucket is browsable.
function sanitize(name) {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_');
}
function categoryForFolder(filepath) {
  const lower = npath(filepath);
  if (lower.includes('/pv modules/')) return 'panels';
  if (lower.includes('/inverter/') || lower.includes('/inverter-')) return 'inverters';
  if (lower.includes('/battery pack/') || lower.includes('/battery datasheet/')) return 'batteries';
  if (lower.includes('/smart meter')) return 'smart-meters';
  if (lower.includes('/ev datasheet')) return 'ev-chargers';
  if (lower.includes('/victron')) return 'victron';
  return 'misc';
}
const sourceToStoragePath = new Map();
for (const f of sourceFiles) {
  const folder = categoryForFolder(f);
  const filename = sanitize(path.basename(f));
  sourceToStoragePath.set(f, `${folder}/${filename}`);
}

// ── Show plan ──────────────────────────────────────────────────────────────
console.log('━'.repeat(110));
console.log('  Upload plan (unique source files)');
console.log('━'.repeat(110));
for (const [src, dest] of sourceToStoragePath) {
  console.log(`  ${dest}`);
  console.log(`     ← ${path.basename(src)}`);
}
console.log();
console.log('━'.repeat(110));
console.log('  Product-row update plan (matched SKUs)');
console.log('━'.repeat(110));
for (const m of matches) {
  const willBeUrl = sourceToStoragePath.get(m.sourceFile);
  const note = m.currentUrl ? ' (was: ' + m.currentUrl.slice(-40) + ')' : '';
  console.log(`  ${m.sku.padEnd(22)} → ${willBeUrl}${note}`);
}

if (!APPLY) {
  console.log();
  console.log('Dry-run complete. Re-run with --apply to commit.');
  process.exit(0);
}

// ── 1. Ensure bucket exists ───────────────────────────────────────────────
console.log();
console.log('Step 1: ensure bucket…');
const { data: buckets } = await sb.storage.listBuckets();
if (!buckets?.some(b => b.name === BUCKET)) {
  const { error } = await sb.storage.createBucket(BUCKET, { public: true });
  if (error) { console.error(`createBucket failed: ${error.message}`); process.exit(1); }
  console.log(`  ✓ created bucket ${BUCKET} (public)`);
} else {
  console.log(`  ✓ bucket ${BUCKET} already exists`);
}

// ── 2. Upload unique files (upsert) ───────────────────────────────────────
console.log();
console.log('Step 2: uploading…');
const sourceToPublicUrl = new Map();
let uploadedCount = 0, skippedCount = 0;
for (const [src, dest] of sourceToStoragePath) {
  const buffer = readFileSync(src);
  const { error } = await sb.storage.from(BUCKET).upload(dest, buffer, {
    contentType: 'application/pdf', upsert: true,
  });
  if (error) {
    console.error(`  ❌ ${dest}: ${error.message}`);
    continue;
  }
  const { data } = sb.storage.from(BUCKET).getPublicUrl(dest);
  sourceToPublicUrl.set(src, data.publicUrl);
  uploadedCount++;
  console.log(`  ✓ ${dest}  (${(buffer.length / 1024).toFixed(0)} KB)`);
}
console.log(`  Uploaded ${uploadedCount}/${sourceToStoragePath.size}.`);

// ── 3. Update datasheet_url on each matched SKU ───────────────────────────
console.log();
console.log('Step 3: updating products.datasheet_url…');
let updatedCount = 0, unchangedCount = 0;
for (const m of matches) {
  const newUrl = sourceToPublicUrl.get(m.sourceFile);
  if (!newUrl) continue;
  if (m.currentUrl === newUrl) {
    unchangedCount++;
    continue;
  }
  const { error } = await sb.from('products')
    .update({ datasheet_url: newUrl })
    .eq('id', m.productId);
  if (error) console.error(`  ❌ ${m.sku}: ${error.message}`);
  else { updatedCount++; console.log(`  ✓ ${m.sku} → ${newUrl.split('/').pop()}`); }
}
console.log(`  Updated ${updatedCount} · already-current ${unchangedCount}`);

// ── 4. Verify final state ────────────────────────────────────────────────
console.log();
console.log('Step 4: verification');
const { data: verify } = await sb.from('products')
  .select('sku, datasheet_url')
  .in('sku', matches.map(m => m.sku));
const ok = verify.filter(v => v.datasheet_url).length;
console.log(`  ${ok}/${verify.length} of the targeted SKUs now have datasheet_url set.`);

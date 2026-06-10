/**
 * apply-legacy-row-sweep.cjs
 *
 * Final non-Victron hygiene sweep on the uncategorized (category IS NULL) bucket:
 *
 *  DELETE: 10 inactive, no-SKU, 0-spec duplicate rows — each confirmed to have a
 *          clean active SKU'd counterpart (Verto/Symo/Primo inverters + BYD LVL).
 *          Backed up to Downloads/deleted_legacy_dupes_backup.json first.
 *  CATEGORISE (+SKU where missing): 9 active real products that just lacked a
 *          category — 3 Keto fuse holders -> Balance of System; 2 Hopergy parts ->
 *          Racking & Mounting; ZYC SIMPO cabinet -> Battery Accessories;
 *          3 AL labels -> Lable Kit.
 *
 * Victron rows are intentionally LEFT untouched (parked).
 *
 * Idempotent-ish: deletes are by id (gone after first run); categorise is by id.
 * Run:  node server/scripts/apply-legacy-row-sweep.cjs [--dry]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DRY = process.argv.includes('--dry');
const envPath = path.join(__dirname, '..', '..', '.env');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t[0] === '#' || !t.includes('=')) continue;
  const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const BASE = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/';
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
function req(method, q, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request(new URL(BASE + q), { method, headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' } },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { if (res.statusCode >= 400) return reject(new Error(method + ' ' + q + ' -> ' + res.statusCode + ' ' + d)); resolve(d ? JSON.parse(d) : null); }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

const DELETE_IDS = [
  '56a3edd7-eeca-4d7c-a223-f3e1afa0dbf3', // BYD LVL 15.4
  'f8150e62-1a1d-484a-8bab-973481ecf220', // Verto 30.0
  '38d12111-32ad-477c-acc1-43e94515d10c', // Verto 33.3
  '38cc819c-fe40-47fa-90d2-d2bca66cfee9', // Verto 25.0
  '573b0153-8ce7-48f7-a1c4-e353c0b5e947', // Verto 20.0
  '3afd4ad4-ac94-440e-ab97-546fdbd396e5', // SYMO 8.0
  'a510575e-edfb-48e9-88b2-dd3c4c8e4847', // SYMO 10.0
  '0f6c988c-b396-4936-b596-57f0e45e2b81', // Primo 4.0
  'bd6acbfc-f4ac-439e-9591-336fb6ff9696', // Primo 5.0
  'cfe4b3d1-2f29-4280-bd71-fe3b033e7429', // Primo 6.0
];

// id -> {category, sku?}
const CATEGORISE = [
  { id: '353abfed-10a4-4382-9f88-9ab72222c494', category: 'Balance of System' },                              // GEN-BOS-NH00-FHL-A
  { id: '9ba46662-b3b6-4ecc-984a-a17ab45176e3', category: 'Balance of System' },                              // GEN-BOS-NH00-FHL-B
  { id: '2df22ebd-1eb6-4e8e-a43b-25262fe7a304', category: 'Balance of System' },                              // GEN-BOS-NH1-FHL
  { id: 'c98ea49c-afb4-45d8-b009-6f1c663fbd19', category: 'Racking & Mounting', sku: 'HOP-RCK-SEAL-EPDM' },   // Hopergy EPDM rubber
  { id: '1cb1dd1b-705d-4e89-948d-4dea035f8c22', category: 'Racking & Mounting', sku: 'HOP-RCK-KIT-AFK60' },   // Hopergy A-Frame Kit
  { id: '717bfc2a-9be5-402c-bd87-c82273e9278a', category: 'Battery Accessories', sku: 'ZYC-BAC-CAB10' },      // ZYC SIMPO Indoor Cabinet
  { id: '9c08f0aa-33ea-4af9-8565-b7a7f95824ac', category: 'Lable Kit', sku: 'GEN-LBL-BEXP' },                 // AL_Label Battery Explosion
  { id: 'a985ffc7-fbc9-4f39-ac60-6334ff2324d2', category: 'Lable Kit', sku: 'GEN-LBL-ES70' },                 // AL_Label ES 70mm
  { id: 'c7869bd8-f224-41b5-ad8d-cabc27694424', category: 'Lable Kit', sku: 'GEN-LBL-DSUP' },                 // AL_Warning Dual Supply
];

(async () => {
  console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== APPLYING ===');

  // backup + delete dupes
  console.log('\nDELETE (10 inactive dupes):');
  if (!DRY) {
    const backup = await req('GET', 'products?select=*&id=in.(' + DELETE_IDS.join(',') + ')');
    fs.writeFileSync('C:/Users/ram33/Downloads/deleted_legacy_dupes_backup.json', JSON.stringify(backup, null, 2));
    console.log('  backed up ' + backup.length + ' rows -> Downloads/deleted_legacy_dupes_backup.json');
  }
  for (const id of DELETE_IDS) {
    if (!DRY) { const d = await req('DELETE', 'products?id=eq.' + id); console.log('  deleted: ' + (d && d[0] ? d[0].name : id)); }
    else console.log('  ' + id);
  }

  // categorise active rows
  console.log('\nCATEGORISE (9 active):');
  for (const c of CATEGORISE) {
    const body = { category: c.category };
    if (c.sku) body.sku = c.sku;
    console.log('  -> ' + c.category.padEnd(20) + (c.sku ? ' sku=' + c.sku : ' (sku kept)'));
    if (!DRY) await req('PATCH', 'products?id=eq.' + c.id, body);
  }

  if (DRY) { console.log('\nRe-run without --dry to apply.'); return; }

  // verify uncategorized now only Victron
  const remain = await req('GET', 'products?select=sku,name,brand&category=is.null&limit=50');
  const nonVic = remain.filter((r) => !(/victron|ictron/i.test((r.brand || '') + ' ' + (r.name || ''))));
  console.log('\n--- post-sweep ---');
  console.log('uncategorized remaining: ' + remain.length + ' (Victron-related: ' + (remain.length - nonVic.length) + ', non-Victron: ' + nonVic.length + ')');
  if (nonVic.length) for (const r of nonVic) console.log('  still uncategorised (non-Victron):', r.name);
  const tot = await req('GET', 'products?select=id&limit=400');
  console.log('total products now:', tot.length);
})().catch((e) => { console.error(e); process.exit(1); });

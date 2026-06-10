/**
 * apply-recategorize-racking-bos-pv.cjs
 *
 * Category hygiene sweep across Racking & Mounting / Balance of System / PV Modules:
 *
 *  A) PV Modules -> Racking & Mounting : 6 Hopergy (4-Panel) mounting kits that
 *     were mis-filed as panels. Assigned HOP-RCK-KIT-* SKUs (none had a SKU).
 *  B) Racking & Mounting -> Balance of System : 5 rows already SKU'd *-BOS-*
 *     (3 CT clamps + 2 SS cable-tie packs) — they are BoS, not racking.
 *  C) Fix the 1 remaining no-SKU racking row (Hopergy TRB-01-S tin bracket),
 *     stays in Racking, just gets its SKU (HOP-RCK-FOT-TRBS, silver pair of -TRBB).
 *
 * Result: PV Modules holds only the 4 real panels; racking hardware all SKU'd;
 * CT clamps + cable ties live under Balance of System.
 *
 * Idempotent. Run:  node server/scripts/apply-recategorize-racking-bos-pv.cjs [--dry]
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

// A) PV Modules -> Racking & Mounting, with new SKUs
const KITS = [
  { id: '3c8cf0ea-8294-4ddc-a831-80ff222a7dc5', sku: 'HOP-RCK-KIT-TILE-B' },
  { id: '62d9eb75-70a6-4099-b6e8-ec1698d401c1', sku: 'HOP-RCK-KIT-TILE-S' },
  { id: '30e990d0-9f99-4492-8fc5-04e6d802df01', sku: 'HOP-RCK-KIT-TILT-B' },
  { id: '3b7f5424-c6f5-47ed-9d65-0f88db330ccc', sku: 'HOP-RCK-KIT-TILT-S' },
  { id: '0fd17de3-255b-4a58-8a3d-e5e0687cf9fb', sku: 'HOP-RCK-KIT-TIN-B' },
  { id: 'f8da8624-1738-4488-80e0-aa8c6901c407', sku: 'HOP-RCK-KIT-TIN-S' },
];
// B) Racking & Mounting -> Balance of System (category only; SKUs already correct)
const BOS = [
  'c926c27c-ba0b-4a91-ba57-05dd6fadf8cd', // ASK-BOS-200-CT
  '7e1ab26f-84a3-40b6-a5b9-3fe97639f74e', // ASK-BOS-300-CT
  'c422646b-66a6-4280-b44e-7d90b50abb31', // ASR-BOS-100-CT
  'bae63f34-cc71-4680-815c-43d15c5b8306', // GEN-BOS-ACC (cable tie pack)
  '3ffc02a6-8ec4-4fc4-b94b-ca07e9affd43', // HOP-BOS-ACC (cable tie)
];
// C) no-SKU racking bracket -> assign SKU, stays in Racking
const SKU_FIX = [
  { id: '2de97ad0-0e9e-4241-b477-ade0a3e222f8', sku: 'HOP-RCK-FOT-TRBS' },
];

(async () => {
  console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== APPLYING ===');

  console.log('\nA) PV Modules -> Racking & Mounting (+SKU):');
  for (const k of KITS) {
    console.log('  ' + k.sku.padEnd(20) + ' <- (no sku) PV Modules');
    if (!DRY) await req('PATCH', 'products?id=eq.' + k.id, { sku: k.sku, category: 'Racking & Mounting' });
  }

  console.log('\nB) Racking & Mounting -> Balance of System:');
  for (const id of BOS) {
    if (!DRY) { const r = await req('PATCH', 'products?id=eq.' + id, { category: 'Balance of System' }); console.log('  moved ' + (r && r[0] ? r[0].sku : id)); }
    else console.log('  ' + id);
  }

  console.log('\nC) racking no-SKU fix:');
  for (const k of SKU_FIX) {
    console.log('  ' + k.sku + ' (stays in Racking)');
    if (!DRY) await req('PATCH', 'products?id=eq.' + k.id, { sku: k.sku });
  }

  console.log('\n' + (DRY ? '[dry] would move 6 kits in, 5 BoS out, fix 1 sku' : 'done: 6 kits in, 5 BoS out, 1 sku fixed'));
  if (DRY) return;

  // verify category counts
  const cnt = async (cat) => (await req('GET', 'products?select=id&category=eq.' + encodeURIComponent(cat))).length;
  console.log('\n--- post-move counts ---');
  console.log('PV Modules:', await cnt('PV Modules'), '(should be 4 panels)');
  console.log('Racking & Mounting:', await cnt('Racking & Mounting'));
  console.log('Balance of System:', await cnt('Balance of System'));
  const noskuRck = (await req('GET', "products?select=sku&category=eq.Racking%20%26%20Mounting&sku=is.null")).length;
  console.log('Racking rows still missing SKU:', noskuRck);
})().catch((e) => { console.error(e); process.exit(1); });

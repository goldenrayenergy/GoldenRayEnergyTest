/**
 * apply-battery-bms-keys.cjs
 *
 * Adds the proposal-engine battery/BMS matching keys so Supabase can drive
 * bomBuilder.js / configValidator.js / engineeringValidator.js:
 *   batteries: series, module_kwh   (chemistry already present = LFP)
 *   BMS:       for_battery_series
 * Also moves the Fronius Reserva BMS out of `Batteries - Lithium` -> `BMS`.
 *
 * Provenance per value (see also Battery Master Database.xlsx, engine catalogue.js):
 *   BYD HVM 2.76 / HVS 2.56 / Reserva 3.15  -> engine catalogue.js (corroborated
 *     by master DB module-count math) — spec_source: 'engine+masterdb'
 *   ZYC SIMPO 5.12                           -> SKU + SIMPO-5000 datasheet
 *   BYD LVL 15.40 / FRW ETW 5.00             -> SKU + name only (no datasheet);
 *     tagged spec_source 'derived-sku' for later confirmation.
 *
 * Idempotent. Run:  node server/scripts/apply-battery-bms-keys.cjs [--dry]
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

// sku -> {series, module_kwh, src}
const BATT = {
  'BYD-BAT-276-HVM':    { series: 'HVM',    module_kwh: 2.76,  src: 'engine+masterdb' },
  'BYD-BAT-256-HVS':    { series: 'HVS',    module_kwh: 2.56,  src: 'engine+masterdb' },
  'FRN-BAT-315-RSV':    { series: 'Reserva', module_kwh: 3.15, src: 'engine+masterdb' },
  'ZYC-BAT-512-SMP':    { series: 'SIMPO',  module_kwh: 5.12,  src: 'sku+datasheet' },
  'BYD-BAT-1540-LVL-A': { series: 'LVL',    module_kwh: 15.40, src: 'derived-sku' },
  'FRW-BAT-500-ETW':    { series: 'ETW',    module_kwh: 5.00,  src: 'derived-sku' },
};
// BMS sku -> {for_battery_series, moveCategory?}
const BMS = {
  'GEN-BAC-ACC-HVM': { for_battery_series: 'HVM',     src: 'engine' },
  'FRN-BAC-ACC-RSV': { for_battery_series: 'Reserva', src: 'engine', moveCategory: 'BMS' },
};

(async () => {
  console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== APPLYING ===');
  const skus = [...Object.keys(BATT), ...Object.keys(BMS)];
  const rows = await req('GET', 'products?select=id,sku,name,category,specs&sku=in.(' + skus.join(',') + ')');
  const bySku = Object.fromEntries(rows.map((r) => [r.sku, r]));

  console.log('\nBatteries:');
  for (const [sku, v] of Object.entries(BATT)) {
    const r = bySku[sku]; if (!r) { console.log('  !! not found:', sku); continue; }
    const merged = Object.assign({}, r.specs || {}, { series: v.series, module_kwh: v.module_kwh, battery_spec_source: v.src });
    console.log(`  ${sku.padEnd(20)} series=${v.series.padEnd(8)} module_kwh=${v.module_kwh}  [${v.src}]`);
    if (!DRY) await req('PATCH', 'products?id=eq.' + r.id, { specs: merged });
  }

  console.log('\nBMS:');
  for (const [sku, v] of Object.entries(BMS)) {
    const r = bySku[sku]; if (!r) { console.log('  !! not found:', sku); continue; }
    const merged = Object.assign({}, r.specs || {}, { for_battery_series: v.for_battery_series, battery_spec_source: v.src });
    const body = { specs: merged };
    if (v.moveCategory && r.category !== v.moveCategory) body.category = v.moveCategory;
    console.log(`  ${sku.padEnd(20)} for_battery_series=${v.for_battery_series}${body.category ? '  (category ' + r.category + ' -> ' + body.category + ')' : ''}`);
    if (!DRY) await req('PATCH', 'products?id=eq.' + r.id, body);
  }

  if (DRY) { console.log('\nRe-run without --dry to apply.'); return; }

  // verify
  const check = await req('GET', 'products?select=sku,category,specs&sku=in.(' + skus.join(',') + ')&order=sku.asc');
  console.log('\n--- verify ---');
  for (const r of check) {
    const s = r.specs || {};
    console.log('  ' + r.sku.padEnd(20) + ' series=' + (s.series || '-') + ' module_kwh=' + (s.module_kwh || '-') + ' for_battery_series=' + (s.for_battery_series || '-') + ' cat=' + r.category);
  }
})().catch((e) => { console.error(e); process.exit(1); });

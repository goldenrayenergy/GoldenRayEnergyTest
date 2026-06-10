/**
 * apply-bms-split.cjs
 *
 * The BYD BMS is sold as ONE physical unit ("BMS- HVM/HVS Series Base & BCU")
 * but the proposal engine (catalogue.js BMS_CONTROLLERS) models a separate BMS
 * per battery series and matches battery.series === bms.for_battery_series.
 * With only the combined row (for_battery_series='HVM'), HVS batteries find no BMS.
 *
 * Fix: split into the engine's two SKUs, cross-linked as the same hardware:
 *   - GEN-BAC-ACC-HVM  -> for_battery_series 'HVM'  (existing; renamed + recategorised)
 *   - GEN-BAC-ACC-HVS  -> for_battery_series 'HVS'  (NEW row, same cost/part)
 * Both moved to category 'BMS' (unifies with FRN-BAC-ACC-RSV).
 *
 * No double-count risk: a quote selects one battery series, hence one BMS row.
 * specs.shared_physical_with + physical_part_name keep the provenance explicit.
 *
 * Idempotent: re-running updates HVM and upserts HVS by SKU.
 * Run:  node server/scripts/apply-bms-split.cjs [--dry]
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

const PHYS = 'BMS- HVM/HVS Series Base & BCU - Vers 2';

(async () => {
  console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== APPLYING ===');

  const hvmRows = await req('GET', 'products?select=*&sku=eq.GEN-BAC-ACC-HVM');
  if (!hvmRows.length) throw new Error('GEN-BAC-ACC-HVM not found');
  const hvm = hvmRows[0];

  // 1) update existing HVM row: HVM-specific name, BMS category, cross-link
  const hvmSpecs = Object.assign({}, hvm.specs || {}, {
    kind: 'BMS',
    for_battery_series: 'HVM',
    shared_physical_with: 'GEN-BAC-ACC-HVS',
    physical_part_name: PHYS,
    battery_spec_source: 'engine',
  });
  const hvmUpdate = {
    name: 'BMS- HVM Series Base & BCU - Vers 2',
    description: 'BMS- HVM Series Base & BCU - Vers 2 (same physical part as GEN-BAC-ACC-HVS)',
    category: 'BMS',
    specs: hvmSpecs,
  };
  console.log('1) update GEN-BAC-ACC-HVM -> category BMS, for_battery_series HVM, linked to HVS');
  if (!DRY) await req('PATCH', 'products?id=eq.' + hvm.id, hvmUpdate);

  // 2) upsert new HVS row cloned from HVM hardware
  const existingHvs = await req('GET', 'products?select=id&sku=eq.GEN-BAC-ACC-HVS');
  const hvsBody = {
    sku: 'GEN-BAC-ACC-HVS',
    category: 'BMS',
    subcategory: hvm.subcategory,
    brand: 'BYD',
    name: 'BMS- HVS Series Base & BCU - Vers 2',
    description: 'BMS- HVS Series Base & BCU - Vers 2 (same physical part as GEN-BAC-ACC-HVM)',
    cost_nzd: hvm.cost_nzd,
    default_margin_pct: hvm.default_margin_pct,
    unit: hvm.unit,
    stock_status: hvm.stock_status,
    qty_available: hvm.qty_available,
    moq: hvm.moq,
    is_active: true,
    source: 'manual',
    needs_review: 'split_from_combined_bms',
    specs: {
      kind: 'BMS',
      for_battery_series: 'HVS',
      shared_physical_with: 'GEN-BAC-ACC-HVM',
      physical_part_name: PHYS,
      battery_spec_source: 'engine',
      spec_source: 'bms-split',
    },
  };
  if (existingHvs.length) {
    console.log('2) GEN-BAC-ACC-HVS exists -> update');
    if (!DRY) await req('PATCH', 'products?id=eq.' + existingHvs[0].id, hvsBody);
  } else {
    console.log('2) insert NEW GEN-BAC-ACC-HVS (for_battery_series HVS, cost $' + hvm.cost_nzd + ')');
    if (!DRY) await req('POST', 'products', hvsBody);
  }

  if (DRY) { console.log('\nRe-run without --dry to apply.'); return; }

  // verify: every BYD battery series resolves to a BMS
  const bms = await req('GET', "products?select=sku,category,specs&category=eq.BMS&order=sku.asc");
  console.log('\n--- BMS category now ---');
  for (const r of bms) console.log('  ' + r.sku.padEnd(18) + ' for_battery_series=' + (r.specs || {}).for_battery_series);
  const batt = await req('GET', "products?select=sku,specs&category=eq.Batteries%20-%20Lithium&specs->>series=not.is.null");
  const bmsSeries = new Set(bms.map((b) => (b.specs || {}).for_battery_series));
  console.log('\n--- battery series -> BMS match check ---');
  for (const b of batt) {
    const ser = (b.specs || {}).series; if (!ser) continue;
    console.log('  ' + b.sku.padEnd(20) + ' series=' + String(ser).padEnd(8) + (bmsSeries.has(ser) ? 'BMS ✓' : '(no BMS row — standalone/AIO)'));
  }
})().catch((e) => { console.error(e); process.exit(1); });

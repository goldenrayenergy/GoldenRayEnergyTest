/**
 * apply-panel-specs.cjs
 *
 * Phase 4 panel cleanup — enrich the 4 real PV-module rows with full
 * datasheet specs (dimensions, electrical params, efficiency, temp coeffs,
 * mechanical loads, warranty) so proposals can render complete panel
 * datasheets and the validator has electrical limits to check against.
 *
 * Sources (real manufacturer datasheets, read page-by-page):
 *   PHN-PNL-475-QSR  -> Phono Quasar Clear 475W  PS475L7GFH-18/VBH
 *   PHN-PNL-595-DRC  -> Phono Draco 595W         PS595M8GF-24/TNH
 *   REC-PNL-470-APX  -> REC Alpha Pure-RX 470W   REC470AA Pure-RX
 *   REC-PNL-370      -> REC TwinPeak 4 370W      REC370TP4
 *
 * Merges into specs jsonb (keeps existing keys like wattage_w).
 * Idempotent. Run:  node server/scripts/apply-panel-specs.cjs [--dry]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DRY = process.argv.includes('--dry');

const envPath = path.join(__dirname, '..', '..', '.env');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t[0] === '#' || !t.includes('=')) continue;
  const i = t.indexOf('=');
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}
const BASE = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/';
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;

function req(method, q, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request(new URL(BASE + q), {
      method,
      headers: {
        apikey: KEY, Authorization: 'Bearer ' + KEY,
        'Content-Type': 'application/json', Prefer: 'return=representation',
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(method + ' ' + q + ' -> ' + res.statusCode + ' ' + d));
        resolve(d ? JSON.parse(d) : null);
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// Full normalized spec sets (snake_case, field names aligned to Panels data.xlsx template)
const SPECS = {
  'PHN-PNL-475-QSR': {
    model: 'PS475L7GFH-18/VBH', brand: 'Phono Solar', series: 'Quasar Clear',
    cell_type: 'N-Type Back Contact (BC)', technology: 'N-Type BC Dual-Glass Transparent',
    wattage_w: 475, efficiency_pct: 23.27,
    voc_v: 40.11, vmp_v: 33.20, isc_a: 15.01, imp_a: 14.31,
    temp_coeff_pmax_pct_c: -0.26, temp_coeff_voc_pct_c: -0.20, temp_coeff_isc_pct_c: 0.05,
    length_mm: 1800, width_mm: 1134, thickness_mm: 30, weight_kg: 23.5,
    front_glass: '2.0mm Heat Strengthened', back_glass: '1.6mm Heat Strengthened',
    frame: 'Anodised Aluminium Alloy', cable_mm2: 4, connectors: 'Staubli EV02', junction_box: 'IP68',
    max_system_voltage_v: 1500, max_series_fuse_a: 30, fire_rating: 'C',
    front_load_pa: 5400, rear_load_pa: 2400, noct_c: 45, power_tolerance: '0~+5W',
    bifacial: true, bifaciality_pct: 70,
    product_warranty_yrs: 30, performance_warranty_yrs: 30,
    first_year_degradation_pct: 1.00, annual_degradation_pct: 0.35,
    origin: 'China',
    spec_source: 'datasheet:PhonoSolar-QuasarClear-475W.pdf',
  },
  'PHN-PNL-595-DRC': {
    model: 'PS595M8GF-24/TNH', brand: 'Phono Solar', series: 'Draco',
    cell_type: 'N-Type Monocrystalline', technology: 'N-TOPCon Bifacial Dual-Glass',
    wattage_w: 595, efficiency_pct: 23.03,
    voc_v: 52.92, vmp_v: 43.75, isc_a: 14.32, imp_a: 13.60,
    temp_coeff_pmax_pct_c: -0.29, temp_coeff_voc_pct_c: -0.25, temp_coeff_isc_pct_c: 0.04,
    length_mm: 2278, width_mm: 1134, thickness_mm: 30, weight_kg: 32.0,
    glass: '2.0/2.0mm Heat Strengthened Dual Glass',
    frame: 'Anodized Aluminium Alloy', cable_mm2: 4, junction_box: 'IP68',
    max_system_voltage_v: 1500, max_series_fuse_a: 30, fire_rating: 'C',
    front_load_pa: 5400, rear_load_pa: 2400, noct_c: 42, power_tolerance: '0~+3%',
    bifacial: true, bifaciality_pct: 80,
    product_warranty_yrs: 15, performance_warranty_yrs: 30,
    first_year_degradation_pct: 1.00, annual_degradation_pct: 0.40,
    origin: 'China',
    spec_source: 'datasheet:GL-EN-182-DRACO-N-144-16BB(575-595W).pdf',
  },
  'REC-PNL-470-APX': {
    model: 'REC470AA Pure-RX', brand: 'REC', series: 'Alpha Pure-RX',
    cell_type: '88 half-cut heterojunction (HJT), lead-free gapless', technology: 'HJT Heterojunction',
    wattage_w: 470, efficiency_pct: 22.6, power_density_wm2: 226, watt_class_sorting: '0/+10',
    voc_v: 65.6, vmp_v: 55.4, isc_a: 8.95, imp_a: 8.49,
    temp_coeff_pmax_pct_c: -0.24, temp_coeff_voc_pct_c: -0.24, temp_coeff_isc_pct_c: 0.04,
    length_mm: 1728, width_mm: 1205, thickness_mm: 30, area_m2: 2.08, weight_kg: 23.2,
    glass: '3.2mm anti-reflective solar glass', backsheet: 'Highly resistant polymer',
    frame: 'Anodized Aluminium (black)', cable_mm2: 4, connectors: 'Staubli MC4',
    junction_box: 'IP68, 4 bypass diodes, lead-free',
    max_system_voltage_v: 1000, max_series_fuse_a: 25, max_reverse_current_a: 25, fire_rating: 'C',
    front_load_pa: 7000, rear_load_pa: 4000, noct_c: 44,
    bifacial: false,
    product_warranty_yrs: 20, product_warranty_protrust_yrs: 25, performance_warranty_yrs: 25,
    annual_degradation_pct: 0.25, power_year1_pct: 98, power_year25_pct: 92,
    origin: 'Singapore',
    spec_source: 'datasheet:REC-Alpha-Pure-RX-450_470-DS.pdf',
  },
  'REC-PNL-370': {
    model: 'REC370TP4', brand: 'REC', series: 'TwinPeak 4',
    cell_type: '120 half-cut mono c-Si p-type', technology: 'TwinPeak (p-type mono PERC)',
    wattage_w: 370, efficiency_pct: 20.3, watt_class_sorting: '0/+5',
    voc_v: 41.0, vmp_v: 34.7, isc_a: 11.38, imp_a: 10.68,
    temp_coeff_pmax_pct_c: -0.34, temp_coeff_voc_pct_c: -0.26, temp_coeff_isc_pct_c: 0.04,
    length_mm: 1755, width_mm: 1040, thickness_mm: 30, area_m2: 1.83, weight_kg: 20.0,
    glass: '3.2mm anti-reflective solar glass', backsheet: 'Highly resistant polymeric',
    frame: 'Anodized Aluminium (black)', cable_mm2: 4, connectors: 'Staubli MC4',
    junction_box: 'IP68, 3 bypass diodes',
    max_system_voltage_v: 1000, max_series_fuse_a: 25, max_reverse_current_a: 25,
    front_load_pa: 7000, rear_load_pa: 4000, noct_c: 44.6,
    bifacial: false,
    product_warranty_yrs: 20, product_warranty_protrust_yrs: 25, performance_warranty_yrs: 25,
    annual_degradation_pct: 0.5, power_year1_pct: 98, power_year25_pct: 86,
    origin: 'Singapore',
    spec_source: 'datasheet:ds_rec_twinpeak_4_series_en.pdf',
  },
};

(async () => {
  console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== APPLYING ===');
  const skus = Object.keys(SPECS);
  const rows = await req('GET', 'products?select=id,sku,name,specs&sku=in.(' + skus.join(',') + ')');
  const bySku = Object.fromEntries(rows.map((r) => [r.sku, r]));

  let done = 0;
  for (const sku of skus) {
    const row = bySku[sku];
    if (!row) { console.log('!! not found:', sku); continue; }
    const before = Object.keys(row.specs || {}).length;
    const merged = Object.assign({}, row.specs || {}, SPECS[sku]);
    console.log(`\n${sku}  (${row.name})`);
    console.log(`  specs: ${before} keys -> ${Object.keys(merged).length} keys  [${SPECS[sku].efficiency_pct}% eff, ${SPECS[sku].length_mm}x${SPECS[sku].width_mm}mm, ${SPECS[sku].product_warranty_yrs}yr product]`);
    if (!DRY) { await req('PATCH', 'products?id=eq.' + row.id, { specs: merged }); done++; }
  }
  console.log(`\n${DRY ? '[dry] would update' : 'updated'}: ${done || skus.length} panels`);
  if (DRY) console.log('Re-run without --dry to apply.');
})().catch((e) => { console.error(e); process.exit(1); });

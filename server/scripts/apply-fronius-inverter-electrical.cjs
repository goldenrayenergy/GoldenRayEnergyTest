/**
 * apply-fronius-inverter-electrical.cjs
 *
 * Fills the proposal-engine electrical-limit keys on every active Fronius
 * inverter, sourced from the official Fronius datasheets (read page-by-page):
 *
 *   Primo GEN24 / Plus 3.0-10.0  -> SE_DS_GEN24_GEN24Plus_Primo-3.0_10.0.pdf
 *   Symo  GEN24 SC / Plus 6-12   -> Datasheet_Symo_GEN24_SC_6-12_kW_AUS_EN.pdf
 *   Verto / Verto Plus 15-33.3   -> SE_DS_Fronius_Verto_Plus_EN_UK.pdf
 *   Tauro ECO 50 / 100           -> Fronius_Tauro_D_EN_AU.pdf
 *
 * Adds: uoc_max_v, mppt_count, idc_max_a_per_mppt, isc_max_a_mppt1/2/3,
 *       isc_max_a_inverter, peak_efficiency_pct,
 *       max_pv_kwp_standard (per-MPPT Wpeak), max_pv_kwp_reduced (inverter Wpeak),
 *       inverter_datasheet, spec_source.
 *
 * Convention (matches engine's existing FRN-INV-100-G24-1P values exactly):
 *   max_pv_kwp_standard = single-MPPT max PV Wpeak / 1000
 *   max_pv_kwp_reduced  = whole-inverter max PV Wpeak / 1000
 *
 * Non-Plus and Plus variants share identical PV-input specs (Plus only adds
 * the battery port), so both get the same electrical data.
 *
 * Idempotent. Run:  node server/scripts/apply-fronius-inverter-electrical.cjs [--dry]
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
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { if (res.statusCode >= 400) return reject(new Error(method + ' ' + q + ' -> ' + res.statusCode + ' ' + d)); resolve(d ? JSON.parse(d) : null); }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

const DS = {
  primo: 'SE_DS_GEN24_GEN24Plus_Primo-3.0_10.0.pdf',
  symo: 'Datasheet_Symo_GEN24_SC_6-12_kW_AUS_EN.pdf',
  verto: 'SE_DS_Fronius_Verto_Plus_EN_UK.pdf',
  tauro: 'Fronius_Tauro_D_EN_AU.pdf',
};

// family -> kw -> electrical record. idc2/isc2/isc3/isc_inv optional.
const DATA = {
  // Primo: 2 MPPT, Udc max 600
  primo: {
    3.0:  { uoc: 600, mppt: 2, idc1: 22, idc2: 12, isc1: 36,    isc2: 19, eff: 97.6, pv_std: 3.75, pv_red: 4.5 },
    4.0:  { uoc: 600, mppt: 2, idc1: 22, idc2: 12, isc1: 36,    isc2: 19, eff: 97.6, pv_std: 5.0,  pv_red: 6.0 },
    5.0:  { uoc: 600, mppt: 2, idc1: 22, idc2: 12, isc1: 36,    isc2: 19, eff: 97.6, pv_std: 6.25, pv_red: 7.5 },
    6.0:  { uoc: 600, mppt: 2, idc1: 22, idc2: 12, isc1: 36,    isc2: 19, eff: 97.6, pv_std: 7.5,  pv_red: 9.0 },
    8.0:  { uoc: 600, mppt: 2, idc1: 22, idc2: 22, isc1: 41.25, isc2: 36, eff: 97.3, pv_std: 10.0, pv_red: 12.0 },
    10.0: { uoc: 600, mppt: 2, idc1: 22, idc2: 22, isc1: 41.25, isc2: 36, eff: 97.3, pv_std: 12.5, pv_red: 15.0 },
  },
  // Symo GEN24 SC: 2 MPPT, Udc max 1000
  symo: {
    6.0:  { uoc: 1000, mppt: 2, idc1: 28, idc2: 14, isc1: 40, isc2: 20, eff: 98.3, pv_std: 7.5,  pv_red: 9.0 },
    8.0:  { uoc: 1000, mppt: 2, idc1: 28, idc2: 14, isc1: 40, isc2: 20, eff: 98.3, pv_std: 10.0, pv_red: 12.0 },
    10.0: { uoc: 1000, mppt: 2, idc1: 28, idc2: 14, isc1: 40, isc2: 20, eff: 98.3, pv_std: 12.5, pv_red: 15.0 },
    12.0: { uoc: 1000, mppt: 2, idc1: 28, idc2: 14, isc1: 40, isc2: 20, eff: 98.2, pv_std: 14.0, pv_red: 18.0 },
  },
  // Verto Plus: 3 MPPT, Udc max 1000, Isc 50/MPPT (150/inverter), pv_std = per-MPPT 20, pv_red = inverter
  verto: {
    15.0: { uoc: 1000, mppt: 3, idc1: 28, isc1: 50, isc2: 50, isc3: 50, isc_inv: 150, eff: 98.03, pv_std: 20.0, pv_red: 22.5 },
    20.0: { uoc: 1000, mppt: 3, idc1: 28, isc1: 50, isc2: 50, isc3: 50, isc_inv: 150, eff: 98.15, pv_std: 20.0, pv_red: 30.0 },
    25.0: { uoc: 1000, mppt: 3, idc1: 28, isc1: 50, isc2: 50, isc3: 50, isc_inv: 150, eff: 98.16, pv_std: 20.0, pv_red: 37.5 },
    30.0: { uoc: 1000, mppt: 3, idc1: 28, isc1: 50, isc2: 50, isc3: 50, isc_inv: 150, eff: 98.15, pv_std: 20.0, pv_red: 45.0 },
    33.3: { uoc: 1000, mppt: 3, idc1: 28, isc1: 50, isc2: 50, isc3: 50, isc_inv: 150, eff: 98.15, pv_std: 20.0, pv_red: 50.0 },
  },
  // Tauro ECO: 1 MPPT, Udc max 1000, isc_inv = inverter-level Isc max, pv = Pdc max kWp
  tauro: {
    50:  { uoc: 1000, mppt: 1, idc1: 87.5, isc1: 178, isc_inv: 178, eff: 98.5, pv_std: 75,  pv_red: 75 },
    100: { uoc: 1000, mppt: 1, idc1: 175,  isc1: 365, isc_inv: 365, eff: 98.5, pv_std: 150, pv_red: 150 },
  },
};

const FAM = { G24: 'primo', G24P: 'primo', SYMO: 'symo', SYMP: 'symo', VRTO: 'verto', VRTP: 'verto', TAUE: 'tauro' };

(async () => {
  console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== APPLYING ===');
  const rows = await req('GET', 'products?select=id,sku,name,is_active,specs&brand=eq.Fronius&is_active=eq.true&or=(category.ilike.*Inverter*,subcategory.ilike.*Inverter*)&limit=200');
  console.log('active Fronius inverter-ish rows:', rows.length);

  let done = 0, skipped = [];
  for (const r of rows) {
    const m = (r.sku || '').match(/^FRN-INV-(\d+)-(G24P|G24|SYMP|SYMO|VRTP|VRTO|TAUE)/);
    if (!m) { skipped.push((r.sku || r.name) + ' (no match)'); continue; }
    const kw = parseInt(m[1], 10) / 10;
    const fam = FAM[m[2]];
    const rec = DATA[fam] && DATA[fam][kw];
    if (!rec) { skipped.push(r.sku + ` (no data for ${fam} ${kw}kW)`); continue; }

    const add = {
      uoc_max_v: rec.uoc,
      mppt_count: rec.mppt,
      idc_max_a_per_mppt: rec.idc1,
      isc_max_a_mppt1: rec.isc1,
      peak_efficiency_pct: rec.eff,
      max_pv_kwp_standard: rec.pv_std,
      max_pv_kwp_reduced: rec.pv_red,
      inverter_datasheet: DS[fam],
      spec_source: 'datasheet:' + DS[fam],
    };
    if (rec.idc2 !== undefined) add.idc_max_a_mppt2 = rec.idc2;
    if (rec.isc2 !== undefined) add.isc_max_a_mppt2 = rec.isc2;
    if (rec.isc3 !== undefined) add.isc_max_a_mppt3 = rec.isc3;
    if (rec.isc_inv !== undefined) add.isc_max_a_inverter = rec.isc_inv;

    const merged = Object.assign({}, r.specs || {}, add);
    console.log(`${r.sku.padEnd(20)} ${fam.padEnd(6)} ${kw}kW  uoc=${rec.uoc} mppt=${rec.mppt} idc=${rec.idc1} isc1=${rec.isc1} eff=${rec.eff}% pv=${rec.pv_std}/${rec.pv_red}`);
    if (!DRY) { await req('PATCH', 'products?id=eq.' + r.id, { specs: merged }); done++; }
  }
  console.log(`\n${DRY ? '[dry] would update' : 'updated'}: ${done || '(dry)'} inverters`);
  if (skipped.length) console.log('skipped:', skipped.join(' | '));
})().catch((e) => { console.error(e); process.exit(1); });

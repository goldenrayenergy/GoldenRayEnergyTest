/**
 * apply-compat-matrix-from-deck.cjs
 *
 * Rebuilds inverter_battery_compat from the authoritative Fronius Australia deck
 * (SE_PPT_Goldenray_17.06.26_v1 — charge/discharge slides p7-9 Reserva, p29-31 BYD).
 *
 * Values are "Nominal DC charge/discharge power [kW]" → charge_kw == discharge_kw.
 * Only valid combos for ACTIVE inverters are inserted; the deck's "-" cells (e.g.
 * single-phase Primo cannot take Reserva 12.6/15.8 or HVS 10.2/12.8 or HVM 22.1)
 * are simply omitted. Replaces the prior 14 partial/partly-wrong rows.
 *
 * Run:  node server/scripts/apply-compat-matrix-from-deck.cjs            (dry run)
 *       node server/scripts/apply-compat-matrix-from-deck.cjs --apply    (writes)
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const APPLY = process.argv.includes('--apply');
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

// inverter kW -> SKU
const PRIMO = { 3.0: 'FRN-INV-30-G24P-1P', 4.0: 'FRN-INV-40-G24P-1P', 5.0: 'FRN-INV-50-G24P-1P', 6.0: 'FRN-INV-60-G24P-1P', 8.0: 'FRN-INV-80-G24P-1P', 10.0: 'FRN-INV-100-G24P-1P' };
const SYMO  = { 6.0: 'FRN-INV-60-SYMP-3P', 8.0: 'FRN-INV-80-SYMP-3P', 10.0: 'FRN-INV-100-SYMP-3P', 12.0: 'FRN-INV-120-SYMP-3P' };
const VERTO = { 15.0: 'FRN-INV-150-VRTP-3P', 20.0: 'FRN-INV-200-VRTP-3P', 25.0: 'FRN-INV-250-VRTP-3P', 30.0: 'FRN-INV-300-VRTP-3P', 33.3: 'FRN-INV-333-VRTP-3P' };

// battery col label -> SKU
const RES = { '6.3': 'FR-RES-6.3', '9.5': 'FR-RES-9.5', '12.6': 'FR-RES-12.6', '15.8': 'FR-RES-15.8' };
const HVS = { '5.1': 'BYD-HVS-5.1', '7.7': 'BYD-HVS-7.7', '10.2': 'BYD-HVS-10.2', '12.8': 'BYD-HVS-12.8' };
const HVM = { '11.0': 'BYD-HVM-11.0', '13.8': 'BYD-HVM-13.8', '16.6': 'BYD-HVM-16.6', '19.3': 'BYD-HVM-19.3', '22.1': 'BYD-HVM-22.1' };

// ── Reserva (p7 Symo / p8 Primo / p9 Verto). charge==discharge. ──
const RES_PRIMO = { // only 6.3, 9.5 supported on single-phase
  3.0: { '6.3': 3.0, '9.5': 3.0 }, 4.0: { '6.3': 4.0, '9.5': 4.0 }, 5.0: { '6.3': 4.5, '9.5': 5.0 },
  6.0: { '6.3': 4.5, '9.5': 6.0 }, 8.0: { '6.3': 4.5, '9.5': 6.75 }, 10.0: { '6.3': 4.5, '9.5': 6.75 },
};
const RES_SYMO = {
  6.0: { '6.3': 4.5, '9.5': 6.0, '12.6': 6.0, '15.8': 6.0 },
  8.0: { '6.3': 4.5, '9.5': 6.75, '12.6': 8.0, '15.8': 8.0 },
  10.0: { '6.3': 4.5, '9.5': 6.75, '12.6': 9.01, '15.8': 10.0 },
  12.0: { '6.3': 4.5, '9.5': 6.75, '12.6': 9.01, '15.8': 11.26 },
};
const RES_VERTO_ROW = { '6.3': 6.55, '9.5': 9.83, '12.6': 13.11, '15.8': 16.38 }; // same for all Verto

// ── BYD (p29 Primo / p30 Symo / p31 Verto). charge==discharge. ──
const BYD_PRIMO = { // HVS 5.1/7.7 + HVM 11/13.8/16.6/19.3 only
  3.0: { '5.1': 3.11, '7.7': 3.11, '11.0': 3.11, '13.8': 3.11, '16.6': 3.11, '19.3': 3.11 },
  4.0: { '5.1': 4.14, '7.7': 4.14, '11.0': 4.14, '13.8': 4.14, '16.6': 4.14, '19.3': 4.14 },
  5.0: { '5.1': 4.51, '7.7': 5.17, '11.0': 4.51, '13.8': 5.17, '16.6': 5.17, '19.3': 5.17 },
  6.0: { '5.1': 4.51, '7.7': 6.20, '11.0': 4.51, '13.8': 5.63, '16.6': 6.20, '19.3': 6.20 },
  8.0: { '5.1': 4.51, '7.7': 6.76, '11.0': 4.51, '13.8': 5.63, '16.6': 6.76, '19.3': 7.88 },
  10.0: { '5.1': 4.51, '7.7': 6.76, '11.0': 4.51, '13.8': 5.63, '16.6': 6.76, '19.3': 7.88 },
};
const BYD_SYMO = { // all HVS + all HVM
  6.0: { '5.1': 4.51, '7.7': 6.22, '10.2': 6.22, '12.8': 6.22, '11.0': 4.51, '13.8': 5.63, '16.6': 6.22, '19.3': 6.22, '22.1': 6.22 },
  8.0: { '5.1': 4.51, '7.7': 6.76, '10.2': 8.26, '12.8': 8.26, '11.0': 4.51, '13.8': 5.63, '16.6': 6.76, '19.3': 7.88, '22.1': 8.26 },
  10.0: { '5.1': 4.51, '7.7': 6.76, '10.2': 9.01, '12.8': 9.01, '11.0': 4.51, '13.8': 5.63, '16.6': 6.76, '19.3': 7.88, '22.1': 9.01 },
  12.0: { '5.1': 4.51, '7.7': 6.76, '10.2': 9.01, '12.8': 11.26, '11.0': 4.51, '13.8': 5.63, '16.6': 6.76, '19.3': 7.88, '22.1': 9.01 },
};
const BYD_VERTO_ROW = { '5.1': 5.12, '7.7': 7.68, '10.2': 10.24, '12.8': 12.80, '11.0': 10.24, '13.8': 12.80, '16.6': 15.36, '19.3': 17.92, '22.1': 20.48 };

function rowsFor(invMap, dataMap, batMaps, fixedRow) {
  const out = [];
  for (const [kw, invSku] of Object.entries(invMap)) {
    const row = fixedRow || dataMap[kw];
    if (!row) continue;
    for (const [col, kwVal] of Object.entries(row)) {
      // find which battery map this column belongs to
      let batSku = null;
      for (const m of batMaps) { if (m[col]) { batSku = m[col]; break; } }
      if (!batSku) continue;
      out.push({ inverter_sku: invSku, battery_system_sku: batSku, charge_kw: kwVal, discharge_kw: kwVal });
    }
  }
  return out;
}

(async () => {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (no writes) — pass --apply to write ===');

  // build all rows
  let all = [];
  all = all.concat(rowsFor(PRIMO, RES_PRIMO, [RES]));
  all = all.concat(rowsFor(SYMO, RES_SYMO, [RES]));
  all = all.concat(rowsFor(VERTO, null, [RES], RES_VERTO_ROW));
  all = all.concat(rowsFor(PRIMO, BYD_PRIMO, [HVS, HVM]));
  all = all.concat(rowsFor(SYMO, BYD_SYMO, [HVS, HVM]));
  all = all.concat(rowsFor(VERTO, null, [HVS, HVM], BYD_VERTO_ROW));

  // fetch battery capacities for max_capacity_kwh
  const bs = await req('GET', 'battery_systems?select=system_sku,capacity_kwh');
  const cap = Object.fromEntries(bs.map((b) => [b.system_sku, b.capacity_kwh]));

  // finalize records
  const records = all.map((r) => ({
    inverter_sku: r.inverter_sku,
    battery_system_sku: r.battery_system_sku,
    is_compatible: true,
    charge_kw: r.charge_kw,
    discharge_kw: r.discharge_kw,
    full_backup: true,
    max_capacity_kwh: cap[r.battery_system_sku] ?? null,
    source: 'fronius-deck-2026-06-17',
    notes: 'DC charge/discharge per Fronius compatibility deck',
  }));

  // summary
  const byFam = {};
  for (const r of records) {
    const f = r.inverter_sku.includes('G24P') ? 'Primo' : r.inverter_sku.includes('SYMP') ? 'Symo' : 'Verto';
    const b = r.battery_system_sku.startsWith('FR-RES') ? 'Reserva' : 'BYD';
    byFam[`${f}×${b}`] = (byFam[`${f}×${b}`] || 0) + 1;
  }
  console.log('TOTAL rows to insert:', records.length);
  console.log('breakdown:', JSON.stringify(byFam, null, 0));
  console.log('\nsamples:');
  for (const s of [records[0], records[12], records[28], records.find(r => r.inverter_sku === 'FRN-INV-120-SYMP-3P' && r.battery_system_sku === 'FR-RES-15.8'), records.find(r => r.inverter_sku === 'FRN-INV-333-VRTP-3P' && r.battery_system_sku === 'BYD-HVM-22.1')]) {
    if (s) console.log('  ', s.inverter_sku.padEnd(20), 'x', s.battery_system_sku.padEnd(14), 'charge/disch=' + s.charge_kw);
  }

  if (!APPLY) { console.log('\n(dry run — nothing written. Re-run with --apply to backup+replace.)'); return; }

  // backup existing, delete all, insert new
  const existing = await req('GET', 'inverter_battery_compat?select=*');
  fs.writeFileSync('C:/Users/ram33/Downloads/inverter_battery_compat_backup.json', JSON.stringify(existing, null, 2));
  console.log('\nbacked up', existing.length, 'existing rows -> Downloads/inverter_battery_compat_backup.json');
  await req('DELETE', 'inverter_battery_compat?id=not.is.null');
  console.log('deleted existing rows');
  // insert in chunks of 50
  for (let i = 0; i < records.length; i += 50) {
    const chunk = records.slice(i, i + 50);
    await req('POST', 'inverter_battery_compat', chunk);
    console.log('  inserted', Math.min(i + 50, records.length), '/', records.length);
  }
  const after = await req('GET', 'inverter_battery_compat?select=id');
  console.log('\ninverter_battery_compat now has', after.length, 'rows');
})().catch((e) => { console.error(e); process.exit(1); });

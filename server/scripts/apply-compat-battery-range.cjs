/**
 * apply-compat-battery-range.cjs
 *
 * Backfills min_battery_kwh / max_battery_kwh on inverter_battery_compat,
 * derived from the AUTHORITATIVE 165-row matrix itself (deck-consistent) —
 * NOT from the stale backup (whose Primo rows wrongly claimed 47.4 kWh).
 *
 * For each inverter: min/max_battery_kwh = smallest/largest compatible battery
 * capacity among its own valid rows (join battery_systems.capacity_kwh).
 * Set uniformly on all rows for that inverter (inverter-level supported range).
 *
 * Run:  node server/scripts/apply-compat-battery-range.cjs            (dry run)
 *       node server/scripts/apply-compat-battery-range.cjs --apply
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

(async () => {
  console.log(APPLY ? '=== APPLYING ===' : '=== DRY RUN (pass --apply to write) ===');
  const compat = await req('GET', 'inverter_battery_compat?select=inverter_sku,battery_system_sku&limit=300');
  const bs = await req('GET', 'battery_systems?select=system_sku,capacity_kwh');
  const cap = Object.fromEntries(bs.map((b) => [b.system_sku, Number(b.capacity_kwh)]));

  // group capacities by inverter
  const byInv = {};
  for (const r of compat) {
    const c = cap[r.battery_system_sku];
    if (c == null) continue;
    (byInv[r.inverter_sku] ||= []).push(c);
  }

  const ranges = Object.entries(byInv).map(([inv, caps]) => ({
    inv, min: Math.min(...caps), max: Math.max(...caps), n: caps.length,
  })).sort((a, b) => a.inv.localeCompare(b.inv));

  console.log('inverter                 #combos  min_kwh  max_kwh');
  for (const r of ranges) console.log('  ' + r.inv.padEnd(22) + ' ' + String(r.n).padStart(5) + '    ' + String(r.min).padStart(6) + '   ' + String(r.max).padStart(6));

  if (!APPLY) { console.log('\n(dry run — nothing written)'); return; }

  let updated = 0;
  for (const r of ranges) {
    await req('PATCH', 'inverter_battery_compat?inverter_sku=eq.' + r.inv, { min_battery_kwh: r.min, max_battery_kwh: r.max });
    updated += r.n;
  }
  console.log('\nupdated', updated, 'rows across', ranges.length, 'inverters');
})().catch((e) => { console.error(e); process.exit(1); });

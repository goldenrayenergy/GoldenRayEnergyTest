/**
 * apply-inverter-licenses.js
 *
 * Phase 4 inverter cleanup — final loose end.
 *
 * 1) Assigns proper SKUs to the 10 Fronius GEN24 battery-upgrade License rows
 *    and moves them all under the clean `Battery Upgrade License` category.
 * 2) Links each license <-> its parent "upgrade"-status inverter, bidirectionally:
 *      - license.specs.parent_inverter_sku  = FRN-INV-...
 *      - inverter.specs.upgrade_license_sku  = FRN-LIC-...
 *      - inverter.specs.upgrade_license_cost = <license cost_nzd>
 *
 * Licenses keep their current is_active flag (deactivated add-ons that the
 * package builder resolves by SKU; not sold standalone in the catalogue).
 *
 * Idempotent: re-running just re-writes the same values.
 * Run:  node server/scripts/apply-inverter-licenses.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DRY = process.argv.includes('--dry');

// ---- env ----
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

function req(method, pathAndQuery, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(BASE + pathAndQuery);
    const r = https.request(u, {
      method,
      headers: {
        apikey: KEY,
        Authorization: 'Bearer ' + KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(method + ' ' + pathAndQuery + ' -> ' + res.statusCode + ' ' + d));
        resolve(d ? JSON.parse(d) : null);
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const get = (q) => req('GET', q);
const patch = (q, body) => req('PATCH', q, body);

// license id -> { sku, parent inverter sku, phase }
const MAP = [
  { id: 'b6dc7879-3675-49e0-bc63-bdacab2af3b3', sku: 'FRN-LIC-30-G24',   parent: 'FRN-INV-30-G24',      phase: 'Single Phase' },
  { id: 'bbb600bc-e058-40d1-a46c-c2a12697a049', sku: 'FRN-LIC-40-G24',   parent: 'FRN-INV-40-G24',      phase: 'Single Phase' },
  { id: '4838520d-253b-4ff0-89e1-a9c5e07fcfda', sku: 'FRN-LIC-50-G24',   parent: 'FRN-INV-50-G24',      phase: 'Single Phase' },
  { id: '46e9185d-bbe0-4c9b-8e5d-b244ad9d5ab6', sku: 'FRN-LIC-60-G24',   parent: 'FRN-INV-60-G24',      phase: 'Single Phase' },
  { id: 'a2802634-4a8d-4558-b496-025ebc2cbd46', sku: 'FRN-LIC-80-G24',   parent: 'FRN-INV-80-G24-1P',   phase: 'Single Phase' },
  { id: '8b03ecf9-701d-4728-b0b4-8ebc07fa652b', sku: 'FRN-LIC-100-G24',  parent: 'FRN-INV-100-G24-1P',  phase: 'Single Phase' },
  { id: 'e5ded011-e293-40f7-ac14-56dcfe3e78ea', sku: 'FRN-LIC-60-SYMO',  parent: 'FRN-INV-60-SYMO',     phase: 'Three Phase' },
  { id: '89d99d83-7779-4824-ae4e-41aa05761130', sku: 'FRN-LIC-80-SYMO',  parent: 'FRN-INV-80-SYMO',     phase: 'Three Phase' },
  { id: '71f93f81-6250-47d3-aa60-1dd1c4eb1902', sku: 'FRN-LIC-100-SYMO', parent: 'FRN-INV-100-SYMO',    phase: 'Three Phase' },
  { id: 'f3f8aaad-a2e4-44b5-8859-d89fab0c07bd', sku: 'FRN-LIC-120-SYMO', parent: 'FRN-INV-120-SYMO-3P', phase: 'Three Phase' },
];

(async () => {
  console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== APPLYING ===');

  // fetch current license + parent rows so we merge specs, not clobber
  const licIds = MAP.map((m) => m.id).join(',');
  const licRows = await get('products?select=id,sku,name,cost_nzd,category,subcategory,is_active,specs&id=in.(' + licIds + ')');
  const licById = Object.fromEntries(licRows.map((r) => [r.id, r]));

  const parentSkus = MAP.map((m) => "%22" + m.parent + "%22").join(','); // not used; fetch by in list below
  const parents = await get('products?select=id,sku,specs&sku=in.(' + MAP.map((m) => m.parent).join(',') + ')');
  const parentBySku = Object.fromEntries(parents.map((r) => [r.sku, r]));

  let licDone = 0, invDone = 0;

  for (const m of MAP) {
    const lic = licById[m.id];
    if (!lic) { console.log('!! license row not found:', m.id); continue; }
    const parent = parentBySku[m.parent];
    if (!parent) { console.log('!! parent inverter not found:', m.parent); continue; }

    const cost = lic.cost_nzd;

    // ---- license row update ----
    const licSpecs = Object.assign({}, lic.specs || {}, {
      parent_inverter_sku: m.parent,
      unlocks: 'hybrid',
      license_for: lic.name,
      spec_source: 'inverter-licenses-cleanup',
    });
    const licBody = {
      sku: m.sku,
      category: 'Battery Upgrade License',
      subcategory: m.phase,
      specs: licSpecs,
    };

    // ---- parent inverter update (merge specs) ----
    const invSpecs = Object.assign({}, parent.specs || {}, {
      upgrade_license_sku: m.sku,
      upgrade_license_cost: cost,
    });
    const invBody = { specs: invSpecs };

    console.log(
      `\n${lic.name}\n  license  ${lic.sku || '(no sku)'} -> ${m.sku}  [$${cost}]  cat='Battery Upgrade License' sub='${m.phase}'  parent=${m.parent}` +
      `\n  inverter ${m.parent}  += upgrade_license_sku=${m.sku}, upgrade_license_cost=${cost}`
    );

    if (!DRY) {
      await patch('products?id=eq.' + m.id, licBody);
      licDone++;
      await patch('products?id=eq.' + parent.id, invBody);
      invDone++;
    }
  }

  console.log(`\n${DRY ? '[dry] would update' : 'updated'}: ${licDone || MAP.length} licenses, ${invDone || MAP.length} inverter links`);
  if (DRY) console.log('Re-run without --dry to apply.');
})().catch((e) => { console.error(e); process.exit(1); });

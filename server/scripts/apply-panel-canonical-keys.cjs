/**
 * apply-panel-canonical-keys.cjs
 *
 * Adds the proposal-engine canonical spec keys to the 4 panel rows so the
 * Supabase catalogue can drive server/services/pm/proposalEngine/* directly
 * (Option A — DB as source of truth, replacing the hardcoded catalogue.js).
 *
 * Derives the canonical keys from the descriptive keys already written by
 * apply-panel-specs.cjs (no new data — pure rename/alias). Keeps the
 * descriptive keys too, so nothing that reads them breaks.
 *
 *   watts                        <- wattage_w
 *   voc_stc                      <- voc_v
 *   isc_stc                      <- isc_a
 *   vmp_stc                      <- vmp_v
 *   imp_stc                      <- imp_a
 *   voltage_temp_coef_pct_per_c  <- temp_coeff_voc_pct_c
 *   current_temp_coef_pct_per_c  <- temp_coeff_isc_pct_c
 *   power_temp_coef_pct_per_c    <- temp_coeff_pmax_pct_c
 *   datasheet_filename           <- spec_source (strip "datasheet:" prefix)
 *
 * Idempotent. Run:  node server/scripts/apply-panel-canonical-keys.cjs [--dry]
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

const SKUS = ['PHN-PNL-475-QSR', 'PHN-PNL-595-DRC', 'REC-PNL-470-APX', 'REC-PNL-370'];

// map: canonical engine key -> descriptive key it derives from
const ALIASES = {
  watts: 'wattage_w',
  voc_stc: 'voc_v',
  isc_stc: 'isc_a',
  vmp_stc: 'vmp_v',
  imp_stc: 'imp_a',
  voltage_temp_coef_pct_per_c: 'temp_coeff_voc_pct_c',
  current_temp_coef_pct_per_c: 'temp_coeff_isc_pct_c',
  power_temp_coef_pct_per_c: 'temp_coeff_pmax_pct_c',
};

(async () => {
  console.log(DRY ? '=== DRY RUN (no writes) ===' : '=== APPLYING ===');
  const rows = await req('GET', 'products?select=id,sku,name,specs&sku=in.(' + SKUS.join(',') + ')');
  const bySku = Object.fromEntries(rows.map((r) => [r.sku, r]));

  let done = 0;
  for (const sku of SKUS) {
    const row = bySku[sku];
    if (!row) { console.log('!! not found:', sku); continue; }
    const s = row.specs || {};
    const add = {};
    for (const [canon, src] of Object.entries(ALIASES)) {
      if (s[src] !== undefined) add[canon] = s[src];
      else console.log(`   (warn) ${sku}: source key '${src}' missing`);
    }
    // datasheet_filename from spec_source ("datasheet:NAME.pdf" -> "NAME.pdf")
    if (typeof s.spec_source === 'string') {
      add.datasheet_filename = s.spec_source.replace(/^datasheet:/, '');
    }
    const merged = Object.assign({}, s, add);
    console.log(`\n${sku}  (${row.name})`);
    console.log(`  + ${Object.keys(add).join(', ')}`);
    console.log(`  voc_stc=${add.voc_stc} isc_stc=${add.isc_stc} vmp_stc=${add.vmp_stc} imp_stc=${add.imp_stc} vtc=${add.voltage_temp_coef_pct_per_c}`);
    if (!DRY) { await req('PATCH', 'products?id=eq.' + row.id, { specs: merged }); done++; }
  }
  console.log(`\n${DRY ? '[dry] would update' : 'updated'}: ${done || SKUS.length} panels`);
  if (DRY) console.log('Re-run without --dry to apply.');
})().catch((e) => { console.error(e); process.exit(1); });

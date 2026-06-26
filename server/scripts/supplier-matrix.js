// Supplier-meeting view of the inverter + battery line-up.
// Outputs a clean markdown table + writes a CSV next to the script.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const { data: invs } = await sb.from('products')
  .select('sku, brand, name, specs')
  .in('category', ['Inverters - Grid Tied', 'Inverters - Off Grid', 'Inverters - Commercial'])
  .eq('is_active', true).order('brand').order('sku');

const { data: bats } = await sb.from('products')
  .select('sku, brand, name, specs')
  .eq('category', 'Batteries - Lithium').eq('is_active', true).order('brand').order('sku');

const isHybrid = s => s?.battery_capable === true || s?.is_plus_variant === true ||
                      s?.hybrid_status === 'ready' || s?.hybrid_status === 'plus';

function family(inv) {
  if (!inv.sku) return inv.name || '(no SKU)';
  if (inv.sku.includes('-G24P-')) return 'Fronius Primo GEN24 Plus (1-phase hybrid)';
  if (inv.sku.includes('-G24-')) return 'Fronius Primo GEN24 (1-phase grid-tied, license-upgradable)';
  if (inv.sku.includes('-SYMP-')) return 'Fronius Symo GEN24 Plus (3-phase hybrid)';
  if (inv.sku.includes('-SYMO')) return 'Fronius Symo GEN24 (3-phase grid-tied, license-upgradable)';
  if (inv.sku.includes('-VRTP-')) return 'Fronius Verto Plus (3-phase commercial hybrid)';
  if (inv.sku.includes('-VRTO-')) return 'Fronius Verto (3-phase commercial grid-tied)';
  if (inv.sku.includes('-TAUE-')) return 'Fronius Tauro ECO (3-phase commercial grid-tied)';
  if (inv.sku.includes('-MPII')) return 'Victron MultiPlus II (off-grid / hybrid)';
  if (inv.sku.includes('-QTRO')) return 'Victron Quattro (off-grid)';
  return inv.name || '';
}

function ratingKw(inv) {
  if (!inv.sku) return '';
  const m = inv.sku.match(/-(\d+)-/);
  if (!m) return '';
  const n = Number(m[1]);
  // The 30 in FRN-INV-30 means 3.0 kW; 100 = 10 kW; 333 = 33.3 kW
  return (n / 10).toFixed(1) + ' kW';
}

const hybrids = invs.filter(i => isHybrid(i.specs));
const grouped = {};
for (const inv of hybrids) {
  const fam = family(inv);
  if (!grouped[fam]) grouped[fam] = [];
  grouped[fam].push(inv);
}

const nonHybrid = invs.filter(i => !isHybrid(i.specs));
const groupedBase = {};
for (const inv of nonHybrid) {
  const fam = family(inv);
  if (!grouped[fam]) groupedBase[fam] = groupedBase[fam] || [];
  groupedBase[fam] = groupedBase[fam] || [];
  groupedBase[fam].push(inv);
}

// Pretty markdown output
const out = [];
out.push('# Goldenray Energy — Inverter + Battery Line-Up');
out.push(`_Generated ${new Date().toISOString().slice(0,10)} from live Supabase catalogue_`);
out.push('');
out.push('## Batteries (active in catalogue)');
out.push('');
out.push('| Brand | SKU | Series | Module size | Notes |');
out.push('|---|---|---|---|---|');
for (const b of bats) {
  const s = b.specs || {};
  const series = s.series || s.family || '—';
  const kwh = s.module_kwh ?? s.kwh_capacity ?? '—';
  const supported = ['HVS','HVM','Reserva'].includes(series) ? 'engine-active' :
                    series === '—' ? 'legacy SKU — needs spec fill' :
                    'in catalogue, engine rule pending';
  out.push(`| ${b.brand} | \`${b.sku}\` | ${series} | ${kwh} kWh | ${supported} |`);
}

out.push('');
out.push('## Hybrid inverters (battery-ready, no license required)');
out.push('');
out.push('| Brand | Family | SKU | Rating | Phase |');
out.push('|---|---|---|---|---|');
for (const fam of Object.keys(grouped).sort()) {
  for (const inv of grouped[fam].sort((a,b) => a.sku.localeCompare(b.sku))) {
    const phase = inv.sku.includes('-1P') ? '1ϕ' : inv.sku.includes('-3P') ? '3ϕ' : '—';
    out.push(`| ${inv.brand} | ${fam.split('(')[0].trim()} | \`${inv.sku}\` | ${ratingKw(inv)} | ${phase} |`);
  }
}

out.push('');
out.push('## Compatibility matrix — which batteries pair with which hybrid inverters');
out.push('');
out.push('| Inverter family | BYD HVS | BYD HVM | Fronius Reserva |');
out.push('|---|---|---|---|');
out.push('| Fronius Primo GEN24 Plus (1ϕ) | ✓ | ✓ | ✓ |');
out.push('| Fronius Symo GEN24 Plus (3ϕ) | ✓ | ✓ | ✓ |');
out.push('| Fronius Verto Plus (3ϕ commercial) | ✓ | ✓ | ✓ |');
out.push('| Victron MultiPlus II | ✓ (standard) | ✓ (standard) | ✗ (Fronius-only ecosystem) |');
out.push('');
out.push('_Note: engine currently allows Victron + Reserva as a permissive default. The Victron pairing in real installs is BYD only._');

out.push('');
out.push('## Grid-tied inverters that can be upgraded to hybrid (license SKU)');
out.push('');
out.push('| Brand | Base SKU | Upgrade-license SKU | Becomes |');
out.push('|---|---|---|---|');
for (const fam of Object.keys(groupedBase).sort()) {
  for (const inv of (groupedBase[fam] || []).sort((a,b) => a.sku.localeCompare(b.sku))) {
    const s = inv.specs || {};
    if (!s.upgrade_license_sku) continue;
    const upgraded = inv.sku.replace('-G24-', '-G24P-').replace('-G24-1P', '-G24P-1P')
                          .replace('-SYMO', '-SYMP-').replace('-SYMO-3P', '-SYMP-3P');
    out.push(`| ${inv.brand} | \`${inv.sku}\` | \`${s.upgrade_license_sku}\` | hybrid (Plus variant) |`);
  }
}

out.push('');
out.push('## Pure grid-tied / off-grid (no battery upgrade path)');
out.push('');
out.push('| Brand | SKU | Family | Rating |');
out.push('|---|---|---|---|');
for (const inv of nonHybrid) {
  const s = inv.specs || {};
  if (s.upgrade_license_sku) continue;
  out.push(`| ${inv.brand} | \`${inv.sku}\` | ${family(inv)} | ${ratingKw(inv)} |`);
}

const md = out.join('\n');
const outPath = path.join(__dirname, '../../docs/SUPPLIER_MATRIX.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, md);
console.log(md);
console.log('\n──────────────────────────────────────────────────');
console.log(`Written to: ${outPath}`);

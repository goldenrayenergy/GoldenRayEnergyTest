// One-shot audit of the products catalogue against what the proposal
// generator needs. Reports counts by category/brand, sample products per
// category, and flags missing categories that the Excel quotation relies on.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  PRODUCT CATALOGUE AUDIT — for proposal generator readiness');
console.log('═══════════════════════════════════════════════════════════\n');

// 1. Total active count
const { rows: totals } = await client.query(`
  SELECT
    COUNT(*) FILTER (WHERE is_active) AS active_count,
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE is_active AND cost_nzd IS NOT NULL AND cost_nzd > 0) AS priced_count,
    COUNT(*) FILTER (WHERE is_active AND default_margin_pct IS NOT NULL) AS with_margin_count,
    COUNT(*) FILTER (WHERE is_active AND brand IS NOT NULL AND brand <> '') AS with_brand_count,
    COUNT(*) FILTER (WHERE is_active AND specs IS NOT NULL AND specs::text <> '{}') AS with_specs_count,
    COUNT(*) FILTER (WHERE is_active AND datasheet_url IS NOT NULL) AS with_datasheet_count,
    COUNT(*) FILTER (WHERE is_active AND image_url IS NOT NULL) AS with_image_count
  FROM products
`);
console.log(`Total products active: ${totals[0].active_count}  /  total in table: ${totals[0].total_count}`);
console.log(`  with cost_nzd > 0:        ${totals[0].priced_count}`);
console.log(`  with default_margin_pct:  ${totals[0].with_margin_count}`);
console.log(`  with brand set:           ${totals[0].with_brand_count}`);
console.log(`  with specs JSONB:         ${totals[0].with_specs_count}`);
console.log(`  with datasheet_url:       ${totals[0].with_datasheet_count}`);
console.log(`  with image_url:           ${totals[0].with_image_count}`);

// 2. By category
console.log(`\n── By category ─────────────────────────────────────────────`);
const { rows: byCat } = await client.query(`
  SELECT category, COUNT(*) AS n, COUNT(DISTINCT brand) AS brands,
         MIN(cost_nzd) AS min_cost, MAX(cost_nzd) AS max_cost
  FROM products
  WHERE is_active
  GROUP BY category
  ORDER BY n DESC
`);
for (const r of byCat) {
  console.log(`  ${String(r.category || '(no category)').padEnd(35)}  ${String(r.n).padStart(4)}  brands:${String(r.brands).padStart(3)}  $${r.min_cost || '?'} – $${r.max_cost || '?'}`);
}

// 3. By brand
console.log(`\n── Top brands ──────────────────────────────────────────────`);
const { rows: byBrand } = await client.query(`
  SELECT brand, COUNT(*) AS n
  FROM products
  WHERE is_active AND brand IS NOT NULL
  GROUP BY brand
  ORDER BY n DESC
  LIMIT 12
`);
for (const r of byBrand) {
  console.log(`  ${String(r.brand).padEnd(25)}  ${r.n}`);
}

// 4. Categories the Excel quotation needs — search by likely category name patterns
console.log(`\n── Excel quotation BOM coverage ───────────────────────────`);
const requiredCategories = [
  { what: 'Solar panels (PV Modules)',         like: ['%pv module%','%panel%','%module%'] },
  { what: 'Inverters',                          like: ['%inverter%'] },
  { what: 'Batteries',                          like: ['%battery%','%batter%','%storage%'] },
  { what: 'Smart meter / Power meter',          like: ['%meter%'] },
  { what: 'DC isolators',                       like: ['%isolator%','%dc isolator%'] },
  { what: 'AC isolators',                       like: ['%isolator%','%ac isolator%'] },
  { what: 'DC Surge protection (SPD)',          like: ['%surge%','%spd%'] },
  { what: 'AC Surge protection (SPD)',          like: ['%surge%','%spd%'] },
  { what: 'Battery protection / fuse',          like: ['%fuse%','%protection%'] },
  { what: 'Conduit',                            like: ['%conduit%','%duct%'] },
  { what: 'AC cable',                           like: ['%ac cable%','%5-core%','%4-core%','%3-phase%'] },
  { what: 'DC cable',                           like: ['%dc cable%','%solar cable%','%4mm%'] },
  { what: 'MC4 connectors / BOS materials',     like: ['%mc4%','%connector%','%bos%'] },
  { what: 'Label kit',                          like: ['%label%'] },
  { what: 'Tilt kit / mounting',                like: ['%tilt%','%mount%','%racking%','%rail%'] },
  { what: 'Cable ties / accessories',           like: ['%cable tie%','%tie%'] },
  { what: 'Roof seal / flashing',               like: ['%seal%','%flashing%','%epdm%','%flashrite%'] },
  { what: 'Mounting fasteners',                 like: ['%fastener%','%bolt%','%screw%','%anchor%'] },
  { what: 'Earthing kit',                       like: ['%earth%','%earthing%'] },
  { what: 'EV charger',                         like: ['%ev%','%ev charger%','%charging%'] },
];
for (const r of requiredCategories) {
  const conds = r.like.map((_, i) => `LOWER(name) LIKE $${i+1} OR LOWER(category) LIKE $${i+1}`).join(' OR ');
  const params = r.like.map(p => p.toLowerCase());
  const { rows: hits } = await client.query(
    `SELECT COUNT(*) AS n, MIN(cost_nzd) AS min, MAX(cost_nzd) AS max FROM products WHERE is_active AND (${conds})`,
    params
  );
  const n = parseInt(hits[0].n, 10);
  const flag = n === 0 ? '❌ MISSING' : n < 2 ? '⚠️  thin' : '✓';
  console.log(`  ${flag.padEnd(13)} ${r.what.padEnd(40)} ${n} match${n === 1 ? '' : 'es'} ${n > 0 ? `($${hits[0].min} – $${hits[0].max})` : ''}`);
}

// 5. Inverter brands + capacity coverage (need a range to support 6, 10, 15, 20 kW)
console.log(`\n── Inverter coverage by capacity (proposal needs 5–30 kW) ──`);
const { rows: invSpec } = await client.query(`
  SELECT brand, name,
         (specs->>'kw')::numeric  AS kw,
         (specs->>'phase')        AS phase,
         cost_nzd
  FROM products
  WHERE is_active AND (LOWER(category) LIKE '%inverter%' OR LOWER(name) LIKE '%inverter%')
  ORDER BY brand, kw NULLS LAST, cost_nzd
  LIMIT 30
`);
if (invSpec.length === 0) {
  console.log(`  ❌ No inverters in catalogue`);
} else {
  for (const r of invSpec.slice(0, 20)) {
    console.log(`  ${String(r.brand || '?').padEnd(15)} ${r.kw ? `${r.kw} kW`.padEnd(8) : '? kW    '} ${(r.phase || '').padEnd(8)} $${r.cost_nzd || '?'} — ${String(r.name).slice(0, 60)}`);
  }
}

// 6. Battery coverage
console.log(`\n── Battery coverage (proposal needs 5–20 kWh range) ────────`);
const { rows: batSpec } = await client.query(`
  SELECT brand, name, (specs->>'kwh')::numeric AS kwh, cost_nzd
  FROM products
  WHERE is_active AND (LOWER(category) LIKE '%battery%' OR LOWER(name) LIKE '%battery%' OR LOWER(name) LIKE '%powerwall%')
  ORDER BY brand, kwh NULLS LAST
  LIMIT 20
`);
if (batSpec.length === 0) {
  console.log(`  ❌ No batteries in catalogue`);
} else {
  for (const r of batSpec) {
    console.log(`  ${String(r.brand || '?').padEnd(15)} ${r.kwh ? `${r.kwh} kWh`.padEnd(10) : '? kWh     '} $${r.cost_nzd || '?'} — ${String(r.name).slice(0, 60)}`);
  }
}

// 7. Panel coverage
console.log(`\n── Panel coverage (proposal needs 400–500W class) ──────────`);
const { rows: panSpec } = await client.query(`
  SELECT brand, name, (specs->>'wattage')::numeric AS w, cost_nzd
  FROM products
  WHERE is_active AND (LOWER(category) LIKE '%pv module%' OR LOWER(category) LIKE '%panel%' OR LOWER(name) LIKE '%panel%')
  ORDER BY brand, w NULLS LAST
  LIMIT 20
`);
if (panSpec.length === 0) {
  console.log(`  ❌ No panels in catalogue`);
} else {
  for (const r of panSpec) {
    console.log(`  ${String(r.brand || '?').padEnd(15)} ${r.w ? `${r.w} W`.padEnd(8) : '? W     '} $${r.cost_nzd || '?'} — ${String(r.name).slice(0, 60)}`);
  }
}

// 8. Margin policy data quality
console.log(`\n── Margin policy data ──────────────────────────────────────`);
const { rows: margin } = await client.query(`
  SELECT
    AVG(default_margin_pct) AS avg_margin,
    MIN(default_margin_pct) AS min_margin,
    MAX(default_margin_pct) AS max_margin,
    COUNT(DISTINCT default_margin_pct) AS distinct_values
  FROM products WHERE is_active
`);
console.log(`  Average margin: ${parseFloat(margin[0].avg_margin || 0).toFixed(1)}%`);
console.log(`  Range: ${margin[0].min_margin}% – ${margin[0].max_margin}%`);
console.log(`  Distinct margin values across catalogue: ${margin[0].distinct_values}`);
const { rows: marginByCat } = await client.query(`
  SELECT category, ROUND(AVG(default_margin_pct), 1) AS avg_m
  FROM products WHERE is_active
  GROUP BY category ORDER BY avg_m DESC LIMIT 10
`);
console.log(`  Top 10 categories by avg margin:`);
for (const r of marginByCat) {
  console.log(`    ${String(r.category || '(none)').padEnd(35)} ${r.avg_m}%`);
}

// 9. Existing packages (already-built starter templates)
console.log(`\n── Existing packages (potential templates) ─────────────────`);
const { rows: pkgs } = await client.query(`
  SELECT slug, name, tier, system_kw, battery_kwh, from_price_override, is_active
  FROM packages WHERE is_active
  ORDER BY system_kw NULLS LAST
`);
if (pkgs.length === 0) {
  console.log(`  ❌ No packages in catalogue (table empty or migration not run)`);
} else {
  for (const p of pkgs) {
    console.log(`  ${String(p.slug).padEnd(30)}  ${String(p.tier || '?').padEnd(20)} ${String(p.system_kw || '?').padStart(6)} kW${p.battery_kwh ? ` + ${p.battery_kwh} kWh` : ''}  from-price-override:$${p.from_price_override || '—'}`);
  }
}

// 10. Existing package_items linkage
const { rows: pkgItems } = await client.query(`
  SELECT p.slug, COUNT(pi.id) AS item_count
  FROM packages p
  LEFT JOIN package_items pi ON pi.package_id = p.id
  WHERE p.is_active
  GROUP BY p.slug
  ORDER BY p.slug
`);
console.log(`\n  Existing package → product linkage:`);
for (const r of pkgItems) {
  const flag = r.item_count == 0 ? '❌' : r.item_count < 10 ? '⚠️ ' : '✓';
  console.log(`    ${flag}  ${String(r.slug).padEnd(30)}  ${r.item_count} line items`);
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  Done. Review above to confirm catalogue readiness.');
console.log('═══════════════════════════════════════════════════════════\n');

await client.end();

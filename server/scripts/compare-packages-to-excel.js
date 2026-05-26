// Compares each existing package's BOM against the Excel reference
// (15.2 kW + 12.6 kWh, Phono 475W panels + Fronius Verto 15 + Reserva 12.6 kWh).
// Reports whether quantities, components, and pricing make sense for the
// stated system size.

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

// Excel reference for the 15.2 kW + 12.6 kWh system
const EXCEL_REF = {
  system_kw: 15.2,
  panels: 32,
  panel_w: 475,
  panel_brand: 'Phono Solar',
  inverter: 'Fronius Verto 15.0',
  inverter_kw: 15,
  battery: 'Fronius Reserva 12.6 kWh',
  battery_kwh: 12.6,
  total_excl_gst: 41777, // estimated purchase cost from Excel R62
  bom_summary: {
    'PV Modules':           { qty: 32, expected_per_kw: 2.1 },     // 32 panels for 15.2 kW = 2.1 panels/kW
    'Inverter (main)':      { qty: 1 },
    'Battery modules':      { qty: 4, expected_per_kwh: 0.32 },    // 4 × 3.15 kWh = 12.6 kWh
    'Battery BMS':          { qty: 1 },
    'Smart meter':          { qty: 1 },
    'DC isolator':          { qty: 1 },
    'AC isolator':          { qty: 1 },
    'DC SPD':               { qty: 1 },
    'AC SPD':               { qty: 1 },
    'Battery fuse':         { qty: 1 },
    'Conduit':              { qty: 1 }, // (30m kit)
    'AC cable':             { qty: 24 }, // 24m
    'MC4 / BOS':            { qty: 1 },
    'Label kit':            { qty: 1 },
    'Tilt kit (4-panel)':   { qty: 8, expected_per_panel: 0.25 }, // 8 kits × 4 panels = 32 panels
    'Cable ties':           { qty: 2 },
    'Roof seal':            { qty: 1 },
    'Mounting fasteners':   { qty: 1 },
    'Earthing kit':         { qty: 1 },
    'Install labour':       { qty: 1 },
    'Supervisor':           { qty: 1 },
    'Travel':               { qty: 1 },
    'Logistics':            { qty: 1 },
    'Design':               { qty: 1 },
    'Inspection':           { qty: 1 },
    'Monitoring setup':     { qty: 1 },
    'Grid application':     { qty: 1 },
    'COC':                  { qty: 1 },
    'ESC':                  { qty: 1 },
  },
};

const fmt = (n) => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });

// Pull all packages with their items
const { rows: packages } = await client.query(`
  SELECT p.id, p.slug, p.name, p.tier, p.system_kw, p.battery_kwh,
         p.estimated_annual_savings, p.estimated_payback_years,
         p.from_price_override
  FROM packages p
  WHERE p.is_active
  ORDER BY p.system_kw NULLS LAST
`);

console.log(`\n═══════════════════════════════════════════════════════════════════`);
console.log(`  PACKAGE REALISM AUDIT — vs Excel reference (15.2 kW + 12.6 kWh)`);
console.log(`═══════════════════════════════════════════════════════════════════\n`);

console.log(`Excel reference system:`);
console.log(`  ${EXCEL_REF.system_kw} kW · ${EXCEL_REF.panels} panels (${EXCEL_REF.panel_w}W) · ${EXCEL_REF.inverter} · ${EXCEL_REF.battery}`);
console.log(`  Total cost (excl GST): ~${fmt(EXCEL_REF.total_excl_gst)}\n`);

for (const p of packages) {
  console.log(`\n────────────────────────────────────────────────────────────────────`);
  console.log(`📦  ${p.slug}  ·  ${p.tier}`);
  console.log(`     "${p.name}"`);
  console.log(`     Stated: ${p.system_kw} kW${p.battery_kwh ? ` + ${p.battery_kwh} kWh battery` : ''}`);
  console.log(`     From-price (marketing): ${fmt(p.from_price_override)}`);

  // Pull line items
  const { rows: items } = await client.query(`
    SELECT pi.qty, pi.product_id,
           pr.sku, pr.name, pr.category, pr.brand, pr.cost_nzd,
           pr.default_margin_pct, pr.specs
    FROM package_items pi
    LEFT JOIN products pr ON pr.id = pi.product_id
    WHERE pi.package_id = $1
    ORDER BY pr.category NULLS LAST, pr.name
  `, [p.id]);

  console.log(`     Line items: ${items.length}`);

  let totalCost = 0;
  let totalSell = 0;
  let panelsCounted = 0;
  let panelW = 0;
  let inverterFound = null;
  let batteryFound = null;
  let batteryKwh = 0;
  const categoryCounts = {};

  for (const it of items) {
    const qty = parseFloat(it.qty || 1);
    const cost = parseFloat(it.cost_nzd || 0);
    const margin = parseFloat(it.default_margin_pct || 30);
    totalCost += qty * cost;
    totalSell += qty * cost * (1 + margin / 100);

    const cat = it.category || '?';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

    if (cat.includes('PV Module') || /panel|module/i.test(it.name || '')) {
      const m = (it.name || '').match(/(\d{3,4})\s*W/i);
      if (m) panelW = parseInt(m[1]);
      panelsCounted += qty;
    }
    if (cat.includes('Inverter') || /inverter/i.test(it.name || '')) inverterFound = `${it.name} (${qty}×)`;
    if (/battery module|battery box|reserva|hvm|hvs|sbr/i.test(it.name || '')) {
      batteryFound = `${it.name} (${qty}×)`;
      const m = (it.name || '').match(/(\d+(?:\.\d+)?)\s*kWh/i);
      if (m) batteryKwh += qty * parseFloat(m[1]);
    }
  }

  const grossMargin = totalSell > 0 ? ((totalSell - totalCost) / totalSell) * 100 : 0;

  console.log(`     Computed BOM cost (excl GST): ${fmt(totalCost)}`);
  console.log(`     Computed sell (excl GST):     ${fmt(totalSell)}   margin: ${grossMargin.toFixed(1)}%`);
  console.log(`     Marketing from-price:         ${fmt(p.from_price_override)}   ${p.from_price_override > totalSell ? `(+${fmt(p.from_price_override - totalSell)} headroom)` : `(${fmt(totalSell - p.from_price_override)} below sell — LOSS)`}`);

  console.log(`\n     Category breakdown:`);
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`       ${String(cat).padEnd(35)} ${count} item${count === 1 ? '' : 's'}`);
  }

  console.log(`\n     Realism check:`);
  // Panel count vs system size
  const expectedPanels = panelW > 0 ? Math.round((p.system_kw * 1000) / panelW) : null;
  if (panelsCounted === 0) {
    console.log(`       ❌ NO PANELS in BOM`);
  } else if (expectedPanels && Math.abs(panelsCounted - expectedPanels) > 2) {
    console.log(`       ⚠️  ${panelsCounted} panels for ${p.system_kw} kW (with ${panelW}W) — should be ~${expectedPanels}`);
  } else {
    console.log(`       ✓  Panels: ${panelsCounted} × ${panelW}W = ${(panelsCounted * panelW / 1000).toFixed(1)} kW (matches stated ${p.system_kw} kW)`);
  }

  // Inverter
  if (!inverterFound) {
    console.log(`       ❌ NO INVERTER in BOM`);
  } else {
    console.log(`       ✓  Inverter: ${inverterFound}`);
  }

  // Battery
  if (p.battery_kwh) {
    if (!batteryFound) {
      console.log(`       ❌ Package states ${p.battery_kwh} kWh battery but NONE in BOM`);
    } else {
      const ok = Math.abs(batteryKwh - p.battery_kwh) < 1;
      console.log(`       ${ok ? '✓ ' : '⚠️ '} Battery: ${batteryFound} → ${batteryKwh} kWh${ok ? ` (matches stated ${p.battery_kwh} kWh)` : ` — stated ${p.battery_kwh} kWh, MISMATCH`}`);
    }
  } else if (batteryFound) {
    console.log(`       ⚠️  Package says no battery but BOM contains: ${batteryFound}`);
  } else {
    console.log(`       ✓  No battery (stated, BOM matches)`);
  }

  // Critical accessories vs Excel
  const has = (re) => items.some(i => re.test(`${i.name || ''} ${i.category || ''}`));
  const checks = [
    { name: 'Smart meter',         re: /smart meter|energy meter|3[- ]phase meter|1[- ]phase meter/i, required: true },
    { name: 'DC isolator',         re: /dc isolator/i, required: true },
    { name: 'AC isolator',         re: /ac isolator/i, required: true },
    { name: 'DC SPD',              re: /surge protection|spd/i, required: true },
    { name: 'AC SPD',              re: /surge protection|spd/i, required: true },
    { name: 'Battery fuse',        re: /battery (protection|fuse)/i, required: !!p.battery_kwh },
    { name: 'Conduit',             re: /conduit/i, required: true },
    { name: 'AC cable',            re: /ac cable|5[- ]core|4[- ]core/i, required: true },
    { name: 'MC4 / BOS',           re: /mc4|bos/i, required: true },
    { name: 'Label kit',           re: /label/i, required: true },
    { name: 'Tilt kit / mounting', re: /tilt kit|tin kit|tile kit|rail|racking|mount/i, required: true },
    { name: 'Cable ties',          re: /cable tie/i, required: false },
    { name: 'Roof seal',           re: /seal|epdm|flashing|flashrite/i, required: true },
    { name: 'Mounting fasteners',  re: /fastener|bolt/i, required: false },
    { name: 'Earthing',            re: /earth/i, required: true },
    { name: 'Install labour',      re: /install.*labour|labour.*install/i, required: true },
    { name: 'Compliance / COC',    re: /coc|certificate of compliance|esc|compliance/i, required: true },
    { name: 'Design fee',          re: /design.*engineering|system design/i, required: true },
  ];
  console.log(`\n     vs Excel BOM (required items):`);
  let missingRequired = 0;
  for (const c of checks) {
    const present = has(c.re);
    if (c.required && !present) {
      console.log(`       ❌ MISSING: ${c.name}`);
      missingRequired++;
    }
  }
  if (missingRequired === 0) {
    console.log(`       ✓  All required Excel items present`);
  } else {
    console.log(`       \n       Total missing required items: ${missingRequired}`);
  }
}

console.log(`\n────────────────────────────────────────────────────────────────────\n`);
await client.end();

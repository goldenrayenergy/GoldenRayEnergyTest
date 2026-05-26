// ────────────────────────────────────────────────────────────────────────────
// Build a "fixed" version of the product catalogue as an Excel file for the
// owner to review BEFORE we apply any DB changes.
//
// What it does:
//   1. Reads all products from the DB (no writes).
//   2. Infers missing brand / category / specs from product names using a
//      pattern map. Original values preserved when present.
//   3. Applies a per-product margin tier based on inferred/existing category.
//   4. Appends 13 NEW rows for the BOM gaps (DC SPD, AC SPD, AC cables,
//      labour, compliance, monitoring, grid application, COC, ESC).
//   5. Writes 3 sheets to ~/Downloads/Goldenray_Product_Catalogue_v2.xlsx:
//        - Catalogue        : the full proposed dataset, columns visible
//        - Changes          : summary of what was added / modified per row
//        - Margin Tiers     : the policy rules applied
//
// The owner reviews the file, edits anything they disagree with, and we
// then apply ONLY what they approve back to the DB in a second step.
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';
import xlsx from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

// ── Inference rules ────────────────────────────────────────────────────────

const BRAND_KEYWORDS = [
  ['Fronius', 'Fronius'],
  ['Sungrow', 'Sungrow'],
  ['SolarEdge', 'SolarEdge'],
  ['Tesla',    'Tesla'],
  ['Enphase',  'Enphase'],
  ['Huawei',   'Huawei'],
  ['Growatt',  'Growatt'],
  ['GoodWe',   'GoodWe'],
  ['BYD',      'BYD'],
  ['Phono Solar', 'Phono Solar'],
  ['Phono',    'Phono Solar'],
  ['REC',      'REC'],
  ['Hopergy',  'Hopergy'],
  ['ZYC',      'ZYC'],
  ['Victron',  'Victron'],
  ['Solarflex','Solarflex'],
  ['FlashRite','FlashRite'],
  ['Freedom Won', 'Freedom Won'],
  ['Pylontech','Pylontech'],
  ['Staubli',  'Staubli'],
  ['LG',       'LG'],
  ['Trina',    'Trina'],
  ['Jinko',    'Jinko'],
  ['Canadian', 'Canadian Solar'],
  ['JA Solar', 'JA Solar'],
];

function inferBrand(name) {
  const n = String(name || '').toLowerCase();
  for (const [kw, brand] of BRAND_KEYWORDS) {
    if (n.includes(kw.toLowerCase())) return brand;
  }
  return null;
}

// Category inference — order matters; first match wins
const CATEGORY_RULES = [
  { match: /panel|module|pv\s*module|quasar|alpha|tiger neo|draco|twin peak/i, cat: 'PV Modules', sub: 'Mono Panels' },
  { match: /off[- ]?grid/i,                                cat: 'Inverters - Off Grid',     sub: null },
  { match: /hybrid/i,                                       cat: 'Inverters - Hybrid',       sub: null },
  { match: /micro[- ]?inverter/i,                           cat: 'Inverters - Micro',        sub: null },
  { match: /inverter|gen24|verto|symo|primo|tauro|multiplus|easysolar|quattro/i, cat: 'Inverters - Grid Tied', sub: null },
  { match: /battery module|battery box|powerwall|reserva|hvm|hvs|sbr|simpo/i, cat: 'Batteries - Lithium', sub: null },
  { match: /\bbms\b|battery management/i,                   cat: 'Batteries - Lithium',      sub: 'BMS' },
  { match: /battery monitor/i,                              cat: 'Accessories',              sub: 'Battery Monitor' },
  { match: /\bbattery\b/i,                                  cat: 'Batteries - Lithium',      sub: null },
  { match: /smart meter|energy meter|3[- ]phase meter|single phase meter|power meter/i, cat: 'Smart Meters', sub: null },
  { match: /dc isolator/i,                                  cat: 'Isolators - DC',           sub: null },
  { match: /ac isolator/i,                                  cat: 'Isolators - AC',           sub: null },
  { match: /\bisolator\b/i,                                 cat: 'Isolators',                sub: null },
  { match: /surge protection|spd/i,                         cat: 'Surge Protection',         sub: null },
  { match: /\bfuse\b|battery protection/i,                  cat: 'Protection',               sub: 'Fuses' },
  { match: /mcb|circuit breaker/i,                          cat: 'Protection',               sub: 'MCB' },
  { match: /enclosure|cabinet/i,                            cat: 'Enclosures',               sub: null },
  { match: /conduit|duct/i,                                 cat: 'Conduit',                  sub: null },
  { match: /ac cable|5[- ]core|4[- ]core|3[- ]phase cable|1[- ]phase cable/i, cat: 'Cables - AC', sub: null },
  { match: /dc cable|solar cable/i,                         cat: 'Cables - DC',              sub: null },
  { match: /\bcable\b/i,                                    cat: 'Cables',                   sub: null },
  { match: /mc4|connector|bos|y[- ]?branch/i,               cat: 'MC4 & Connectors',         sub: null },
  { match: /label/i,                                        cat: 'Labels',                   sub: null },
  { match: /tilt kit|tin kit|tile kit|tile feet|rail|racking|mount/i, cat: 'Racking & Mounting', sub: null },
  { match: /cable tie|tie pack/i,                           cat: 'Accessories',              sub: 'Cable Ties' },
  { match: /seal|epdm|flashing|flashrite/i,                 cat: 'Roof Sealing',             sub: null },
  { match: /fastener|bolt|screw|anchor/i,                   cat: 'Fasteners',                sub: null },
  { match: /earth|earthing|earth rod/i,                     cat: 'Earthing',                 sub: null },
  { match: /ev charger|ev charging|charger/i,               cat: 'EV Chargers',              sub: null },
  { match: /water heater/i,                                 cat: 'Other',                    sub: 'Water Heater' },
  { match: /licen[cs]e/i,                                   cat: 'Licenses',                 sub: null },
];

function inferCategory(name, currentCategory) {
  if (currentCategory && currentCategory.trim() !== '') return { cat: currentCategory, sub: null };
  for (const r of CATEGORY_RULES) {
    if (r.match.test(String(name || ''))) return { cat: r.cat, sub: r.sub };
  }
  return { cat: 'Uncategorised', sub: null };
}

// Specs inference
function inferSpecs(name, category, currentSpecs) {
  const n = String(name || '');
  const specs = { ...(currentSpecs || {}) };

  // Panel wattage
  if (category && category.includes('PV Modules')) {
    const m = n.match(/(\d{3,4})\s*W\b/);
    if (m) specs.wattage = parseInt(m[1], 10);
  }

  // Inverter kW
  if (category && category.startsWith('Inverters')) {
    // Try patterns like "10.0", "15.0 Plus", "5kW", "GEN24 6.0"
    const m = n.match(/(\d+(?:\.\d+)?)\s*(?:kW)?\s*(?:Plus|GEN24|Verto|Symo|Primo)?\b/i);
    if (m) {
      const v = parseFloat(m[1]);
      // Heuristic — only keep if reasonable inverter size (1–100 kW)
      if (v >= 1 && v <= 100) specs.kw = v;
    }
    // Phase
    if (/three[- ]?phase|3[- ]?phase|tri[- ]?phase|symo|verto/i.test(n)) specs.phase = '3ph';
    else if (/single[- ]?phase|1[- ]?phase|primo/i.test(n)) specs.phase = '1ph';
  }

  // Battery kWh
  if (category && category.includes('Batteries')) {
    const m = n.match(/(\d+(?:\.\d+)?)\s*kWh\b/i);
    if (m) specs.kwh = parseFloat(m[1]);
  }

  // Mounting kit panels-per-kit
  if (category === 'Racking & Mounting') {
    const m = n.match(/\((\d+)[- ]?panel\)/i);
    if (m) specs.panels_per_kit = parseInt(m[1], 10);
  }

  return Object.keys(specs).length === 0 ? null : specs;
}

// Margin tiers — proposed default policy
const MARGIN_TIERS = {
  'PV Modules':                18,
  'Inverters - Grid Tied':     22,
  'Inverters - Hybrid':        22,
  'Inverters - Off Grid':      22,
  'Inverters - Micro':         22,
  'Batteries - Lithium':       25,
  'Smart Meters':              30,
  'Isolators - DC':            35,
  'Isolators - AC':            35,
  'Isolators':                 35,
  'Surge Protection':          35,
  'Protection':                40,
  'Enclosures':                30,
  'Conduit':                   45,
  'Cables - AC':               45,
  'Cables - DC':               45,
  'Cables':                    45,
  'MC4 & Connectors':          50,
  'Labels':                    55,
  'Racking & Mounting':        35,
  'Accessories':               55,
  'Roof Sealing':              50,
  'Fasteners':                 50,
  'Earthing':                  40,
  'EV Chargers':               25,
  'Licenses':                  20,
  'Labour':                    30,
  'Compliance & Services':     30,
  'Other':                     30,
  'Uncategorised':             30,
};

function applyMargin(category) {
  return MARGIN_TIERS[category] ?? 30;
}

// ── 13 new products to add (BOM gaps) ─────────────────────────────────────
const NEW_PRODUCTS = [
  // Surge protection
  { sku: 'SPD-DC-1000V', category: 'Surge Protection', subcategory: 'DC', brand: 'Generic', name: 'DC Surge Protection Device (SPD) 1000V Type II', cost_nzd: 180.00, default_margin_pct: 35, unit: 'EA', specs: { rating: '1000V DC', type: 'Type II' }, source: 'manual' },
  { sku: 'SPD-AC-3PH',   category: 'Surge Protection', subcategory: 'AC', brand: 'Generic', name: 'AC Surge Protection Device (SPD) 3-Phase Type II',  cost_nzd: 180.00, default_margin_pct: 35, unit: 'EA', specs: { phase: '3ph', type: 'Type II' }, source: 'manual' },

  // AC cables
  { sku: 'CABLE-AC-10MM-5C-3PH', category: 'Cables - AC', subcategory: 'Three Phase', brand: 'Generic', name: 'AC Cable 10mm² 5-core 3-Phase (per metre)',  cost_nzd: 18.00, default_margin_pct: 45, unit: 'M', specs: { size: '10mm²', cores: 5, phase: '3ph' }, source: 'manual' },
  { sku: 'CABLE-AC-6MM-5C-3PH',  category: 'Cables - AC', subcategory: 'Three Phase', brand: 'Generic', name: 'AC Cable 6mm² 5-core 3-Phase (per metre)',   cost_nzd: 14.00, default_margin_pct: 45, unit: 'M', specs: { size: '6mm²',  cores: 5, phase: '3ph' }, source: 'manual' },
  { sku: 'CABLE-AC-4MM-3C-1PH',  category: 'Cables - AC', subcategory: 'Single Phase', brand: 'Generic', name: 'AC Cable 4mm² 3-core 1-Phase (per metre)',  cost_nzd:  9.00, default_margin_pct: 45, unit: 'M', specs: { size: '4mm²',  cores: 3, phase: '1ph' }, source: 'manual' },

  // Labour
  { sku: 'LBR-INSTALL-DAY', category: 'Labour', subcategory: 'Installation', brand: null, name: 'Installation Labour (2-3 technicians, 1 day)',  cost_nzd: 4500.00, default_margin_pct: 30, unit: 'DAY', source: 'manual' },
  { sku: 'LBR-SUPERVISOR-DAY', category: 'Labour', subcategory: 'Supervision', brand: null, name: 'Supervisor / Project Manager (1 day)',          cost_nzd:  650.00, default_margin_pct: 30, unit: 'DAY', source: 'manual' },
  { sku: 'LBR-TRAVEL', category: 'Labour', subcategory: 'Travel', brand: null, name: 'Travel cost (per project, < 50 km)',                          cost_nzd:  350.00, default_margin_pct: 30, unit: 'EA',  source: 'manual' },
  { sku: 'LBR-LOGISTICS', category: 'Labour', subcategory: 'Logistics', brand: null, name: 'Loading / Transport / Logistics (per project)',        cost_nzd:  650.00, default_margin_pct: 30, unit: 'EA',  source: 'manual' },

  // Compliance & services
  { sku: 'CMP-DESIGN', category: 'Compliance & Services', subcategory: 'Design', brand: null, name: 'System Design & Engineering',                 cost_nzd:  200.00, default_margin_pct: 30, unit: 'EA', source: 'manual' },
  { sku: 'CMP-INSPECT', category: 'Compliance & Services', subcategory: 'Inspection', brand: null, name: 'Inspection & Compliance Certification', cost_nzd:  500.00, default_margin_pct: 30, unit: 'EA', source: 'manual' },
  { sku: 'CMP-MONITORING', category: 'Compliance & Services', subcategory: 'Monitoring', brand: null, name: 'Monitoring Setup & Commissioning',   cost_nzd:  350.00, default_margin_pct: 30, unit: 'EA', source: 'manual' },
  { sku: 'CMP-GRID-APP', category: 'Compliance & Services', subcategory: 'Grid', brand: null, name: 'Grid Application Assistance',                cost_nzd:  250.00, default_margin_pct: 30, unit: 'EA', source: 'manual' },
  { sku: 'CMP-COC', category: 'Compliance & Services', subcategory: 'Certification', brand: null, name: 'Certificate of Compliance (CoC)',         cost_nzd:  150.00, default_margin_pct: 30, unit: 'EA', source: 'manual' },
  { sku: 'CMP-ESC', category: 'Compliance & Services', subcategory: 'Certification', brand: null, name: 'Electrical Safety Certificate (ESC)',     cost_nzd:  120.00, default_margin_pct: 30, unit: 'EA', source: 'manual' },
];

// ── Read existing products ────────────────────────────────────────────────
const { rows: existing } = await client.query(`
  SELECT id, sku, category, subcategory, brand, name, description,
         cost_nzd, default_margin_pct, unit,
         stock_status, qty_available, moq, image_url, datasheet_url,
         specs, source, is_active
  FROM products
  WHERE is_active
  ORDER BY category NULLS LAST, name
`);
console.log(`Read ${existing.length} active products from DB.`);

// ── Build proposed rows ───────────────────────────────────────────────────
const changes = [];
const proposed = [];

for (const p of existing) {
  const catRes  = inferCategory(p.name, p.category);
  const newCat  = catRes.cat;
  const newSub  = p.subcategory || catRes.sub;
  const newBrand = p.brand || inferBrand(p.name);
  const currentSpecs = p.specs || {};
  const inferredSpecs = inferSpecs(p.name, newCat, currentSpecs);
  const newMargin = applyMargin(newCat);

  const diffs = [];
  if (!p.category && newCat) diffs.push(`category: → ${newCat}`);
  if (!p.subcategory && newSub) diffs.push(`subcategory: → ${newSub}`);
  if (!p.brand && newBrand) diffs.push(`brand: → ${newBrand}`);
  if (inferredSpecs && JSON.stringify(currentSpecs) !== JSON.stringify(inferredSpecs)) {
    diffs.push(`specs: → ${JSON.stringify(inferredSpecs)}`);
  }
  if (Number(p.default_margin_pct) !== newMargin) {
    diffs.push(`margin: ${p.default_margin_pct}% → ${newMargin}%`);
  }

  proposed.push({
    Action: diffs.length === 0 ? 'unchanged' : 'modified',
    SKU: p.sku || '',
    Category: newCat,
    Subcategory: newSub || '',
    Brand: newBrand || '',
    Name: p.name,
    'Cost (NZD)': Number(p.cost_nzd || 0),
    'Margin %': newMargin,
    'Sell excl GST': +(Number(p.cost_nzd || 0) * (1 + newMargin / 100)).toFixed(2),
    'Sell incl GST': +(Number(p.cost_nzd || 0) * (1 + newMargin / 100) * 1.15).toFixed(2),
    Unit: p.unit || 'EA',
    'Stock Status': p.stock_status || 'unknown',
    Specs: inferredSpecs ? JSON.stringify(inferredSpecs) : (p.specs ? JSON.stringify(p.specs) : ''),
    'Original Cost': Number(p.cost_nzd || 0),
    'Original Margin': Number(p.default_margin_pct || 30),
    'Original Category': p.category || '',
    'Original Brand': p.brand || '',
    Source: p.source || 'manual',
    'Changes Applied': diffs.join(' | '),
  });

  if (diffs.length > 0) {
    changes.push({
      SKU: p.sku || '',
      Name: p.name,
      Changes: diffs.join('  ·  '),
    });
  }
}

// Add new products
for (const np of NEW_PRODUCTS) {
  const margin = applyMargin(np.category);
  proposed.push({
    Action: 'NEW',
    SKU: np.sku,
    Category: np.category,
    Subcategory: np.subcategory || '',
    Brand: np.brand || '',
    Name: np.name,
    'Cost (NZD)': np.cost_nzd,
    'Margin %': np.default_margin_pct ?? margin,
    'Sell excl GST': +(np.cost_nzd * (1 + (np.default_margin_pct ?? margin) / 100)).toFixed(2),
    'Sell incl GST': +(np.cost_nzd * (1 + (np.default_margin_pct ?? margin) / 100) * 1.15).toFixed(2),
    Unit: np.unit,
    'Stock Status': 'unknown',
    Specs: np.specs ? JSON.stringify(np.specs) : '',
    'Original Cost': '',
    'Original Margin': '',
    'Original Category': '(new)',
    'Original Brand': '',
    Source: 'manual',
    'Changes Applied': 'NEW PRODUCT',
  });
  changes.push({
    SKU: np.sku,
    Name: np.name,
    Changes: 'NEW — added to fill BOM gap',
  });
}

// ── Write XLSX ─────────────────────────────────────────────────────────────

const wb = xlsx.utils.book_new();

// Sheet 1: full proposed catalogue
const wsCatalogue = xlsx.utils.json_to_sheet(proposed);
xlsx.utils.book_append_sheet(wb, wsCatalogue, 'Catalogue');

// Sheet 2: changes summary
const wsChanges = xlsx.utils.json_to_sheet(
  changes.length > 0 ? changes : [{ SKU: '', Name: '', Changes: '(no changes)' }]
);
xlsx.utils.book_append_sheet(wb, wsChanges, 'Changes');

// Sheet 3: margin tier policy
const wsTiers = xlsx.utils.json_to_sheet(
  Object.entries(MARGIN_TIERS).map(([cat, m]) => ({ Category: cat, 'Margin %': m }))
);
xlsx.utils.book_append_sheet(wb, wsTiers, 'Margin Tiers');

// Sheet 4: stats
const stats = [
  { Metric: 'Existing products read',     Count: existing.length },
  { Metric: 'Modified (any change)',      Count: changes.filter(c => !c.Changes.startsWith('NEW')).length },
  { Metric: 'New products added',         Count: NEW_PRODUCTS.length },
  { Metric: 'Total in proposed catalogue',Count: proposed.length },
  { Metric: 'Distinct categories',        Count: [...new Set(proposed.map(p => p.Category))].length },
  { Metric: 'Distinct brands',            Count: [...new Set(proposed.map(p => p.Brand).filter(Boolean))].length },
  { Metric: 'Distinct margin tiers',      Count: [...new Set(proposed.map(p => p['Margin %']))].length },
];
const wsStats = xlsx.utils.json_to_sheet(stats);
xlsx.utils.book_append_sheet(wb, wsStats, 'Stats');

const outPath = path.join(os.homedir(), 'Downloads', 'Goldenray_Product_Catalogue_v2.xlsx');
xlsx.writeFile(wb, outPath);

console.log(`\n✅ Written: ${outPath}`);
console.log(`   Catalogue:    ${proposed.length} rows (${existing.length} existing + ${NEW_PRODUCTS.length} new)`);
console.log(`   Changes:      ${changes.length} rows`);
console.log(`   Margin Tiers: ${Object.keys(MARGIN_TIERS).length} categories\n`);

await client.end();

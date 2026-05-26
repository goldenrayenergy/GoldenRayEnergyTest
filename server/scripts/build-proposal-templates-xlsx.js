// ────────────────────────────────────────────────────────────────────────────
// Build a "Proposal Templates v1" Excel for owner review.
//
// SCALING RULES are derived directly from the user's reference Excel
// (Goldenray_Final_Detailed_Quotation.xlsx — 15.2 kW + 12.6 kWh).
// Each template's BOM mirrors that Excel's structure, scaled by:
//   - panel_count (= panels × wattage gives system kW)
//   - kWh battery (= battery modules required)
//   - per-kW cable / conduit needs
//
// 6 templates cover the realistic NZ residential market:
//   1. residential-3kw           (3.8 kW — entry, single-phase, no battery)
//   2. residential-6kw           (6.65 kW — typical 3-4 BR family, no battery)
//   3. residential-6kw-battery   (6.65 kW + 10.24 kWh — most popular battery)
//   4. residential-10kw          (10.45 kW — large home, three-phase)
//   5. residential-15kw-battery  (15.2 kW + 12.6 kWh — exact Excel reference)
//   6. residential-20kw-battery  (19.95 kW + 18.9 kWh — large home/small biz)
//
// Output sheets:
//   Summary           — one row per template (specs, cost, sell, margin, from-price)
//   Scaling Rules     — explains every BOM line's scaling formula
//   BOM-<slug>        — full BOM per template (one sheet each — Excel-style)
//   Catalogue Used    — the 30+ products this script references (with cost/margin)
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

// ── Read existing catalogue ────────────────────────────────────────────────
const { rows: dbProducts } = await client.query(`
  SELECT id, sku, category, brand, name, cost_nzd, default_margin_pct, unit, specs
  FROM products WHERE is_active
`);

// Index by SKU + by lowercase name match
const bySku  = new Map();
const byName = new Map();
for (const p of dbProducts) {
  if (p.sku) bySku.set(p.sku, p);
  byName.set(String(p.name || '').toLowerCase().trim(), p);
}

// ── 15 NEW catalogue items (mirror the catalogue-v2 Excel) ────────────────
const NEW_CATALOG = [
  { sku:'SPD-DC-1000V',           category:'Surge Protection',     brand:'Generic', name:'DC Surge Protection Device (SPD) 1000V Type II', cost:180,     margin:35, unit:'EA' },
  { sku:'SPD-AC-3PH',             category:'Surge Protection',     brand:'Generic', name:'AC Surge Protection Device (SPD) 3-Phase Type II', cost:180,    margin:35, unit:'EA' },
  { sku:'CABLE-AC-10MM-5C-3PH',   category:'Cables - AC',          brand:'Generic', name:'AC Cable 10mm² 5-core 3-Phase (per metre)',     cost:18,      margin:45, unit:'M'  },
  { sku:'CABLE-AC-6MM-5C-3PH',    category:'Cables - AC',          brand:'Generic', name:'AC Cable 6mm² 5-core 3-Phase (per metre)',      cost:14,      margin:45, unit:'M'  },
  { sku:'CABLE-AC-4MM-3C-1PH',    category:'Cables - AC',          brand:'Generic', name:'AC Cable 4mm² 3-core 1-Phase (per metre)',      cost:9,       margin:45, unit:'M'  },
  { sku:'LBR-INSTALL-DAY',        category:'Labour',               brand:null,      name:'Installation Labour (2-3 technicians, 1 day)',  cost:4500,    margin:30, unit:'DAY'},
  { sku:'LBR-SUPERVISOR-DAY',     category:'Labour',               brand:null,      name:'Supervisor / Project Manager (1 day)',          cost:650,     margin:30, unit:'DAY'},
  { sku:'LBR-TRAVEL',             category:'Labour',               brand:null,      name:'Travel cost (per project, < 50 km)',            cost:350,     margin:30, unit:'EA' },
  { sku:'LBR-LOGISTICS',          category:'Labour',               brand:null,      name:'Loading / Transport / Logistics (per project)', cost:650,     margin:30, unit:'EA' },
  { sku:'CMP-DESIGN',             category:'Compliance & Services',brand:null,      name:'System Design & Engineering',                    cost:200,     margin:30, unit:'EA' },
  { sku:'CMP-INSPECT',            category:'Compliance & Services',brand:null,      name:'Inspection & Compliance Certification',          cost:500,     margin:30, unit:'EA' },
  { sku:'CMP-MONITORING',         category:'Compliance & Services',brand:null,      name:'Monitoring Setup & Commissioning',               cost:350,     margin:30, unit:'EA' },
  { sku:'CMP-GRID-APP',           category:'Compliance & Services',brand:null,      name:'Grid Application Assistance',                    cost:250,     margin:30, unit:'EA' },
  { sku:'CMP-COC',                category:'Compliance & Services',brand:null,      name:'Certificate of Compliance (CoC)',                cost:150,     margin:30, unit:'EA' },
  { sku:'CMP-ESC',                category:'Compliance & Services',brand:null,      name:'Electrical Safety Certificate (ESC)',            cost:120,     margin:30, unit:'EA' },
];
for (const np of NEW_CATALOG) {
  const fakeProduct = {
    sku: np.sku, category: np.category, brand: np.brand, name: np.name,
    cost_nzd: np.cost, default_margin_pct: np.margin, unit: np.unit, _new: true,
  };
  bySku.set(np.sku, fakeProduct);
  byName.set(np.name.toLowerCase().trim(), fakeProduct);
}

// ── Margin tiers (same as catalogue-v2 Excel) ─────────────────────────────
const MARGIN_TIERS = {
  'PV Modules': 18, 'Inverters - Grid Tied': 22, 'Inverters - Hybrid': 22,
  'Inverters - Off Grid': 22, 'Batteries - Lithium': 25, 'Smart Meters': 30,
  'Isolators - DC': 35, 'Isolators - AC': 35, 'Isolators': 35, 'Surge Protection': 35,
  'Protection': 40, 'Conduit': 45, 'Cables - AC': 45, 'Cables - DC': 45, 'Cables': 45,
  'MC4 & Connectors': 50, 'Labels': 55, 'Racking & Mounting': 35, 'Accessories': 55,
  'Roof Sealing': 50, 'Fasteners': 50, 'Earthing': 40, 'EV Chargers': 25,
  'Labour': 30, 'Compliance & Services': 30, 'Other': 30, 'Uncategorised': 30,
};

function applyMargin(p) {
  return MARGIN_TIERS[p.category] ?? Number(p.default_margin_pct) ?? 30;
}

// ── Lookup helpers ─────────────────────────────────────────────────────────

function findProductBySku(sku) {
  return bySku.get(sku);
}

function findFirstByNameKeyword(...keywords) {
  for (const [name, p] of byName) {
    if (keywords.every(kw => name.includes(kw.toLowerCase()))) return p;
  }
  return null;
}

// ── Resolve a "logical" item to a real catalogue product ─────────────────
// `spec` is one of:
//   { sku: 'XXX' }
//   { keyword: ['phono','475w'] }
//   { fallbackName: 'something' }
function resolveProduct(spec) {
  if (spec.sku) {
    const p = findProductBySku(spec.sku);
    if (p) return p;
  }
  if (spec.keyword) {
    const p = findFirstByNameKeyword(...spec.keyword);
    if (p) return p;
  }
  return null;
}

// ── Template definitions ──────────────────────────────────────────────────
// Each template lists logical items + qty. Resolves at build time.
// "fixed" qty is per-project. Other qtys may scale per-kW or per-panel — but
// for these 6 templates we set explicit qtys based on Excel scaling rules.

function panelKitsForCount(panels) {
  return Math.ceil(panels / 4);  // Hopergy 4-panel tilt kits
}
function acCableMetres(systemKw, threePhase) {
  return threePhase ? Math.ceil(systemKw * 1.6) : Math.ceil(systemKw * 1.4);
}

const TEMPLATES = [
  // ── 1. Residential 3 kW ─────────────────────────────────────────────────
  {
    slug: 'residential-3kw',
    name: 'Residential 3 kW (Entry)',
    description: 'Compact 3 kW for 1-2 person households. Single-phase, hybrid-ready.',
    system_kw: 3.8,
    panel_count: 8,
    panel_w: 475,
    battery_kwh: null,
    phase: '1ph',
    inverter_kw: 3,
    items: [
      { logical: 'Panels',         spec: { keyword: ['phono', '475w', 'quasar'] }, qty: 8 },
      { logical: 'Inverter',       spec: { keyword: ['fronius', 'primo', '3.0', 'gen24'] }, qty: 1 },
      { logical: 'Smart meter',    spec: { keyword: ['fronius', '63a-1', 'single phase smart meter'] }, qty: 1 },
      { logical: 'DC isolator',    spec: { keyword: ['dc isolator', '32a'] }, qty: 1 },
      { logical: 'AC isolator',    spec: { keyword: ['ac isolator'] }, qty: 1 },
      { logical: 'DC SPD',         spec: { sku: 'SPD-DC-1000V' }, qty: 1 },
      { logical: 'AC SPD',         spec: { sku: 'SPD-AC-3PH' }, qty: 1 },
      { logical: 'Conduit',        spec: { keyword: ['conduit'] }, qty: 1 },
      { logical: 'AC cable',       spec: { sku: 'CABLE-AC-4MM-3C-1PH' }, qty: acCableMetres(3.8, false) },
      { logical: 'DC cable',       spec: { keyword: ['solar cable', '4mm'] }, qty: 1 },
      { logical: 'MC4 / BOS',      spec: { keyword: ['mc4'] }, qty: 1 },
      { logical: 'Label kit',      spec: { keyword: ['label kit', 'string'] }, qty: 1 },
      { logical: 'Mounting kits',  spec: { keyword: ['hopergy', 'tilt kit'] }, qty: panelKitsForCount(8) },
      { logical: 'Cable ties',     spec: { keyword: ['cable tie'] }, qty: 1 },
      { logical: 'Roof seal',      spec: { keyword: ['flashrite', 'epdm'] }, qty: 1 },
      { logical: 'Earthing',       spec: { keyword: ['earth'] }, qty: 1 },
      { logical: 'Install labour', spec: { sku: 'LBR-INSTALL-DAY' }, qty: 1 },
      { logical: 'Supervisor',     spec: { sku: 'LBR-SUPERVISOR-DAY' }, qty: 1 },
      { logical: 'Travel',         spec: { sku: 'LBR-TRAVEL' }, qty: 1 },
      { logical: 'Logistics',      spec: { sku: 'LBR-LOGISTICS' }, qty: 1 },
      { logical: 'Design fee',     spec: { sku: 'CMP-DESIGN' }, qty: 1 },
      { logical: 'Inspection',     spec: { sku: 'CMP-INSPECT' }, qty: 1 },
      { logical: 'Monitoring',     spec: { sku: 'CMP-MONITORING' }, qty: 1 },
      { logical: 'Grid app',       spec: { sku: 'CMP-GRID-APP' }, qty: 1 },
      { logical: 'COC',            spec: { sku: 'CMP-COC' }, qty: 1 },
      { logical: 'ESC',            spec: { sku: 'CMP-ESC' }, qty: 1 },
    ],
  },

  // ── 2. Residential 6 kW (no battery) ────────────────────────────────────
  {
    slug: 'residential-6kw',
    name: 'Residential 6 kW',
    description: 'Typical 3-4 BR family home. Single-phase, hybrid-ready inverter.',
    system_kw: 6.65,
    panel_count: 14,
    panel_w: 475,
    battery_kwh: null,
    phase: '1ph',
    inverter_kw: 6,
    items: [
      { logical: 'Panels',         spec: { keyword: ['phono', '475w', 'quasar'] }, qty: 14 },
      { logical: 'Inverter',       spec: { keyword: ['fronius', 'primo', '6.0', 'gen24'] }, qty: 1 },
      { logical: 'Smart meter',    spec: { keyword: ['fronius', '63a-1', 'single phase smart meter'] }, qty: 1 },
      { logical: 'DC isolator',    spec: { keyword: ['dc isolator', '32a'] }, qty: 1 },
      { logical: 'AC isolator',    spec: { keyword: ['ac isolator'] }, qty: 1 },
      { logical: 'DC SPD',         spec: { sku: 'SPD-DC-1000V' }, qty: 1 },
      { logical: 'AC SPD',         spec: { sku: 'SPD-AC-3PH' }, qty: 1 },
      { logical: 'Conduit',        spec: { keyword: ['conduit'] }, qty: 1 },
      { logical: 'AC cable',       spec: { sku: 'CABLE-AC-4MM-3C-1PH' }, qty: acCableMetres(6.65, false) },
      { logical: 'DC cable',       spec: { keyword: ['solar cable', '4mm'] }, qty: 1 },
      { logical: 'MC4 / BOS',      spec: { keyword: ['mc4'] }, qty: 1 },
      { logical: 'Label kit',      spec: { keyword: ['label kit', 'string'] }, qty: 1 },
      { logical: 'Mounting kits',  spec: { keyword: ['hopergy', 'tilt kit'] }, qty: panelKitsForCount(14) },
      { logical: 'Cable ties',     spec: { keyword: ['cable tie'] }, qty: 2 },
      { logical: 'Roof seal',      spec: { keyword: ['flashrite', 'epdm'] }, qty: 1 },
      { logical: 'Earthing',       spec: { keyword: ['earth'] }, qty: 1 },
      { logical: 'Install labour', spec: { sku: 'LBR-INSTALL-DAY' }, qty: 1 },
      { logical: 'Supervisor',     spec: { sku: 'LBR-SUPERVISOR-DAY' }, qty: 1 },
      { logical: 'Travel',         spec: { sku: 'LBR-TRAVEL' }, qty: 1 },
      { logical: 'Logistics',      spec: { sku: 'LBR-LOGISTICS' }, qty: 1 },
      { logical: 'Design fee',     spec: { sku: 'CMP-DESIGN' }, qty: 1 },
      { logical: 'Inspection',     spec: { sku: 'CMP-INSPECT' }, qty: 1 },
      { logical: 'Monitoring',     spec: { sku: 'CMP-MONITORING' }, qty: 1 },
      { logical: 'Grid app',       spec: { sku: 'CMP-GRID-APP' }, qty: 1 },
      { logical: 'COC',            spec: { sku: 'CMP-COC' }, qty: 1 },
      { logical: 'ESC',            spec: { sku: 'CMP-ESC' }, qty: 1 },
    ],
  },

  // ── 3. Residential 6 kW + 10 kWh battery ────────────────────────────────
  {
    slug: 'residential-6kw-battery',
    name: 'Residential 6 kW + 10 kWh Battery',
    description: 'Most popular battery option. Solar + backup for typical NZ home.',
    system_kw: 6.65,
    panel_count: 14,
    panel_w: 475,
    battery_kwh: 10.24,
    phase: '1ph',
    inverter_kw: 6,
    items: [
      { logical: 'Panels',         spec: { keyword: ['phono', '475w', 'quasar'] }, qty: 14 },
      { logical: 'Inverter',       spec: { keyword: ['fronius', 'primo', '6.0', 'gen24'] }, qty: 1 },
      { logical: 'Battery modules',spec: { keyword: ['byd', 'hvs', '2.56'] }, qty: 4 },  // 4 × 2.56 = 10.24 kWh
      { logical: 'Battery BMS',    spec: { keyword: ['byd', 'bms'] }, qty: 1 },
      { logical: 'Battery fuse',   spec: { keyword: ['battery', 'fuse'] }, qty: 1 },
      { logical: 'Smart meter',    spec: { keyword: ['fronius', '63a-1', 'single phase smart meter'] }, qty: 1 },
      { logical: 'DC isolator',    spec: { keyword: ['dc isolator', '32a'] }, qty: 1 },
      { logical: 'AC isolator',    spec: { keyword: ['ac isolator'] }, qty: 1 },
      { logical: 'DC SPD',         spec: { sku: 'SPD-DC-1000V' }, qty: 1 },
      { logical: 'AC SPD',         spec: { sku: 'SPD-AC-3PH' }, qty: 1 },
      { logical: 'Conduit',        spec: { keyword: ['conduit'] }, qty: 1 },
      { logical: 'AC cable',       spec: { sku: 'CABLE-AC-4MM-3C-1PH' }, qty: acCableMetres(6.65, false) },
      { logical: 'DC cable',       spec: { keyword: ['solar cable', '4mm'] }, qty: 1 },
      { logical: 'MC4 / BOS',      spec: { keyword: ['mc4'] }, qty: 1 },
      { logical: 'Label kit',      spec: { keyword: ['label kit', 'string'] }, qty: 1 },
      { logical: 'Mounting kits',  spec: { keyword: ['hopergy', 'tilt kit'] }, qty: panelKitsForCount(14) },
      { logical: 'Cable ties',     spec: { keyword: ['cable tie'] }, qty: 2 },
      { logical: 'Roof seal',      spec: { keyword: ['flashrite', 'epdm'] }, qty: 1 },
      { logical: 'Earthing',       spec: { keyword: ['earth'] }, qty: 1 },
      { logical: 'Install labour', spec: { sku: 'LBR-INSTALL-DAY' }, qty: 1 },
      { logical: 'Supervisor',     spec: { sku: 'LBR-SUPERVISOR-DAY' }, qty: 1 },
      { logical: 'Travel',         spec: { sku: 'LBR-TRAVEL' }, qty: 1 },
      { logical: 'Logistics',      spec: { sku: 'LBR-LOGISTICS' }, qty: 1 },
      { logical: 'Design fee',     spec: { sku: 'CMP-DESIGN' }, qty: 1 },
      { logical: 'Inspection',     spec: { sku: 'CMP-INSPECT' }, qty: 1 },
      { logical: 'Monitoring',     spec: { sku: 'CMP-MONITORING' }, qty: 1 },
      { logical: 'Grid app',       spec: { sku: 'CMP-GRID-APP' }, qty: 1 },
      { logical: 'COC',            spec: { sku: 'CMP-COC' }, qty: 1 },
      { logical: 'ESC',            spec: { sku: 'CMP-ESC' }, qty: 1 },
    ],
  },

  // ── 4. Residential 10 kW (no battery, three-phase) ──────────────────────
  {
    slug: 'residential-10kw',
    name: 'Residential 10 kW (Three-Phase)',
    description: 'Large home or small commercial. Three-phase, hybrid-ready.',
    system_kw: 10.45,
    panel_count: 22,
    panel_w: 475,
    battery_kwh: null,
    phase: '3ph',
    inverter_kw: 10,
    items: [
      { logical: 'Panels',         spec: { keyword: ['phono', '475w', 'quasar'] }, qty: 22 },
      { logical: 'Inverter',       spec: { keyword: ['fronius', 'symo', '10.0', 'gen24'] }, qty: 1 },
      { logical: 'Smart meter',    spec: { keyword: ['fronius', '63a-3', 'three phase smart meter'] }, qty: 1 },
      { logical: 'DC isolator',    spec: { keyword: ['dc isolator', '32a'] }, qty: 1 },
      { logical: 'AC isolator',    spec: { keyword: ['ac isolator'] }, qty: 1 },
      { logical: 'DC SPD',         spec: { sku: 'SPD-DC-1000V' }, qty: 1 },
      { logical: 'AC SPD',         spec: { sku: 'SPD-AC-3PH' }, qty: 1 },
      { logical: 'Conduit',        spec: { keyword: ['conduit'] }, qty: 1 },
      { logical: 'AC cable',       spec: { sku: 'CABLE-AC-6MM-5C-3PH' }, qty: acCableMetres(10.45, true) },
      { logical: 'DC cable',       spec: { keyword: ['solar cable', '4mm'] }, qty: 1 },
      { logical: 'MC4 / BOS',      spec: { keyword: ['mc4'] }, qty: 1 },
      { logical: 'Label kit',      spec: { keyword: ['label kit', 'string'] }, qty: 1 },
      { logical: 'Mounting kits',  spec: { keyword: ['hopergy', 'tilt kit'] }, qty: panelKitsForCount(22) },
      { logical: 'Cable ties',     spec: { keyword: ['cable tie'] }, qty: 2 },
      { logical: 'Roof seal',      spec: { keyword: ['flashrite', 'epdm'] }, qty: 1 },
      { logical: 'Earthing',       spec: { keyword: ['earth'] }, qty: 1 },
      { logical: 'Install labour', spec: { sku: 'LBR-INSTALL-DAY' }, qty: 1 },
      { logical: 'Supervisor',     spec: { sku: 'LBR-SUPERVISOR-DAY' }, qty: 1 },
      { logical: 'Travel',         spec: { sku: 'LBR-TRAVEL' }, qty: 1 },
      { logical: 'Logistics',      spec: { sku: 'LBR-LOGISTICS' }, qty: 1 },
      { logical: 'Design fee',     spec: { sku: 'CMP-DESIGN' }, qty: 1 },
      { logical: 'Inspection',     spec: { sku: 'CMP-INSPECT' }, qty: 1 },
      { logical: 'Monitoring',     spec: { sku: 'CMP-MONITORING' }, qty: 1 },
      { logical: 'Grid app',       spec: { sku: 'CMP-GRID-APP' }, qty: 1 },
      { logical: 'COC',            spec: { sku: 'CMP-COC' }, qty: 1 },
      { logical: 'ESC',            spec: { sku: 'CMP-ESC' }, qty: 1 },
    ],
  },

  // ── 5. Residential 15 kW + 12.6 kWh battery (EXACT EXCEL REFERENCE) ─────
  {
    slug: 'residential-15kw-battery',
    name: 'Residential 15 kW + 12.6 kWh Battery (Excel match)',
    description: 'Large home, three-phase, Fronius Verto + Reserva battery. Mirrors your reference Excel exactly.',
    system_kw: 15.2,
    panel_count: 32,
    panel_w: 475,
    battery_kwh: 12.6,
    phase: '3ph',
    inverter_kw: 15,
    items: [
      { logical: 'Panels',         spec: { keyword: ['phono', '475w', 'quasar'] }, qty: 32 },
      { logical: 'Inverter',       spec: { keyword: ['fronius', 'verto', '15.0'] }, qty: 1 },
      { logical: 'Battery BMS',    spec: { keyword: ['fronius', 'reserva', 'bms'] }, qty: 1 },
      { logical: 'Battery modules',spec: { keyword: ['fronius', 'reserva', '3.15'] }, qty: 4 },  // 4 × 3.15 = 12.6 kWh
      { logical: 'Battery fuse',   spec: { keyword: ['battery', 'fuse'] }, qty: 1 },
      { logical: 'Smart meter',    spec: { keyword: ['fronius', '63a-3', 'three phase smart meter'] }, qty: 1 },
      { logical: 'DC isolator',    spec: { keyword: ['dc isolator', '32a'] }, qty: 1 },
      { logical: 'AC isolator',    spec: { keyword: ['ac isolator'] }, qty: 1 },
      { logical: 'DC SPD',         spec: { sku: 'SPD-DC-1000V' }, qty: 1 },
      { logical: 'AC SPD',         spec: { sku: 'SPD-AC-3PH' }, qty: 1 },
      { logical: 'Conduit',        spec: { keyword: ['conduit'] }, qty: 1 },
      { logical: 'AC cable',       spec: { sku: 'CABLE-AC-10MM-5C-3PH' }, qty: 24 }, // matches Excel
      { logical: 'DC cable',       spec: { keyword: ['solar cable', '4mm'] }, qty: 1 },
      { logical: 'MC4 / BOS',      spec: { keyword: ['mc4'] }, qty: 1 },
      { logical: 'Label kit',      spec: { keyword: ['label kit', 'string'] }, qty: 1 },
      { logical: 'Mounting kits',  spec: { keyword: ['hopergy', 'tilt kit'] }, qty: 8 }, // matches Excel
      { logical: 'Cable ties',     spec: { keyword: ['cable tie'] }, qty: 2 },
      { logical: 'Roof seal',      spec: { keyword: ['flashrite', 'epdm'] }, qty: 1 },
      { logical: 'Mounting fasteners', spec: { keyword: ['fastener'] }, qty: 1 },
      { logical: 'Earthing',       spec: { keyword: ['earth'] }, qty: 1 },
      { logical: 'Install labour', spec: { sku: 'LBR-INSTALL-DAY' }, qty: 1 },
      { logical: 'Supervisor',     spec: { sku: 'LBR-SUPERVISOR-DAY' }, qty: 1 },
      { logical: 'Travel',         spec: { sku: 'LBR-TRAVEL' }, qty: 1 },
      { logical: 'Logistics',      spec: { sku: 'LBR-LOGISTICS' }, qty: 1 },
      { logical: 'Design fee',     spec: { sku: 'CMP-DESIGN' }, qty: 1 },
      { logical: 'Inspection',     spec: { sku: 'CMP-INSPECT' }, qty: 1 },
      { logical: 'Monitoring',     spec: { sku: 'CMP-MONITORING' }, qty: 1 },
      { logical: 'Grid app',       spec: { sku: 'CMP-GRID-APP' }, qty: 1 },
      { logical: 'COC',            spec: { sku: 'CMP-COC' }, qty: 1 },
      { logical: 'ESC',            spec: { sku: 'CMP-ESC' }, qty: 1 },
    ],
  },

  // ── 6. Residential 20 kW + 18.9 kWh battery ─────────────────────────────
  {
    slug: 'residential-20kw-battery',
    name: 'Residential 20 kW + 18.9 kWh Battery',
    description: 'Maximum residential. Three-phase, large EV/pool households or small commercial.',
    system_kw: 19.95,
    panel_count: 42,
    panel_w: 475,
    battery_kwh: 18.9,
    phase: '3ph',
    inverter_kw: 20,
    items: [
      { logical: 'Panels',         spec: { keyword: ['phono', '475w', 'quasar'] }, qty: 42 },
      { logical: 'Inverter',       spec: { keyword: ['fronius', 'verto', '20.0'] }, qty: 1 },
      { logical: 'Battery BMS',    spec: { keyword: ['fronius', 'reserva', 'bms'] }, qty: 1 },
      { logical: 'Battery modules',spec: { keyword: ['fronius', 'reserva', '3.15'] }, qty: 6 },  // 6 × 3.15 = 18.9 kWh
      { logical: 'Battery fuse',   spec: { keyword: ['battery', 'fuse'] }, qty: 1 },
      { logical: 'Smart meter',    spec: { keyword: ['fronius', '63a-3', 'three phase smart meter'] }, qty: 1 },
      { logical: 'DC isolator',    spec: { keyword: ['dc isolator', '32a'] }, qty: 2 },  // larger system needs 2
      { logical: 'AC isolator',    spec: { keyword: ['ac isolator'] }, qty: 1 },
      { logical: 'DC SPD',         spec: { sku: 'SPD-DC-1000V' }, qty: 1 },
      { logical: 'AC SPD',         spec: { sku: 'SPD-AC-3PH' }, qty: 1 },
      { logical: 'Conduit',        spec: { keyword: ['conduit'] }, qty: 2 },  // double for size
      { logical: 'AC cable',       spec: { sku: 'CABLE-AC-10MM-5C-3PH' }, qty: acCableMetres(19.95, true) },
      { logical: 'DC cable',       spec: { keyword: ['solar cable', '4mm'] }, qty: 2 },
      { logical: 'MC4 / BOS',      spec: { keyword: ['mc4'] }, qty: 2 },
      { logical: 'Label kit',      spec: { keyword: ['label kit', 'string'] }, qty: 1 },
      { logical: 'Mounting kits',  spec: { keyword: ['hopergy', 'tilt kit'] }, qty: panelKitsForCount(42) },
      { logical: 'Cable ties',     spec: { keyword: ['cable tie'] }, qty: 3 },
      { logical: 'Roof seal',      spec: { keyword: ['flashrite', 'epdm'] }, qty: 1 },
      { logical: 'Mounting fasteners', spec: { keyword: ['fastener'] }, qty: 1 },
      { logical: 'Earthing',       spec: { keyword: ['earth'] }, qty: 1 },
      { logical: 'Install labour', spec: { sku: 'LBR-INSTALL-DAY' }, qty: 2 },  // 2 days for big install
      { logical: 'Supervisor',     spec: { sku: 'LBR-SUPERVISOR-DAY' }, qty: 2 },
      { logical: 'Travel',         spec: { sku: 'LBR-TRAVEL' }, qty: 1 },
      { logical: 'Logistics',      spec: { sku: 'LBR-LOGISTICS' }, qty: 1 },
      { logical: 'Design fee',     spec: { sku: 'CMP-DESIGN' }, qty: 1 },
      { logical: 'Inspection',     spec: { sku: 'CMP-INSPECT' }, qty: 1 },
      { logical: 'Monitoring',     spec: { sku: 'CMP-MONITORING' }, qty: 1 },
      { logical: 'Grid app',       spec: { sku: 'CMP-GRID-APP' }, qty: 1 },
      { logical: 'COC',            spec: { sku: 'CMP-COC' }, qty: 1 },
      { logical: 'ESC',            spec: { sku: 'CMP-ESC' }, qty: 1 },
    ],
  },
];

// ── Build resolved BOMs ────────────────────────────────────────────────────

const allRefs = new Map(); // sku → product (for "Catalogue Used" sheet)
const summaryRows = [];
const fullSheets = {};

function fmt$(n) { return Number(n || 0); }

for (const tpl of TEMPLATES) {
  const lines = [];
  let costSum = 0, sellSum = 0;
  const unresolved = [];

  for (const item of tpl.items) {
    const product = resolveProduct(item.spec);
    if (!product) {
      unresolved.push(`${item.logical} (${JSON.stringify(item.spec)})`);
      lines.push({
        Section: '',
        Logical: item.logical,
        SKU: '(unresolved)',
        Name: '(no match in catalogue)',
        Brand: '',
        Qty: item.qty,
        'Unit Cost': '',
        'Margin %': '',
        'Unit Sell': '',
        'Line Total': '',
      });
      continue;
    }
    allRefs.set(product.sku || product.name, product);
    const margin = applyMargin(product);
    const cost = parseFloat(product.cost_nzd || 0);
    const sell = cost * (1 + margin / 100);
    const lineCost = cost * item.qty;
    const lineSell = sell * item.qty;
    costSum += lineCost;
    sellSum += lineSell;

    lines.push({
      Section: sectionFor(product.category),
      Logical: item.logical,
      SKU: product.sku || '',
      Name: product.name,
      Brand: product.brand || '',
      Qty: item.qty,
      'Unit Cost': +cost.toFixed(2),
      'Margin %': margin,
      'Unit Sell': +sell.toFixed(2),
      'Line Total': +lineSell.toFixed(2),
    });
  }

  // Sort by section
  const SECTION_ORDER = ['A) Materials', 'B) Labour', 'C) Compliance', ''];
  lines.sort((a, b) => SECTION_ORDER.indexOf(a.Section) - SECTION_ORDER.indexOf(b.Section));

  const gst = sellSum * 0.15;
  const total = sellSum + gst;
  const grossProfit = sellSum - costSum;
  const grossMarginPct = sellSum > 0 ? (grossProfit / sellSum) * 100 : 0;

  // Marketing from-price = nice-rounded total (round up to nearest $500)
  const fromPrice = Math.ceil(total / 500) * 500;

  summaryRows.push({
    Slug: tpl.slug,
    Name: tpl.name,
    'kW DC':       tpl.system_kw,
    'Panels':      tpl.panel_count,
    'Battery kWh': tpl.battery_kwh ?? '',
    'Phase':       tpl.phase,
    'Inverter kW': tpl.inverter_kw,
    'Lines':       lines.length,
    'Unresolved':  unresolved.length,
    'Cost (excl GST)':   +costSum.toFixed(2),
    'Sell (excl GST)':   +sellSum.toFixed(2),
    'Gross Profit':      +grossProfit.toFixed(2),
    'Gross Margin %':    +grossMarginPct.toFixed(1),
    'GST (15%)':         +gst.toFixed(2),
    'Total (incl GST)':  +total.toFixed(2),
    'From-Price (rounded)': fromPrice,
  });

  // Full BOM sheet for this template
  fullSheets[tpl.slug] = lines;
}

function sectionFor(category) {
  if (!category) return 'A) Materials';
  if (category === 'Labour')               return 'B) Labour';
  if (category === 'Compliance & Services')return 'C) Compliance';
  return 'A) Materials';
}

// ── Build XLSX ─────────────────────────────────────────────────────────────

const wb = xlsx.utils.book_new();

// Sheet 1: Summary
xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(summaryRows), 'Summary');

// Sheet 2: Scaling rules
const scalingRules = [
  { Item: 'Panels',            'Scaling Rule': 'Per template — explicit panel count × wattage = system kW' },
  { Item: 'Inverter',          'Scaling Rule': 'Selected by system kW: 3kW Primo / 6kW Primo / 10kW SYMO / 15kW Verto / 20kW Verto' },
  { Item: 'Smart meter',       'Scaling Rule': '1ph (63A-1) for single-phase systems, 3ph (63A-3) for three-phase' },
  { Item: 'Battery modules',   'Scaling Rule': 'qty = ceil(stated_kwh / module_kwh). Reserva 3.15 kWh module on Verto, BYD HVS 2.56 kWh on Primo' },
  { Item: 'Battery BMS',       'Scaling Rule': '1 per battery system' },
  { Item: 'Battery fuse',      'Scaling Rule': '1 per battery system' },
  { Item: 'DC isolator',       'Scaling Rule': '1 for systems ≤15kW, 2 for ≥20kW' },
  { Item: 'AC isolator',       'Scaling Rule': '1 per project' },
  { Item: 'DC SPD',            'Scaling Rule': '1 per project (NZ-compliant)' },
  { Item: 'AC SPD',            'Scaling Rule': '1 per project (NZ-compliant)' },
  { Item: 'Conduit (30m kit)', 'Scaling Rule': '1 for systems ≤15kW, 2 for ≥20kW' },
  { Item: 'AC cable',          'Scaling Rule': 'metres = ceil(kW × 1.4) single-phase, ceil(kW × 1.6) three-phase. Excel reference: 24m for 15.2 kW' },
  { Item: 'DC cable',          'Scaling Rule': '1 kit per project (≤22 panels), 2 for larger' },
  { Item: 'MC4 / BOS',         'Scaling Rule': '1 for systems ≤22 panels, 2 for larger' },
  { Item: 'Label kit',         'Scaling Rule': '1 per project (NZ AS/NZS5033.2021)' },
  { Item: 'Mounting kits',     'Scaling Rule': 'qty = ceil(panels / 4). Hopergy 4-panel tilt kit. Excel: 8 kits = 32 panels' },
  { Item: 'Cable ties',        'Scaling Rule': '1 per ≤8 panels, 2 per ≤22, 3 for larger' },
  { Item: 'Roof seal',         'Scaling Rule': '1 per project' },
  { Item: 'Mounting fasteners','Scaling Rule': '1 for ≥15kW (extra anchors)' },
  { Item: 'Earthing kit',      'Scaling Rule': '1 per project' },
  { Item: 'Install labour',    'Scaling Rule': '1 day ≤15kW, 2 days ≥20kW' },
  { Item: 'Supervisor',        'Scaling Rule': '1 day per install day' },
  { Item: 'Travel',            'Scaling Rule': '1 per project (within 50 km)' },
  { Item: 'Logistics',         'Scaling Rule': '1 per project' },
  { Item: 'Design / Inspection / Monitoring / Grid app / COC / ESC', 'Scaling Rule': '1 each per project (fixed compliance overhead)' },
];
xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(scalingRules), 'Scaling Rules');

// Sheet 3+: Per-template BOM
for (const tpl of TEMPLATES) {
  const rows = fullSheets[tpl.slug];
  // Add summary header rows for context at the top
  const header = [
    { Logical: `=== ${tpl.name} ===` },
    { Logical: tpl.description },
    { Logical: `System: ${tpl.system_kw} kW DC · ${tpl.panel_count} panels${tpl.battery_kwh ? ` · ${tpl.battery_kwh} kWh battery` : ''} · ${tpl.phase}` },
    { Logical: '' },
  ];
  const ws = xlsx.utils.json_to_sheet([...header, ...rows]);
  xlsx.utils.book_append_sheet(wb, ws, `BOM-${tpl.slug.slice(0, 24)}`);
}

// Sheet last: Catalogue Used
const refRows = [];
for (const p of allRefs.values()) {
  const margin = applyMargin(p);
  refRows.push({
    SKU: p.sku || '',
    Category: p.category || '',
    Brand: p.brand || '',
    Name: p.name,
    'Cost (NZD)': +parseFloat(p.cost_nzd || 0).toFixed(2),
    'Margin %': margin,
    Unit: p.unit || 'EA',
    'New (not yet in DB)': p._new ? 'YES' : '',
  });
}
refRows.sort((a, b) => (a.Category || '').localeCompare(b.Category || ''));
xlsx.utils.book_append_sheet(wb, xlsx.utils.json_to_sheet(refRows), 'Catalogue Used');

// Save
const outPath = path.join(os.homedir(), 'Downloads', 'Goldenray_Proposal_Templates_v1.xlsx');
xlsx.writeFile(wb, outPath);

console.log(`\n✅ Written: ${outPath}\n`);
console.log(`Summary:`);
for (const r of summaryRows) {
  console.log(`  ${r.Slug.padEnd(28)} ${String(r['kW DC']).padStart(6)} kW${r['Battery kWh'] ? ` + ${r['Battery kWh']} kWh`.padEnd(12) : '              '}  cost $${Math.round(r['Cost (excl GST)']).toLocaleString()}  →  sell $${Math.round(r['Sell (excl GST)']).toLocaleString()}  →  total inc GST $${Math.round(r['Total (incl GST)']).toLocaleString()}  margin ${r['Gross Margin %']}%${r['Unresolved'] > 0 ? `  ⚠️ ${r.Unresolved} items unresolved` : ''}`);
}
console.log('');

await client.end();

// ────────────────────────────────────────────────────────────────────────────
// Build the "Supplier Setup" workbook for Goldenray.
//
// The owner takes this Excel file into supplier conversations, fills in the
// negotiated terms (tier, wholesale cost, margin target, volume commits),
// and brings it back. A later importer reads this workbook and seeds the
// suppliers / products / compatibility / region / cost-defaults tables.
//
// The workbook is designed to be human-friendly:
//   - 1 README sheet up front with instructions
//   - Each domain table has its own sheet
//   - Example rows pre-filled with realistic NZ data
//   - Column widths sized for readability
//   - "Notes" column on every sheet for free-text from supplier calls
//
// Run:  node server/scripts/build-supplier-setup-xlsx.js
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import os from 'node:os';
import xlsx from 'xlsx';

const OUT = path.join(os.homedir(), 'Downloads', 'Goldenray_Supplier_Setup.xlsx');

const wb = xlsx.utils.book_new();

// ── Helper: append a sheet with a header row, data rows, and column widths ─
function addSheet(name, columns, rows) {
  const aoa = [
    columns.map(c => c.label),
    ...rows.map(r => columns.map(c => r[c.key] ?? '')),
  ];
  const ws = xlsx.utils.aoa_to_sheet(aoa);
  ws['!cols'] = columns.map(c => ({ wch: c.width || 16 }));
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  xlsx.utils.book_append_sheet(wb, ws, name);
}

// ─── SHEET 1 — README / Instructions ────────────────────────────────────────
const readmeRows = [
  ['GOLDENRAY ENERGY NZ — SUPPLIER SETUP WORKBOOK', ''],
  ['', ''],
  ['HOW TO USE THIS FILE', ''],
  ['', ''],
  ['1. Take this into every supplier conversation. Fill in negotiated terms as you talk.', ''],
  ['2. Each sheet is independent. Fill in any order — example rows show the shape.', ''],
  ['3. Don\'t delete the example rows yet — they\'re your reference. Delete them before re-importing.', ''],
  ['4. When done, hand the file back to the dev team for import into the DB.', ''],
  ['', ''],
  ['THE 7 SHEETS', ''],
  ['', ''],
  ['Suppliers',         'One row per supplier brand you buy from. Captures the relationship terms.'],
  ['Products',          'Extended product catalogue — adds wholesale_cost, margin_target, lead_time.'],
  ['Compatibility',     'Which panels work with which inverters; which batteries work with which inverters.'],
  ['Region_Defaults',   'Sun hours + average household consumption per NZ region. Drives system sizing.'],
  ['Cost_Defaults',     'Install labour, permits, scaffolding — fixed costs to add on top of parts.'],
  ['Package_Templates', 'Pre-defined recipes that the 3-quote engine uses to build packages from products.'],
  ['', ''],
  ['TIER GUIDE — for the Suppliers sheet', ''],
  ['', ''],
  ['t1_strategic', 'Volume commitment in place. Best wholesale pricing. Marketing co-funding. Dedicated rep. PRIORITY for Quote A.'],
  ['t2_volume',    'Regular volume buyer. Good wholesale. No commit. Negotiated each order. PRIORITY for Quote B.'],
  ['t3_opportunistic', 'Spot buys only. Highest margin. Less leverage. Used for Quote C / price-sensitive customers.'],
  ['', ''],
  ['QUESTIONS TO ASK EACH SUPPLIER', ''],
  ['', ''],
  ['1. What is your wholesale price per unit if I commit to X units/year?', ''],
  ['2. What is the lead time from order to delivery (Auckland)?', ''],
  ['3. Is there marketing co-funding available — and what % do you contribute?', ''],
  ['4. What\'s your warranty back-stop process if a customer claims fails?', ''],
  ['5. Who is the dedicated account manager? What\'s their direct number?', ''],
  ['6. Do you offer extended warranties / value-add packs I can resell?', ''],
  ['', ''],
  ['FILE LOCATION', ''],
  ['', ''],
  ['Save as you go. Keep on Goldenray\'s shared drive — multiple sales reps may add to it.', ''],
];

(() => {
  const ws = xlsx.utils.aoa_to_sheet(readmeRows);
  ws['!cols'] = [{ wch: 32 }, { wch: 90 }];
  xlsx.utils.book_append_sheet(wb, ws, 'README');
})();

// ─── SHEET 2 — Suppliers ────────────────────────────────────────────────────
addSheet('Suppliers', [
  { key: 'supplier_name',            label: 'Supplier Name',                  width: 26 },
  { key: 'short_code',               label: 'Short Code',                     width: 12 },
  { key: 'category_focus',           label: 'Category Focus',                 width: 18 },
  { key: 'tier',                     label: 'Tier (t1/t2/t3)',                width: 18 },
  { key: 'contract_status',          label: 'Status (active/probation/paused)', width: 22 },
  { key: 'contract_start',           label: 'Contract Start (YYYY-MM-DD)',    width: 22 },
  { key: 'contract_renewal_date',    label: 'Renewal Date (YYYY-MM-DD)',      width: 22 },
  { key: 'min_volume_target_yearly', label: 'Min Volume / Year',              width: 18 },
  { key: 'volume_unit',              label: 'Volume Unit (panels/inverters/batteries/mixed)', width: 36 },
  { key: 'marketing_cofund_pct',     label: 'Marketing Co-fund %',            width: 20 },
  { key: 'rep_name',                 label: 'Rep / Account Manager',          width: 24 },
  { key: 'rep_email',                label: 'Rep Email',                      width: 30 },
  { key: 'rep_phone',                label: 'Rep Phone',                      width: 16 },
  { key: 'notes',                    label: 'Notes',                          width: 50 },
], [
  // Example rows — based on what's in the existing catalogue/seeds
  {
    supplier_name: 'Fronius Australia (NZ distributor: Solar King)', short_code: 'FRO',
    category_focus: 'Inverters', tier: 't1_strategic', contract_status: 'active',
    contract_start: '', contract_renewal_date: '',
    min_volume_target_yearly: 30, volume_unit: 'inverters',
    marketing_cofund_pct: 0, rep_name: '', rep_email: '', rep_phone: '',
    notes: 'EXAMPLE — replace with your actual Fronius rep details after the call',
  },
  {
    supplier_name: 'REC Solar', short_code: 'REC',
    category_focus: 'Panels', tier: 't1_strategic', contract_status: 'active',
    contract_start: '', contract_renewal_date: '',
    min_volume_target_yearly: 200, volume_unit: 'panels',
    marketing_cofund_pct: 0, rep_name: '', rep_email: '', rep_phone: '',
    notes: 'EXAMPLE',
  },
  {
    supplier_name: 'BYD Battery', short_code: 'BYD',
    category_focus: 'Batteries', tier: 't1_strategic', contract_status: 'active',
    contract_start: '', contract_renewal_date: '',
    min_volume_target_yearly: 40, volume_unit: 'batteries',
    marketing_cofund_pct: 0, rep_name: '', rep_email: '', rep_phone: '',
    notes: 'EXAMPLE',
  },
  {
    supplier_name: 'Phono Solar', short_code: 'PHO',
    category_focus: 'Panels', tier: 't2_volume', contract_status: 'active',
    contract_start: '', contract_renewal_date: '',
    min_volume_target_yearly: '', volume_unit: 'panels',
    marketing_cofund_pct: 0, rep_name: '', rep_email: '', rep_phone: '',
    notes: 'EXAMPLE — main volume panel today, used in 4 of 5 seeded packages',
  },
  {
    supplier_name: 'Sungrow', short_code: 'SUN',
    category_focus: 'Inverters', tier: 't2_volume', contract_status: 'active',
    contract_start: '', contract_renewal_date: '',
    min_volume_target_yearly: '', volume_unit: 'inverters',
    marketing_cofund_pct: 0, rep_name: '', rep_email: '', rep_phone: '',
    notes: 'EXAMPLE',
  },
  {
    supplier_name: 'Tesla Energy', short_code: 'TSL',
    category_focus: 'Batteries', tier: 't2_volume', contract_status: 'active',
    contract_start: '', contract_renewal_date: '',
    min_volume_target_yearly: '', volume_unit: 'batteries',
    marketing_cofund_pct: 0, rep_name: '', rep_email: '', rep_phone: '',
    notes: 'EXAMPLE — customer-requested by name, premium positioning',
  },
  {
    supplier_name: 'Freedom Won', short_code: 'FRW',
    category_focus: 'Batteries', tier: 't2_volume', contract_status: 'active',
    contract_start: '', contract_renewal_date: '',
    min_volume_target_yearly: '', volume_unit: 'batteries',
    marketing_cofund_pct: 0, rep_name: '', rep_email: '', rep_phone: '',
    notes: 'EXAMPLE — used in whole-home package',
  },
  {
    supplier_name: 'Hopergy', short_code: 'HOP',
    category_focus: 'Racking', tier: 't2_volume', contract_status: 'active',
    contract_start: '', contract_renewal_date: '',
    min_volume_target_yearly: '', volume_unit: 'mixed',
    marketing_cofund_pct: 0, rep_name: '', rep_email: '', rep_phone: '',
    notes: 'EXAMPLE — racking + clamps for every install',
  },
  {
    supplier_name: 'Trina Solar', short_code: 'TRN',
    category_focus: 'Panels', tier: 't3_opportunistic', contract_status: 'active',
    contract_start: '', contract_renewal_date: '',
    min_volume_target_yearly: '', volume_unit: 'panels',
    marketing_cofund_pct: 0, rep_name: '', rep_email: '', rep_phone: '',
    notes: 'EXAMPLE — fallback when REC/Phono are tight',
  },
  {
    supplier_name: 'Solis', short_code: 'SOL',
    category_focus: 'Inverters', tier: 't3_opportunistic', contract_status: 'active',
    contract_start: '', contract_renewal_date: '',
    min_volume_target_yearly: '', volume_unit: 'inverters',
    marketing_cofund_pct: 0, rep_name: '', rep_email: '', rep_phone: '',
    notes: 'EXAMPLE — budget inverter for price-sensitive customers',
  },
]);

// ─── SHEET 3 — Products ─────────────────────────────────────────────────────
addSheet('Products', [
  { key: 'sku',                label: 'SKU',                          width: 12 },
  { key: 'product_name',       label: 'Product Name',                 width: 38 },
  { key: 'category',           label: 'Category (panel/inverter/battery/racking/bos)', width: 36 },
  { key: 'supplier_short_code',label: 'Supplier Short Code',          width: 18 },
  { key: 'model_number',       label: 'Model Number',                 width: 22 },
  { key: 'wattage_w',          label: 'Wattage (W) — panels',         width: 16 },
  { key: 'kw_rating',          label: 'kW Rating — inverters',        width: 18 },
  { key: 'kwh_capacity',       label: 'kWh Capacity — batteries',     width: 20 },
  { key: 'phase',              label: 'Phase (1-phase/3-phase)',      width: 18 },
  { key: 'wholesale_cost_nzd', label: 'Wholesale Cost $NZ (your cost)', width: 22 },
  { key: 'rrp_nzd',            label: 'Supplier RRP $NZ (optional)',   width: 22 },
  { key: 'margin_target_pct',  label: 'Margin Target %',              width: 16 },
  { key: 'lead_time_days',     label: 'Lead Time (days)',             width: 14 },
  { key: 'datasheet_url',      label: 'Datasheet URL',                width: 40 },
  { key: 'notes',              label: 'Notes',                        width: 40 },
], [
  // Examples covering each category
  { sku: '301066', product_name: 'REC TP4 370W Panel', category: 'panel',
    supplier_short_code: 'REC', model_number: 'REC370TP4',
    wattage_w: 370, kw_rating: '', kwh_capacity: '', phase: '',
    wholesale_cost_nzd: 295, rrp_nzd: 380, margin_target_pct: 14, lead_time_days: 14,
    datasheet_url: '', notes: 'EXAMPLE — used in Starter 3kW package' },
  { sku: '311306', product_name: 'Phono Solar 595W Draco Panel', category: 'panel',
    supplier_short_code: 'PHO', model_number: 'PS-M10/595W',
    wattage_w: 595, kw_rating: '', kwh_capacity: '', phase: '',
    wholesale_cost_nzd: 240, rrp_nzd: 320, margin_target_pct: 22, lead_time_days: 21,
    datasheet_url: '', notes: 'EXAMPLE — main volume panel' },
  { sku: '301075', product_name: 'Fronius Primo 3.0 GEN24 Hybrid Inverter', category: 'inverter',
    supplier_short_code: 'FRO', model_number: 'PRIMO 3.0-1 GEN24',
    wattage_w: '', kw_rating: 3.0, kwh_capacity: '', phase: '1-phase',
    wholesale_cost_nzd: 2400, rrp_nzd: 3200, margin_target_pct: 15, lead_time_days: 7,
    datasheet_url: '', notes: 'EXAMPLE' },
  { sku: '301010', product_name: 'Fronius Primo 5.0 GEN24 Hybrid Inverter', category: 'inverter',
    supplier_short_code: 'FRO', model_number: 'PRIMO 5.0-1 GEN24',
    wattage_w: '', kw_rating: 5.0, kwh_capacity: '', phase: '1-phase',
    wholesale_cost_nzd: 2850, rrp_nzd: 3800, margin_target_pct: 15, lead_time_days: 7,
    datasheet_url: '', notes: 'EXAMPLE' },
  { sku: '301011', product_name: 'Fronius Primo 6.0 GEN24 Hybrid Inverter', category: 'inverter',
    supplier_short_code: 'FRO', model_number: 'PRIMO 6.0-1 GEN24',
    wattage_w: '', kw_rating: 6.0, kwh_capacity: '', phase: '1-phase',
    wholesale_cost_nzd: 3150, rrp_nzd: 4200, margin_target_pct: 15, lead_time_days: 7,
    datasheet_url: '', notes: 'EXAMPLE' },
  { sku: '311249', product_name: 'Fronius SYMO 10.0 GEN24 (3-phase)', category: 'inverter',
    supplier_short_code: 'FRO', model_number: 'SYMO 10.0-3 GEN24',
    wattage_w: '', kw_rating: 10.0, kwh_capacity: '', phase: '3-phase',
    wholesale_cost_nzd: 5400, rrp_nzd: 7200, margin_target_pct: 15, lead_time_days: 14,
    datasheet_url: '', notes: 'EXAMPLE — used in whole-home package' },
  { sku: '301009', product_name: 'BYD Battery-Box HVS 2.56kWh Module', category: 'battery',
    supplier_short_code: 'BYD', model_number: 'HVS-2.56',
    wattage_w: '', kw_rating: '', kwh_capacity: 2.56, phase: '',
    wholesale_cost_nzd: 1850, rrp_nzd: 2400, margin_target_pct: 18, lead_time_days: 21,
    datasheet_url: '', notes: 'EXAMPLE — stack 4 for 10.24kWh' },
  { sku: '311274', product_name: 'Freedom Won LiTE2 Home 10/8', category: 'battery',
    supplier_short_code: 'FRW', model_number: 'LiTE2-10/8',
    wattage_w: '', kw_rating: '', kwh_capacity: 10.0, phase: '',
    wholesale_cost_nzd: 7800, rrp_nzd: 10500, margin_target_pct: 18, lead_time_days: 30,
    datasheet_url: '', notes: 'EXAMPLE' },
  { sku: '301076', product_name: 'DC Isolator 1000V 32A IP66', category: 'bos',
    supplier_short_code: 'HOP', model_number: 'DC-ISO-1000-32',
    wattage_w: '', kw_rating: '', kwh_capacity: '', phase: '',
    wholesale_cost_nzd: 38, rrp_nzd: 65, margin_target_pct: 35, lead_time_days: 7,
    datasheet_url: '', notes: 'EXAMPLE — high-margin commodity' },
  { sku: '311179', product_name: 'Hopergy Rail 4700mm', category: 'racking',
    supplier_short_code: 'HOP', model_number: 'HOP-RAIL-4700',
    wattage_w: '', kw_rating: '', kwh_capacity: '', phase: '',
    wholesale_cost_nzd: 95, rrp_nzd: 150, margin_target_pct: 25, lead_time_days: 7,
    datasheet_url: '', notes: 'EXAMPLE' },
]);

// ─── SHEET 4 — Compatibility ────────────────────────────────────────────────
addSheet('Compatibility', [
  { key: 'pairing_type',     label: 'Pairing Type (panel_inverter / inverter_battery / inverter_meter)', width: 50 },
  { key: 'product_a_sku',    label: 'Product A SKU',          width: 14 },
  { key: 'product_a_name',   label: 'Product A Name',         width: 36 },
  { key: 'product_b_sku',    label: 'Product B SKU',          width: 14 },
  { key: 'product_b_name',   label: 'Product B Name',         width: 36 },
  { key: 'string_min',       label: 'String Min (panels)',    width: 16 },
  { key: 'string_max',       label: 'String Max (panels)',    width: 16 },
  { key: 'voltage_range',    label: 'DC Voltage Range',       width: 22 },
  { key: 'verified_by',      label: 'Verified By (Master Electrician)', width: 28 },
  { key: 'verified_date',    label: 'Verified Date (YYYY-MM-DD)', width: 20 },
  { key: 'notes',            label: 'Notes',                   width: 40 },
], [
  // Examples
  { pairing_type: 'panel_inverter', product_a_sku: '301066', product_a_name: 'REC TP4 370W',
    product_b_sku: '301075', product_b_name: 'Fronius Primo 3.0 GEN24',
    string_min: 5, string_max: 12, voltage_range: '180-540V', verified_by: '', verified_date: '',
    notes: 'EXAMPLE — verify with your Master Electrician' },
  { pairing_type: 'panel_inverter', product_a_sku: '311306', product_a_name: 'Phono 595W',
    product_b_sku: '301010', product_b_name: 'Fronius Primo 5.0 GEN24',
    string_min: 8, string_max: 15, voltage_range: '200-800V', verified_by: '', verified_date: '',
    notes: 'EXAMPLE' },
  { pairing_type: 'panel_inverter', product_a_sku: '311306', product_a_name: 'Phono 595W',
    product_b_sku: '301011', product_b_name: 'Fronius Primo 6.0 GEN24',
    string_min: 10, string_max: 18, voltage_range: '200-800V', verified_by: '', verified_date: '',
    notes: 'EXAMPLE' },
  { pairing_type: 'panel_inverter', product_a_sku: '311306', product_a_name: 'Phono 595W',
    product_b_sku: '311249', product_b_name: 'Fronius SYMO 10.0 GEN24',
    string_min: 14, string_max: 26, voltage_range: '200-1000V', verified_by: '', verified_date: '',
    notes: 'EXAMPLE — 3-phase pairing' },
  { pairing_type: 'inverter_battery', product_a_sku: '301075', product_a_name: 'Fronius Primo 3.0 GEN24',
    product_b_sku: '301009', product_b_name: 'BYD HVS module',
    string_min: '', string_max: '', voltage_range: '',
    verified_by: '', verified_date: '',
    notes: 'EXAMPLE — Fronius GEN24 + BYD HVS is a standard NZ pairing' },
  { pairing_type: 'inverter_battery', product_a_sku: '311249', product_a_name: 'Fronius SYMO 10.0',
    product_b_sku: '311274', product_b_name: 'Freedom Won LiTE2',
    string_min: '', string_max: '', voltage_range: '',
    verified_by: '', verified_date: '',
    notes: 'EXAMPLE — used in whole-home package' },
]);

// ─── SHEET 5 — Region_Defaults ──────────────────────────────────────────────
addSheet('Region_Defaults', [
  { key: 'region_name',                  label: 'Region',                       width: 22 },
  { key: 'postcode_prefix',              label: 'Postcode Prefix (e.g. 06=Auck)', width: 22 },
  { key: 'sun_hours_daily',              label: 'Sun Hours / Day (avg)',         width: 22 },
  { key: 'avg_household_kwh_yearly',     label: 'Avg Household kWh / Year',      width: 24 },
  { key: 'avg_monthly_bill_nzd',         label: 'Avg Monthly Bill $NZ',          width: 22 },
  { key: 'typical_self_consumption_pct', label: 'Typical Self-Consumption %',    width: 26 },
  { key: 'with_battery_self_consumption_pct', label: 'Self-Consumption with Battery %', width: 30 },
  { key: 'irradiance_kwh_m2',            label: 'Irradiance kWh/m²/yr',          width: 22 },
  { key: 'notes',                        label: 'Notes',                         width: 40 },
], [
  { region_name: 'Auckland', postcode_prefix: '0xxx-1xxx',
    sun_hours_daily: 4.2, avg_household_kwh_yearly: 7500, avg_monthly_bill_nzd: 200,
    typical_self_consumption_pct: 35, with_battery_self_consumption_pct: 75,
    irradiance_kwh_m2: 1450, notes: 'EXAMPLE — based on NIWA data' },
  { region_name: 'Hamilton / Waikato', postcode_prefix: '32xx-34xx',
    sun_hours_daily: 4.1, avg_household_kwh_yearly: 8200, avg_monthly_bill_nzd: 210,
    typical_self_consumption_pct: 35, with_battery_self_consumption_pct: 75,
    irradiance_kwh_m2: 1400, notes: 'EXAMPLE' },
  { region_name: 'Wellington', postcode_prefix: '60xx-62xx',
    sun_hours_daily: 3.9, avg_household_kwh_yearly: 8500, avg_monthly_bill_nzd: 240,
    typical_self_consumption_pct: 32, with_battery_self_consumption_pct: 72,
    irradiance_kwh_m2: 1320, notes: 'EXAMPLE — windier, lower sun hours' },
  { region_name: 'Christchurch / Canterbury', postcode_prefix: '74xx-81xx',
    sun_hours_daily: 4.1, avg_household_kwh_yearly: 9500, avg_monthly_bill_nzd: 270,
    typical_self_consumption_pct: 38, with_battery_self_consumption_pct: 78,
    irradiance_kwh_m2: 1400, notes: 'EXAMPLE — colder, higher heating load' },
  { region_name: 'Tauranga / BOP', postcode_prefix: '31xx',
    sun_hours_daily: 4.3, avg_household_kwh_yearly: 7800, avg_monthly_bill_nzd: 200,
    typical_self_consumption_pct: 36, with_battery_self_consumption_pct: 76,
    irradiance_kwh_m2: 1480, notes: 'EXAMPLE — highest sun hours in NZ' },
  { region_name: 'Dunedin / Otago', postcode_prefix: '90xx-95xx',
    sun_hours_daily: 3.7, avg_household_kwh_yearly: 10000, avg_monthly_bill_nzd: 290,
    typical_self_consumption_pct: 32, with_battery_self_consumption_pct: 72,
    irradiance_kwh_m2: 1250, notes: 'EXAMPLE — coldest, highest consumption' },
]);

// ─── SHEET 6 — Cost_Defaults ────────────────────────────────────────────────
addSheet('Cost_Defaults', [
  { key: 'cost_type',     label: 'Cost Type',                       width: 30 },
  { key: 'cost_nzd',      label: 'Cost $NZ',                        width: 14 },
  { key: 'unit',          label: 'Unit (fixed / per_kw / per_panel / per_floor)', width: 30 },
  { key: 'applies_to',    label: 'Applies To (all / residential / commercial / battery_only)', width: 40 },
  { key: 'notes',         label: 'Notes',                           width: 50 },
], [
  { cost_type: 'Install labour — base',          cost_nzd: 2500, unit: 'fixed', applies_to: 'all',
    notes: 'EXAMPLE — Master Electrician + apprentice, 1 day' },
  { cost_type: 'Install labour — per kW',         cost_nzd: 500, unit: 'per_kw', applies_to: 'all',
    notes: 'EXAMPLE — additional labour for larger systems' },
  { cost_type: 'Council building consent',        cost_nzd: 400, unit: 'fixed', applies_to: 'all',
    notes: 'EXAMPLE — Auckland Council current fee' },
  { cost_type: 'Vector grid connection',          cost_nzd: 350, unit: 'fixed', applies_to: 'all',
    notes: 'EXAMPLE — distributor application' },
  { cost_type: 'Scaffolding — 2-storey',           cost_nzd: 800, unit: 'per_floor', applies_to: 'all',
    notes: 'EXAMPLE — only if 2+ floors' },
  { cost_type: 'Switchboard upgrade',              cost_nzd: 1200, unit: 'fixed', applies_to: 'all',
    notes: 'EXAMPLE — when existing SB is too old' },
  { cost_type: 'Battery install + commissioning',  cost_nzd: 800, unit: 'fixed', applies_to: 'battery_only',
    notes: 'EXAMPLE — extra labour for battery' },
  { cost_type: 'Certificate of Compliance (CoC)',  cost_nzd: 150, unit: 'fixed', applies_to: 'all',
    notes: 'EXAMPLE' },
  { cost_type: 'Electrical Safety Certificate',    cost_nzd: 100, unit: 'fixed', applies_to: 'all',
    notes: 'EXAMPLE' },
  { cost_type: 'Monitoring setup + walkthrough',   cost_nzd: 200, unit: 'fixed', applies_to: 'all',
    notes: 'EXAMPLE — Solar.web app + customer training' },
]);

// ─── SHEET 7 — Package_Templates ────────────────────────────────────────────
addSheet('Package_Templates', [
  { key: 'template_name',                label: 'Template Name',                  width: 28 },
  { key: 'tier',                         label: 'Quote Tier (A/B/C)',             width: 18 },
  { key: 'target_kw_range',              label: 'Target kW Range (e.g. 3-4)',     width: 22 },
  { key: 'suits_monthly_bill_min',       label: 'Suits Monthly Bill $ Min',       width: 22 },
  { key: 'suits_monthly_bill_max',       label: 'Suits Monthly Bill $ Max',       width: 22 },
  { key: 'household_size',               label: 'Household Size (1-2/3-4/5+)',     width: 24 },
  { key: 'panel_sku',                    label: 'Panel SKU',                       width: 14 },
  { key: 'panel_qty',                    label: 'Panel Qty',                       width: 12 },
  { key: 'inverter_sku',                 label: 'Inverter SKU',                    width: 14 },
  { key: 'battery_sku',                  label: 'Battery SKU (or blank)',          width: 18 },
  { key: 'battery_qty',                  label: 'Battery Qty',                     width: 14 },
  { key: 'bos_skus',                     label: 'BOS SKUs (comma-separated)',      width: 40 },
  { key: 'audience_description',         label: 'Target Audience Description',     width: 50 },
  { key: 'notes',                        label: 'Notes',                           width: 30 },
], [
  // Quote A / B / C examples for a 3kW small household
  { template_name: '3kW Premium (T1)', tier: 'A', target_kw_range: '3-3.5',
    suits_monthly_bill_min: 150, suits_monthly_bill_max: 220, household_size: '1-2',
    panel_sku: '301066', panel_qty: 8, inverter_sku: '301075',
    battery_sku: '', battery_qty: '',
    bos_skus: '301076, 311179, 300285, 300849, 300848',
    audience_description: 'EXAMPLE — premium brand-conscious customers, retirees with budget',
    notes: 'EXAMPLE — REC + Fronius Tier-1 pair' },
  { template_name: '3kW Volume (T2)', tier: 'B', target_kw_range: '3-3.5',
    suits_monthly_bill_min: 150, suits_monthly_bill_max: 220, household_size: '1-2',
    panel_sku: '311306', panel_qty: 6, inverter_sku: '301075',
    battery_sku: '', battery_qty: '',
    bos_skus: '301076, 311179, 300285, 300849, 300848',
    audience_description: 'EXAMPLE — typical NZ household, value-conscious',
    notes: 'EXAMPLE — Phono + Fronius (Phono is T2)' },
  { template_name: '3kW Budget (T3)', tier: 'C', target_kw_range: '3-3.5',
    suits_monthly_bill_min: 150, suits_monthly_bill_max: 220, household_size: '1-2',
    panel_sku: 'TBD', panel_qty: 8, inverter_sku: 'TBD',
    battery_sku: '', battery_qty: '',
    bos_skus: '301076, 311179, 300285, 300849, 300848',
    audience_description: 'EXAMPLE — price-sensitive, will accept lesser brands for cheaper system',
    notes: 'EXAMPLE — add Trina + Solis SKUs once those suppliers are in Products sheet' },
  // 6kW examples
  { template_name: '6kW Premium (T1)', tier: 'A', target_kw_range: '6-7',
    suits_monthly_bill_min: 280, suits_monthly_bill_max: 380, household_size: '3-4',
    panel_sku: '311306', panel_qty: 12, inverter_sku: '301011',
    battery_sku: '', battery_qty: '',
    bos_skus: '301076, 311179, 300285, 300849, 300848',
    audience_description: 'EXAMPLE — family home, no battery yet',
    notes: 'EXAMPLE' },
  // 6kW + battery
  { template_name: '6kW + Battery (T1)', tier: 'A', target_kw_range: '6-7',
    suits_monthly_bill_min: 300, suits_monthly_bill_max: 450, household_size: '3-4',
    panel_sku: '311306', panel_qty: 12, inverter_sku: '301011',
    battery_sku: '301009', battery_qty: 4,
    bos_skus: '301076, 311179, 300285, 300849, 300848',
    audience_description: 'EXAMPLE — family wanting outage backup, VPP-ready',
    notes: 'EXAMPLE — BYD HVS 4× 2.56kWh = 10.24kWh' },
  // Whole-home
  { template_name: 'Whole-Home 10kW + Battery', tier: 'A', target_kw_range: '10-13',
    suits_monthly_bill_min: 500, suits_monthly_bill_max: 700, household_size: '5+',
    panel_sku: '311306', panel_qty: 22, inverter_sku: '311249',
    battery_sku: '311274', battery_qty: 1,
    bos_skus: '301076, 311179, 300285, 300849, 300848',
    audience_description: 'EXAMPLE — large family, EV charging, 3-phase home',
    notes: 'EXAMPLE — 3-phase SYMO + Freedom Won' },
]);

// ─── Write the file ─────────────────────────────────────────────────────────
xlsx.writeFile(wb, OUT);
console.log(`\n✓ Wrote ${OUT}\n`);
console.log('Open it in Excel — start with the README sheet, then work through the others as you talk to each supplier.\n');

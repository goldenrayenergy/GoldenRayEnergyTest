// ────────────────────────────────────────────────────────────────────────────
// Stage 2 (Final) sample proposal PDF — same client, same system, post site
// visit. Locked pricing, full BOM with model/datasheet, SLD reference,
// distributor approval, T&Cs inline, signature + deposit block.
//
// Output: ~/Downloads/Goldenray_Sample_Proposal_15kW_Stage2.pdf
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Same customer as Stage 1 ─────────────────────────────────────────────
const CUSTOMER = {
  name: 'Mr & Mrs Tane Williams',
  address: '23 Tinakori Road',
  suburb: 'Thorndon',
  city: 'Wellington',
  postcode: '6011',
  email: 'tane.williams@example.co.nz',
  phone: '021 555 0123',
};

const PROPOSAL = {
  number_v1:        'PR-STAGE1-2026-0099',
  number:           'PR-STAGE2-2026-0099-v2',
  date:             new Date().toLocaleDateString('en-NZ', { year: 'numeric', month: 'long', day: 'numeric' }),
  validity_days:    30,
  valid_until:      new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-NZ', { year: 'numeric', month: 'long', day: 'numeric' }),
  site_visit_date:  new Date(Date.now() - 3 * 86400000).toLocaleDateString('en-NZ', { year: 'numeric', month: 'long', day: 'numeric' }),
  tc_version:       '2026.1',
};

// ── Locked pricing (was $48k-$56k range in Stage 1) ──────────────────────
const PRICING = {
  cost_locked_excl_gst:  45565.22,    // computed from BOM
  gst:                    6834.78,
  total_incl_gst:        52400.00,
  deposit_pct:            30,
  deposit_amount:        15720.00,
  progress_amount:       18340.00,    // 35% — on materials delivery
  final_amount:          18340.00,    // 35% — on commissioning
};

// ── Site visit findings ─────────────────────────────────────────────────
const SITE_SURVEY = {
  visited_on:           PROPOSAL.site_visit_date,
  surveyor:             'Mike Robertson (Senior Designer)',
  roof_orientation:     'North-facing, 22° pitch',
  roof_condition:       'Excellent — 8 years old, Colorsteel, no concerns',
  shading:              'Minimal — small chimney to the SW, no other obstructions',
  switchboard:          '100A three-phase board, capacity OK, no upgrade required',
  meter_type:           'Smart import-export ready (already installed)',
  internet:             'Fibre — Wi-Fi reaches inverter location',
  structural:           'Roof load capacity verified by visual + chord measurements; no engineer sign-off needed',
  notes:                'Customer prefers all-black panel aesthetic confirmed. Battery to be wall-mounted in garage. Cable run 18m east elevation to garage — within standard.',
};

// ── System (locked from design) ─────────────────────────────────────────
const SYSTEM = {
  system_kw:        15.2,
  panel_count:      32,
  panel_make:       'Phono Solar',
  panel_model:      '475W Quasar All-Black',
  panel_datasheet:  'phono-475w-quasar.pdf',
  inverter_make:    'Fronius',
  inverter_model:   'Verto Plus 15.0',
  inverter_kw:      15,
  inverter_phase:   'Three-phase',
  inverter_datasheet:'fronius-verto-15.pdf',
  battery_make:     'Fronius',
  battery_model:    'Reserva 12.6 kWh',
  battery_modules:  '4 × Reserva 3.15 kWh',
  battery_datasheet:'fronius-reserva.pdf',
  monitoring:       'Fronius Solar.web (free for life of system)',
  vpp_capable:      true,
};

const ENERGY_YIELD = {
  predicted_annual_kwh: 17500,
  specific_yield:       1151,    // kWh/kWp
  performance_ratio:    84,
  tool:                 'PVsyst v7.4',
  simulation_run_by:    'Mike Robertson',
};

const DISTRIBUTOR = {
  name:                 'Wellington Electricity',
  application_ref:      'WE-2026-0091',
  application_status:   'APPROVED',
  approved_date:        new Date(Date.now() - 1 * 86400000).toLocaleDateString('en-NZ'),
  export_limit_kw:      10,
  conditions:           'Standard 10kW export limit; G98/G99 compliance required (Fronius Verto certified)',
};

const ENGINEERING = {
  designer:             'Mike Robertson',
  designer_license:     'EWRB E12345',
  reviewed_by:          'Sarah Chen',
  approved_at:          new Date(Date.now() - 2 * 86400000).toLocaleDateString('en-NZ'),
  sld_version:          'v1.0',
  sld_reference:        'SLD-2026-0099-v1.0.pdf',
};

// ── 25-year savings (LOCKED — single numbers, not ranges) ────────────────
const SAVINGS = {
  do_nothing_25yr:      229925,
  solar_battery_25yr:   86000,
  net_25yr_savings:    143925,
  payback_locked_years: 11,
  annual_savings_year1: 4098,    // 85% of $4,820
  annual_export_credit: 480,
};

// ── Full BOM (Excel-style, with brand+model+datasheet) ─────────────────
const BOM = {
  materials: [
    { name: 'Phono Solar 475W Quasar Clear-Back-Contact All-Black panels', brand: 'Phono Solar', model: '475W Quasar', datasheet: 'phono-475w.pdf', qty: 32, unit: 'EA' },
    { name: 'Fronius Verto Plus 15.0 — three-phase hybrid inverter',       brand: 'Fronius',     model: 'Verto Plus 15.0', datasheet: 'fronius-verto-15.pdf', qty: 1,  unit: 'EA' },
    { name: 'Fronius Reserva BMS',                                          brand: 'Fronius',     model: 'Reserva BMS', datasheet: 'fronius-reserva-bms.pdf', qty: 1,  unit: 'EA' },
    { name: 'Fronius Reserva 3.15 kWh battery modules',                     brand: 'Fronius',     model: 'Reserva 3.15', datasheet: 'fronius-reserva.pdf', qty: 4,  unit: 'EA' },
    { name: 'Battery protection / fuse',                                    brand: 'Generic',     model: '—', datasheet: '', qty: 1,  unit: 'EA' },
    { name: 'Fronius 63A-3 Three-Phase Smart Meter',                        brand: 'Fronius',     model: '63A-3', datasheet: 'fronius-meter-3ph.pdf', qty: 1,  unit: 'EA' },
    { name: 'DC Isolator Switch IP66 32A 1000V DC',                         brand: 'IMO',         model: 'SI32-1000', datasheet: 'imo-si32.pdf', qty: 1,  unit: 'EA' },
    { name: 'AC Isolator',                                                  brand: 'IMO',         model: 'SI63', datasheet: '', qty: 1,  unit: 'EA' },
    { name: 'DC Surge Protection Device (Type II)',                         brand: 'Phoenix',     model: 'VAL-MS 1000DC', datasheet: '', qty: 1,  unit: 'EA' },
    { name: 'AC Surge Protection Device (Type II)',                         brand: 'Phoenix',     model: 'VAL-MS 230AC-3', datasheet: '', qty: 1,  unit: 'EA' },
    { name: 'Solarflex 32mm HD UV Pre-wired Conduit (30m)',                 brand: 'Solarflex',   model: '32mm HD UV', datasheet: '', qty: 1,  unit: 'EA' },
    { name: 'AC Cable 10mm² 5-core 3-Phase',                                brand: 'Olex',        model: '10mm² 5C', datasheet: '', qty: 24, unit: 'M' },
    { name: 'MC4 Connectors & BOS Materials kit',                           brand: 'Staubli',     model: 'MC4', datasheet: '', qty: 1,  unit: 'EA' },
    { name: 'Label Kit for NZ Hybrid 2025 — AS/NZS 5033.2021',              brand: 'Generic',     model: 'NZ Hybrid 2025', datasheet: '', qty: 1,  unit: 'EA' },
    { name: 'Hopergy Tilt Kit (4-panel) 15-30°',                            brand: 'Hopergy',     model: 'TK-4P-15-30', datasheet: 'hopergy-tilt.pdf', qty: 8,  unit: 'EA' },
    { name: 'SS Cable Tie Black Pack',                                      brand: 'Generic',     model: '—', datasheet: '', qty: 2,  unit: 'EA' },
    { name: 'FlashRite Roof Seal EPDM Black',                               brand: 'FlashRite',   model: 'EPDM-B', datasheet: '', qty: 1,  unit: 'EA' },
    { name: 'Roof Mount Fasteners & Rails Accessories',                     brand: 'Hopergy',     model: '—', datasheet: '', qty: 1,  unit: 'EA' },
    { name: 'Earthing Kit / Earth Rod',                                     brand: 'Generic',     model: '—', datasheet: '', qty: 1,  unit: 'EA' },
  ],
  labour: [
    { name: 'Installation Labour (3 technicians, 1 day)',                                 qty: 1, unit: 'day' },
    { name: 'Supervisor / Project Manager (1 day)',                                       qty: 1, unit: 'day' },
    { name: 'Travel cost (within 50 km of base)',                                         qty: 1, unit: 'EA' },
    { name: 'Loading / Transport / Logistics',                                            qty: 1, unit: 'EA' },
  ],
  compliance: [
    { name: 'System Design & Engineering (Mike R, EWRB E12345)',                          qty: 1, unit: 'EA' },
    { name: 'Inspection & Compliance Certification',                                      qty: 1, unit: 'EA' },
    { name: 'Monitoring Setup & Commissioning',                                            qty: 1, unit: 'EA' },
    { name: 'Grid Application Assistance (Wellington Electricity ref ' + DISTRIBUTOR.application_ref + ')', qty: 1, unit: 'EA' },
    { name: 'Certificate of Compliance (CoC)',                                            qty: 1, unit: 'EA' },
    { name: 'Electrical Safety Certificate (ESC)',                                        qty: 1, unit: 'EA' },
  ],
};

// ── Warranty (with start/end dates) ─────────────────────────────────────
const WARRANTY = [
  { component: 'Phono Solar 475W panels',          duration: '30-year performance, 12-year product',  start_year: 2026, end_year_perf: 2056, end_year_prod: 2038 },
  { component: 'Fronius Verto Plus 15.0 inverter', duration: '10-year manufacturer warranty',          start_year: 2026, end_year_prod: 2036 },
  { component: 'Fronius Reserva 12.6 kWh battery', duration: '10-year manufacturer warranty (≥80% capacity)', start_year: 2026, end_year_prod: 2036 },
  { component: 'Hopergy mounting & racking',       duration: '10-year manufacturer warranty',          start_year: 2026, end_year_prod: 2036 },
  { component: 'DC cable',                          duration: '10-year warranty',                       start_year: 2026, end_year_prod: 2036 },
  { component: 'Goldenray workmanship & install',  duration: '5-year warranty (includes call-out, parts & labour for install-related issues)', start_year: 2026, end_year_prod: 2031 },
];

// ── T&Cs (NZ Consumer Guarantees Act + standard install terms) ──────────
const TERMS = [
  {
    title: '1. Acceptance & Pricing',
    body: 'This proposal is valid for ' + PROPOSAL.validity_days + ' days from ' + PROPOSAL.date + '. The total price of NZD $' + PRICING.total_incl_gst.toLocaleString() + ' (incl. GST) is locked subject to (a) acceptance within validity, (b) site conditions remaining as observed during the site visit on ' + SITE_SURVEY.visited_on + ', and (c) component availability. Material price changes >5% between contract signing and material order may be passed through with prior written notice and customer approval.',
  },
  {
    title: '2. Payment Schedule',
    body: 'Deposit (30%): NZD $' + PRICING.deposit_amount.toLocaleString() + ' due within 7 days of acceptance. Progress payment (35%): NZD $' + PRICING.progress_amount.toLocaleString() + ' due on materials delivery. Final (35%): NZD $' + PRICING.final_amount.toLocaleString() + ' due within 7 days of commissioning. Late payments (>14 days) may incur interest at 1.5% per month on the outstanding balance.',
  },
  {
    title: '3. Workmanship & Warranty',
    body: 'Goldenray Energy NZ Ltd warrants installation workmanship for 5 years from commissioning. This covers labour and parts for install-related defects (loose connections, mounting failures, water ingress at install points, monitoring setup). Manufacturer warranties for panels, inverter, and battery are passed through with original duration as listed in the Warranty Schedule. Consumer Guarantees Act 1993 rights are not affected.',
  },
  {
    title: '4. Performance Estimates',
    body: 'Annual generation of ' + ENERGY_YIELD.predicted_annual_kwh.toLocaleString() + ' kWh and 25-year savings of $' + SAVINGS.net_25yr_savings.toLocaleString() + ' are modeled estimates using ' + ENERGY_YIELD.tool + ', NIWA SolarView irradiance data, and 5% retail electricity inflation. Actual outcomes depend on weather, household behaviour, retailer pricing, and policy changes. Goldenray does not guarantee specific generation, savings, or payback periods.',
  },
  {
    title: '5. Site Conditions & Variations',
    body: 'This proposal assumes the site conditions documented in the Site Visit Summary. If hidden conditions are discovered (e.g., asbestos, structural defects, switchboard non-compliance, hidden roof damage), Goldenray will notify the customer in writing with itemised costs and obtain written approval before proceeding. Customer may opt to cancel within 7 days of variation notice with refund of unspent deposit.',
  },
  {
    title: '6. Title & Risk',
    body: 'Title to all installed equipment passes to the customer on receipt of final payment. Risk passes on commissioning. Goldenray retains the right to reclaim equipment for non-payment >60 days overdue.',
  },
  {
    title: '7. Cancellation',
    body: 'Customer may cancel within 7 days of acceptance for full refund of deposit. After 7 days, deposit is non-refundable except where Goldenray fails to perform or invokes a variation under §5. Goldenray may cancel at any time before install with full refund of deposit if site conditions render the system unviable.',
  },
  {
    title: '8. Privacy',
    body: 'Customer details, bills, and bill-analysis data are stored securely and used only for project delivery, ongoing support, and (with explicit consent) future VPP enrollment offers. Data is never sold or shared with third parties beyond compliance requirements (distributor, certifier, Inland Revenue).',
  },
  {
    title: '9. Dispute Resolution',
    body: 'In the event of dispute, parties will first attempt direct resolution. If unresolved within 30 days, mediation through the New Zealand Dispute Resolution Centre. New Zealand law applies; New Zealand courts have exclusive jurisdiction.',
  },
  {
    title: '10. VPP Enrollment (Future)',
    body: 'Customer is under no obligation to enroll in any future Goldenray Virtual Power Plant programme. If customer opts in, separate VPP enrollment terms apply. Goldenray makes no representations about VPP earnings; the $200–$400/year estimate referenced is illustrative.',
  },
];

const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-NZ');

// ── HTML ──────────────────────────────────────────────────────────────────

const html = `
<!doctype html>
<html><head><meta charset="utf-8">
<title>${PROPOSAL.number} — ${CUSTOMER.name} — Final Proposal</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
         color: #1a1a1a; line-height: 1.45; margin: 0; padding: 0; font-size: 11.5px; }
  .page { padding: 28px 36px; }
  .page-break { page-break-before: always; }

  .stage-banner, .system-hero, .scenarios, .savings-callout, .invest, .vpp,
  .carbon, .assumptions, .next-steps, .changelog, .signature, .deposit,
  .site-visit, .sld-block, .terms-section, table, .meta {
    page-break-inside: avoid; break-inside: avoid;
  }
  h2, h3 { page-break-after: avoid; break-after: avoid; }

  /* Header */
  .topbar { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 3px solid #10b981; padding-bottom: 12px; margin-bottom: 18px; }
  .brand { font-weight: 800; color: #1a1a1a; font-size: 16px; letter-spacing: 0.5px; }
  .brand .second { color: #f59e0b; }
  .tagline { font-size: 9px; color: #777; font-style: italic; margin-top: -2px; }
  .topbar .right { text-align: right; font-size: 9.5px; color: #555; }

  h1 { font-size: 22px; margin: 4px 0 6px; font-weight: 700; }
  h2 { font-size: 14px; margin: 18px 0 8px; color: #1a1a1a; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  h3 { font-size: 12px; margin: 12px 0 5px; color: #4b5563; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
  p  { margin: 4px 0; }

  /* Stage 2 banner — emerald (locked) */
  .stage-banner { background: #ecfdf5; border: 1.5px solid #6ee7b7; border-radius: 6px;
                  padding: 10px 14px; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; }
  .stage-banner .label { font-weight: 800; color: #065f46; font-size: 11px; letter-spacing: 0.5px; }
  .stage-banner .text  { color: #065f46; font-size: 10.5px; }

  /* Customer card */
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
  .meta .box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 5px; padding: 10px 12px; }
  .meta .box .lbl { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta .box .val { font-size: 11.5px; color: #111; font-weight: 600; margin-top: 1px; }

  /* Site visit block */
  .site-visit { background: #f0f9ff; border: 1px solid #7dd3fc; border-radius: 6px; padding: 12px 14px; margin: 12px 0; }
  .site-visit .title { font-weight: 800; color: #0c4a6e; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .site-visit dl { margin: 6px 0 0; display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; font-size: 10.5px; }
  .site-visit dt { color: #0c4a6e; font-weight: 600; }
  .site-visit dd { color: #075985; margin: 0; }

  /* System hero */
  .system-hero { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0 18px; }
  .stat { background: #fffbeb; border: 1.5px solid #fcd34d; border-radius: 6px; padding: 10px 12px; text-align: center; }
  .stat .num   { font-size: 22px; font-weight: 800; color: #92400e; line-height: 1; }
  .stat .unit  { font-size: 10px; color: #92400e; margin-top: 1px; }
  .stat .lbl   { font-size: 9px; color: #78716c; text-transform: uppercase; margin-top: 4px; letter-spacing: 0.5px; }

  /* Investment LOCKED — single number */
  .invest { background: linear-gradient(180deg, #d1fae5 0%, #a7f3d0 100%);
            border: 2px solid #10b981; border-radius: 8px; padding: 18px 24px; margin: 14px 0;
            text-align: center; }
  .invest .lbl { font-size: 10px; color: #065f46; text-transform: uppercase; letter-spacing: 0.7px; }
  .invest .price { font-size: 36px; font-weight: 800; color: #064e3b; line-height: 1.1; margin: 6px 0 4px; }
  .invest .note  { font-size: 10px; color: #065f46; }
  .invest .breakdown { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px;
                       padding-top: 12px; border-top: 1px solid #6ee7b7; }
  .invest .breakdown div { font-size: 10px; }
  .invest .breakdown strong { color: #064e3b; font-size: 12px; }

  /* Change log */
  .changelog { background: #faf5ff; border: 1px solid #d8b4fe; border-radius: 6px; padding: 12px 14px; margin: 12px 0; }
  .changelog .title { font-weight: 800; color: #581c87; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .changelog table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10.5px; }
  .changelog td { padding: 4px 8px; vertical-align: top; }
  .changelog .delta-plus  { color: #166534; }
  .changelog .delta-minus { color: #991b1b; }
  .changelog .delta-same  { color: #6b7280; }

  /* Scenarios chart (locked numbers) */
  .scenarios { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px; margin: 8px 0 14px; }
  .scenario-row { display: grid; grid-template-columns: 160px 1fr 100px; gap: 10px; align-items: center; margin-bottom: 8px; }
  .scenario-row .name { font-size: 11px; font-weight: 600; }
  .scenario-row .name .sub { font-size: 9px; color: #6b7280; font-weight: normal; }
  .scenario-row .bar-wrap { background: #e5e7eb; height: 16px; border-radius: 3px; overflow: hidden; }
  .scenario-row .bar { height: 100%; }
  .bar-do-nothing  { background: #ef4444; }
  .bar-with-battery{ background: #10b981; }
  .scenario-row .amt { font-size: 11px; font-weight: 700; text-align: right; }
  .savings-callout { background: #d1fae5; border: 2px solid #10b981; border-radius: 6px;
                     padding: 14px; text-align: center; margin: 12px 0; }
  .savings-callout .num { font-size: 28px; color: #065f46; font-weight: 800; }
  .savings-callout .lbl { font-size: 11px; color: #065f46; }

  /* BOM tables */
  table.bom { width: 100%; border-collapse: collapse; margin: 6px 0 14px; font-size: 10px; }
  table.bom th { background: #f3f4f6; text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb;
                 font-size: 9px; text-transform: uppercase; color: #4b5563; letter-spacing: 0.4px; }
  table.bom td { padding: 5px 8px; border-bottom: 1px solid #f3f4f6; }
  table.bom td.qty { text-align: right; width: 50px; color: #6b7280; }
  table.bom td.brand { color: #6b7280; font-size: 9.5px; width: 80px; }
  table.bom td.model { color: #4b5563; font-size: 9.5px; width: 110px; font-family: monospace; }
  table.bom td.ds   { font-size: 9px; width: 90px; }
  table.bom td.ds a { color: #1d4ed8; text-decoration: underline; }

  /* Warranty table */
  table.warr { width: 100%; border-collapse: collapse; margin: 6px 0 14px; font-size: 10.5px; }
  table.warr th { background: #f3f4f6; text-align: left; padding: 6px 10px; font-size: 9px;
                  text-transform: uppercase; color: #4b5563; letter-spacing: 0.4px; border-bottom: 1px solid #e5e7eb; }
  table.warr td { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; }
  table.warr td.first { font-weight: 600; width: 200px; }
  table.warr td.dates { font-family: monospace; color: #6b7280; }

  /* SLD / engineering block */
  .sld-block { background: #fef3c7; border: 1px dashed #f59e0b; border-radius: 6px; padding: 16px; margin: 8px 0; text-align: center; }
  .sld-block .placeholder { font-size: 32px; color: #b45309; padding: 30px 0; }
  .sld-block .ref { font-size: 10px; color: #78716c; margin-top: 6px; }

  /* Distributor / engineering sign-off */
  .signoffs { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0; }
  .signoffs .box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 5px; padding: 10px 14px; }
  .signoffs .box .title { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
  .signoffs .box dl { margin: 6px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; font-size: 10.5px; }
  .signoffs .box dt { color: #6b7280; font-weight: 500; }
  .signoffs .box dd { margin: 0; color: #111; }
  .badge-ok { background: #d1fae5; color: #065f46; padding: 2px 6px; border-radius: 3px; font-weight: 700; font-size: 9px; }

  /* T&Cs */
  .terms-section { margin-bottom: 10px; }
  .terms-section .h { font-size: 10.5px; font-weight: 800; color: #1f2937; margin-bottom: 4px; }
  .terms-section .b { font-size: 10px; color: #4b5563; line-height: 1.5; }

  /* Signature block */
  .signature { background: #f9fafb; border: 2px solid #1f2937; border-radius: 6px; padding: 14px 18px; margin: 14px 0; }
  .signature h3 { color: #1f2937; margin-top: 0; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 10px; }
  .sig-block { padding: 10px; }
  .sig-line { border-bottom: 1px solid #1f2937; margin-bottom: 4px; height: 36px; }
  .sig-label { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
  .sig-name  { font-weight: 600; font-size: 10px; margin-top: 2px; }

  /* Acceptance checkbox */
  .accept-box { background: #fef9c3; border: 1.5px solid #fde047; border-radius: 5px; padding: 10px 14px; margin: 10px 0; font-size: 10.5px; }
  .accept-box .check { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #1f2937; vertical-align: middle; margin-right: 8px; }

  /* Deposit */
  .deposit { background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 6px; padding: 14px 18px; margin: 12px 0; }
  .deposit h3 { color: #1e40af; margin-top: 0; }
  .deposit .row { display: grid; grid-template-columns: 130px 1fr; gap: 4px 12px; font-size: 10.5px; }

  .footer { border-top: 1px solid #e5e7eb; padding-top: 10px; margin-top: 14px;
            display: flex; justify-content: space-between; font-size: 9px; color: #6b7280; }
  .small { font-size: 9.5px; color: #6b7280; }
  .vpp { background: #ecfdf5; border: 1.5px solid #6ee7b7; border-radius: 6px; padding: 12px 14px; margin: 10px 0; }
  .vpp .title { font-weight: 800; color: #065f46; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .vpp p { color: #065f46; }
</style>
</head>
<body>

<!-- ─────── PAGE 1 — Cover + site visit + system + locked price ─────── -->
<div class="page">

  <div class="topbar">
    <div>
      <div class="brand">GOLDENRAY <span class="second">ENERGY NZ</span></div>
      <div class="tagline">Powering a Sustainable Future</div>
    </div>
    <div class="right">
      <div><strong>${PROPOSAL.number}</strong></div>
      <div>${PROPOSAL.date}</div>
      <div>Valid until ${PROPOSAL.valid_until} (${PROPOSAL.validity_days} days)</div>
      <div class="small">Supersedes ${PROPOSAL.number_v1}</div>
    </div>
  </div>

  <div class="stage-banner">
    <div class="label">STAGE 2 — FINAL PROPOSAL · LOCKED PRICING</div>
    <div class="text">Site visited ${SITE_SURVEY.visited_on}. Distributor approved. Single-line diagram complete. Sign and pay deposit to schedule install.</div>
  </div>

  <h1>Final Solar + Battery Proposal</h1>
  <p style="color: #4b5563; margin-bottom: 12px;">Prepared for <strong>${CUSTOMER.name}</strong> at ${CUSTOMER.address}, ${CUSTOMER.suburb}, ${CUSTOMER.city}.</p>

  <div class="meta">
    <div class="box">
      <div class="lbl">Customer</div>
      <div class="val">${CUSTOMER.name}</div>
      <div class="small">${CUSTOMER.email} · ${CUSTOMER.phone}</div>
    </div>
    <div class="box">
      <div class="lbl">Site</div>
      <div class="val">${CUSTOMER.address}</div>
      <div class="small">${CUSTOMER.suburb}, ${CUSTOMER.city} ${CUSTOMER.postcode}</div>
    </div>
  </div>

  <div class="site-visit">
    <div class="title">📋 Site Visit Findings — ${SITE_SURVEY.visited_on}</div>
    <dl>
      <dt>Surveyed by</dt><dd>${SITE_SURVEY.surveyor}</dd>
      <dt>Roof orientation</dt><dd>${SITE_SURVEY.roof_orientation}</dd>
      <dt>Roof condition</dt><dd>${SITE_SURVEY.roof_condition}</dd>
      <dt>Shading</dt><dd>${SITE_SURVEY.shading}</dd>
      <dt>Switchboard</dt><dd>${SITE_SURVEY.switchboard}</dd>
      <dt>Meter</dt><dd>${SITE_SURVEY.meter_type}</dd>
      <dt>Internet</dt><dd>${SITE_SURVEY.internet}</dd>
      <dt>Structural</dt><dd>${SITE_SURVEY.structural}</dd>
      <dt>Notes</dt><dd>${SITE_SURVEY.notes}</dd>
    </dl>
  </div>

  <h2>Locked system specification</h2>

  <div class="system-hero">
    <div class="stat"><div class="num">${SYSTEM.system_kw}</div><div class="unit">kW solar</div><div class="lbl">${SYSTEM.panel_count} panels</div></div>
    <div class="stat"><div class="num">${SYSTEM.battery_kwh}</div><div class="unit">kWh battery</div><div class="lbl">stored backup</div></div>
    <div class="stat"><div class="num">${ENERGY_YIELD.predicted_annual_kwh.toLocaleString()}</div><div class="unit">kWh/year</div><div class="lbl">PVsyst yield</div></div>
    <div class="stat"><div class="num">${SAVINGS.payback_locked_years}</div><div class="unit">years</div><div class="lbl">locked payback</div></div>
  </div>

  <h2>Locked investment</h2>

  <div class="invest">
    <div class="lbl">Total locked price (incl. GST)</div>
    <div class="price">${fmt$(PRICING.total_incl_gst)}</div>
    <div class="note">Locked subject to ${PROPOSAL.validity_days}-day validity and unchanged site conditions per §1 of T&amp;Cs.</div>
    <div class="breakdown">
      <div>Excl. GST<br><strong>${fmt$(PRICING.cost_locked_excl_gst)}</strong></div>
      <div>GST (15%)<br><strong>${fmt$(PRICING.gst)}</strong></div>
      <div>Year-1 savings<br><strong>${fmt$(SAVINGS.annual_savings_year1)}</strong></div>
    </div>
  </div>

  <div class="footer">
    <div>Goldenray Energy NZ · ${CUSTOMER.name} · ${PROPOSAL.number}</div>
    <div>Page 1 of 5</div>
  </div>
</div>

<!-- ─────── PAGE 2 — Change log + 25-yr story ─────── -->
<div class="page page-break">
  <div class="topbar">
    <div><div class="brand">GOLDENRAY <span class="second">ENERGY NZ</span></div></div>
    <div class="right"><div><strong>${PROPOSAL.number}</strong></div><div class="small">What changed since Stage 1</div></div>
  </div>

  <h2>What changed since Stage 1 (${PROPOSAL.number_v1})</h2>

  <div class="changelog">
    <div class="title">📝 Change Log</div>
    <table>
      <tr><td><strong>Indicative range</strong></td><td class="delta-same">$48,000 – $56,000</td><td>→</td><td class="delta-plus"><strong>${fmt$(PRICING.total_incl_gst)} locked</strong> (mid-range — site visit confirmed standard install)</td></tr>
      <tr><td><strong>Payback</strong></td><td class="delta-same">9–12 years</td><td>→</td><td class="delta-plus"><strong>${SAVINGS.payback_locked_years} years locked</strong></td></tr>
      <tr><td><strong>Annual yield</strong></td><td class="delta-same">~17,500 kWh (estimated)</td><td>→</td><td class="delta-plus"><strong>${ENERGY_YIELD.predicted_annual_kwh.toLocaleString()} kWh (PVsyst-modeled, ${ENERGY_YIELD.specific_yield} kWh/kWp)</strong></td></tr>
      <tr><td><strong>Switchboard upgrade</strong></td><td class="delta-same">Possible $800–$2,500</td><td>→</td><td class="delta-plus"><strong>Not required</strong> (existing 100A 3-phase board is OK)</td></tr>
      <tr><td><strong>Scaffolding</strong></td><td class="delta-same">Possible $1,500–$3,500</td><td>→</td><td class="delta-plus"><strong>Not required</strong> (single-storey, ladder-only access OK)</td></tr>
      <tr><td><strong>Distributor approval</strong></td><td class="delta-same">Pending</td><td>→</td><td class="delta-plus"><strong>APPROVED</strong> (${DISTRIBUTOR.name} ${DISTRIBUTOR.application_ref})</td></tr>
      <tr><td><strong>SLD</strong></td><td class="delta-same">Not yet drawn</td><td>→</td><td class="delta-plus"><strong>Complete (${ENGINEERING.sld_version})</strong></td></tr>
      <tr><td><strong>T&amp;Cs</strong></td><td class="delta-same">Not in Stage 1</td><td>→</td><td class="delta-plus"><strong>Full T&amp;Cs included (v${PROPOSAL.tc_version})</strong></td></tr>
    </table>
  </div>

  <h2>Your 25-year story (locked numbers)</h2>

  <div class="scenarios">
    <div class="scenario-row">
      <div class="name">Do nothing<div class="sub">stay with current retailer</div></div>
      <div class="bar-wrap"><div class="bar bar-do-nothing" style="width: 100%;"></div></div>
      <div class="amt" style="color: #b91c1c;">${fmt$(SAVINGS.do_nothing_25yr)}</div>
    </div>
    <div class="scenario-row">
      <div class="name">This system<div class="sub">solar + battery, ~85% offset</div></div>
      <div class="bar-wrap"><div class="bar bar-with-battery" style="width: ${(SAVINGS.solar_battery_25yr / SAVINGS.do_nothing_25yr * 100).toFixed(0)}%;"></div></div>
      <div class="amt" style="color: #047857;">${fmt$(SAVINGS.solar_battery_25yr)}</div>
    </div>
  </div>

  <div class="savings-callout">
    <div class="num">${fmt$(SAVINGS.net_25yr_savings)}</div>
    <div class="lbl">Net 25-year savings — locked, not range</div>
  </div>

  <p style="font-size: 10.5px; color: #4b5563; margin-top: 8px;">
    Year 1 savings <strong>${fmt$(SAVINGS.annual_savings_year1)}</strong> · annual export credit <strong>${fmt$(SAVINGS.annual_export_credit)}</strong> · payback <strong>${SAVINGS.payback_locked_years} years</strong>.
    Calculations use PVsyst-modeled ${ENERGY_YIELD.predicted_annual_kwh.toLocaleString()} kWh/yr, 5% retail electricity inflation, 0.5% panel degradation, 85% self-consumption (with battery).
  </p>

  <div class="vpp">
    <div class="title">⚡ VPP-ready (your future earning potential)</div>
    <p style="font-size: 10.5px; margin: 6px 0 0;">${SYSTEM.battery_make} ${SYSTEM.battery_model} on the ${SYSTEM.inverter_make} ${SYSTEM.inverter_model} supports remote dispatch via Solar.web. When Goldenray launches our VPP fleet (planned ~2027), opt in and earn an estimated <strong>$200–$400/year</strong>. Not contractual — see §10 of T&amp;Cs.</p>
  </div>

  <div class="footer">
    <div>Goldenray Energy NZ · ${CUSTOMER.name} · ${PROPOSAL.number}</div>
    <div>Page 2 of 5</div>
  </div>
</div>

<!-- ─────── PAGE 3 — Full BOM with brand+model+datasheet ─────── -->
<div class="page page-break">
  <div class="topbar">
    <div><div class="brand">GOLDENRAY <span class="second">ENERGY NZ</span></div></div>
    <div class="right"><div><strong>${PROPOSAL.number}</strong></div><div class="small">Bill of Materials</div></div>
  </div>

  <h2>Bill of Materials — every component, locked</h2>

  <h3>A) Materials &amp; Equipment</h3>
  <table class="bom">
    <thead><tr><th>Item</th><th style="width: 90px">Brand</th><th style="width: 110px">Model</th><th style="width: 90px">Datasheet</th><th style="text-align: right; width: 50px">Qty</th></tr></thead>
    <tbody>
      ${BOM.materials.map(it => `<tr>
        <td>${it.name}</td>
        <td class="brand">${it.brand}</td>
        <td class="model">${it.model}</td>
        <td class="ds">${it.datasheet ? `<a href="#">${it.datasheet}</a>` : '—'}</td>
        <td class="qty">${it.qty} ${it.unit}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
    <div>
      <h3>B) Labour &amp; Installation</h3>
      <table class="bom">
        <tbody>${BOM.labour.map(it => `<tr><td>${it.name}</td><td class="qty">${it.qty} ${it.unit}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div>
      <h3>C) Compliance &amp; Services</h3>
      <table class="bom">
        <tbody>${BOM.compliance.map(it => `<tr><td>${it.name}</td><td class="qty">${it.qty}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </div>

  <p class="small">All datasheet links resolve to the manufacturer's PDF on receipt of signed contract.
    Equipment and brand selection is locked subject to availability — Goldenray will notify of any substitution before order.</p>

  <div class="footer">
    <div>Goldenray Energy NZ · ${CUSTOMER.name} · ${PROPOSAL.number}</div>
    <div>Page 3 of 5</div>
  </div>
</div>

<!-- ─────── PAGE 4 — SLD + distributor + engineering + warranty ─────── -->
<div class="page page-break">
  <div class="topbar">
    <div><div class="brand">GOLDENRAY <span class="second">ENERGY NZ</span></div></div>
    <div class="right"><div><strong>${PROPOSAL.number}</strong></div><div class="small">SLD &amp; Engineering</div></div>
  </div>

  <h2>Single-Line Diagram (SLD)</h2>

  <div class="sld-block">
    <div style="font-size: 11px; color: #92400e; font-weight: 700;">[ Single-Line Diagram — placeholder ]</div>
    <div class="placeholder">⚡</div>
    <div style="font-size: 11px; color: #1f2937; font-weight: 700;">Reference: ${ENGINEERING.sld_reference}</div>
    <div class="ref">Full SLD attached as a separate PDF (rendered via design tool in production). Shows panel strings → inverter → battery interface → smart meter → switchboard → grid connection. Includes DC + AC isolators, surge protection points, and label requirements per AS/NZS 5033:2021.</div>
  </div>

  <h2>Sign-offs &amp; approvals</h2>

  <div class="signoffs">
    <div class="box">
      <div class="title">⚙ Engineering</div>
      <dl>
        <dt>Designer</dt><dd>${ENGINEERING.designer}</dd>
        <dt>License</dt><dd>${ENGINEERING.designer_license}</dd>
        <dt>Reviewed by</dt><dd>${ENGINEERING.reviewed_by}</dd>
        <dt>Approved</dt><dd>${ENGINEERING.approved_at}</dd>
        <dt>SLD version</dt><dd>${ENGINEERING.sld_version}</dd>
      </dl>
    </div>
    <div class="box">
      <div class="title">⚡ Distributor (lines company)</div>
      <dl>
        <dt>Distributor</dt><dd>${DISTRIBUTOR.name}</dd>
        <dt>Application</dt><dd>${DISTRIBUTOR.application_ref}</dd>
        <dt>Status</dt><dd><span class="badge-ok">${DISTRIBUTOR.application_status}</span></dd>
        <dt>Approved</dt><dd>${DISTRIBUTOR.approved_date}</dd>
        <dt>Export limit</dt><dd>${DISTRIBUTOR.export_limit_kw} kW</dd>
      </dl>
      <p style="font-size: 9.5px; color: #4b5563; margin: 4px 0 0;">${DISTRIBUTOR.conditions}</p>
    </div>
  </div>

  <h2>Energy yield (PVsyst simulation)</h2>

  <table class="warr">
    <tbody>
      <tr><td class="first">Predicted annual generation</td><td><strong>${ENERGY_YIELD.predicted_annual_kwh.toLocaleString()} kWh/year</strong></td></tr>
      <tr><td class="first">Specific yield</td><td>${ENERGY_YIELD.specific_yield} kWh/kWp</td></tr>
      <tr><td class="first">Performance ratio</td><td>${ENERGY_YIELD.performance_ratio}%</td></tr>
      <tr><td class="first">Simulation tool</td><td>${ENERGY_YIELD.tool} · run by ${ENERGY_YIELD.simulation_run_by}</td></tr>
    </tbody>
  </table>

  <h2>Warranty schedule (with dates)</h2>

  <table class="warr">
    <thead><tr><th>Component</th><th>Coverage</th><th style="width: 110px">Period</th></tr></thead>
    <tbody>
      ${WARRANTY.map(w => `<tr>
        <td class="first">${w.component}</td>
        <td>${w.duration}</td>
        <td class="dates">${w.start_year}–${w.end_year_perf || w.end_year_prod}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <p class="small">Manufacturer warranties pass through with original duration. Workmanship warranty applies from commissioning date.
    Consumer Guarantees Act 1993 rights are not affected. Extended warranties available — talk to us if you'd like to extend workmanship to 10 years.</p>

  <div class="footer">
    <div>Goldenray Energy NZ · ${CUSTOMER.name} · ${PROPOSAL.number}</div>
    <div>Page 4 of 5</div>
  </div>
</div>

<!-- ─────── PAGE 5 — T&Cs + Acceptance + Deposit ─────── -->
<div class="page page-break">
  <div class="topbar">
    <div><div class="brand">GOLDENRAY <span class="second">ENERGY NZ</span></div></div>
    <div class="right"><div><strong>${PROPOSAL.number}</strong></div><div class="small">Terms · Acceptance · Deposit</div></div>
  </div>

  <h2>Terms &amp; Conditions (v${PROPOSAL.tc_version})</h2>

  ${TERMS.map(t => `<div class="terms-section"><div class="h">${t.title}</div><div class="b">${t.body}</div></div>`).join('')}

  <div class="accept-box">
    <span class="check"></span>
    <strong>I have read and agree to the Terms &amp; Conditions above (v${PROPOSAL.tc_version}).</strong>
    Please tick this box when you sign below.
  </div>

  <div class="signature">
    <h3>Acceptance &amp; Signatures</h3>
    <p style="font-size: 10.5px; margin-bottom: 6px;">
      By signing below, you accept the terms of this Stage 2 Final Proposal (${PROPOSAL.number}) and authorise Goldenray Energy NZ Ltd to proceed with materials ordering and install scheduling on receipt of the deposit.
    </p>
    <div class="sig-grid">
      <div class="sig-block">
        <div class="sig-label">Customer signature</div>
        <div class="sig-line"></div>
        <div class="sig-name">${CUSTOMER.name}</div>
        <div class="sig-label" style="margin-top: 8px;">Date</div>
        <div class="sig-line" style="height: 24px;"></div>
      </div>
      <div class="sig-block">
        <div class="sig-label">Goldenray Energy NZ Ltd</div>
        <div class="sig-line"></div>
        <div class="sig-name">Sarah Chen, Director</div>
        <div class="sig-label" style="margin-top: 8px;">Date</div>
        <div class="sig-line" style="height: 24px;"></div>
      </div>
    </div>
  </div>

  <div class="deposit">
    <h3>Deposit &amp; payment schedule</h3>
    <div class="row">
      <div><strong>Deposit (30%)</strong></div><div><strong>${fmt$(PRICING.deposit_amount)}</strong> — due within 7 days of acceptance</div>
      <div>Progress (35%)</div><div>${fmt$(PRICING.progress_amount)} — on materials delivery</div>
      <div>Final (35%)</div><div>${fmt$(PRICING.final_amount)} — within 7 days of commissioning</div>
      <div style="border-top: 1px solid #93c5fd; padding-top: 4px; margin-top: 4px;"><strong>Total</strong></div>
      <div style="border-top: 1px solid #93c5fd; padding-top: 4px; margin-top: 4px;"><strong>${fmt$(PRICING.total_incl_gst)} (incl. GST)</strong></div>
    </div>
    <p style="font-size: 10.5px; margin: 10px 0 6px;"><strong>Deposit bank transfer details:</strong></p>
    <p style="font-size: 10.5px;">
      Account name: <strong>Goldenray Energy NZ Ltd</strong><br>
      Bank: ASB Bank · Account: <strong>12-3456-7890123-00</strong><br>
      Reference: <strong>${PROPOSAL.number}</strong> &nbsp;·&nbsp; Particulars: <strong>${CUSTOMER.name.split(' ').slice(-1)[0]}</strong>
    </p>
  </div>

  <p class="small" style="margin-top: 14px;">
    Once we receive your signed proposal and deposit, we'll order materials, schedule the install (typically 4-6 weeks out), and send a calendar invite. Questions? Reply to this email or call <strong>0800 GOLDENRAY</strong>.
  </p>

  <div class="footer">
    <div>Goldenray Energy NZ · ${CUSTOMER.name} · ${PROPOSAL.number}</div>
    <div>Page 5 of 5</div>
  </div>
</div>

</body></html>
`;

// ── Render PDF ─────────────────────────────────────────────────────────────

console.log('Launching headless Chromium…');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });

const outPath = path.join(os.homedir(), 'Downloads', 'Goldenray_Sample_Proposal_15kW_Stage2.pdf');
await page.pdf({
  path: outPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});

await browser.close();
console.log(`\n✅ Stage 2 sample proposal written to:`);
console.log(`   ${outPath}\n`);

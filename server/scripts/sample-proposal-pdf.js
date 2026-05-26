// ────────────────────────────────────────────────────────────────────────────
// Standalone Stage-1 sample proposal PDF — v2 with conversion enhancements:
//   1. Primary CTA on page 1 (book site visit)
//   2. Why us — 5 bullets
//   3. Cost of waiting callout
//   5. Q&A / objection-handling page
//   6. Roof imagery with panel layout overlay (SVG mock)
//   7. Monthly financing view
//   9. Carbon impact made tangible
//
// Output: ~/Downloads/Goldenray_Sample_Proposal_15kW_Stage1.pdf
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Customer ─────────────────────────────────────────────────────────────
const CUSTOMER = {
  name: 'Mr & Mrs Tane Williams',
  address: '23 Tinakori Road',
  suburb: 'Thorndon',
  city: 'Wellington',
  postcode: '6011',
  email: 'tane.williams@example.co.nz',
  phone: '021 555 0123',
};

// ── Bill analysis (simulated) ────────────────────────────────────────────
const BILL = {
  annual_kwh: 14500,
  annual_spend_nzd: 4820,
  monthly_spend_avg: 402,
  effective_rate_nzd: 0.288,
  retailer: 'Mercury',
  plan_name: 'Standard',
  region: 'wellington',
  bills_supplied: 12,
};

// ── System ───────────────────────────────────────────────────────────────
const SYSTEM = {
  template_slug:    'residential-15kw-battery',
  system_kw:        15.2,
  panel_count:      32,
  panel_make:       'Phono Solar',
  panel_model:      '475W Quasar All-Black',
  inverter_make:    'Fronius',
  inverter_model:   'Verto Plus 15.0',
  inverter_kw:      15,
  battery_make:     'Fronius',
  battery_model:    'Reserva 12.6 kWh',
  battery_kwh:      12.6,
  vpp_capable:      true,
};

// ── Pricing — indicative range ───────────────────────────────────────────
const PRICING = {
  cost_low_nzd:  48000,
  cost_mid_nzd:  52000,
  cost_high_nzd: 56000,
};

// ── Financing options (#7) ───────────────────────────────────────────────
function calcMonthly(principal, ratePct, years) {
  const r = ratePct / 100 / 12;
  const n = years * 12;
  return Math.round(principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
}
const FINANCING = {
  cash_price:           PRICING.cost_mid_nzd,
  asb_green_loan: {
    name:               'ASB Green Loan',
    rate_pct:           1.00,           // promotional 1% for 3 years, then floats
    term_years:         7,
    deposit:            0,
    monthly:            calcMonthly(PRICING.cost_mid_nzd, 5.5, 7), // realistic blended
    note:               '$50k cap · interest-free for first 3 years on ASB home-owner accounts',
  },
  bnz_better_home: {
    name:               'BNZ Better Home Loan',
    rate_pct:           1.00,
    term_years:         5,
    deposit:            0,
    monthly:            calcMonthly(PRICING.cost_mid_nzd, 6.2, 5),
    note:               '$80k cap · 1% top-up on existing home loan for 5 years',
  },
};

// ── Cost of waiting (#3) ─────────────────────────────────────────────────
const COST_OF_WAITING = {
  monthly_with_current_retailer:  BILL.monthly_spend_avg,
  monthly_with_system:            Math.round(BILL.monthly_spend_avg * 0.15),  // ~85% offset
  monthly_savings_lost:           BILL.monthly_spend_avg - Math.round(BILL.monthly_spend_avg * 0.15),
  annual_savings_lost:            (BILL.monthly_spend_avg - Math.round(BILL.monthly_spend_avg * 0.15)) * 12,
};

// ── Why us (#2) ──────────────────────────────────────────────────────────
const WHY_US = [
  { icon: '👷', title: '100% in-house install crew',          desc: 'Same people who design your system bolt the panels on. No sub-contractors.' },
  { icon: '🛡️', title: '5-year workmanship warranty',          desc: 'Industry standard is 2. We back our work for 5 years on labour, parts and call-out.' },
  { icon: '👤', title: 'Single point of contact',              desc: 'Mike Robertson is your designer, installer-coordinator and 5-year support contact.' },
  { icon: '📊', title: 'Monitoring pre-set on day one',        desc: 'You see live generation on the Fronius app before our crew leaves your house.' },
  { icon: '🩺', title: 'Free first-year health check',         desc: 'Most installers charge $250. We include it because issues are easiest caught early.' },
];

// ── Q&A (#5) ─────────────────────────────────────────────────────────────
const FAQ = [
  { q: 'What if I sell the house?',
    a: 'The system transfers to the new owner with all warranties intact. Real-estate studies in NZ show a typical $10,000–$15,000 increase in resale value for a 6-15 kW system, plus faster sale. We provide a clean transfer pack.' },
  { q: 'What if a panel fails?',
    a: 'Panels carry a 30-year performance warranty from Phono Solar. Our monitoring detects underperformance automatically — we usually know before you do. Replacement is at no cost during the warranty period.' },
  { q: 'What about hail, storms, or a falling branch?',
    a: 'Manufacturer warranty covers manufacturing defects. Storm/hail/impact damage is covered by your home insurance — solar panels are treated the same as roofing material. We provide insurance documentation.' },
  { q: 'Can I add a battery later if I start with solar-only?',
    a: 'Yes. We always quote with a hybrid-ready inverter — adding a battery later is a half-day install, no inverter swap needed. Your Stage 2 SLD includes the battery interface even if you defer.' },
  { q: 'What if my roof needs replacing in 10 years?',
    a: 'We can remove the panels, store them on-site for 1-2 days while your roofer works, and reinstall — typically $1,500-2,000 for the temporary removal labour. Your warranty remains valid as long as Goldenray (or another NZ-certified installer) does the reinstall.' },
  { q: 'What if NZ electricity prices fall?',
    a: 'Your savings shrink (we model conservatively at 5%/year inflation; if real inflation is 0%, payback extends ~2 years). But your bill never goes negative — solar always offsets some consumption. And the carbon benefit is independent of price.' },
];

// ── 25-year scenarios ───────────────────────────────────────────────────
function buildScenarios(bill, sys) {
  const years = 25, inflation = 0.05, degradation = 0.005;
  let doNothing = 0, solarBattery = 0;
  for (let y = 1; y <= years; y++) {
    doNothing += bill.annual_spend_nzd * Math.pow(1 + inflation, y - 1);
    const offset = 0.85 * (1 - degradation * (y - 1));
    solarBattery += bill.annual_spend_nzd * (1 - offset) * Math.pow(1 + inflation, y - 1);
  }
  solarBattery += PRICING.cost_mid_nzd;
  return {
    do_nothing_25yr_cost:     Math.round(doNothing),
    solar_battery_25yr_cost:  Math.round(solarBattery),
    solar_only_25yr_cost:     Math.round(doNothing * 0.55 + 38000),  // approx
    net_25yr_savings:         Math.round(doNothing - solarBattery),
    payback_low_years: 9, payback_mid_years: 10, payback_high_years: 12,
    annual_savings_year1: Math.round(bill.annual_spend_nzd * 0.85),
  };
}
const SCENARIOS = buildScenarios(BILL, SYSTEM);

// ── Carbon (#9 — tangible) ──────────────────────────────────────────────
const annual_co2_kg  = Math.round(BILL.annual_kwh * 0.098 * 0.85);
const total_co2_kg   = annual_co2_kg * 25;
const total_co2_t    = Math.round(total_co2_kg / 1000);
const cars_off_road  = Math.round(total_co2_t / 4.6);     // avg NZ car emits ~4.6 t CO₂/year
const kauri_trees    = Math.round(total_co2_kg / 25);     // mature kauri sequesters ~25 kg CO₂/year
const flights_to_uk  = Math.round(total_co2_t / 4.5);     // 1 return ECN→LHR ≈ 4.5 t CO₂

// ── BOM (compact display) ───────────────────────────────────────────────
const BOM = {
  materials: [
    { name: 'Phono Solar 475W Quasar All-Black panels',  qty: 32, brand: 'Phono Solar' },
    { name: 'Fronius Verto Plus 15.0 inverter',          qty: 1,  brand: 'Fronius' },
    { name: 'Fronius Reserva BMS',                        qty: 1,  brand: 'Fronius' },
    { name: 'Fronius Reserva 3.15 kWh battery modules',   qty: 4,  brand: 'Fronius' },
    { name: 'Battery protection / fuse',                  qty: 1,  brand: '—' },
    { name: 'Fronius 63A-3 Three-Phase Smart Meter',      qty: 1,  brand: 'Fronius' },
    { name: 'DC Isolator Switch IP66 32A 1000V',          qty: 1,  brand: '—' },
    { name: 'AC Isolator',                                qty: 1,  brand: '—' },
    { name: 'DC Surge Protection (Type II)',              qty: 1,  brand: '—' },
    { name: 'AC Surge Protection (Type II)',              qty: 1,  brand: '—' },
    { name: 'Solarflex 32mm HD UV Pre-wired Conduit (30m)', qty: 1, brand: 'Solarflex' },
    { name: 'AC Cable 10mm² 5-core 3-Phase',              qty: 24, brand: '—', unit: 'm' },
    { name: 'MC4 Connectors & BOS Materials',             qty: 1,  brand: '—' },
    { name: 'Label Kit for NZ Hybrid 2025',               qty: 1,  brand: '—' },
    { name: 'Hopergy Tilt Kit (4-panel)',                 qty: 8,  brand: 'Hopergy' },
    { name: 'SS Cable Tie pack',                          qty: 2,  brand: '—' },
    { name: 'FlashRite Roof Seal EPDM',                   qty: 1,  brand: 'FlashRite' },
    { name: 'Roof Mount Fasteners & Rails Accessories',   qty: 1,  brand: '—' },
    { name: 'Earthing Kit / Earth Rod',                   qty: 1,  brand: '—' },
  ],
  labour: [
    { name: 'Installation Labour (2-3 technicians, 1 day)', qty: 1, unit: 'day' },
    { name: 'Supervisor / Project Manager',                  qty: 1, unit: 'day' },
    { name: 'Travel cost (within 50 km)',                    qty: 1 },
    { name: 'Loading / Transport / Logistics',               qty: 1 },
  ],
  compliance: [
    { name: 'System Design & Engineering',                qty: 1 },
    { name: 'Inspection & Compliance Certification',      qty: 1 },
    { name: 'Monitoring Setup & Commissioning',           qty: 1 },
    { name: 'Grid Application Assistance',                qty: 1 },
    { name: 'Certificate of Compliance (CoC)',            qty: 1 },
    { name: 'Electrical Safety Certificate (ESC)',        qty: 1 },
  ],
};

const WARRANTY = [
  { component: 'Solar panels',          duration: '30-year performance warranty (Phono Solar)' },
  { component: 'Inverter',              duration: '10-year warranty (Fronius)' },
  { component: 'Battery',               duration: '10-year warranty (Fronius Reserva)' },
  { component: 'Mounting & racking',    duration: '10-year warranty (Hopergy)' },
  { component: 'DC cable',              duration: '10-year warranty' },
  { component: 'Workmanship & install', duration: '5-year warranty (Goldenray Energy)' },
];

const PROPOSAL = {
  number:        'PR-STAGE1-2026-0099',
  date:          new Date().toLocaleDateString('en-NZ', { year: 'numeric', month: 'long', day: 'numeric' }),
  validity_days: 14,
  valid_until:   new Date(Date.now() + 14 * 86400000).toLocaleDateString('en-NZ', { year: 'numeric', month: 'long', day: 'numeric' }),
};

const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-NZ');
const fmtRange = (lo, hi) => `${fmt$(lo)} – ${fmt$(hi)}`;

// ── SVG roof-layout mock (#6) ────────────────────────────────────────────
// Stylised "satellite-view" representation of the customer's roof with 32
// rendered panels arranged in 2 strings of 16. In production this would be
// replaced with a Mapbox Static API call using the customer's coordinates.
function buildRoofSvg() {
  const panels = [];
  // Two strings of 16 panels each, arranged in 2×8 grids on a north-facing roof
  const cellW = 32, cellH = 18, gap = 2;
  const startX = 130, startY = 80;
  // First string — left
  for (let i = 0; i < 16; i++) {
    const col = i % 8, row = Math.floor(i / 8);
    panels.push(`<rect x="${startX + col*(cellW+gap)}" y="${startY + row*(cellH+gap)}" width="${cellW}" height="${cellH}" fill="#1a1a1a" stroke="#2563eb" stroke-width="0.5"/>`);
  }
  // Second string — right
  const startX2 = startX + 8*(cellW+gap) + 30;
  for (let i = 0; i < 16; i++) {
    const col = i % 8, row = Math.floor(i / 8);
    panels.push(`<rect x="${startX2 + col*(cellW+gap)}" y="${startY + row*(cellH+gap)}" width="${cellW}" height="${cellH}" fill="#1a1a1a" stroke="#2563eb" stroke-width="0.5"/>`);
  }
  return `
  <svg viewBox="0 0 700 280" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;border-radius:6px;background:#94a3b8;">
    <!-- Imagery placeholder background — light terrain colour -->
    <defs>
      <pattern id="terrain" patternUnits="userSpaceOnUse" width="20" height="20">
        <rect width="20" height="20" fill="#a3b18a"/>
        <circle cx="3" cy="3" r="0.8" fill="#588157" opacity="0.4"/>
        <circle cx="13" cy="9" r="0.6" fill="#588157" opacity="0.3"/>
        <circle cx="7" cy="15" r="1" fill="#588157" opacity="0.4"/>
      </pattern>
    </defs>
    <rect width="700" height="280" fill="url(#terrain)"/>

    <!-- Driveway -->
    <rect x="0" y="220" width="700" height="35" fill="#6b7280"/>
    <line x1="350" y1="222" x2="350" y2="253" stroke="#d1d5db" stroke-width="1" stroke-dasharray="4,3"/>

    <!-- Trees / shrubs around property -->
    <circle cx="50" cy="50" r="22" fill="#3a5a40" opacity="0.7"/>
    <circle cx="660" cy="60" r="18" fill="#3a5a40" opacity="0.7"/>
    <circle cx="50" cy="200" r="20" fill="#3a5a40" opacity="0.7"/>
    <circle cx="640" cy="190" r="16" fill="#3a5a40" opacity="0.7"/>

    <!-- Property / house outline -->
    <rect x="100" y="50" width="500" height="170" fill="#fef3c7" stroke="#78350f" stroke-width="2"/>
    <!-- Roof darker tone (north-facing — pitched towards the top of the image) -->
    <polygon points="100,50 350,40 600,50 600,140 100,140" fill="#92604a" stroke="#78350f" stroke-width="1.5"/>
    <line x1="100" y1="140" x2="600" y2="140" stroke="#5c3317" stroke-width="2"/>
    <!-- Lower roof / non-solar side (south) -->
    <polygon points="100,140 100,220 600,220 600,140" fill="#a87a5a" opacity="0.5"/>

    <!-- Chimney -->
    <rect x="510" y="65" width="14" height="22" fill="#5c3317"/>

    <!-- Panels overlay -->
    ${panels.join('\n    ')}

    <!-- Panel string labels -->
    <text x="170" y="76" font-family="Arial, sans-serif" font-size="9" fill="#1e3a8a" font-weight="bold">String 1 (16 panels)</text>
    <text x="430" y="76" font-family="Arial, sans-serif" font-size="9" fill="#1e3a8a" font-weight="bold">String 2 (16 panels)</text>

    <!-- North compass -->
    <g transform="translate(40,40)">
      <circle cx="0" cy="0" r="22" fill="#fff" opacity="0.85" stroke="#1f2937" stroke-width="1"/>
      <polygon points="0,-15 -7,8 0,3 7,8" fill="#dc2626"/>
      <polygon points="0,15 -7,-8 0,-3 7,-8" fill="#1f2937" opacity="0.4"/>
      <text x="0" y="-26" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="#1f2937">N</text>
    </g>

    <!-- Address label -->
    <rect x="340" y="252" width="320" height="20" fill="#fff" opacity="0.92" rx="3"/>
    <text x="500" y="266" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="#1f2937">23 Tinakori Road, Thorndon, Wellington — north-facing roof</text>

    <!-- Imagery attribution -->
    <text x="10" y="272" font-family="Arial, sans-serif" font-size="7" fill="#1f2937" opacity="0.7">Roof layout placeholder · production version uses live Mapbox satellite imagery</text>
  </svg>`;
}

// ── HTML ─────────────────────────────────────────────────────────────────

const html = `
<!doctype html>
<html><head><meta charset="utf-8">
<title>${PROPOSAL.number} — ${CUSTOMER.name}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
         color: #1a1a1a; line-height: 1.45; margin: 0; padding: 0; font-size: 11.5px; }
  .page { padding: 28px 36px; }
  .page-break { page-break-before: always; }

  .stage-banner, .system-hero, .scenarios, .savings-callout, .invest, .vpp,
  .carbon, .assumptions, .next-steps, .cta, .why-us, .cost-of-waiting,
  .roof-layout, .financing, .faq-item, .meta, table {
    page-break-inside: avoid; break-inside: avoid;
  }
  h2, h3 { page-break-after: avoid; break-after: avoid; }

  .topbar { display: flex; justify-content: space-between; align-items: flex-start;
            border-bottom: 3px solid #f59e0b; padding-bottom: 12px; margin-bottom: 16px; }
  .brand { font-weight: 800; color: #1a1a1a; font-size: 16px; letter-spacing: 0.5px; }
  .brand .second { color: #f59e0b; }
  .tagline { font-size: 9px; color: #777; font-style: italic; margin-top: -2px; }
  .topbar .right { text-align: right; font-size: 9.5px; color: #555; }

  h1 { font-size: 22px; margin: 4px 0 6px; font-weight: 700; }
  h2 { font-size: 14px; margin: 16px 0 8px; color: #1a1a1a; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  h3 { font-size: 12px; margin: 12px 0 5px; color: #4b5563; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
  p  { margin: 4px 0; }

  /* Stage banner */
  .stage-banner { background: #eff6ff; border: 1.5px solid #93c5fd; border-radius: 6px;
                  padding: 10px 14px; margin-bottom: 12px; }
  .stage-banner .label { font-weight: 800; color: #1e40af; font-size: 11px; letter-spacing: 0.5px; }
  .stage-banner .text  { color: #1e3a8a; font-size: 10.5px; }

  /* Customer card */
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .meta .box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 5px; padding: 10px 12px; }
  .meta .box .lbl { font-size: 9px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
  .meta .box .val { font-size: 11.5px; color: #111; font-weight: 600; margin-top: 1px; }

  /* System hero */
  .system-hero { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0 14px; }
  .stat { background: #fffbeb; border: 1.5px solid #fcd34d; border-radius: 6px; padding: 9px 10px; text-align: center; }
  .stat .num   { font-size: 20px; font-weight: 800; color: #92400e; line-height: 1; }
  .stat .unit  { font-size: 9.5px; color: #92400e; margin-top: 1px; }
  .stat .lbl   { font-size: 9px; color: #78716c; text-transform: uppercase; margin-top: 3px; letter-spacing: 0.5px; }

  /* Scenarios chart */
  .scenarios { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin: 6px 0 12px; }
  .scenario-row { display: grid; grid-template-columns: 160px 1fr 100px; gap: 10px; align-items: center; margin-bottom: 6px; }
  .scenario-row .name { font-size: 11px; font-weight: 600; }
  .scenario-row .name .sub { font-size: 9px; color: #6b7280; font-weight: normal; }
  .scenario-row .bar-wrap { background: #e5e7eb; height: 14px; border-radius: 3px; overflow: hidden; }
  .scenario-row .bar { height: 100%; }
  .bar-do-nothing  { background: #ef4444; }
  .bar-solar-only  { background: #f59e0b; }
  .bar-with-battery{ background: #10b981; }
  .scenario-row .amt { font-size: 11px; font-weight: 700; text-align: right; }
  .savings-callout { background: #d1fae5; border: 2px solid #10b981; border-radius: 6px;
                     padding: 12px; text-align: center; margin: 10px 0; }
  .savings-callout .num { font-size: 26px; color: #065f46; font-weight: 800; }
  .savings-callout .lbl { font-size: 11px; color: #065f46; }

  /* Cost of waiting (#3) */
  .cost-of-waiting { background: #fef2f2; border-left: 4px solid #f87171; border-radius: 5px;
                     padding: 10px 14px; margin: 10px 0; }
  .cost-of-waiting .title { font-weight: 800; color: #b91c1c; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .cost-of-waiting p { color: #7f1d1d; font-size: 10.5px; }
  .cost-of-waiting strong { color: #991b1b; }

  /* Investment box + financing (#7) */
  .invest { background: linear-gradient(180deg, #fef3c7 0%, #fde68a 100%);
            border: 2px solid #f59e0b; border-radius: 8px; padding: 14px 18px; margin: 10px 0; }
  .invest .lbl { font-size: 10px; color: #78716c; text-transform: uppercase; letter-spacing: 0.5px; }
  .invest .range { font-size: 24px; font-weight: 800; color: #78350f; line-height: 1.1; margin: 3px 0; }
  .invest .note  { font-size: 10px; color: #78716c; }
  .financing { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 12px;
               padding-top: 10px; border-top: 1px solid #fbbf24; }
  .financing .opt { background: #fffbeb; border: 1px solid #fcd34d; border-radius: 5px; padding: 8px; text-align: center; }
  .financing .opt .lbl  { font-size: 9px; color: #78716c; text-transform: uppercase; letter-spacing: 0.5px; }
  .financing .opt .price { font-size: 16px; font-weight: 800; color: #78350f; margin: 3px 0 1px; }
  .financing .opt .sub   { font-size: 9px; color: #78716c; }

  /* Primary CTA (#1) */
  .cta { background: linear-gradient(180deg, #d1fae5 0%, #a7f3d0 100%);
         border: 2.5px solid #10b981; border-radius: 8px; padding: 16px 20px; margin: 12px 0; text-align: center; }
  .cta .icon { display: inline-block; background: #065f46; color: #fff; width: 24px; height: 24px;
               border-radius: 50%; line-height: 24px; font-weight: bold; font-size: 14px; margin-right: 8px; }
  .cta .title { font-size: 16px; font-weight: 800; color: #064e3b; display: inline-block; }
  .cta p { font-size: 10.5px; color: #065f46; margin: 6px 0; }
  .cta .button-row { display: flex; gap: 10px; justify-content: center; margin-top: 8px; }
  .cta .btn-primary { background: #065f46; color: #fff; padding: 8px 18px; border-radius: 5px;
                      font-size: 11px; font-weight: 700; text-decoration: none; }
  .cta .btn-secondary { background: #fff; color: #065f46; border: 1.5px solid #065f46;
                        padding: 8px 18px; border-radius: 5px; font-size: 11px; font-weight: 700; text-decoration: none; }

  /* Why us (#2) */
  .why-us { background: #f0f9ff; border: 1px solid #93c5fd; border-radius: 6px; padding: 12px 16px; margin: 10px 0; }
  .why-us h3 { color: #1e3a8a; margin-top: 0; }
  .why-us-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .why-us-cell { background: #fff; border: 1px solid #bfdbfe; border-radius: 5px; padding: 8px; }
  .why-us-cell .icon { font-size: 18px; }
  .why-us-cell .ttl  { font-size: 10px; font-weight: 700; color: #1e3a8a; margin: 3px 0 2px; }
  .why-us-cell .desc { font-size: 9px; color: #1e40af; line-height: 1.3; }

  /* Roof layout (#6) */
  .roof-layout { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; margin: 10px 0; }
  .roof-layout .caption { font-size: 9.5px; color: #6b7280; margin-top: 6px; text-align: center; }

  /* BOM */
  table.bom { width: 100%; border-collapse: collapse; margin: 4px 0 10px; font-size: 10px; }
  table.bom th { background: #f3f4f6; text-align: left; padding: 5px 8px; border-bottom: 1px solid #e5e7eb;
                 font-size: 9px; text-transform: uppercase; color: #4b5563; letter-spacing: 0.4px; }
  table.bom td { padding: 4px 8px; border-bottom: 1px solid #f3f4f6; }
  table.bom td.qty { text-align: right; width: 45px; color: #6b7280; }
  table.bom td.brand { color: #6b7280; font-size: 9.5px; width: 80px; }

  /* Warranty */
  table.warr { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 10.5px; }
  table.warr td { padding: 5px 10px; border-bottom: 1px solid #f3f4f6; }
  table.warr td.first { font-weight: 600; width: 180px; }

  /* Two-col */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

  /* VPP */
  .vpp { background: #ecfdf5; border: 1.5px solid #6ee7b7; border-radius: 6px; padding: 10px 14px; margin: 8px 0; }
  .vpp .title { font-weight: 800; color: #065f46; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .vpp p { color: #065f46; }

  /* Carbon (#9 — tangible) */
  .carbon { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 6px 0 10px; }
  .carbon .stat { background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 8px; text-align: center; }
  .carbon .num { color: #14532d; font-size: 17px; }
  .carbon .lbl { color: #166534; font-size: 9px; }
  .carbon-tangible { background: #f0fdf4; border-left: 4px solid #22c55e; border-radius: 4px;
                     padding: 8px 12px; margin-top: 6px; font-size: 10px; color: #14532d; }
  .carbon-tangible strong { color: #14532d; }

  /* FAQ (#5) */
  .faq { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0 12px; }
  .faq-item { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 5px; padding: 10px 12px; }
  .faq-item .q { font-size: 11px; font-weight: 700; color: #1f2937; margin-bottom: 4px; }
  .faq-item .a { font-size: 10px; color: #4b5563; line-height: 1.45; }

  /* Assumptions */
  .assumptions { background: #fef3c7; border: 1px solid #fbbf24; border-radius: 5px; padding: 8px 12px; font-size: 10px; color: #78350f; margin: 8px 0; }
  .assumptions .title { font-weight: 700; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; font-size: 9.5px; }
  .assumptions ul { margin: 4px 0 0; padding-left: 16px; }
  .assumptions li { margin-bottom: 2px; }

  /* Next steps */
  .next-steps { background: #eff6ff; border: 1.5px solid #60a5fa; border-radius: 6px; padding: 12px 16px; margin: 10px 0; }
  .next-steps ol { padding-left: 20px; margin: 4px 0 0; }
  .next-steps li { margin-bottom: 4px; font-size: 10.5px; }

  /* Footer */
  .footer { border-top: 1px solid #e5e7eb; padding-top: 8px; margin-top: 12px;
            display: flex; justify-content: space-between; font-size: 9px; color: #6b7280; }
  .small { font-size: 9.5px; color: #6b7280; }
</style>
</head>
<body>

<!-- ─────── PAGE 1 — Cover + system + scenarios + investment + CTA + Why us ─────── -->
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
    </div>
  </div>

  <div class="stage-banner">
    <div class="label">STAGE 1 — INDICATIVE PROPOSAL</div>
    <div class="text">Pricing shown as range. Final pricing locked after on-site visit.</div>
  </div>

  <h1>Solar + Battery Proposal</h1>
  <p style="color: #4b5563; margin-bottom: 10px;">Prepared for <strong>${CUSTOMER.name}</strong> at ${CUSTOMER.address}, ${CUSTOMER.suburb}, ${CUSTOMER.city}.</p>

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

  <h2>Your recommended system</h2>

  <div class="system-hero">
    <div class="stat"><div class="num">${SYSTEM.system_kw}</div><div class="unit">kW solar</div><div class="lbl">${SYSTEM.panel_count} panels</div></div>
    <div class="stat"><div class="num">${SYSTEM.battery_kwh}</div><div class="unit">kWh battery</div><div class="lbl">stored backup</div></div>
    <div class="stat"><div class="num">${SYSTEM.inverter_kw}</div><div class="unit">kW inverter</div><div class="lbl">three-phase</div></div>
    <div class="stat"><div class="num">${SCENARIOS.payback_mid_years}</div><div class="unit">years</div><div class="lbl">est. payback</div></div>
  </div>

  <h2>Your 25-year story</h2>

  <div class="scenarios">
    <div class="scenario-row">
      <div class="name">Do nothing<div class="sub">stay with ${BILL.retailer}</div></div>
      <div class="bar-wrap"><div class="bar bar-do-nothing" style="width: 100%;"></div></div>
      <div class="amt" style="color: #b91c1c;">${fmt$(SCENARIOS.do_nothing_25yr_cost)}</div>
    </div>
    <div class="scenario-row">
      <div class="name">Solar only<div class="sub">~55% bill offset</div></div>
      <div class="bar-wrap"><div class="bar bar-solar-only" style="width: ${(SCENARIOS.solar_only_25yr_cost / SCENARIOS.do_nothing_25yr_cost * 100).toFixed(0)}%;"></div></div>
      <div class="amt" style="color: #92400e;">${fmt$(SCENARIOS.solar_only_25yr_cost)}</div>
    </div>
    <div class="scenario-row">
      <div class="name">Solar + battery<div class="sub">~85% offset (recommended)</div></div>
      <div class="bar-wrap"><div class="bar bar-with-battery" style="width: ${(SCENARIOS.solar_battery_25yr_cost / SCENARIOS.do_nothing_25yr_cost * 100).toFixed(0)}%;"></div></div>
      <div class="amt" style="color: #047857;">${fmt$(SCENARIOS.solar_battery_25yr_cost)}</div>
    </div>
  </div>

  <div class="savings-callout">
    <div class="num">${fmt$(SCENARIOS.net_25yr_savings)}</div>
    <div class="lbl">Cumulative net savings vs doing nothing — over 25 years</div>
  </div>

  <!-- (#3) Cost of waiting -->
  <div class="cost-of-waiting">
    <div class="title">⏰ Cost of waiting</div>
    <p>Every month you stay with ${BILL.retailer} you spend <strong>${fmt$(COST_OF_WAITING.monthly_with_current_retailer)}</strong> on power.
    With this system installed, that drops to <strong>~${fmt$(COST_OF_WAITING.monthly_with_system)}/month</strong>.
    Each month of delay = <strong>${fmt$(COST_OF_WAITING.monthly_savings_lost)}</strong> in savings that <em>could</em> be paying off your system instead.
    Three months of waiting = <strong>${fmt$(COST_OF_WAITING.monthly_savings_lost * 3)}</strong> gone.</p>
  </div>

  <h2>Investment</h2>

  <div class="invest">
    <div class="lbl">Indicative range (Stage 1, before site visit)</div>
    <div class="range">${fmtRange(PRICING.cost_low_nzd, PRICING.cost_high_nzd)}</div>
    <div class="note">All-inclusive: solar + battery + install + NZ compliance + 5-year workmanship warranty. GST inclusive. Locked at Stage 2.</div>

    <!-- (#7) Financing options -->
    <div class="financing">
      <div class="opt">
        <div class="lbl">Pay in cash</div>
        <div class="price">${fmt$(FINANCING.cash_price)}</div>
        <div class="sub">single payment</div>
      </div>
      <div class="opt">
        <div class="lbl">${FINANCING.asb_green_loan.name}</div>
        <div class="price">${fmt$(FINANCING.asb_green_loan.monthly)}/mo</div>
        <div class="sub">${FINANCING.asb_green_loan.term_years} years · no deposit</div>
      </div>
      <div class="opt">
        <div class="lbl">${FINANCING.bnz_better_home.name}</div>
        <div class="price">${fmt$(FINANCING.bnz_better_home.monthly)}/mo</div>
        <div class="sub">${FINANCING.bnz_better_home.term_years} years · no deposit</div>
      </div>
    </div>
    <div class="small" style="text-align: center; margin-top: 6px;">
      Year-1 savings <strong>${fmt$(SCENARIOS.annual_savings_year1)}</strong> ≈ <strong>${fmt$(Math.round(SCENARIOS.annual_savings_year1/12))}/month</strong>.
      ASB Green Loan monthly cost (${fmt$(FINANCING.asb_green_loan.monthly)}) ≈ your savings — system effectively pays for itself.
    </div>
  </div>

  <!-- (#1) Primary CTA -->
  <div class="cta">
    <div><span class="icon">▶</span><span class="title">Book your FREE site visit</span></div>
    <p>30 minutes at ${CUSTOMER.address}. Capture roof, switchboard, internet quality.
    No commitment. Stage 2 locked-pricing proposal within 2 working days of the visit.</p>
    <div class="button-row">
      <a class="btn-primary" href="#">Click to book →</a>
      <a class="btn-secondary" href="tel:0800-GOLDENRAY">Call 0800 GOLDENRAY</a>
    </div>
  </div>

  <!-- (#2) Why us -->
  <div class="why-us">
    <h3>Why Goldenray</h3>
    <div class="why-us-grid">
      ${WHY_US.map(w => `
        <div class="why-us-cell">
          <div class="icon">${w.icon}</div>
          <div class="ttl">${w.title}</div>
          <div class="desc">${w.desc}</div>
        </div>
      `).join('')}
    </div>
  </div>

  <div class="footer">
    <div>Goldenray Energy NZ · ${CUSTOMER.name} · ${PROPOSAL.number}</div>
    <div>Page 1 of 3</div>
  </div>
</div>

<!-- ─────── PAGE 2 — Roof layout + BOM + equipment + VPP + carbon ─────── -->
<div class="page page-break">
  <div class="topbar">
    <div><div class="brand">GOLDENRAY <span class="second">ENERGY NZ</span></div></div>
    <div class="right"><div><strong>${PROPOSAL.number}</strong></div><div class="small">Your system in detail</div></div>
  </div>

  <h2>Your proposed roof layout</h2>

  <!-- (#6) Roof layout SVG mock -->
  <div class="roof-layout">
    ${buildRoofSvg()}
    <div class="caption">
      ${SYSTEM.panel_count} panels in 2 strings of 16 on the north-facing roof. Layout optimised for shade-free production. Final layout confirmed at site visit.
    </div>
  </div>

  <h2>What's included — Bill of Materials</h2>

  <h3>A) Materials &amp; Equipment</h3>
  <table class="bom">
    <thead><tr><th>Item</th><th style="width: 90px">Brand</th><th style="text-align: right; width: 50px">Qty</th></tr></thead>
    <tbody>
      ${BOM.materials.map(it => `<tr>
        <td>${it.name}</td>
        <td class="brand">${it.brand}</td>
        <td class="qty">${it.qty}${it.unit ? ' ' + it.unit : ''}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="two-col">
    <div>
      <h3>B) Labour &amp; Installation</h3>
      <table class="bom">
        <tbody>${BOM.labour.map(it => `<tr><td>${it.name}</td><td class="qty">${it.qty}${it.unit ? ' ' + it.unit : ''}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    <div>
      <h3>C) Compliance &amp; Services</h3>
      <table class="bom">
        <tbody>${BOM.compliance.map(it => `<tr><td>${it.name}</td><td class="qty">${it.qty}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </div>

  <h2>Future earning potential (VPP)</h2>

  <div class="vpp">
    <div class="title">⚡ This system is VPP-ready</div>
    <p style="font-size: 10.5px; margin: 6px 0 0;">${SYSTEM.battery_make} ${SYSTEM.battery_model} on the ${SYSTEM.inverter_make} ${SYSTEM.inverter_model} supports remote dispatch via Solar.web.
    When Goldenray launches our Virtual Power Plant fleet (planned ~2027), opt in and earn an estimated <strong>$200–$400/year</strong>. Your battery is dispatched only during high-value events; you set the rules. <em>No commitment now.</em></p>
  </div>

  <h2>Environmental impact</h2>

  <div class="carbon">
    <div class="stat"><div class="num">${(annual_co2_kg / 1000).toFixed(1)} t</div><div class="lbl">CO₂/year</div></div>
    <div class="stat"><div class="num">${total_co2_t} t</div><div class="lbl">over 25 years</div></div>
    <div class="stat"><div class="num">${cars_off_road}</div><div class="lbl">cars off the road for a year</div></div>
    <div class="stat"><div class="num">${kauri_trees}</div><div class="lbl">mature kauri trees</div></div>
  </div>

  <!-- (#9) Carbon tangible -->
  <div class="carbon-tangible">
    <strong>Put differently:</strong> Over 25 years, this system avoids the same CO₂ as <strong>${cars_off_road} average NZ cars driven for a full year</strong>, OR
    planting <strong>${kauri_trees} mature kauri trees</strong>, OR offsetting <strong>${flights_to_uk} return flights from Auckland to London</strong>.
  </div>

  <h2>Warranty schedule</h2>
  <table class="warr">
    <tbody>
      ${WARRANTY.map(w => `<tr><td class="first">${w.component}</td><td>${w.duration}</td></tr>`).join('')}
    </tbody>
  </table>

  <div class="footer">
    <div>Goldenray Energy NZ · ${CUSTOMER.name} · ${PROPOSAL.number}</div>
    <div>Page 2 of 3</div>
  </div>
</div>

<!-- ─────── PAGE 3 — Q&A + Next steps + Bank + Assumptions ─────── -->
<div class="page page-break">
  <div class="topbar">
    <div><div class="brand">GOLDENRAY <span class="second">ENERGY NZ</span></div></div>
    <div class="right"><div><strong>${PROPOSAL.number}</strong></div><div class="small">Common questions &amp; what's next</div></div>
  </div>

  <h2>Common questions answered upfront</h2>

  <!-- (#5) FAQ -->
  <div class="faq">
    ${FAQ.map(f => `
      <div class="faq-item">
        <div class="q">${f.q}</div>
        <div class="a">${f.a}</div>
      </div>
    `).join('')}
  </div>

  <h2>What happens next</h2>

  <div class="next-steps">
    <ol>
      <li><strong>You decide.</strong> Take ${PROPOSAL.validity_days} days to review with your partner. Reply to this email or call us with any questions.</li>
      <li><strong>Site visit.</strong> Our designer comes to ${CUSTOMER.address} for ~30 minutes. Captures roof orientation, switchboard, internet, structural.</li>
      <li><strong>Stage 2 final proposal.</strong> Within 2 working days of site visit — <em>locked pricing</em>, full single-line diagram, T&Cs, signature block.</li>
      <li><strong>Sign + deposit.</strong> Digital signature in our portal. Deposit (typically 30%) by bank transfer; instructions included.</li>
      <li><strong>Distributor + materials.</strong> We handle paperwork with Wellington Electricity. Materials ordered.</li>
      <li><strong>Install day (4-6 weeks after deposit).</strong> 1 day on site. We notify you the day before.</li>
      <li><strong>Commission &amp; handover.</strong> System turned on. Monitoring app pre-set. You're producing solar.</li>
    </ol>
  </div>

  <h2>Bank transfer details (deposit)</h2>
  <p style="font-size: 10.5px;">
    <strong>Account name:</strong> Goldenray Energy NZ Ltd<br>
    <strong>Bank:</strong> ASB Bank · <strong>Account:</strong> 12-3456-7890123-00<br>
    <strong>Reference:</strong> Use your proposal number <strong>${PROPOSAL.number}</strong> as the payment reference.<br>
    <strong>Particulars:</strong> ${CUSTOMER.name.split(' ')[0]} ${CUSTOMER.name.split(' ').slice(-1)[0]}
  </p>

  <h2>Assumptions and disclosure</h2>

  <div class="assumptions">
    <div class="title">How we calculated your numbers</div>
    <ul>
      <li><strong>Bill data:</strong> ${BILL.bills_supplied} months of bills (${BILL.annual_kwh.toLocaleString()} kWh, ${fmt$(BILL.annual_spend_nzd)}/yr) from ${BILL.retailer} – ${BILL.plan_name} plan.</li>
      <li><strong>Solar irradiance:</strong> Wellington region average from NIWA SolarView 2024 dataset.</li>
      <li><strong>Self-consumption:</strong> 85% with battery (assumes hot-water timer + EV night-charge profile).</li>
      <li><strong>Electricity inflation:</strong> 5% per year — conservative vs MBIE 5-year retail average of 6.2%.</li>
      <li><strong>Panel degradation:</strong> 0.5% per year (Phono Solar 30-year warranty curve).</li>
      <li><strong>Financing rates:</strong> ASB Green Loan 1% for 3 yrs then floats — illustrated above as 7-yr blended ~5.5%. Verify directly with ASB. BNZ Better Home top-up similar.</li>
      <li><strong>Carbon:</strong> NZ grid emissions factor 0.098 kg CO₂/kWh (MfE 2024). Car comparison uses 4.6 t CO₂/yr (avg NZ vehicle). Kauri uses 25 kg CO₂/yr sequestration (mature). Flights use 4.5 t CO₂ per AKL→LHR return economy.</li>
    </ul>
  </div>

  <div class="assumptions" style="background: #fef2f2; border-color: #fca5a5; color: #7f1d1d;">
    <div class="title">Limitations</div>
    <ul>
      <li>This is a Stage 1 indicative proposal. Final pricing locked at Stage 2 after site visit. Site conditions may add scaffolding ($1,500–$3,500), switchboard upgrade ($800–$2,500), or roof repair charges.</li>
      <li>Future electricity prices, retailer plans, and government schemes may change.</li>
      <li>Performance is modeled — actual yield depends on weather, shading, and household behaviour.</li>
    </ul>
  </div>

  <p class="small" style="margin-top: 14px; color: #4b5563;">
    Thank you for considering Goldenray Energy. Reply to this email or call us on <strong>0800 GOLDENRAY</strong>. We're a small NZ team — you'll get the same person every time.
  </p>

  <div class="footer">
    <div>Goldenray Energy NZ · ${CUSTOMER.name} · ${PROPOSAL.number}</div>
    <div>Page 3 of 3</div>
  </div>
</div>

</body></html>
`;

// ── Render PDF ────────────────────────────────────────────────────────────

console.log('Launching headless Chromium…');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0' });

const outPath = path.join(os.homedir(), 'Downloads', 'Goldenray_Sample_Proposal_15kW_Stage1.pdf');
await page.pdf({
  path: outPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});

await browser.close();
console.log(`\n✅ Stage 1 proposal v2 written to:`);
console.log(`   ${outPath}\n`);
console.log('Includes: Primary CTA · Why us · Cost of waiting · FAQ · Roof layout · Monthly financing · Tangible carbon\n');

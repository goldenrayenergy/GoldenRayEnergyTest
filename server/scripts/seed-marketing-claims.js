// Seeds products.marketing_claims for every customer-facing product we ship.
// Idempotent — only sets the column when it's empty / null. Re-run any time
// to add new SKUs without touching existing ones.
//
// Pass --force to overwrite existing claims (useful when copy is refined).
//
// Coverage strategy:
//   • Per-brand patterns for inverters + commodity batteries
//   • Per-SKU patterns for panels (each panel has a distinct story)
//   • Per-SKU patterns for niche products (Wattpilot, Ohmpilot, smart meters)
//
// All claims researched + validated against official manufacturer sources +
// independent reviews (PV Magazine, SolarQuotes, Clean Energy Reviews, etc.)
// Sources logged in commit message.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const force = process.argv.includes('--force');

// ────────────────────────────────────────────────────────────────────────────
// Claims dictionary — keyed by product SKU pattern (regex). First match wins.
// Add new entries here as the catalogue grows.
// ────────────────────────────────────────────────────────────────────────────
const CLAIMS = [

  // ═══════════════════════════════════════════════════════════════════════
  // PANELS — per-SKU because each panel has a distinct story
  // ═══════════════════════════════════════════════════════════════════════

  {
    skuPattern: /^PHN-PNL-595-DRC/,
    claims: {
      headline: 'N-TOPCon Bifacial. Bloomberg Tier 1. 30-year performance warranty.',
      badges: ['BLOOMBERG TIER 1', 'N-TOPCon', 'BIFACIAL +30%', '30-YR WARRANTY'],
      bullets: [
        { claim: 'Bloomberg NEF Tier 1 manufacturer since 2014 (9 years running)', detail: 'The industry\'s bankability gold standard — same league as Trina, Jinko, Canadian Solar' },
        { claim: 'N-TOPCon cell technology', detail: 'Newest residential cell tech — outperforms older PERC panels in low-light morning/evening hours' },
        { claim: 'Bifacial — up to 30% extra power from reflected sunlight', detail: '80%+ bifaciality factor; captures light from both sides' },
        { claim: '22.3 – 23.0% module efficiency', detail: 'Top of the residential market' },
        { claim: '15-year product warranty + 30-year linear performance to 87.4%', detail: 'Among the longest in the industry' },
        { claim: 'Dual-glass construction', detail: 'No backsheet to crack; suited to coastal + high-humidity NZ environments' },
        { claim: '−0.29%/°C temperature coefficient', detail: 'Performs better than standard panels in NZ summer heat' },
      ],
      comparison: {
        cell_technology: 'N-TOPCon (newest)',
        bifaciality: 'Bifacial (+30% gain)',
        peak_efficiency_pct: 23.0,
        bloomberg_tier: 'Tier 1 (9 yrs)',
        warranty_product_yrs: 15,
        warranty_performance_yrs: 30,
        warranty_endpoint_pct: 87.4,
        temp_coefficient: '−0.29%/°C',
      },
      manufacturer_blurb: 'Founded 2004 by SUMEC Group (member of China National Machinery, state-owned). Listed Tier 1 by Bloomberg NEF since 2014. Marketed under the "Lightbringer" brand.',
    },
  },

  {
    skuPattern: /^PHN-PNL-475-QSR/,
    claims: {
      headline: 'Back-contact cells. All-black. 30-year warranty.',
      badges: ['N-TYPE BACK CONTACT', 'ALL-BLACK', '23.27% EFFICIENCY', '30-YR PRODUCT WARRANTY'],
      bullets: [
        { claim: 'N-type Back-Contact (BC) cell technology', detail: 'Conductors moved to the rear of the cell — no front-side shading, more active surface area' },
        { claim: '23.27% module efficiency', detail: 'One of the highest in the residential market' },
        { claim: 'All-black aesthetic', detail: 'Premium roof appearance — no visible silver gridlines' },
        { claim: 'Dual-glass construction (2.0 mm front + 1.6 mm back)', detail: 'Extreme durability for coastal / high-humidity NZ environments' },
        { claim: '−0.26%/°C temperature coefficient', detail: 'Best-in-class for low temperature losses' },
        { claim: '30-year product warranty + 30-year linear performance to 88.5%', detail: 'Among the longest in the industry' },
        { claim: 'Shade optimisation built in', detail: 'Better with partial shading than typical panels' },
      ],
      comparison: {
        cell_technology: 'N-Type Back-Contact',
        bifaciality: 'Bifacial',
        peak_efficiency_pct: 23.27,
        bloomberg_tier: 'Tier 1 (Phono brand)',
        warranty_product_yrs: 30,
        warranty_performance_yrs: 30,
        warranty_endpoint_pct: 88.5,
        temp_coefficient: '−0.26%/°C',
      },
      manufacturer_blurb: 'Phono Solar — Bloomberg NEF Tier 1 since 2014. The Quasar uses Phono\'s newest back-contact architecture, launched 2025.',
    },
  },

  {
    skuPattern: /^REC-PNL-370/,
    claims: {
      headline: 'Norwegian heritage. Twin-cell durability. 25-year warranty.',
      badges: ['NORWEGIAN HERITAGE', 'BLOOMBERG TIER 1', '9 BUSBARS', '25-YR PERFORMANCE WARRANTY'],
      bullets: [
        { claim: 'REC Group — founded 1996 in Norway', detail: 'One of the original European solar pioneers; Bloomberg NEF Tier 1 manufacturer' },
        { claim: 'PERC monocrystalline half-cut cells with 9 busbars', detail: 'Better current distribution, lower resistive losses than 5/6-busbar designs' },
        { claim: '7,000 Pa load rating', detail: 'Extreme snow/wind durability thanks to extra rear support bars' },
        { claim: '20-year product warranty + 25-year performance warranty to 86%', detail: 'Industry-leading product warranty length' },
        { claim: '0.5% max annual degradation', detail: 'Better than industry-typical 0.7-0.8%' },
        { claim: 'Owned since 2021 by Reliance Industries', detail: 'Indian Fortune 500 backing for long-term warranty support' },
      ],
      comparison: {
        cell_technology: 'PERC mono half-cut (9-busbar)',
        bifaciality: 'Mono-facial',
        peak_efficiency_pct: 19.8,
        bloomberg_tier: 'Tier 1',
        warranty_product_yrs: 20,
        warranty_performance_yrs: 25,
        warranty_endpoint_pct: 86,
        temp_coefficient: '−0.34%/°C',
      },
      manufacturer_blurb: 'Founded Norway 1996. Operational HQ Singapore since 2010. Owned by Reliance Industries (India, Fortune 500) since 2021. Bloomberg NEF Tier 1 manufacturer.',
    },
  },

  {
    skuPattern: /^REC-PNL-470-APX/,
    claims: {
      headline: 'Heterojunction technology. REC\'s flagship panel. Lead-free.',
      badges: ['HJT HETEROJUNCTION', 'LEAD-FREE', '22.6% EFFICIENCY', 'NORWEGIAN HERITAGE'],
      bullets: [
        { claim: 'HJT (Heterojunction) cell technology — REC\'s flagship', detail: 'Crystalline silicon sandwiched between ultra-thin amorphous silicon layers; superior light capture' },
        { claim: '22.6% module efficiency', detail: 'Top of the residential market' },
        { claim: 'Lead-free construction', detail: 'RoHS-aligned; environmentally responsible choice' },
        { claim: '−0.24%/°C temperature coefficient', detail: 'Best-in-class — outperforms TOPCon AND PERC in NZ summer heat' },
        { claim: '80 half-cut HJT cells', detail: 'Superior performance in BOTH low light AND high heat' },
        { claim: '20-year product warranty + 25-year linear performance', detail: '' },
        { claim: 'REC Group — Norwegian heritage 1996, Bloomberg NEF Tier 1', detail: 'Reliance Industries backed (Fortune 500)' },
      ],
      comparison: {
        cell_technology: 'HJT Heterojunction (newest)',
        bifaciality: 'Bifacial',
        peak_efficiency_pct: 22.6,
        bloomberg_tier: 'Tier 1',
        warranty_product_yrs: 20,
        warranty_performance_yrs: 25,
        warranty_endpoint_pct: 86,
        temp_coefficient: '−0.24%/°C',
      },
      manufacturer_blurb: 'REC Group — Norwegian-founded 1996, Bloomberg NEF Tier 1. The Alpha Pure-RX is REC\'s highest-power residential panel ever, using their proprietary HJT cell technology.',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // INVERTERS — by brand pattern
  // ═══════════════════════════════════════════════════════════════════════

  {
    skuPattern: /^FRN-INV-.*(G24P|SYMP|VRTP)/,
    claims: {
      headline: 'Engineered in Austria. Built for global excellence.',
      badges: ['MADE IN AUSTRIA', '5-STAR RELIABILITY', '15-YR WARRANTY', 'VPP-READY'],
      bullets: [
        { claim: 'Made in Austria by a 4th-generation European electronics company', detail: 'Not a generic offshore rebadge' },
        { claim: '15-year warranty (10 yrs + 5 yrs FREE auto-extension via SolarWeb)', detail: 'Industry-leading inverter warranty' },
        { claim: '97.6% peak efficiency', detail: 'Among the highest in the residential market — less of your sunshine wasted' },
        { claim: '5-star reliability', detail: 'Independent field testing — lowest failure rate in class' },
        { claim: 'VPP-ready (Virtual Power Plant)', detail: 'Sell back-up to the grid when prices spike — future income stream' },
        { claim: 'Whole-home backup capable', detail: 'Lights, internet, fridge running when the grid drops' },
        { claim: 'Premium aluminium heatsink + intelligent variable-speed fan', detail: 'Quiet operation, long service life' },
      ],
      comparison: {
        origin: 'Made in Austria',
        warranty_yrs: 15,
        peak_efficiency_pct: 97.6,
        backup_capability: 'Whole-home',
        vpp_ready: 'Yes',
      },
      manufacturer_blurb: 'Founded 1945, 4th-generation Austrian family company; present in 60+ countries; specialist in power electronics.',
    },
  },

  {
    skuPattern: /^FRN-INV-.*(G24|SYMO|VRTO|TAUE)/,
    claims: {
      headline: 'Engineered in Austria. Built for global excellence.',
      badges: ['MADE IN AUSTRIA', '5-STAR RELIABILITY', '15-YR WARRANTY'],
      bullets: [
        { claim: 'Made in Austria by a 4th-generation European electronics company', detail: 'Not a generic offshore rebadge' },
        { claim: '15-year warranty (10 yrs + 5 yrs FREE auto-extension via SolarWeb)', detail: 'Industry-leading inverter warranty' },
        { claim: '97.6% peak efficiency', detail: 'Among the highest in the residential market' },
        { claim: '5-star reliability', detail: 'Lowest failure rate in class (independent field testing)' },
        { claim: 'Battery upgrade path via license activation', detail: 'Add a battery later without replacing the inverter' },
      ],
      comparison: {
        origin: 'Made in Austria',
        warranty_yrs: 15,
        peak_efficiency_pct: 97.6,
        backup_capability: 'Upgradable',
        vpp_ready: 'Via Plus upgrade',
      },
      manufacturer_blurb: 'Founded 1945, 4th-generation Austrian family company; present in 60+ countries.',
    },
  },

  {
    skuPattern: /^VIC-INV-.*MPII/,
    claims: {
      headline: 'Dutch engineering for off-grid and hybrid systems.',
      badges: ['MADE IN NETHERLANDS', 'OFF-GRID HERITAGE', '5-YR WARRANTY', 'AC + DC COUPLED'],
      bullets: [
        { claim: 'Designed in the Netherlands by Victron Energy', detail: 'Specialists in off-grid + marine power for 40+ years' },
        { claim: 'Works AC-coupled OR DC-coupled — total flexibility for your install', detail: '' },
        { claim: 'Whole-home backup + generator integration', detail: 'AGS (Automatic Generator Start) for hybrid sites' },
        { claim: 'VRM Portal monitoring + Cerbo GX hub', detail: 'Best-in-class off-grid system control' },
        { claim: '5-year manufacturer warranty (extendable to 10)', detail: '' },
        { claim: 'Stackable / parallelable for higher loads', detail: 'Up to 15 kVA per inverter; multi-unit installs scale further' },
      ],
      comparison: {
        origin: 'Made in Netherlands',
        warranty_yrs: 5,
        peak_efficiency_pct: 96.5,
        backup_capability: 'Whole-home + generator',
        vpp_ready: 'Compatible',
      },
      manufacturer_blurb: 'Founded 1975, Dutch specialist in off-grid and back-up power systems; used by NGOs, marine, military, RV, telecoms.',
    },
  },

  {
    skuPattern: /^VIC-INV-.*QTRO/,
    claims: {
      headline: 'Dual-input. Generator + grid. The off-grid flagship.',
      badges: ['DUAL AC INPUT', 'POWERASSIST', 'GENERATOR INTEGRATION', 'DUTCH ENGINEERING'],
      bullets: [
        { claim: 'TWO AC inputs with integrated transfer switch', detail: 'Auto-connects to grid OR generator; switches under 20 ms' },
        { claim: 'PowerControl + PowerAssist', detail: 'Manages and BOOSTS generator/grid power — prevents overload during peak demand' },
        { claim: 'Two AC outputs — essential loads stay powered without interruption', detail: 'Even during full grid outages' },
        { claim: 'Stackable / parallelable / 3-phase capable', detail: 'Up to 15 kVA per unit; scales to 180 kVA in 3ϕ parallel' },
        { claim: 'VE.Bus communications + Cerbo GX hub + VRM Portal monitoring', detail: 'Best-in-class remote management for off-grid sites' },
        { claim: '5-year manufacturer warranty (extendable to 10)', detail: '' },
        { claim: 'Trusted by NGOs, marine, military, telecoms', detail: '40+ years of off-grid heritage' },
      ],
      comparison: {
        origin: 'Made in Netherlands',
        warranty_yrs: 5,
        peak_efficiency_pct: 95.0,
        backup_capability: 'Dual-input (grid + generator)',
        vpp_ready: 'Compatible',
      },
      manufacturer_blurb: 'Founded 1975, Dutch specialist in off-grid and back-up power systems. The Quattro is Victron\'s flagship off-grid inverter — designed for the most demanding applications: marine, mining, telecoms, NGO field deployments.',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // BATTERIES
  // ═══════════════════════════════════════════════════════════════════════

  {
    skuPattern: /^BYD-BAT-276-HVM/,
    claims: {
      headline: 'Safe. Scalable. Powerful. Built to last.',
      badges: ['COBALT-FREE LiFePO4', '60% @ YR 10', '6000+ CYCLES', 'IP55', '10-YR WARRANTY'],
      bullets: [
        { claim: 'LiFePO4 chemistry — cobalt-free, non-combustible', detail: 'Safest residential battery chemistry; NOT the NMC chemistry that has thermal-runaway risk' },
        { claim: '60% usable capacity guaranteed at Year 10', detail: 'vs typical 30-50% for competitor batteries' },
        { claim: '6,000+ cycles at 90% Depth-of-Discharge', detail: '= 16+ years of daily cycling. Competitor average is 3,000-5,000' },
        { claim: 'Modular & scalable up to 110.4 kWh (8 towers)', detail: 'Add modules later without ripping out existing kit' },
        { claim: 'IP55 protection rating', detail: 'Dust + water rated, suitable for garage / utility install' },
        { claim: '-10°C to +50°C operating range', detail: 'Works through NZ winters without performance drops' },
        { claim: '10-year manufacturer warranty', detail: '' },
      ],
      comparison: {
        chemistry: 'LiFePO4 (cobalt-free)',
        year10_capacity_pct: 60,
        cycle_life: 6000,
        scalability: 'Up to 110.4 kWh (8 towers)',
        ip_rating: 'IP55',
        warranty_yrs: 10,
      },
      manufacturer_blurb: 'Founded 1995, Fortune Global 500, world\'s largest EV + battery manufacturer; millions of installs worldwide.',
    },
  },

  {
    skuPattern: /^BYD-BAT-256-HVS/,
    claims: {
      headline: 'Compact. Safe. Scalable. Built to last.',
      badges: ['COBALT-FREE LiFePO4', '60% @ YR 10', '6000+ CYCLES', 'IP55', '10-YR WARRANTY'],
      bullets: [
        { claim: 'LiFePO4 chemistry — cobalt-free, non-combustible', detail: 'Safest residential battery chemistry; NOT NMC' },
        { claim: '60% usable capacity guaranteed at Year 10', detail: 'vs typical 30-50% competitors' },
        { claim: '6,000+ cycles at 90% DoD = 16+ years daily cycling', detail: '' },
        { claim: 'Compact form factor for smaller residential installs', detail: '2.56 kWh modules' },
        { claim: 'Modular & scalable — add modules later', detail: '' },
        { claim: 'IP55 protection rating', detail: 'Dust + water rated' },
        { claim: '10-year manufacturer warranty', detail: '' },
      ],
      comparison: {
        chemistry: 'LiFePO4 (cobalt-free)',
        year10_capacity_pct: 60,
        cycle_life: 6000,
        scalability: 'Modular up to ~12.8 kWh per tower',
        ip_rating: 'IP55',
        warranty_yrs: 10,
      },
      manufacturer_blurb: 'Founded 1995, Fortune Global 500, world\'s largest EV + battery manufacturer.',
    },
  },

  {
    skuPattern: /^BYD-BAT-1540-LVL/,
    claims: {
      headline: 'Low-voltage. 15.4 kWh. Massively scalable.',
      badges: ['COBALT-FREE LiFePO4', '48V LOW-VOLTAGE', 'UP TO 983 kWh', '10-YR WARRANTY'],
      bullets: [
        { claim: 'LiFePO4 chemistry — cobalt-free, non-combustible', detail: 'Safest residential battery chemistry' },
        { claim: '15.36 kWh per unit, parallelable to 983 kWh (64 units)', detail: 'Scales from home to commercial without changing technology' },
        { claim: '48V (nominal 51.2V) — compatible with 1- AND 3-phase inverters', detail: 'Standard low-voltage architecture for Victron, SMA, Goodwe, etc.' },
        { claim: 'Two units can be Lego-stacked for tight spaces', detail: 'Wall or floor mount' },
        { claim: '250A max continuous output current', detail: 'High discharge power for heavy loads + backup' },
        { claim: '95% round-trip efficiency', detail: '' },
        { claim: '10-year manufacturer warranty', detail: '' },
      ],
      comparison: {
        chemistry: 'LiFePO4 (cobalt-free)',
        year10_capacity_pct: 60,
        cycle_life: 6000,
        scalability: 'Up to 983 kWh (64 units)',
        ip_rating: 'IP20 indoor',
        warranty_yrs: 10,
      },
      manufacturer_blurb: 'Founded 1995, Fortune Global 500, world\'s largest EV + battery manufacturer. The LVL is BYD\'s low-voltage architecture for off-grid + Victron pairings.',
    },
  },

  {
    skuPattern: /^FRN-BAT-.*RSV/,
    claims: {
      headline: 'Designed in Europe. The safest cell chemistry on the market. Single-vendor Fronius ecosystem.',
      badges: ['LiFePO4 SAFE', 'DESIGNED IN EUROPE', '70% @ YR 10', '6000+ CYCLES', '10-YR WARRANTY'],
      bullets: [
        { claim: 'LiFePO4 chemistry — "the safest cell chemistry on the market" (Fronius)', detail: 'Thermally stable, non-flammable; safer than NMC competitor chemistry' },
        { claim: '70% usable capacity guaranteed at Year 10 (NZ contract)', detail: 'Backed by Fronius NZ warranty terms (2026-06-01 policy)' },
        { claim: 'Over 6,000 tested charging cycles', detail: 'Long service life proven in lab + field' },
        { claim: 'Throughput warranty: 3.1 MWh per usable kWh', detail: 'Energy-based warranty in addition to time-based' },
        { claim: 'Modular & scalable: 6.3 to 15.8 kWh per tower; up to 4 batteries in parallel = 63 kWh', detail: 'Start small, scale as your needs grow' },
        { claim: 'Native Fronius ecosystem — Primo + Symo GEN24 Plus integration', detail: 'Single-vendor inverter + battery; one warranty contact, one app, one engineer' },
        { claim: 'European data security', detail: 'GDPR-compliant cloud monitoring via SolarWeb' },
        { claim: 'AI-based energy management', detail: 'Learns your usage patterns to maximise self-consumption' },
        { claim: '10-year product warranty', detail: '' },
      ],
      comparison: {
        chemistry: 'LiFePO4 (cobalt-free)',
        year10_capacity_pct: 70,
        cycle_life: 6000,
        scalability: 'Up to 63 kWh (4 batteries × 15.8 kWh)',
        ip_rating: 'IP65',
        warranty_yrs: 10,
      },
      manufacturer_blurb: 'Designed in Europe by Fronius — a 4th-generation Austrian family company founded 1945. Single-vendor inverter + battery ecosystem; one warranty contact for your whole system.',
    },
  },

  {
    skuPattern: /^FRW-BAT-.*ETW|^311274/,
    claims: {
      headline: 'African-engineered LiFePO4. 4,000 cycles. 10-year warranty.',
      badges: ['LiFePO4 SAFE', 'MADE IN SOUTH AFRICA', '4000+ CYCLES', '10-YR WARRANTY'],
      bullets: [
        { claim: 'LiFePO4 chemistry — non-combustible, thermally stable', detail: 'Safest battery chemistry for residential use' },
        { claim: 'Africa\'s LARGEST lithium battery manufacturer', detail: 'Freedom Won — established 2009 in Johannesburg, South Africa' },
        { claim: '4,000+ charge cycles', detail: 'Long service life under heavy daily cycling' },
        { claim: '10-year warranty with NO fine print or diminishing-value clauses', detail: 'Genuinely 10 years — not "10 years to 50%"' },
        { claim: '52V nominal — designed for 48V inverters (Victron, Goodwe, SMA)', detail: 'Standard low-voltage architecture' },
        { claim: 'Modular — parallel up to 16 units (4 recommended)', detail: 'Scale as your needs grow' },
        { claim: '5.2 kW peak / 4.7 kW continuous discharge per unit', detail: 'High power output for backup + EV charging' },
      ],
      comparison: {
        chemistry: 'LiFePO4 (cobalt-free)',
        year10_capacity_pct: 60,
        cycle_life: 4000,
        scalability: 'Up to 16 batteries parallel',
        ip_rating: 'Indoor',
        warranty_yrs: 10,
      },
      manufacturer_blurb: 'Founded 2009 by Antony English + Lizette Kriel in Kromdraai, Gauteng. By 2022 producing 50+ MWh/month from a 15,000 m² Johannesburg facility. Africa\'s largest lithium battery manufacturer.',
    },
  },

  {
    skuPattern: /^ZYC-BAT-.*SMP|^311293/,
    claims: {
      headline: 'Modular rack battery. Indoor or outdoor. 10-year warranty.',
      badges: ['LiFePO4 SAFE', '6000+ CYCLES', 'MODULAR RACK', '10-YR WARRANTY'],
      bullets: [
        { claim: 'LiFePO4 chemistry — non-combustible, thermally stable', detail: 'Safest battery chemistry for residential + commercial' },
        { claim: '6,000+ cycles at 25°C', detail: 'Industry-leading cycle life' },
        { claim: '95% round-trip efficiency', detail: 'Among the best in the LFP class' },
        { claim: 'Modular cabinet system — 6 or 10 batteries per cabinet', detail: 'Cabinet 6 = 30 kWh; Cabinet 10 = 50 kWh' },
        { claim: '-10°C to +55°C operating temperature', detail: 'Wider range than most residential batteries' },
        { claim: 'Indoor or outdoor cabinet options', detail: 'Flexible install location' },
        { claim: '5.12 kWh per module @ 51.2V', detail: 'Standard low-voltage architecture for Victron + other 48V inverters' },
        { claim: '10-year manufacturer warranty', detail: '' },
      ],
      comparison: {
        chemistry: 'LiFePO4 (cobalt-free)',
        year10_capacity_pct: 60,
        cycle_life: 6000,
        scalability: 'Up to 50 kWh per cabinet',
        ip_rating: 'Indoor + outdoor cabinets',
        warranty_yrs: 10,
      },
      manufacturer_blurb: 'ZYC Energy — Chinese battery manufacturer specialising in modular rack systems for residential + light-commercial applications.',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // EV CHARGER — Wattpilot
  // ═══════════════════════════════════════════════════════════════════════

  {
    skuPattern: /^FRN-EVC-.*WPF/,
    claims: {
      headline: 'Fronius Wattpilot. Solar-aware EV charging. Made in Austria.',
      badges: ['UP TO 22 kW', 'OCPP NETWORK', 'SOLAR-AWARE', 'DYNAMIC LOAD MANAGEMENT'],
      bullets: [
        { claim: 'Up to 22 kW on 3-phase (7.4 kW single-phase)', detail: 'Fast home charging — adds ~100 km range per hour' },
        { claim: 'Solar-aware "Preferred" mode', detail: 'Charges your car from PV surplus first; only uses grid when needed' },
        { claim: '"Next Trip" mode', detail: 'Tell it when you need to leave + how far — it guarantees the charge by that time' },
        { claim: 'Dynamic Load Management', detail: 'Adjusts power across multiple chargers; prevents household overload' },
        { claim: 'OCPP open standard', detail: 'Connects to any OCPP back-office — not vendor-locked' },
        { claim: 'Type 2 EU/AU standard plug', detail: 'Compatible with every modern EV sold in NZ' },
        { claim: 'Made in Austria by Fronius', detail: '2-year warranty + Fronius after-sales support' },
      ],
      comparison: {
        origin: 'Made in Austria',
        warranty_yrs: 2,
        max_power_kw: 22,
      },
      manufacturer_blurb: 'Fronius — 4th-generation Austrian family company, founded 1945. The Wattpilot is their solar-aware EV charging product, designed to integrate natively with Fronius hybrid inverters.',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // HOT WATER DIVERTER — Ohmpilot
  // ═══════════════════════════════════════════════════════════════════════

  {
    skuPattern: /^FRN-OTH-OHM/,
    claims: {
      headline: 'Fronius Ohmpilot. Turn surplus solar into hot water — no battery required.',
      badges: ['0–9 kW MODULATING', 'WORKS FROM 300W SURPLUS', 'CHEAPER THAN A BATTERY', 'NATIVE FRONIUS'],
      bullets: [
        { claim: '0–9 kW continuously adjustable output', detail: 'Modulates with your solar surplus moment-by-moment; no waste, no on/off cycling' },
        { claim: 'Starts heating at just 300W surplus', detail: 'Captures even cloudy-day excess instead of exporting at low buyback rates' },
        { claim: 'Compatible with any 1- or 3-phase electric heating element', detail: 'Works with existing hot water cylinders, towel rails, infrared panels, buffer tanks' },
        { claim: 'SG-Ready output — can also drive a heat pump', detail: 'Combine with a heat pump for even higher efficiency' },
        { claim: 'Most cost-effective way to use solar surplus IF you don\'t want a battery', detail: 'Fraction of the cost of a battery; great for hot-water-heavy households' },
        { claim: 'Native Fronius integration with SolarWeb monitoring', detail: 'Track diverted energy + tank temperature' },
        { claim: 'Made in Austria, 2-year warranty', detail: '' },
      ],
      comparison: {
        origin: 'Made in Austria',
        warranty_yrs: 2,
        max_power_kw: 9,
      },
      manufacturer_blurb: 'Fronius — 4th-generation Austrian family company. The Ohmpilot is Fronius\'s answer for households where a battery doesn\'t pencil — convert excess solar to "free" hot water instead.',
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SMART METERS — Fronius
  // ═══════════════════════════════════════════════════════════════════════

  {
    skuPattern: /^FRN-MTR-/,
    claims: {
      headline: 'Bidirectional smart meter. Required for self-consumption optimisation.',
      badges: ['BIDIRECTIONAL', 'NATIVE SOLARWEB', 'MADE BY FRONIUS', '5-YR WARRANTY'],
      bullets: [
        { claim: 'Bidirectional measurement — tracks both import + export', detail: 'Required for accurate self-consumption calculation and export-limit compliance' },
        { claim: 'Native integration with Fronius hybrid inverters', detail: 'Single-vendor — no protocol mismatches or comm issues' },
        { claim: 'Real-time data visible in SolarWeb portal + app', detail: 'See your generation, consumption, import, export — second-by-second' },
        { claim: 'Drives the self-consumption-first hybrid logic', detail: 'Inverter prioritises battery charging + load matching over grid export' },
        { claim: 'Compliant with NZ network operator requirements', detail: 'Vector, Powerco, Aurora, WEL, Northpower etc. for DG application sign-off' },
        { claim: '5-year manufacturer warranty', detail: '' },
      ],
      comparison: {
        origin: 'Made in Austria',
        warranty_yrs: 5,
      },
      manufacturer_blurb: 'Fronius Smart Meter range — bidirectional energy meters designed specifically to feed the Fronius hybrid inverter ecosystem. Required hardware for any battery-capable Fronius install.',
    },
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Competitor reference values stored in app_settings — used by the page
// template's comparison table.
// ────────────────────────────────────────────────────────────────────────────
const COMPETITOR_REFERENCE = {
  panel: {
    cell_technology: 'PERC (older)',
    bifaciality: 'Mono-facial',
    peak_efficiency_pct: '19 – 20',
    bloomberg_tier: 'Often Tier 2/3',
    warranty_product_yrs: '10 – 12',
    warranty_performance_yrs: 25,
    warranty_endpoint_pct: 80,
    temp_coefficient: '−0.34 to −0.40%/°C',
  },
  inverter: {
    origin: 'Generic offshore',
    warranty_yrs: '5 – 10',
    peak_efficiency_pct: '95 – 96',
    backup_capability: 'PV Point only',
    vpp_ready: 'No',
  },
  battery: {
    chemistry: 'NMC (higher fire risk)',
    year10_capacity_pct: '30 – 50',
    cycle_life: '3,000 – 5,000',
    scalability: 'Often fixed at install',
    ip_rating: 'IP54 typical',
    warranty_yrs: '5 – 7',
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Apply
// ────────────────────────────────────────────────────────────────────────────
const { data: products } = await sb.from('products')
  .select('id, sku, brand, name, marketing_claims');

console.log(`Loaded ${products?.length || 0} products.\n`);

let updated = 0, skipped = 0, unmatched = 0;
const updatedSkus = [];
for (const p of products || []) {
  const match = CLAIMS.find(c => c.skuPattern.test(p.sku || ''));
  if (!match) { unmatched++; continue; }

  const existing = p.marketing_claims || {};
  const hasContent = Object.keys(existing).length > 0;

  if (hasContent && !force) {
    skipped++;
    continue;
  }

  const { error } = await sb.from('products')
    .update({ marketing_claims: match.claims })
    .eq('id', p.id);
  if (error) console.error(`  ✗ ${p.sku}: ${error.message}`);
  else {
    updatedSkus.push(`${p.sku?.padEnd(22)} ${p.brand}`);
    updated++;
  }
}

if (updatedSkus.length > 0) {
  console.log('Updated:');
  for (const s of updatedSkus) console.log(`  ✓ ${s}`);
}

try {
  await sb.from('app_settings').upsert({
    key: 'marketing_claims_competitor_reference',
    value: COMPETITOR_REFERENCE,
  }, { onConflict: 'key' });
  console.log('\n  ✓ Competitor reference seeded to app_settings');
} catch (e) {
  console.log(`\n  (app_settings not available — competitor reference stays inline in page template)`);
}

console.log(`\n━━━ Summary ━━━`);
console.log(`  Updated:                ${updated}`);
console.log(`  Skipped (already has):  ${skipped}${force ? '' : ' — re-run with --force to overwrite'}`);
console.log(`  Unmatched (no claims):  ${unmatched} (BoS / racking / labels / commodity)`);

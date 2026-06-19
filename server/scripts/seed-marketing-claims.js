// Seeds products.marketing_claims for the brands we ship today.
// Idempotent — only sets the column when it's empty / null. Re-run any time
// to add new SKUs without touching existing ones.
//
// Adds a `--force` flag to overwrite existing claims (useful when copy changes).
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
// Add new entries here as the catalogue grows; no code changes required.
// ────────────────────────────────────────────────────────────────────────────
const CLAIMS = [
  // ── Fronius GEN24 / Symo / Verto Plus (hybrid inverters) ───────────────
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

  // ── Fronius non-Plus (grid-tied only, license-upgradable) ──────────────
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

  // ── Victron MultiPlus II (off-grid / hybrid) ───────────────────────────
  {
    skuPattern: /^VIC-INV-.*MPII/,
    claims: {
      headline: 'Dutch engineering for off-grid and hybrid systems.',
      badges: ['MADE IN NETHERLANDS', 'OFF-GRID HERITAGE', '5-YR WARRANTY', 'AC + DC COUPLED'],
      bullets: [
        { claim: 'Designed in the Netherlands by Victron Energy', detail: 'Specialists in off-grid + marine power for 40 years' },
        { claim: 'Works AC-coupled OR DC-coupled — total flexibility for your install', detail: '' },
        { claim: 'Whole-home backup + generator integration', detail: 'AGS (Automatic Generator Start) for hybrid sites' },
        { claim: 'VRM Portal monitoring + Cerbo GX hub', detail: 'Best-in-class off-grid system control' },
        { claim: '5-year manufacturer warranty', detail: '' },
        { claim: 'Stackable / parallelable for higher loads', detail: 'Up to 15 kVA per inverter; multi-unit installs scale further' },
      ],
      comparison: {
        origin: 'Made in Netherlands',
        warranty_yrs: 5,
        peak_efficiency_pct: 96.5,
        backup_capability: 'Whole-home + generator',
        vpp_ready: 'Compatible',
      },
      manufacturer_blurb: 'Founded 1975, Dutch specialist in off-grid and back-up power systems; used by NGOs, marine, military, RV.',
    },
  },

  // ── BYD Battery-Box HVM (high-voltage modular) ─────────────────────────
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

  // ── BYD Battery-Box HVS (smaller modular) ───────────────────────────────
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

  // ── Fronius Reserva ─────────────────────────────────────────────────────
  {
    skuPattern: /^FRN-BAT-.*RSV/,
    claims: {
      headline: 'Austrian-engineered battery, perfectly matched to your Fronius inverter.',
      badges: ['LiFePO4 SAFE', 'AUSTRIAN ENGINEERING', '70% @ YR 10', '10-YR WARRANTY'],
      bullets: [
        { claim: 'LiFePO4 chemistry — safest residential battery chemistry', detail: 'Cobalt-free, thermally stable' },
        { claim: '70% usable capacity guaranteed at Year 10', detail: 'Higher than industry-typical 30-50%' },
        { claim: 'Native Fronius integration — single ecosystem, single warranty contact', detail: '' },
        { claim: 'Modular — start small, add modules later up to 15.8 kWh per tower', detail: '' },
        { claim: '10-year manufacturer warranty', detail: '' },
      ],
      comparison: {
        chemistry: 'LiFePO4 (cobalt-free)',
        year10_capacity_pct: 70,
        cycle_life: 6000,
        scalability: 'Up to 15.8 kWh per tower',
        ip_rating: 'IP65',
        warranty_yrs: 10,
      },
      manufacturer_blurb: 'Designed in Austria by Fronius. Single-vendor inverter + battery ecosystem; single warranty contact.',
    },
  },
];

// Industry-typical / "competitor" reference values used on the comparison
// table when the page renders. These are page-level constants — not per-SKU.
// They're stored in app_settings (or seeded into engine_constants if you have
// a centralized place). For now we just write them to a known key so the page
// template can read them at render time.
const COMPETITOR_REFERENCE = {
  battery: {
    chemistry: 'NMC (higher fire risk)',
    year10_capacity_pct: '30 - 50',
    cycle_life: '3,000 - 5,000',
    scalability: 'Often fixed at install',
    ip_rating: 'IP54 typical',
    warranty_yrs: '5 - 7',
  },
  inverter: {
    origin: 'Generic offshore',
    warranty_yrs: '5 - 10',
    peak_efficiency_pct: '95 - 96',
    backup_capability: 'PV Point only',
    vpp_ready: 'No',
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Apply
// ────────────────────────────────────────────────────────────────────────────
const { data: products } = await sb.from('products')
  .select('id, sku, brand, name, marketing_claims');

console.log(`Loaded ${products?.length || 0} products.`);

let updated = 0, skipped = 0, unmatched = 0;
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
    console.log(`  ✓ ${p.sku.padEnd(28)}  ${p.brand}`);
    updated++;
  }
}

// Also seed the competitor reference into app_settings.
// Skip if you don't have an app_settings table — the page template will use
// inline constants instead.
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
console.log(`  Unmatched (no claims):  ${unmatched}`);

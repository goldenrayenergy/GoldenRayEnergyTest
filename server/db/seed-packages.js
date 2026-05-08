// Seed 5 realistic NZ residential solar packages from the catalogue.
//
// Run:  node server/db/seed-packages.js
//
// Idempotent: looks up packages by slug — if it already exists, refreshes
// metadata and replaces its items. Looks products up by SKU; missing SKUs
// log a warning but don't abort.
//
// Prices ("from_price_override"):
//   The computed sum of catalogue items is parts only (no install labour,
//   permits, scaffolding, electrician site time). NZ residential solar
//   typically adds $2-4k of labour/site costs on top of parts. We use
//   from_price_override to set the customer-facing "From $X" headline at
//   realistic NZ market levels — roughly aligned with Harrisons / Solar
//   Shop / SunSolar pricing for similar systems.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);

// ── Package definitions ────────────────────────────────────────────────────
//
// Each entry is the package metadata + a list of { sku, qty } items.
// SKUs come from Solar prices 2.xlsx (the master catalogue) — verified
// against the live products table on this branch.

const PACKAGES = [
  {
    slug: 'starter-3kw',
    name: 'Starter 3 kW',
    tier: 'starter',
    badge: null,
    description: 'Compact 3 kW system for apartments, granny flats, or small 1-2 person households. Grid-tied, hybrid-ready inverter so you can add a battery later.',
    long_description:
      'Best for: 1-2 person homes with $150-220 monthly bills.\n\n' +
      'What\'s inside: 8× REC TP4 370W panels (proven NZ-grade module with 25-year power warranty), Fronius Primo 3.0 GEN24 single-phase hybrid inverter (battery upgradable in future), Fronius smart meter for self-consumption monitoring, full DC isolation and surge protection, Hopergy NZ-tested racking.\n\n' +
      'Performance: ~4,200 kWh/year in Auckland (north-facing roof, 25° pitch). Average payback 7-9 years.',
    hero_image_url: 'https://images.unsplash.com/photo-1509391366360-2e959784a276?w=1200&h=800&fit=crop&auto=format&q=80',
    system_kw: 2.96,
    battery_kwh: null,
    estimated_annual_savings: 1200,
    estimated_payback_years: 7.8,
    from_price_override: 8990,
    sort_order: 10,
    prefill: { installation_type: 'residential', battery_option: 'without-battery', estimated_monthly_bill: 200 },
    items: [
      { sku: '301066', qty: 8 },   // REC 370W panel × 8 = 2.96 kW
      { sku: '301075', qty: 1 },   // Fronius Primo 3.0 GEN24
      { sku: '300554', qty: 1 },   // Fronius 63A-1 Smart Meter
      { sku: '301076', qty: 1 },   // DC Isolator
      { sku: '311348', qty: 2 },   // MC4 in-line fuse
      { sku: '300285', qty: 8 },   // L-foot bracket × 8 (one per panel)
      { sku: '300849', qty: 4 },   // End clamps × 4
      { sku: '300848', qty: 12 },  // Inner clamps × 12
      { sku: '311179', qty: 2 },   // 4700mm rail × 2
    ],
  },

  {
    slug: 'standard-5kw',
    name: 'Standard 5 kW',
    tier: 'standard',
    badge: 'Most Popular',
    description: 'The right system for most NZ family homes. 12× high-yield Phono panels paired with the proven Fronius Primo 5.0 GEN24 hybrid inverter — battery-ready for the future.',
    long_description:
      'Best for: 3-4 bedroom family homes with $250-350 monthly bills.\n\n' +
      'What\'s inside: 12× Phono Solar 595W Draco panels (premium high-output module, 30-year performance warranty), Fronius Primo 5.0 GEN24 single-phase hybrid inverter (Austrian-engineered, 10-year warranty, hybrid upgrade keeps your options open), Fronius smart meter for live solar feed-in tracking, NZ-compliant DC isolation and PV fuses, Hopergy SAA-approved racking.\n\n' +
      'Performance: ~10,500 kWh/year typical Auckland install. Annual bill drops by 60-80%. Standard payback 6-8 years.\n\n' +
      'Why this is the most-installed package: it covers the typical NZ 3-4 BR home\'s daytime use, banks credits for evening use, and the 5.0 inverter has plenty of headroom if you add an EV charger or battery in 2-3 years.',
    hero_image_url: 'https://images.unsplash.com/photo-1611365892117-00ac5ef43c90?w=1200&h=800&fit=crop&auto=format&q=80',
    system_kw: 7.14,    // 12 × 595W = 7.14 kW DC (slightly oversized to a 5kW inverter, NZ-standard)
    battery_kwh: null,
    estimated_annual_savings: 2200,
    estimated_payback_years: 6.5,
    from_price_override: 13990,
    sort_order: 20,
    prefill: { installation_type: 'residential', battery_option: 'without-battery', estimated_monthly_bill: 280 },
    items: [
      { sku: '311306', qty: 12 },  // Phono Solar 595W × 12 = 7.14 kW DC
      { sku: '301010', qty: 1 },   // Fronius Primo 5.0 GEN24
      { sku: '300554', qty: 1 },   // Fronius 63A-1 Smart Meter
      { sku: '301076', qty: 1 },   // DC Isolator
      { sku: '311348', qty: 2 },   // MC4 fuses
      { sku: '300285', qty: 12 },  // L-feet
      { sku: '300849', qty: 4 },   // End clamps
      { sku: '300848', qty: 20 },  // Inner clamps
      { sku: '311179', qty: 3 },   // Rails
    ],
  },

  {
    slug: 'premium-6kw-allblack',
    name: 'Premium 6 kW All-Black',
    tier: 'premium',
    badge: 'Best Aesthetic',
    description: 'Sleek all-black panel system for design-conscious homeowners. 14× Phono Quasar all-black panels with the Fronius Primo 6.0 GEN24 — strong daytime production and a clean roofline.',
    long_description:
      'Best for: larger family homes ($300-400 monthly bills), homeowners who care about how the system looks from the street, or houses with prominent north-facing roofs.\n\n' +
      'What\'s inside: 14× Phono Solar 475W Quasar Clear-Back-Contact ALL-BLACK panels (no visible grid lines, premium aesthetic, 25-year power warranty), Fronius Primo 6.0 GEN24 single-phase hybrid inverter, Fronius smart meter, premium black Hopergy racking and clamps, NZ-compliant DC components.\n\n' +
      'Performance: ~9,800 kWh/year typical Auckland install. Strong fit for households starting EV charging.\n\n' +
      'Hybrid-ready: add Fronius Reserva or Tesla Powerwall in the future without replacing the inverter.',
    hero_image_url: 'https://images.unsplash.com/photo-1605980776566-0486c3ac7617?w=1200&h=800&fit=crop&auto=format&q=80',
    system_kw: 6.65,
    battery_kwh: null,
    estimated_annual_savings: 2400,
    estimated_payback_years: 7.2,
    from_price_override: 16490,
    sort_order: 30,
    prefill: { installation_type: 'residential', battery_option: 'without-battery', estimated_monthly_bill: 350 },
    items: [
      { sku: '311345', qty: 14 },  // Phono 475W all-black × 14 = 6.65 kW DC
      { sku: '301011', qty: 1 },   // Fronius Primo 6.0 GEN24
      { sku: '300554', qty: 1 },   // Smart meter
      { sku: '301076', qty: 1 },   // DC Isolator
      { sku: '311348', qty: 2 },   // MC4 fuses
      { sku: '300285', qty: 14 },  // L-feet (black variant ideally — using available BLACK SKU)
      { sku: '300849', qty: 4 },   // End clamps
      { sku: '300848', qty: 24 },  // Inner clamps
      { sku: '311178', qty: 3 },   // Black rails
    ],
  },

  {
    slug: 'premium-6kw-battery',
    name: 'Premium 6 kW + Battery',
    tier: 'premium-battery',
    badge: 'Best Value (with backup)',
    description: 'Solar + battery for energy independence and overnight backup. Fronius Primo 6.0 GEN24 paired with a 10 kWh BYD HVS battery stack — keep the lights on when the grid drops.',
    long_description:
      'Best for: families that want overnight backup, frequent power-cut areas, customers preparing for EV ownership.\n\n' +
      'What\'s inside: 12× Phono Solar 595W Draco panels (7.14 kW DC), Fronius Primo 6.0 GEN24 single-phase hybrid inverter, BYD Battery Box HVS modules (4× 2.56 kWh = 10.2 kWh stack), Fronius smart meter, full DC isolation, Hopergy racking.\n\n' +
      'Performance: ~11,200 kWh/year solar generation, ~85% self-consumption with the battery. Annual bill drops 80-90% for typical households. Backup keeps essentials running for 8-12 hours during a grid outage.\n\n' +
      'Payback: 8-10 years (longer than solar-only, but you get blackout backup the whole time).',
    hero_image_url: 'https://images.unsplash.com/photo-1559302504-64aae6ca6b6d?w=1200&h=800&fit=crop&auto=format&q=80',
    system_kw: 7.14,
    battery_kwh: 10.24,
    estimated_annual_savings: 3000,
    estimated_payback_years: 9.0,
    from_price_override: 26990,
    sort_order: 40,
    prefill: { installation_type: 'residential', battery_option: 'with-battery', estimated_monthly_bill: 400 },
    items: [
      { sku: '311306', qty: 12 },  // Phono 595W × 12
      { sku: '301011', qty: 1 },   // Fronius Primo 6.0 GEN24
      { sku: '301009', qty: 4 },   // BYD HVS 2.56 kWh × 4 = 10.24 kWh
      { sku: '300554', qty: 1 },   // Smart meter
      { sku: '301076', qty: 1 },   // DC Isolator
      { sku: '311348', qty: 2 },   // MC4 fuses
      { sku: '300285', qty: 12 },  // L-feet
      { sku: '300849', qty: 4 },   // End clamps
      { sku: '300848', qty: 20 },  // Inner clamps
      { sku: '311179', qty: 3 },   // Rails
    ],
  },

  {
    slug: 'whole-home-10kw-battery',
    name: 'Whole-Home 10 kW + Battery',
    tier: 'whole-home',
    badge: 'Future-Proof',
    description: 'Three-phase whole-home solution with substantial 10 kW solar and Freedom Won 10 kWh lithium battery. Built for large homes, EV charging, and serious energy independence.',
    long_description:
      'Best for: 5+ bedroom homes, families with 1-2 EVs, customers wanting maximum self-sufficiency, properties with three-phase supply.\n\n' +
      'What\'s inside: 22× Phono Solar 595W Draco panels (13.09 kW DC, oversized to a 10 kW inverter for maximum yield), Fronius SYMO 10.0 GEN24 three-phase hybrid inverter (top-tier German engineering), Freedom Won LiTE2 Home 10/8 lithium battery (10 kWh storage, 8 kWh usable, 10-year warranty), three-phase Fronius smart meter, full DC isolation, Hopergy racking.\n\n' +
      'Performance: ~17,500 kWh/year solar generation, peak 90%+ self-consumption with the battery. Most large homes go effectively off-bill (only fixed charges remain). Backup keeps an entire household running for 12-18 hours.\n\n' +
      'Future-proof: the SYMO inverter and three-phase battery setup support adding EV charging, additional battery capacity, or hot-water diversion without re-engineering the system.',
    hero_image_url: 'https://images.unsplash.com/photo-1542665952-14513db15293?w=1200&h=800&fit=crop&auto=format&q=80',
    system_kw: 13.09,
    battery_kwh: 10.0,
    estimated_annual_savings: 4200,
    estimated_payback_years: 8.5,
    from_price_override: 39990,
    sort_order: 50,
    prefill: { installation_type: 'residential', battery_option: 'with-battery', estimated_monthly_bill: 550 },
    items: [
      { sku: '311306', qty: 22 },  // Phono 595W × 22 = 13.09 kW DC
      { sku: '311249', qty: 1 },   // Fronius SYMO 10.0 GEN24 (three-phase)
      { sku: '311274', qty: 1 },   // Freedom Won LiTE2 Home 10/8
      { sku: '300555', qty: 1 },   // Three-phase smart meter
      { sku: '301076', qty: 2 },   // DC Isolators × 2
      { sku: '311348', qty: 4 },   // MC4 fuses
      { sku: '300285', qty: 22 },  // L-feet
      { sku: '300849', qty: 4 },   // End clamps
      { sku: '300848', qty: 40 },  // Inner clamps
      { sku: '311179', qty: 5 },   // Rails
    ],
  },
];

// ── Insertion logic ────────────────────────────────────────────────────────

async function findProductIdsBySku(skus) {
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name')
    .in('sku', skus);
  if (error) throw error;
  const map = new Map();
  for (const p of data || []) map.set(p.sku, p);
  return map;
}

async function upsertPackage(pkg) {
  // Look up product IDs in one query
  const skus = [...new Set(pkg.items.map(i => i.sku))];
  const productMap = await findProductIdsBySku(skus);

  // Warn on missing products but proceed (skip those items)
  const missing = skus.filter(s => !productMap.has(s));
  if (missing.length) {
    console.warn(`  ⚠ ${pkg.slug}: ${missing.length} SKUs not found in products table — skipping: ${missing.join(', ')}`);
  }

  const itemsResolved = pkg.items
    .filter(i => productMap.has(i.sku))
    .map((i, idx) => ({
      product_id: productMap.get(i.sku).id,
      qty: i.qty,
      position: idx,
    }));

  if (itemsResolved.length === 0) {
    console.error(`  ✗ ${pkg.slug}: no resolved items, skipping package entirely`);
    return null;
  }

  // Upsert package metadata by slug
  const { items, ...metadata } = pkg;
  const { data: existing } = await supabase
    .from('packages')
    .select('id')
    .eq('slug', pkg.slug)
    .maybeSingle();

  let packageId;
  if (existing) {
    const { data, error } = await supabase
      .from('packages')
      .update({ ...metadata, is_active: true })
      .eq('id', existing.id)
      .select('id')
      .single();
    if (error) throw error;
    packageId = data.id;
    // Wipe existing items (we're replacing them)
    await supabase.from('package_items').delete().eq('package_id', packageId);
  } else {
    const { data, error } = await supabase
      .from('packages')
      .insert({ ...metadata, is_active: true })
      .select('id')
      .single();
    if (error) throw error;
    packageId = data.id;
  }

  // Insert items
  const itemRows = itemsResolved.map(i => ({ package_id: packageId, ...i }));
  const { error: itemErr } = await supabase.from('package_items').insert(itemRows);
  if (itemErr) throw itemErr;

  return { id: packageId, slug: pkg.slug, items: itemsResolved.length };
}

async function main() {
  console.log(`Seeding ${PACKAGES.length} packages...\n`);
  let ok = 0, fail = 0;
  for (const pkg of PACKAGES) {
    try {
      const result = await upsertPackage(pkg);
      if (result) {
        console.log(`  ✓ ${result.slug.padEnd(28)} ${String(result.items).padStart(2)} items · From $${pkg.from_price_override.toLocaleString('en-NZ')}`);
        ok++;
      } else {
        fail++;
      }
    } catch (e) {
      console.error(`  ✗ ${pkg.slug}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\nDone: ${ok} succeeded, ${fail} failed.`);
}

main().catch(e => { console.error(e); process.exit(1); });

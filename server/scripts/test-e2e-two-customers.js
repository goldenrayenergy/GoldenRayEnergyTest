// ────────────────────────────────────────────────────────────────────────────
// End-to-end test for Option 4c (b): server-side composition against 2 real
// customers with bill analyses on file. Exercises the same code path that
// POST /pm/quotes runs internally.
//
// Run: node server/scripts/test-e2e-two-customers.js
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { loadCatalogueFromDb } = await import(
  '../services/pm/proposalEngine/catalogue/dbLoader.js');
const { composeThreeTiers, topLevelSystemFromTier } = await import(
  '../services/pm/proposalEngine/threeTierComposer.js');
const { REGIONS, BMS_RULES, COMPATIBILITY, TIER_STRIP_SETTINGS } = await import(
  '../services/pm/proposalEngine/data/engineeringRules.js');
const { runEngine } = await import(
  '../services/pm/proposalEngine/index.js');

// Find the 2 most-recent bill analyses with usable recommendations
const { data: analyses } = await supabase
  .from('bill_analyses')
  .select(`id, contact_id, retailer, plan_name,
           annual_kwh, annual_spend_nzd, effective_rate_nzd,
           period_start, period_end, months_covered,
           region, postcode, status, created_at,
           recommended_system_kw, recommended_battery_kwh`)
  .gt('recommended_system_kw', 0)
  .order('created_at', { ascending: false })
  .limit(8);

if (!analyses?.length) { console.error('No bill analyses on file.'); process.exit(1); }

// Take the most recent 2 from different contacts
const seenContacts = new Set();
const picked = [];
for (const a of analyses) {
  if (!seenContacts.has(a.contact_id) && picked.length < 2) {
    seenContacts.add(a.contact_id);
    picked.push(a);
  }
}
if (picked.length < 2) {
  console.error('Need at least 2 distinct contacts with bill analyses.'); process.exit(1);
}

const catalogue = await loadCatalogueFromDb(supabase);
console.log(`Catalogue loaded: ${Object.keys(catalogue.PANELS).length} panels, ` +
            `${Object.keys(catalogue.INVERTERS).length} inverters, ` +
            `${Object.keys(catalogue.BATTERIES).length} batteries.\n`);

const REGION_MAP = {
  auckland: 'auckland_vector', counties: 'counties_franklin', franklin: 'counties_franklin',
  northland: 'northland', waikato: 'waikato', bay_of_plenty: 'bop_tauranga',
  bop: 'bop_tauranga', tauranga: 'bop_tauranga', taranaki: 'taranaki',
  wellington: 'wellington', canterbury: 'canterbury', otago: 'otago_queenstown',
  queenstown: 'otago_queenstown', southland: 'otago_queenstown',
};
const mapRegion = (raw) => {
  if (!raw) return null;
  const k = String(raw).toLowerCase().replace(/[^a-z]+/g, '_');
  for (const [n, key] of Object.entries(REGION_MAP)) if (k.includes(n)) return key;
  return null;
};

let bugCount = 0;
function bug(label) { console.log(`    🐛 BUG: ${label}`); bugCount++; }
function ok(label)  { console.log(`    ✓ ${label}`); }

for (const [idx, analysis] of picked.entries()) {
  const { data: contact } = await supabase
    .from('contacts').select('id, name, location, street, suburb, city, postcode')
    .eq('id', analysis.contact_id).maybeSingle();

  console.log(`\n══════════════════════════════════════════════════════════════════`);
  console.log(` CUSTOMER ${idx + 1}: ${contact?.name || '(unknown)'}`);
  console.log(`══════════════════════════════════════════════════════════════════`);
  console.log(`  Annual usage:   ${analysis.annual_kwh} kWh   /   $${analysis.annual_spend_nzd}`);
  console.log(`  Recommended:    ${analysis.recommended_system_kw} kWp + ${analysis.recommended_battery_kwh} kWh battery`);
  console.log(`  Region:         ${analysis.region}   →   ${mapRegion(analysis.region) || 'auckland_vector'}`);
  console.log(`  Bill period:    ${analysis.period_start?.slice(0,10)} → ${analysis.period_end?.slice(0,10)} (${analysis.months_covered} months)`);

  const regionKey = mapRegion(analysis.region) || mapRegion(contact?.location) || 'auckland_vector';
  const region = REGIONS[regionKey];

  for (const sizeMode of ['same_size', 'tiered_sizes']) {
    console.log(`\n  ── Mode: ${sizeMode} ──`);
    const out = composeThreeTiers({
      billAnalysis: analysis, phase: 1, region, sizeMode,
      catalogue, COMPATIBILITY, BMS_RULES, TIER_STRIP_SETTINGS,
    });

    // Per-tier print + assertions
    for (const [i, t] of out.tiers.entries()) {
      const p = t.system_overrides.panel;
      const inv = t.system_overrides.inverter;
      const bat = t.system_overrides.battery;
      const sd = t.system_overrides.string_design;
      const tag = t.is_recommended ? '★' : ' ';
      console.log(`    ${tag} Tier ${i+1}: ${t.label}`);
      console.log(`         Panel    ${p?.sku ?? 'NULL'} × ${p?.count ?? 'NULL'}`);
      console.log(`         Inverter ${inv?.sku ?? 'NULL'}`);
      console.log(`         Battery  ${bat ? `${bat.sku} × ${bat.module_count} = ${bat.kwh}kWh` : '(none)'}`);
      console.log(`         Strings  ${sd ? `${sd.string_count} × ${sd.panels_per_string}${sd.asymmetric ? ` + 1 × ${sd.asymmetric_string?.panels_per_string}` : ''} (${sd.topology})` : '(none)'}`);
      console.log(`         Source   ${t.source}   Price $${t.pricing.customer_price_inc_gst}`);
      if (t.engine_warnings.length > 0) {
        for (const w of t.engine_warnings) console.log(`         ⚠ ${w.code}: ${w.message.slice(0, 100)}`);
      }

      // Critical assertions
      if (!p?.sku)   bug(`tier ${i+1} panel SKU is null`);
      if (!inv?.sku) bug(`tier ${i+1} inverter SKU is null`);
      if (i > 0 && !bat) bug(`tier ${i+1} should have battery (recommended kwh > 0)`);
      if (p?.count == null || p.count <= 0) bug(`tier ${i+1} panel count is invalid (${p?.count})`);
    }

    // Top-level system population
    const topLevel = topLevelSystemFromTier(out.tiers[out.recommended_index], { phase: 1, smart_meter: { sku: null, phase: 1 } });
    if (!topLevel.panel?.sku)    bug(`top-level panel.sku is null after compose`);
    if (!topLevel.inverter?.sku) bug(`top-level inverter.sku is null after compose`);
    else ok(`top-level system fully populated from tier ${out.recommended_index+1}`);

    // Now: build a FULL spec like POST /pm/quotes would and run the engine
    // Simulate the rep having entered customer fields. In real flow the
    // create endpoint allows partial spec; PATCH /spec enforces.
    const fullSpec = {
      customer: {
        full_name: contact?.name || 'Test Customer',
        email: `test+${idx}@example.com`,
        phone: '021 000 0000',
        address: {
          street: contact?.street || '1 Test St',
          suburb: contact?.suburb || 'Test Suburb',
          city:   contact?.city   || 'Auckland',
          postcode: contact?.postcode || '1010',
          region: regionKey,
        },
        icp_number: '0000000000XX0',
        property_ownership: 'own',
      },
      bills: { manual_entry: { annual_kwh: analysis.annual_kwh,
                                annual_spend: analysis.annual_spend_nzd,
                                retailer: analysis.retailer,
                                variable_rate_per_kwh_incl_gst: 0.23,
                                daily_fixed_charge_incl_gst: 2.50, buyback_rate: 0.09 } },
      system: topLevel,
      pricing: { customer_price_inc_gst: 45000, stage: 'stage_1_estimate', final_mode: true,
                  discount: { applied_nzd: 0, owner_approved: false, reason: null } },
      preferences: { backup_priority: 'whole_home_essentials' },
      tiers: out.tiers,
      tier_strip: { size_mode: sizeMode },
    };
    const engineResult = await runEngine(fullSpec, { catalogue });

    if (!engineResult.ok) {
      bug(`runEngine returned ok=false: ${JSON.stringify(engineResult.config_errors?.slice(0, 3) || engineResult)}`);
    } else {
      ok(`runEngine accepted the spec (config_valid=${engineResult.config_valid}, is_multi_tier=${engineResult.is_multi_tier})`);
      if (engineResult.is_multi_tier) {
        for (const [ti, tr] of engineResult.tiers.entries()) {
          if (!tr.config_valid) bug(`tier ${ti+1} engine config_valid=false: ${JSON.stringify(tr.config_errors)}`);
          if (tr.engineering?.hard_fails?.length > 0) {
            for (const hf of tr.engineering.hard_fails) {
              console.log(`         ⚠⚠ Tier ${ti+1} engineering hard-fail: ${hf.rule}: ${hf.message.slice(0, 80)}`);
            }
          }
        }
      }
    }
  }
}

console.log(`\n══════════════════════════════════════════════════════════════════`);
console.log(` SUMMARY: ${bugCount === 0 ? '✅ NO BUGS' : `🐛 ${bugCount} BUGS FOUND`}`);
console.log(`══════════════════════════════════════════════════════════════════\n`);
process.exit(bugCount === 0 ? 0 : 1);

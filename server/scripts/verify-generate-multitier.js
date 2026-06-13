// ────────────────────────────────────────────────────────────────────────────
// Reproduces the EXACT code path the /generate endpoint uses, against an
// already-existing multi-tier quote in the DB. Verifies that the multi-tier
// gating + render works without going through HTTP auth.
//
// Usage: node server/scripts/verify-generate-multitier.js PR-Y-2026-005
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const quoteRef = process.argv[2] || 'PR-Y-2026-005';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const { loadCatalogueFromDb } = await import('../services/pm/proposalEngine/catalogue/dbLoader.js');
const { runEngine } = await import('../services/pm/proposalEngine/index.js');
const { runThreeScenarios } = await import('../services/pm/proposalEngine/financialModel.js');
const { renderProposalPdfs } = await import('../services/pm/proposalEngine/renderPdf.js');

console.log(`Looking up quote ${quoteRef}…`);
const { data: q } = await sb.from('quotes').select('*').eq('quote_ref', quoteRef).maybeSingle();
if (!q) { console.error(`Quote ${quoteRef} not found.`); process.exit(1); }
const { data: v } = await sb.from('quote_versions').select('*').eq('id', q.current_version_id).maybeSingle();
console.log(`  ${quoteRef} status=${q.status} version=${v?.version_number} is_multi_tier=${Array.isArray(v?.spec?.tiers) && v.spec.tiers.length > 0}`);

console.log('\nLoading catalogue + running engine…');
const catalogue = await loadCatalogueFromDb(sb);
const engine = await runEngine(v.spec, { catalogue });
console.log(`  engine.ok=${engine.ok}  config_valid=${engine.config_valid}  is_multi_tier=${engine.is_multi_tier}`);
if (engine.is_multi_tier) {
  console.log(`  engine.can_ship_all=${engine.can_ship_all}`);
  engine.tiers.forEach(t => console.log(`    ${t.is_recommended ? '★' : ' '} ${t.label}: can_ship=${t.can_ship} margin=${t.cost?.totals?.project_margin_pct?.toFixed(1)}% LIST=$${t.cost?.totals?.total_list_inc_gst}`));
} else {
  console.log(`  engine.can_ship=${engine.can_ship}`);
}

if (!engine.ok) {
  console.error('Engine refused config:', JSON.stringify(engine.config_errors, null, 2));
  process.exit(1);
}

// ── Same gate /generate now uses ──
const canShipEntire = engine.is_multi_tier ? engine.can_ship_all : engine.can_ship;
console.log(`\ncanShipEntire = ${canShipEntire}`);
if (!canShipEntire) {
  console.error('Quote cannot ship. block_reasons:', engine.block_reasons);
  process.exit(1);
}

// ── Build scenarios same way /generate does ──
let singleTierScenarios = null;
let tierScenarios = null;
if (engine.is_multi_tier) {
  tierScenarios = engine.tiers.map((t, i) => {
    const tierSpec = v.spec.tiers?.[i] || {};
    const effective = {
      ...v.spec,
      system: { ...v.spec.system, ...(tierSpec.system_overrides || {}) },
      pricing: tierSpec.pricing || v.spec.pricing,
      cost_overrides: tierSpec.cost_overrides || v.spec.cost_overrides,
    };
    return runThreeScenarios(effective, t.cost, {}, { catalogue });
  });
  console.log(`Built ${tierScenarios.length} tier scenario bundles.`);
} else {
  singleTierScenarios = runThreeScenarios(v.spec, engine.cost, {}, { catalogue });
  console.log(`Built single-tier scenarios.`);
}

console.log('\nCalling renderProposalPdfs (no actual upload)…');
const rendered = await renderProposalPdfs({
  spec: v.spec,
  engineResult: engine,
  scenarios: singleTierScenarios,
  tierScenarios,
  options: { quote_ref: q.quote_ref, quote_date: new Date().toISOString() },
});
console.log(`  customer_pdf bytes:        ${rendered.customer_pdf.length}`);
console.log(`  sales_console_pdf bytes:   ${rendered.sales_console_pdf.length}`);
console.log(`  used_fallback (no Puppeteer): ${rendered.used_fallback}`);
console.log(`  is_multi_tier:             ${rendered.is_multi_tier}`);
console.log(`  render_version:            ${rendered.render_version}`);

console.log('\n✅ Multi-tier generate path works end-to-end.');

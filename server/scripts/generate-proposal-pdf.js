// ────────────────────────────────────────────────────────────────────────────
// End-to-end CLI: spec.json → customer PDF + sales console PDF
//
// Run:
//   node server/scripts/generate-proposal-pdf.js <path-to-spec.json> [out-dir]
//
// Example:
//   node server/scripts/generate-proposal-pdf.js mockups/3-quote-sample-krishna/krishna-spec.json
//
// If no spec file is supplied, falls back to the Krishna spec baked in
// for smoke testing. Useful before the UI lands at Day 6.
// ────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runEngine } from '../services/pm/proposalEngine/index.js';
import { runThreeScenarios } from '../services/pm/proposalEngine/financialModel.js';
import { renderProposalPdfs } from '../services/pm/proposalEngine/renderPdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Built-in Krishna spec for smoke testing without a spec file ───────────
const KRISHNA_SPEC = {
  customer: {
    full_name: 'Mr Naga Sai Krishna Avala',
    email: 'krishna.avala@example.com',
    phone: '+64 21 000 0000',
    address: { street: '6 Woodacre Street', suburb: 'Flat Bush', city: 'Auckland', postcode: '2019', region: 'auckland_vector' },
    icp_number: '1002175017LCB5D',
    property_ownership: 'mortgaged',
  },
  bills: { manual_entry: { annual_kwh: 13044, annual_spend: 3825, retailer: 'Mercury',
                           variable_rate_per_kwh_incl_gst: 0.223, daily_fixed_charge_incl_gst: 2.52, buyback_rate: 0.09 }},
  system: {
    panel: { sku: 'PHN-PNL-595-DRC', count: 24 },
    inverter: { sku: 'FRN-INV-100-G24P-1P' },
    battery: { sku: 'BYD-BAT-276-HVM', module_count: 5 },
    smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
    string_topology: 'parallel',
    string_design: { panels_per_string: 6, string_count: 4 },
    cable_run_metres_estimate: 24,
    phase: 1,
  },
  pricing: { customer_price_inc_gst: 40500, stage: 'stage_1_estimate', final_mode: true,
             discount: { applied_nzd: 0, owner_approved: false, reason: null }},
  preferences: { backup_priority: 'whole_home_essentials', decision_makers: 'solo',
                 financing: { choice: 'cash' }},
};

async function main() {
  const specArg = process.argv[2];
  const outDirArg = process.argv[3];

  let spec, source;
  if (specArg) {
    if (!existsSync(specArg)) {
      console.error(`✗ Spec file not found: ${specArg}`);
      process.exit(1);
    }
    spec = JSON.parse(readFileSync(specArg, 'utf8'));
    source = path.basename(specArg);
  } else {
    spec = KRISHNA_SPEC;
    source = '(built-in Krishna spec)';
  }

  const outDir = outDirArg
    ? path.resolve(outDirArg)
    : path.resolve(__dirname, '..', '..', 'mockups', '3-quote-sample-krishna');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  console.log('━'.repeat(80));
  console.log('  Proposal generator — end-to-end');
  console.log('━'.repeat(80));
  console.log(`  Spec source:  ${source}`);
  console.log(`  Output dir:   ${outDir}`);
  console.log();

  // 1. Run engine
  const t0 = Date.now();
  const result = runEngine(spec);
  if (!result.ok) {
    console.error('✗ Engine refused spec:');
    if (result.config_errors) for (const e of result.config_errors) console.error(`    ${e.path}: ${e.message}`);
    if (result.bom_error) console.error(`    BoM error: ${result.bom_error}`);
    if (result.cost_error) console.error(`    Cost error: ${result.cost_error}`);
    process.exit(1);
  }

  if (!result.can_ship) {
    console.warn('⚠ Engine output flagged can_ship=false. Reasons:');
    for (const r of result.block_reasons) console.warn(`    • ${r}`);
    console.warn('  Continuing with render — sales console will surface the block.');
  } else {
    console.log(`✓ Engine cleared: margin ${result.cost.totals.project_margin_pct.toFixed(1)}% (${result.cost.margin_floor_status})`);
  }

  // 2. Three-scenario projection
  const scenarios = runThreeScenarios(spec, result.cost);
  console.log(`✓ Scenarios: Conservative $${Math.round(scenarios.summary[0].lifetime_net_savings).toLocaleString()} · Expected $${Math.round(scenarios.summary[1].lifetime_net_savings).toLocaleString()} · Optimistic $${Math.round(scenarios.summary[2].lifetime_net_savings).toLocaleString()}`);

  // 3. Render PDFs
  const rendered = await renderProposalPdfs({
    spec, costResult: result.cost, scenarios,
    engineering: result.engineering, bom: result.bom,
    options: { quote_date: new Date().toISOString() },
  });

  const customerPdfPath = path.join(outDir, `${rendered.quote_ref}-customer.pdf`);
  const salesPdfPath = path.join(outDir, `${rendered.quote_ref}-sales-console.pdf`);
  const customerHtmlPath = path.join(outDir, `${rendered.quote_ref}-customer.html`);
  const salesHtmlPath = path.join(outDir, `${rendered.quote_ref}-sales-console.html`);

  writeFileSync(customerPdfPath, rendered.customer_pdf);
  writeFileSync(salesPdfPath, rendered.sales_console_pdf);
  writeFileSync(customerHtmlPath, rendered.customer_html, 'utf8');
  writeFileSync(salesHtmlPath, rendered.sales_console_html, 'utf8');

  console.log();
  console.log(`✓ Customer PDF:   ${customerPdfPath} (${(rendered.customer_pdf.length / 1024).toFixed(1)} KB)`);
  console.log(`✓ Sales console:  ${salesPdfPath} (${(rendered.sales_console_pdf.length / 1024).toFixed(1)} KB)`);
  console.log(`✓ Customer HTML:  ${customerHtmlPath}`);
  console.log(`✓ Sales HTML:     ${salesHtmlPath}`);
  console.log();
  console.log(`  Quote ref:     ${rendered.quote_ref}`);
  console.log(`  Spec hash:     ${(rendered.spec_hash || '').slice(0, 16) || 'n/a'}…`);
  console.log(`  Used fallback: ${rendered.used_fallback ? 'yes (HTML buffer in PDF slot)' : 'no — real PDF'}`);
  console.log(`  Elapsed:       ${Date.now() - t0} ms`);
  console.log();

  if (rendered.used_fallback) {
    console.warn('⚠ Puppeteer fell back to HTML — open the .html files to verify content.');
    console.warn('  To get real PDFs, install puppeteer: `cd server && npm install puppeteer`');
  } else {
    console.log('  Open the customer PDF to review what your team would email out.');
  }
}

main().catch(e => { console.error('✗ Generator failed:', e); process.exit(1); });

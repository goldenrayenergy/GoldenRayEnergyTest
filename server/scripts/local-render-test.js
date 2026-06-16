// Local /generate simulation — exercises the full Phase G pipeline against
// a synthetic Krishan-like spec, writes the merged PDF to disk so you can
// open + page-count it before pushing G to production.
//
// On Windows we can't use chromium-min (Linux-only binary). The script
// auto-detects a system Chrome/Edge install and sets PUPPETEER_EXECUTABLE_PATH
// for the duration of the run. Set PUPPETEER_EXECUTABLE_PATH yourself to
// override.
//
// Usage:
//   node server/scripts/local-render-test.js           # battery quote (BYD HVM)
//   node server/scripts/local-render-test.js reserva   # Reserva battery
//   node server/scripts/local-render-test.js solar     # solar-only (no battery)
//   node server/scripts/local-render-test.js ev        # solar+battery+wattpilot
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

// ── Auto-detect system Chrome / Edge for local dev ────────────────────────
if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge Dev/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      process.env.PUPPETEER_EXECUTABLE_PATH = c;
      console.log(`Using browser: ${c}`);
      break;
    }
  }
  if (!process.env.PUPPETEER_EXECUTABLE_PATH) {
    console.error('❌ No system Chrome / Edge found. Set PUPPETEER_EXECUTABLE_PATH manually.');
    process.exit(1);
  }
}

// ── Load engine + catalogue ───────────────────────────────────────────────
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const { loadCatalogueFromDb } = await import('../services/pm/proposalEngine/catalogue/dbLoader.js');
const { runEngine }           = await import('../services/pm/proposalEngine/index.js');
const { runThreeScenarios }   = await import('../services/pm/proposalEngine/financialModel.js');
const { renderProposalPdfs }  = await import('../services/pm/proposalEngine/renderPdf.js');

const catalogue = await loadCatalogueFromDb(sb);
console.log(`Catalogue: ${Object.keys(catalogue.PANELS).length} panels, `
  + `${Object.keys(catalogue.INVERTERS).length} inverters, `
  + `${Object.keys(catalogue.BATTERIES).length} batteries`);

// Check how many datasheet_url's are populated (we just uploaded 54)
const dsCount = ['PANELS','INVERTERS','BATTERIES','SMART_METERS','EV_CHARGERS','BMS_CONTROLLERS']
  .reduce((n, k) => n + Object.values(catalogue[k] || {}).filter(p => p.datasheet_url).length, 0);
console.log(`Catalogue items with datasheet_url: ${dsCount}`);

// ── Pick a flavour ────────────────────────────────────────────────────────
const flavour = process.argv[2] || 'battery';
function buildSpec() {
  const base = {
    customer: {
      full_name: 'Local Smoke Test',
      email: 'test@example.com', phone: '+64 21 000 0000',
      address: { street: '1 Test St', suburb: 'Test', city: 'Auckland',
                 postcode: '1010', region: 'auckland_vector' },
      icp_number: '00000000000XXX', property_ownership: 'mortgaged',
    },
    bills: { manual_entry: {
      annual_kwh: 13000, annual_spend: 3800, retailer: 'Mercury',
      variable_rate_per_kwh_incl_gst: 0.23, daily_fixed_charge_incl_gst: 2.5,
      buyback_rate: 0.09,
    }},
    pricing: { customer_price_inc_gst: null, stage: 'stage_1_estimate',
               final_mode: true, discount: { applied_nzd: 0, owner_approved: false, reason: null }},
    preferences: { backup_priority: 'whole_home_essentials',
                   decision_makers: 'solo', financing: { choice: 'cash' }},
  };
  const sys = (battery, wattpilot=false) => ({
    panel: { sku: 'PHN-PNL-595-DRC', count: 17 },
    inverter: { sku: 'FRN-INV-100-G24P-1P' },
    battery, smart_meter: { sku: 'FRN-MTR-63-S1P', phase: 1 },
    string_topology: 'series',
    string_design: { groups: [{ panels_per_string: 10, string_count: 1 },
                              { panels_per_string: 7, string_count: 1 }], topology: 'series' },
    cable_run_metres_estimate: 24, phase: 1,
    wattpilot_included: wattpilot,
  });
  if (flavour === 'solar') return { ...base, system: sys(null) };
  if (flavour === 'reserva') return { ...base, system: sys({ sku: 'FRN-BAT-315-RSV', module_count: 3, kwh: 9.45 }) };
  if (flavour === 'ev') return { ...base, system: sys({ sku: 'BYD-BAT-276-HVM', module_count: 5, kwh: 13.8 }, true) };
  // default: solar + BYD HVM battery
  return { ...base, system: sys({ sku: 'BYD-BAT-276-HVM', module_count: 5, kwh: 13.8 }) };
}

const spec = buildSpec();
console.log(`\nFlavour: ${flavour}  ·  Battery: ${spec.system.battery?.sku || '(none)'}  ·  Wattpilot: ${spec.system.wattpilot_included}`);

// ── Run engine ────────────────────────────────────────────────────────────
console.log('\nRunning engine…');
const t0 = Date.now();
const engineResult = await runEngine(spec, { catalogue });
console.log(`  engine.ok=${engineResult.ok}  can_ship=${engineResult.can_ship}  `
  + `engine_ms=${Date.now() - t0}`);
if (!engineResult.ok) {
  console.error('Engine refused:', JSON.stringify(engineResult.config_errors || engineResult.block_reasons, null, 2));
  process.exit(1);
}
const scenarios = runThreeScenarios(spec, engineResult.cost, {}, { catalogue });

// ── Render + concat ───────────────────────────────────────────────────────
console.log('\nRendering customer PDF + concatenating datasheets…');
const t1 = Date.now();
const rendered = await renderProposalPdfs({
  spec, engineResult, scenarios,
  options: { quote_ref: 'LOCAL-SMOKE-001', quote_date: new Date().toISOString(), catalogue },
});
console.log(`  render_ms=${Date.now() - t1}`);
console.log(`  used_fallback=${rendered.used_fallback}  fallback_reason=${rendered.fallback_reason || '—'}`);
console.log(`  customer_pdf bytes=${rendered.customer_pdf.length}`);
console.log(`  sales_console_pdf bytes=${rendered.sales_console_pdf.length}`);
if (rendered.concat) {
  console.log(`\nConcat details:`);
  console.log(`  cover_pages: ${rendered.concat.cover_pages}`);
  console.log(`  datasheet_pages: ${rendered.concat.datasheet_pages}`);
  console.log(`  merged_skus (${rendered.concat.merged_skus.length}): ${rendered.concat.merged_skus.join(', ')}`);
  console.log(`  requested_skus (${rendered.concat.requested_skus.length}): ${rendered.concat.requested_skus.join(', ')}`);
}

// ── Save to disk + show real page count via pdf-lib ───────────────────────
const outDir = path.resolve(__dirname, '../../mockups/local-render-test');
mkdirSync(outDir, { recursive: true });
const customerPath = path.join(outDir, `customer-${flavour}.pdf`);
const salesPath = path.join(outDir, `sales-console-${flavour}.pdf`);
writeFileSync(customerPath, rendered.customer_pdf);
writeFileSync(salesPath, rendered.sales_console_pdf);

let totalPages = '(HTML fallback — cannot count)';
if (!rendered.used_fallback) {
  try {
    const pdf = await PDFDocument.load(rendered.customer_pdf);
    totalPages = pdf.getPageCount();
  } catch (e) { totalPages = `(read failed: ${e.message})`; }
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Wrote ${customerPath}`);
console.log(`  Wrote ${salesPath}`);
console.log(`  Customer PDF total pages: ${totalPages}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`\nOpen the file with: start "" "${customerPath}"`);

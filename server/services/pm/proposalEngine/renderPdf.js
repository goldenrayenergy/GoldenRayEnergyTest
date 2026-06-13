// ────────────────────────────────────────────────────────────────────────────
// PDF render wrapper — proposal engine
//
// Single entry point that takes engine outputs, builds HTML for both the
// customer proposal and the internal sales console, then renders each to PDF
// via Puppeteer. Falls back to raw HTML buffers if Puppeteer can't launch
// (e.g. in CI without Chrome).
//
// Two input shapes accepted (auto-detected via engineResult.is_multi_tier):
//
//   Single-tier:
//     renderProposalPdfs({ spec, engineResult, scenarios, options })
//       — engineResult is the full runEngine output for a single-tier spec.
//         Internally we read .cost / .engineering / .bom from it.
//
//   Multi-tier (P4.5):
//     renderProposalPdfs({ spec, engineResult, tierScenarios, options })
//       — engineResult.is_multi_tier === true; engineResult.tiers carries
//         per-tier cost/engineering. tierScenarios is one runThreeScenarios()
//         output per tier, aligned to engineResult.tiers order.
//
// Output buffers ready for storage upload / email attachment / HTTP response.
// ────────────────────────────────────────────────────────────────────────────

import { buildCustomerProposalHTML } from './htmlTemplates/customerProposal.js';
import { buildSalesConsole, buildMultiTierSalesConsole } from './htmlTemplates/salesConsole.js';
import { buildProposalData, buildMultiTierProposalData } from './htmlTemplates/proposalData.js';

export const RENDER_VERSION = '1.1.0';

const A4_MARGINS = { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' };

async function htmlToPdf(html, label) {
  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: A4_MARGINS,
      preferCSSPageSize: true,
    });
    await browser.close();
    return { buffer: pdfBuffer, fallback: false };
  } catch (e) {
    console.warn(`⚠ Puppeteer failed for ${label} — falling back to HTML buffer. (${e.message})`);
    return { buffer: Buffer.from(html, 'utf8'), fallback: true };
  }
}

export async function renderProposalPdfs(args = {}) {
  // Backward-compat with the legacy call signature
  //   { spec, costResult, scenarios, engineering, bom, options }
  // Callers that have already moved to the new shape pass engineResult.
  const {
    spec,
    engineResult: explicitEngineResult,
    scenarios,
    tierScenarios,
    options = {},
    // Legacy fields — synthesised into a pseudo single-tier engineResult if
    // the caller hasn't migrated yet.
    costResult, engineering, bom,
  } = args;

  let engineResult = explicitEngineResult;
  if (!engineResult && costResult) {
    engineResult = { is_multi_tier: false, cost: costResult, engineering, bom };
  }
  if (!engineResult) {
    throw new Error('renderProposalPdfs: pass either { engineResult } or the legacy { costResult, engineering, bom }');
  }

  // ── Multi-tier branch ──────────────────────────────────────────────────
  if (engineResult.is_multi_tier) {
    if (!Array.isArray(tierScenarios) || tierScenarios.length !== (engineResult.tiers || []).length) {
      throw new Error(
        `renderProposalPdfs (multi-tier): tierScenarios length (${tierScenarios?.length}) must equal tiers length (${(engineResult.tiers || []).length}).`,
      );
    }
    const d = buildMultiTierProposalData({ spec, engineResult, tierScenarios, options });
    const customerHtml = buildCustomerProposalHTML({ spec, engineResult, tierScenarios, options });
    const salesConsoleHtml = buildMultiTierSalesConsole(d, engineResult);
    const [customerOut, salesOut] = await Promise.all([
      htmlToPdf(customerHtml, 'customer'),
      htmlToPdf(salesConsoleHtml, 'sales-console'),
    ]);
    return {
      customer_pdf: customerOut.buffer,
      sales_console_pdf: salesOut.buffer,
      customer_html: customerHtml,
      sales_console_html: salesConsoleHtml,
      used_fallback: customerOut.fallback || salesOut.fallback,
      quote_ref: d.meta.quote_ref,
      spec_hash: null,                       // per-tier cost hashes; aggregate isn't meaningful
      render_version: RENDER_VERSION,
      is_multi_tier: true,
    };
  }

  // ── Single-tier branch (legacy + new) ──────────────────────────────────
  const d = buildProposalData({
    spec,
    costResult: engineResult.cost,
    scenarios,
    engineering: engineResult.engineering,
    bom: engineResult.bom,
    options,
  });
  const customerHtml = buildCustomerProposalHTML({
    spec,
    costResult: engineResult.cost,
    scenarios,
    engineering: engineResult.engineering,
    bom: engineResult.bom,
    options,
  });
  const salesConsoleHtml = buildSalesConsole(d, engineResult.cost);
  const [customerOut, salesOut] = await Promise.all([
    htmlToPdf(customerHtml, 'customer'),
    htmlToPdf(salesConsoleHtml, 'sales-console'),
  ]);
  return {
    customer_pdf: customerOut.buffer,
    sales_console_pdf: salesOut.buffer,
    customer_html: customerHtml,
    sales_console_html: salesConsoleHtml,
    used_fallback: customerOut.fallback || salesOut.fallback,
    quote_ref: d.meta.quote_ref,
    spec_hash: engineResult.cost?.spec_sha256 || null,
    render_version: RENDER_VERSION,
    is_multi_tier: false,
  };
}

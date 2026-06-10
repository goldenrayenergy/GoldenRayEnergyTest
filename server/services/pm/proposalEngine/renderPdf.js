// ────────────────────────────────────────────────────────────────────────────
// PDF render wrapper — proposal engine
//
// Single entry point that takes engine outputs, builds HTML for both the
// customer proposal and the internal sales console, then renders each to PDF
// via Puppeteer. Falls back to raw HTML buffers if Puppeteer can't launch
// (e.g. in CI without Chrome).
//
// Usage:
//   const result = runEngine(spec);
//   const scenarios = runThreeScenarios(spec, result.cost);
//   const { customer_pdf, sales_console_pdf, customer_html, sales_console_html, used_fallback }
//     = await renderProposalPdfs({ spec, costResult: result.cost, scenarios,
//                                  engineering: result.engineering, bom: result.bom });
//
// Output buffers ready for storage upload / email attachment / HTTP response.
// ────────────────────────────────────────────────────────────────────────────

import { buildCustomerProposalHTML } from './htmlTemplates/customerProposal.js';
import { buildSalesConsole } from './htmlTemplates/salesConsole.js';
import { buildProposalData } from './htmlTemplates/proposalData.js';

export const RENDER_VERSION = '1.0.0';

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

export async function renderProposalPdfs({
  spec, costResult, scenarios, engineering, bom, options = {},
}) {
  // Build both documents from the same adapter-output `d` so they share data.
  const d = buildProposalData({ spec, costResult, scenarios, engineering, bom, options });

  const customerHtml = buildCustomerProposalHTML({
    spec, costResult, scenarios, engineering, bom, options,
  });
  const salesConsoleHtml = buildSalesConsole(d, costResult);

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
    spec_hash: costResult.spec_sha256 || null,
    render_version: RENDER_VERSION,
  };
}

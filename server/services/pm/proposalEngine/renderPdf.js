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
import { launchHeadlessBrowser } from './headlessBrowser.js';
import { PDFDocument } from 'pdf-lib';

// Bump when rendering pipeline changes shape (concat support, etc.). Sales
// console + customer PDF carry this in their metadata-ish places.
export const RENDER_VERSION = '1.2.0';

const A4_MARGINS = { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' };

async function htmlToPdf(html, label) {
  let browser;
  try {
    browser = await launchHeadlessBrowser();
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
    if (browser) try { await browser.close(); } catch {}
    console.warn(`⚠ Headless render failed for ${label} — falling back to HTML buffer. (${e.message})`);
    return { buffer: Buffer.from(html, 'utf8'), fallback: true, fallback_reason: e.message };
  }
}

// ── G2 — Datasheet concat helpers ──────────────────────────────────────────
// Per-quote final PDF = [6-page custom proposal] + [N pages of manufacturer
// datasheets]. Datasheets are pre-existing PDFs in Supabase Storage; we
// merge them with pdf-lib (CPU-only, no browser). Missing datasheets are
// skipped with a warning — never block the render.

// Pull the SKUs whose datasheets the customer should see.
function collectDatasheetSkus(spec, catalogue) {
  const seen = new Set();
  const out = [];
  const push = (sku) => {
    if (!sku || seen.has(sku)) return;
    seen.add(sku);
    out.push(sku);
  };

  // Always include the headline tier's hardware (or root spec for single-tier).
  const tiers = Array.isArray(spec?.tiers) ? spec.tiers : [];
  const tier = tiers.find(t => t.is_recommended) || tiers[0];
  const sys = tier?.system_overrides
    ? { ...spec.system, ...tier.system_overrides }
    : (spec?.system || {});

  push(sys.panel?.sku);
  push(sys.inverter?.sku);
  push(sys.battery?.sku);
  push(sys.smart_meter?.sku);
  // BMS controller: resolved from catalogue by battery series
  if (sys.battery?.sku && catalogue?.BATTERIES?.[sys.battery.sku]) {
    const series = catalogue.BATTERIES[sys.battery.sku].series;
    const bms = Object.values(catalogue.BMS_CONTROLLERS || {})
      .find(b => b.for_battery_series === series);
    push(bms?.sku);
  }
  // EV charger (Wattpilot) when the tier opted into wattpilot_included
  if (sys.wattpilot_included && catalogue?.EV_CHARGERS) {
    const ev = Object.values(catalogue.EV_CHARGERS)[0];
    push(ev?.sku);
  }
  return out;
}

// Resolve each SKU → datasheet PDF bytes. Pulls via Supabase Storage signed
// URL when products.datasheet_url is present; logs and skips otherwise.
async function loadDatasheetBuffers(skus, catalogue, label) {
  const results = [];
  for (const sku of skus) {
    const item = catalogue.PANELS?.[sku]
              || catalogue.INVERTERS?.[sku]
              || catalogue.BATTERIES?.[sku]
              || catalogue.SMART_METERS?.[sku]
              || catalogue.BMS_CONTROLLERS?.[sku]
              || catalogue.EV_CHARGERS?.[sku]
              || null;
    const url = item?.datasheet_url;
    if (!url) {
      results.push({ sku, skipped: true, reason: 'no datasheet_url' });
      continue;
    }
    try {
      const r = await fetch(url);
      if (!r.ok) {
        results.push({ sku, skipped: true, reason: `HTTP ${r.status}` });
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      // Validate it's actually a PDF before we try to merge.
      if (buf.slice(0, 5).toString() !== '%PDF-') {
        results.push({ sku, skipped: true, reason: 'not a PDF' });
        continue;
      }
      results.push({ sku, buffer: buf });
    } catch (e) {
      results.push({ sku, skipped: true, reason: e.message });
    }
  }
  const skipped = results.filter(r => r.skipped);
  if (skipped.length) {
    console.warn(`⚠ ${label} concat — skipped ${skipped.length}/${skus.length} datasheets: ` +
      skipped.map(s => `${s.sku} (${s.reason})`).join(', '));
  }
  return results.filter(r => !r.skipped);
}

// Merge buffers into one PDF. Cover (customer proposal) goes first, then each
// datasheet in order. Returns the merged bytes + page counts so callers can
// log/audit. If pdf-lib throws on any input, we drop that one and continue.
async function mergePdfBuffers(coverPdfBuffer, datasheets) {
  const final = await PDFDocument.create();
  let coverPages = 0, datasheetPages = 0, mergedSkus = [];

  // Cover proposal first
  try {
    const cover = await PDFDocument.load(coverPdfBuffer);
    const copied = await final.copyPages(cover, cover.getPageIndices());
    for (const p of copied) final.addPage(p);
    coverPages = copied.length;
  } catch (e) {
    // Cover buffer wasn't a real PDF (HTML fallback). Bail — final = cover.
    console.warn(`⚠ Cover PDF unreadable by pdf-lib; returning cover buffer as-is. (${e.message})`);
    return { buffer: coverPdfBuffer, cover_pages: 0, datasheet_pages: 0,
             concat_skipped: true, merged_skus: [] };
  }

  for (const ds of datasheets) {
    try {
      const src = await PDFDocument.load(ds.buffer);
      const copied = await final.copyPages(src, src.getPageIndices());
      for (const p of copied) final.addPage(p);
      datasheetPages += copied.length;
      mergedSkus.push(ds.sku);
    } catch (e) {
      console.warn(`⚠ Datasheet ${ds.sku} could not be merged: ${e.message}`);
    }
  }

  const buffer = Buffer.from(await final.save());
  return { buffer, cover_pages: coverPages, datasheet_pages: datasheetPages,
           concat_skipped: false, merged_skus: mergedSkus };
}

// Public: render proposal + concat datasheets in one call. Returns
//   { buffer, fallback, fallback_reason?, concat: { ... } }
async function renderAndConcat(coverHtml, spec, catalogue, label) {
  const rendered = await htmlToPdf(coverHtml, label);
  if (rendered.fallback) {
    // Don't try to concat HTML; return the fallback buffer as-is.
    return { ...rendered, concat: null };
  }
  const skus = collectDatasheetSkus(spec, catalogue || {});
  const datasheets = await loadDatasheetBuffers(skus, catalogue || {}, label);
  const merged = await mergePdfBuffers(rendered.buffer, datasheets);
  return {
    buffer: merged.buffer,
    fallback: false,
    concat: {
      cover_pages: merged.cover_pages,
      datasheet_pages: merged.datasheet_pages,
      merged_skus: merged.merged_skus,
      requested_skus: skus,
    },
  };
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
      renderAndConcat(customerHtml, spec, options?.catalogue, 'customer'),
      htmlToPdf(salesConsoleHtml, 'sales-console'),
    ]);
    return {
      customer_pdf: customerOut.buffer,
      sales_console_pdf: salesOut.buffer,
      customer_html: customerHtml,
      sales_console_html: salesConsoleHtml,
      used_fallback: customerOut.fallback || salesOut.fallback,
      fallback_reason: customerOut.fallback_reason || salesOut.fallback_reason || null,
      concat: customerOut.concat,
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
    renderAndConcat(customerHtml, spec, options?.catalogue, 'customer'),
    htmlToPdf(salesConsoleHtml, 'sales-console'),
  ]);
  return {
    customer_pdf: customerOut.buffer,
    sales_console_pdf: salesOut.buffer,
    customer_html: customerHtml,
    sales_console_html: salesConsoleHtml,
    used_fallback: customerOut.fallback || salesOut.fallback,
    fallback_reason: customerOut.fallback_reason || salesOut.fallback_reason || null,
    concat: customerOut.concat,
    quote_ref: d.meta.quote_ref,
    spec_hash: engineResult.cost?.spec_sha256 || null,
    render_version: RENDER_VERSION,
    is_multi_tier: false,
  };
}

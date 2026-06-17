// ────────────────────────────────────────────────────────────────────────────
// Customer proposal — full multi-page HTML builder
//
// Takes engine outputs (spec, cost, scenarios, engineering, bom) and produces
// the customer-facing HTML for downstream PDF rendering (Puppeteer).
//
// Layout (Phase 3b.1 — minimum credibility-complete set; long-tail pages
// added in Phase 3b.2):
//
//   1.  Cover & welcome letter
//   2.  Your system at a glance + hardware specification
//   3.  Year-1 monthly breakdown
//   4.  Three-scenario financial outlook  ← NEW credibility page
//   5.  Investment & pricing
//
// All pages share the chrome (CSS + page head/foot) from _shared.js.
//
// Internal sales console is a SEPARATE document — see salesConsole.js.
// ────────────────────────────────────────────────────────────────────────────

import { PROPOSAL_CSS } from './_shared.js';
import { buildProposalData, buildMultiTierProposalData } from './proposalData.js';

import { pageCover } from './pages/cover.js';
import { pageSystemSummary } from './pages/systemSummary.js';
import { pageComponents, COMPONENTS_PAGE_CSS } from './pages/components.js';
import { pageMonthlyProfile } from './pages/monthlyProfile.js';
import { pageFinancialOutlook } from './pages/financialOutlook.js';
import { pagePricing } from './pages/pricing.js';
import { pageThreeTierComparison, TIER_COMPARISON_CSS } from './pages/threeTierComparison.js';
// Phase H1 — bill-analysis-driven insight pages
import { pageDoNothing } from './pages/doNothing.js';
import { pageTariffRecommendation } from './pages/tariffRecommendation.js';
import { pagePatternsAcrossYear } from './pages/patternsAcrossYear.js';
import { pageEnvironmentalImpact } from './pages/environmentalImpact.js';
import { pageCashFlowWaterfall } from './pages/cashFlowWaterfall.js';
// Phase H2 — hourly typical-day simulation page
import { pageTypicalDays } from './pages/typicalDays.js';
// Phase H3 — single-line diagram
import { pageSLD } from './pages/sld.js';
// Phase H4 — polished monthly bill comparison (bar chart)
import { pageBillComparison } from './pages/billComparison.js';
// Phase H5 — conceptual "Four typical scenarios" cards page
import { pageFourScenarios } from './pages/fourScenarios.js';

export const TEMPLATE_VERSION = '1.5.0';

// Page order — note that the insight pages return '' when their data is
// missing (no bill_analysis on file), so they're effectively "lazy" pages
// that drop out of the PDF when nothing to say. customerProposalHTML
// filters empty results before counting sections so the footer numbering
// stays correct.
// Phase H2 — "Typical days across the year" page (page name kept as
// `patterns` was bill-engine pattern-spotting; H2 added a separate
// `typical_days` page that visualises hourly behaviour.
const SINGLE_TIER_PAGES = [
  { id: 'cover',         label: 'Cover & welcome',                   build: pageCover },
  { id: 'system',        label: 'System summary',                    build: pageSystemSummary },
  { id: 'components',    label: 'Your solution — components',        build: pageComponents },
  { id: 'sld',           label: 'System layout (single-line diagram)', build: pageSLD },
  { id: 'patterns',      label: 'Patterns from your bills',          build: pagePatternsAcrossYear },
  { id: 'four_scenarios',label: 'How your system works',             build: pageFourScenarios },
  { id: 'typical_days',  label: 'Daily energy flows',                build: pageTypicalDays },
  { id: 'bill_compare',  label: 'First year — monthly bill comparison',  build: pageBillComparison },
  { id: 'monthly',       label: 'Year-1 monthly breakdown',          build: pageMonthlyProfile },
  { id: 'do_nothing',    label: 'The cost of doing nothing',         build: pageDoNothing },
  { id: 'outlook',       label: 'Financial outlook',                 build: pageFinancialOutlook },
  { id: 'cash_flow',     label: '30-year cash flow',                 build: pageCashFlowWaterfall },
  { id: 'environmental', label: 'Environmental impact',              build: pageEnvironmentalImpact },
  { id: 'tariff',        label: 'Recommended tariff (post-install)', build: pageTariffRecommendation },
  { id: 'pricing',       label: 'Investment & pricing',              build: pagePricing },
];

// Multi-tier inserts the comparison page between cover and system summary.
const MULTI_TIER_PAGES = [
  { id: 'cover',         label: 'Cover & welcome',                   build: pageCover },
  { id: 'tiers',         label: 'Three packages at a glance',        build: pageThreeTierComparison },
  { id: 'system',        label: 'System summary',                    build: pageSystemSummary },
  { id: 'components',    label: 'Your solution — components',        build: pageComponents },
  { id: 'sld',           label: 'System layout (single-line diagram)', build: pageSLD },
  { id: 'patterns',      label: 'Patterns from your bills',          build: pagePatternsAcrossYear },
  { id: 'four_scenarios',label: 'How your system works',             build: pageFourScenarios },
  { id: 'typical_days',  label: 'Daily energy flows',                build: pageTypicalDays },
  { id: 'bill_compare',  label: 'First year — monthly bill comparison',  build: pageBillComparison },
  { id: 'monthly',       label: 'Year-1 monthly breakdown',          build: pageMonthlyProfile },
  { id: 'do_nothing',    label: 'The cost of doing nothing',         build: pageDoNothing },
  { id: 'outlook',       label: 'Financial outlook',                 build: pageFinancialOutlook },
  { id: 'cash_flow',     label: '30-year cash flow',                 build: pageCashFlowWaterfall },
  { id: 'environmental', label: 'Environmental impact',              build: pageEnvironmentalImpact },
  { id: 'tariff',        label: 'Recommended tariff (post-install)', build: pageTariffRecommendation },
  { id: 'pricing',       label: 'Investment & pricing',              build: pagePricing },
];

// ────────────────────────────────────────────────────────────────────────────
// Public entry point.
//
// Two input shapes accepted (auto-detected):
//
//   Single-tier (legacy):
//     { spec, costResult, scenarios, engineering, bom, options }
//
//   Multi-tier (P4.5):
//     { spec, engineResult, tierScenarios, options }
//     where engineResult is the full output of runEngine() for a multi-tier
//     spec, and tierScenarios is an array of runThreeScenarios output per
//     tier (in the same order as engineResult.tiers).
// ────────────────────────────────────────────────────────────────────────────
export function buildCustomerProposalHTML(args = {}) {
  const { engineResult } = args;
  const isMultiTier = !!engineResult?.is_multi_tier;

  const d = isMultiTier
    ? buildMultiTierProposalData(args)
    : buildProposalData(args);

  const pageOrder = isMultiTier ? MULTI_TIER_PAGES : SINGLE_TIER_PAGES;
  // Components page CSS is always included (cheap; ~1.5KB) — present in both
  // page orderings.
  const css = isMultiTier
    ? `${PROPOSAL_CSS}\n${TIER_COMPARISON_CSS}\n${COMPONENTS_PAGE_CSS}`
    : `${PROPOSAL_CSS}\n${COMPONENTS_PAGE_CSS}`;

  // Phase H1 — insight pages return '' when their data is missing. Do a
  // two-pass build: first try every page with provisional numbering, then
  // filter empties, then renumber so the footer "Section X of Y" stays
  // correct (and Y reflects the REAL page count for this quote).
  const provisional = pageOrder.map(p => ({ id: p.id, html: p.build(d, 0, 0) }));
  const populated = provisional.filter(p => p.html && p.html.trim() !== '');
  const sectionsTotal = populated.length;
  const body = populated.map((p, i) => {
    // Re-render with the right sectionNum / sectionsTotal so the footer
    // numbering is accurate. Page builders are cheap (string concat) so the
    // second pass costs nothing.
    const pageDef = pageOrder.find(x => x.id === p.id);
    return pageDef.build(d, i + 1, sectionsTotal);
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Solar Proposal — ${d.customer.name} — ${d.meta.quote_ref}</title>
  <style>${css}</style>
</head>
<body>
${body}
</body>
</html>`;
}

// ── Test/dev hook — returns the data object alone for inspection ──────────
export function debugProposalData(args) {
  return args.engineResult?.is_multi_tier
    ? buildMultiTierProposalData(args)
    : buildProposalData(args);
}

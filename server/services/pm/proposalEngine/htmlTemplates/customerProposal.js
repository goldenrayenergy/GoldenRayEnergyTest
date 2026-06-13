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

export const TEMPLATE_VERSION = '1.1.0';

const SINGLE_TIER_PAGES = [
  { id: 'cover',      label: 'Cover & welcome',            build: pageCover },
  { id: 'system',     label: 'System summary',             build: pageSystemSummary },
  { id: 'components', label: 'Your solution — components', build: pageComponents },
  { id: 'monthly',    label: 'Year-1 monthly breakdown',   build: pageMonthlyProfile },
  { id: 'outlook',    label: 'Financial outlook',          build: pageFinancialOutlook },
  { id: 'pricing',    label: 'Investment & pricing',       build: pagePricing },
];

// Multi-tier inserts the comparison page between cover and system summary.
const MULTI_TIER_PAGES = [
  { id: 'cover',      label: 'Cover & welcome',            build: pageCover },
  { id: 'tiers',      label: 'Three packages at a glance', build: pageThreeTierComparison },
  { id: 'system',     label: 'System summary',              build: pageSystemSummary },
  { id: 'components', label: 'Your solution — components',  build: pageComponents },
  { id: 'monthly',    label: 'Year-1 monthly breakdown',    build: pageMonthlyProfile },
  { id: 'outlook',    label: 'Financial outlook',           build: pageFinancialOutlook },
  { id: 'pricing',    label: 'Investment & pricing',        build: pagePricing },
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

  const sectionsTotal = pageOrder.length;
  const body = pageOrder.map((p, i) => p.build(d, i + 1, sectionsTotal)).join('\n');

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

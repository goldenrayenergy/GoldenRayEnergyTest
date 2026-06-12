// ────────────────────────────────────────────────────────────────────────────
// Auto-populate 3 tiers — Option 4c (b) thin client.
//
// HEAVY LIFTING IS SERVER-SIDE. This module is now a single API call to
// POST /pm/proposal-engine/compose-three-tiers, which handles:
//   • bill-analysis lookup
//   • fallback when bills missing or composer fails
//   • per-tier system overrides with engine-recommended SKUs
//
// Used by the QuoteFormPage Recompose button. Quote creation uses the
// SAME orchestration inside POST /pm/quotes so the spec is never null.
// ────────────────────────────────────────────────────────────────────────────

import { pmProposalEngineAPI } from '../services/pmQuotesApi';

export function readyForAutoPopulate(billAnalysis) {
  return !!(billAnalysis && Number(billAnalysis.recommended_system_kw) > 0);
}

// Re-compose 3 tiers for an existing quote. Always returns an array of 3
// tier objects (engine-picked, fallback, or partial). Never throws.
export async function autoSizeThreeTiers({
  billAnalysisId = null,
  billAnalysis = null,        // direct passthrough for QuoteNewPage compatibility
  phase = 1,
  sizeMode = 'same_size',
  region = null,
} = {}) {
  try {
    const { data } = await pmProposalEngineAPI.composeThreeTiers({
      bill_analysis_id: billAnalysisId,
      bill_analysis:    billAnalysis,
      phase, region,
      size_mode: sizeMode,
    });
    return data.tiers || [];
  } catch (e) {
    console.warn('autoSizeThreeTiers compose failed:', e?.response?.data?.error || e?.message);
    return [];
  }
}

// Kept for backwards compatibility — returns empty (server-side will replace
// these the next time recompose runs).
export function autoSizeThreeTiersFromSpec() {
  return [];
}

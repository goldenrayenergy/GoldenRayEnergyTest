// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Public entry point
//
// Single import for callers. Orchestrates:
//   spec → validate config → build BoM → validate engineering → cost → return
//
// Days 3 will add: financial-model + html-templates + PDF rendering.
// Today the engine returns the structured data only — no PDF yet.
//
// Usage:
//   import { runEngine } from './services/pm/proposalEngine/index.js';
//   const result = runEngine(spec);
//   if (!result.config_valid) → throw ConfigError
//   if (result.engineering.hard_fails.length) → block with hard_fails
//   const internalSheet = result.cost;     // P&L for sales console
//   const customerData = result.cost.totals.customer_total_inc_gst;
// ────────────────────────────────────────────────────────────────────────────

import { validateSpec } from './configValidator.js';
import { buildBom } from './bomBuilder.js';
import { validateEngineering, VALIDATOR_VERSION } from './engineeringValidator.js';
import { computeCost } from './costEngine.js';
import { getCatalogue } from './catalogue/index.js';
import { WARRANTY_TERMS_VERSION } from './data/engineeringRules.js';
import {
  ensureTierIds, buildEffectiveSpec, validateTiers, pickHeadlineTierId,
} from './tiers.js';
import { ensureLoaded as ensureFieldLimitsLoaded } from './fieldLimits.js';
import crypto from 'node:crypto';

export const ENGINE_VERSION = '1.0.0';

// SHA256 hash of spec for run-log reproducibility audit.
function specHash(spec) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(spec, Object.keys(spec).sort()))
    .digest('hex');
}

// runEngine is async so it can prime the field_limits cache from the DB before
// validateSpec uses getHardRange(). Existing callers in routes were already
// async (just add `await`); the test scripts that called it sync top-level
// also work because ESM allows top-level await.
export async function runEngine(spec, options = {}) {
  // Prime the field_limits cache once per call. Safe to call repeatedly —
  // returns the in-flight promise if a concurrent load is in progress, or
  // the cached value if still inside TTL. Never throws (falls back to static).
  await ensureFieldLimitsLoaded();

  const startedAt = Date.now();
  const catalogue = getCatalogue(options);
  // Thread the resolved catalogue + any other options to every child fn.
  const childOpts = { ...options, catalogue };

  // ── Multi-tier branch (P4.5) ─────────────────────────────────────────────
  // When spec.tiers is present, run the single-tier engine once per tier
  // against an effective merged spec, then return a tier-aware result.
  if (Array.isArray(spec.tiers) && spec.tiers.length > 0) {
    const tierShapeErrors = validateTiers(spec);
    if (tierShapeErrors.length > 0) {
      return {
        ok: false,
        config_valid: false,
        is_multi_tier: true,
        config_errors: tierShapeErrors,
        started_at: new Date(startedAt).toISOString(),
        duration_ms: Date.now() - startedAt,
      };
    }
    const specWithIds = ensureTierIds(spec);
    const headlineTierId = pickHeadlineTierId(specWithIds);
    const tierResults = specWithIds.tiers.map(tier => {
      const effectiveSpec = buildEffectiveSpec(specWithIds, tier);
      const inner = runSingleTier(effectiveSpec, childOpts, startedAt);
      return {
        tier_id: tier.tier_id,
        label: tier.label,
        is_recommended: tier.is_recommended === true,
        is_headline: tier.tier_id === headlineTierId,
        ...inner,
      };
    });
    const anyConfigFail = tierResults.some(t => !t.config_valid);
    const allCanShip = tierResults.every(t => t.can_ship === true);
    const aggregatedBlockReasons = tierResults
      .filter(t => !t.can_ship && t.label)
      .flatMap(t => (t.block_reasons || []).map(r => `[${t.label}] ${r}`));
    return {
      ok: !anyConfigFail,
      config_valid: !anyConfigFail,
      is_multi_tier: true,
      tiers: tierResults,
      recommended_tier_id: headlineTierId,
      can_ship_all: allCanShip,
      block_reasons: aggregatedBlockReasons,
      versions: {
        engine_version: ENGINE_VERSION,
        validator_version: VALIDATOR_VERSION,
        catalogue_version: catalogue.CATALOGUE_VERSION || 'db',
        warranty_terms_version: WARRANTY_TERMS_VERSION,
        labour_rate_card_version: catalogue.LABOUR_RATE_CARD_VERSION || 'db',
      },
      spec_sha256: specHash(specWithIds),
      started_at: new Date(startedAt).toISOString(),
      duration_ms: Date.now() - startedAt,
    };
  }

  // ── Single-tier (legacy) path ────────────────────────────────────────────
  return {
    ...runSingleTier(spec, childOpts, startedAt),
    versions: {
      engine_version: ENGINE_VERSION,
      validator_version: VALIDATOR_VERSION,
      catalogue_version: catalogue.CATALOGUE_VERSION || 'db',
      warranty_terms_version: WARRANTY_TERMS_VERSION,
      labour_rate_card_version: catalogue.LABOUR_RATE_CARD_VERSION || 'db',
    },
    spec_sha256: specHash(spec),
    started_at: new Date(startedAt).toISOString(),
    duration_ms: Date.now() - startedAt,
  };
}

// Internal: runs validator → BoM → engineering → cost on a single spec.
// Returns the engine-output bundle (without versions / sha256 / timing,
// which the public runEngine adds depending on tier/single mode).
function runSingleTier(spec, childOpts, startedAt) {
  // 1. Config validation
  const configResult = validateSpec(spec, childOpts);
  if (!configResult.valid) {
    return {
      ok: false,
      config_valid: false,
      config_errors: configResult.errors,
    };
  }

  // 2. Build BoM from spec
  let bom;
  try { bom = buildBom(spec, childOpts); }
  catch (e) {
    return {
      ok: false,
      config_valid: true,
      bom_error: e.message,
    };
  }

  // 3. Engineering validation
  const engineering = validateEngineering(spec, childOpts);

  // 4. Cost computation (always run — owner sees this even on hard_fail)
  let cost = null;
  try { cost = computeCost(spec, bom, childOpts); }
  catch (e) {
    return {
      ok: false,
      config_valid: true,
      cost_error: e.message,
      engineering,
    };
  }

  // 5. Overall ship-ready check
  const canShip = engineering.hard_fails.length === 0 &&
                  cost.margin_floor_status !== 'below_floor';

  return {
    ok: true,
    config_valid: true,
    can_ship: canShip,
    block_reasons: [
      ...engineering.hard_fails.map(f => `${f.rule}: ${f.message}`),
      ...(cost.margin_floor_status === 'below_floor'
          ? cost.warnings.filter(w => w.code === 'below_margin_floor').map(w => w.message)
          : []),
    ],
    bom,
    engineering,
    cost,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// proposalEngine/evaluatedShape.js — shape-uniform helpers for evaluateSpec()
//
// Background: server/routes/pm/quotes.js evaluateSpec() returns one of two
// shapes depending on whether spec.tiers is present:
//
//   Single-tier:  { ok, engine, scenarios }
//      where engine = { ok, config_valid, can_ship, cost, engineering, ... }
//
//   Multi-tier:   { ok, engine, tier_scenarios }
//      where engine = { ok, config_valid, is_multi_tier: true,
//                       tiers: [{ tier_id, label, is_recommended, ok,
//                                 config_valid, cost, engineering, ... }, ...],
//                       recommended_tier_id, ... }
//      and tier_scenarios is an array parallel to engine.tiers, each with
//      its own { summary, expected: { yr1, ... }, ... }.
//
// Accessing evaluated.scenarios.* or evaluated.engine.cost.* in multi-tier
// mode → undefined → "Cannot read properties of undefined" at runtime.
//
// These helpers normalize the access. EVERY consumer in quotes.js / quote-
// actions.js MUST use these helpers — no direct `.cost.X` / `.engineering.X`
// / `.scenarios.X` reads. The helpers are pure and exhaustively tested.
// ────────────────────────────────────────────────────────────────────────────

// Worst-case ordering for margin floor status. Higher numeric = worse.
const MARGIN_FLOOR_RANK = {
  'healthy':     0,
  'amber':       1,
  'below_floor': 2,
};

// Find the index of the recommended (or headline) tier in the engine output.
// Falls back to 0 (first tier) when neither flag is set.
function recommendedIndex(engine) {
  if (!engine?.is_multi_tier || !Array.isArray(engine.tiers)) return -1;
  if (engine.recommended_tier_id) {
    const idx = engine.tiers.findIndex(t => t.tier_id === engine.recommended_tier_id);
    if (idx >= 0) return idx;
  }
  const recIdx = engine.tiers.findIndex(t => t.is_recommended === true);
  if (recIdx >= 0) return recIdx;
  const headIdx = engine.tiers.findIndex(t => t.is_headline === true);
  if (headIdx >= 0) return headIdx;
  return 0;
}

// ── 1. Financial summary ───────────────────────────────────────────────────
// Returns { summary, headline, by_tier? } in a shape suitable for the
// quote_versions.financial_model_output column.
//
// When evaluated.ok === false, returns null (no scenarios computed).
// Single-tier: { summary, headline } from evaluated.scenarios.
// Multi-tier:  recommended tier's summary + headline, plus by_tier map.
export function getFinancialSummary(evaluated) {
  if (!evaluated?.ok) return null;
  const engine = evaluated.engine;

  if (engine?.is_multi_tier) {
    const tierScenarios = evaluated.tier_scenarios;
    if (!Array.isArray(tierScenarios)) return null;
    const recIdx = recommendedIndex(engine);
    const rec = tierScenarios[recIdx] || tierScenarios[0];
    if (!rec) return null;
    const by_tier = {};
    for (let i = 0; i < tierScenarios.length; i++) {
      const t = engine.tiers[i];
      const s = tierScenarios[i];
      if (!t || !s) continue;
      by_tier[t.tier_id] = {
        label: t.label,
        is_recommended: t.is_recommended === true,
        summary: s.summary || null,
        headline: s.expected?.yr1 || null,
      };
    }
    return {
      summary: rec.summary || null,
      headline: rec.expected?.yr1 || null,
      by_tier,
    };
  }

  // Single-tier
  const s = evaluated.scenarios;
  return {
    summary: s?.summary || null,
    headline: s?.expected?.yr1 || null,
  };
}

// ── 2. Margin floor status ─────────────────────────────────────────────────
// Returns the WORST margin_floor_status across all tiers (multi-tier) or the
// single tier's status (single-tier). 'below_floor' beats 'amber' beats
// 'healthy'. Returns null when engine didn't run or no cost computed.
export function getMarginFloorStatus(evaluated) {
  const engine = evaluated?.engine;
  if (!engine) return null;

  if (engine.is_multi_tier && Array.isArray(engine.tiers)) {
    let worst = null;
    for (const t of engine.tiers) {
      const status = t?.cost?.margin_floor_status;
      if (!status) continue;
      if (worst == null || MARGIN_FLOOR_RANK[status] > MARGIN_FLOOR_RANK[worst]) {
        worst = status;
      }
    }
    return worst;
  }

  return engine.cost?.margin_floor_status ?? null;
}

// ── 3. Engineering output ──────────────────────────────────────────────────
// Returns a uniform engineering bundle suitable for the
// quote_versions.validator_output column. Multi-tier: aggregates hard_fails /
// soft_warnings / passes / unverified across all tiers, prefixing the rule
// label with [tier label] so downstream consumers can see which tier each
// finding came from. Single-tier: pass through.
export function getEngineeringOutput(evaluated) {
  const engine = evaluated?.engine;
  if (!engine) return null;

  if (engine.is_multi_tier && Array.isArray(engine.tiers)) {
    const hard_fails = [];
    const soft_warnings = [];
    const passes = [];
    const unverified = [];
    let standards_referenced = null;
    let validator_version = null;
    let validated_at = null;
    for (const t of engine.tiers) {
      const e = t?.engineering;
      if (!e) continue;
      const tag = t.label ? `[${t.label}] ` : '';
      for (const x of (e.hard_fails || [])) hard_fails.push({ ...x, tier_id: t.tier_id, tier_label: t.label, rule: tag + (x.rule || '') });
      for (const x of (e.soft_warnings || [])) soft_warnings.push({ ...x, tier_id: t.tier_id, tier_label: t.label, rule: tag + (x.rule || '') });
      for (const x of (e.passes || [])) passes.push({ ...x, tier_id: t.tier_id, tier_label: t.label, rule: tag + (x.rule || '') });
      for (const x of (e.unverified || [])) unverified.push({ ...x, tier_id: t.tier_id, tier_label: t.label, rule: tag + (x.rule || '') });
      standards_referenced = standards_referenced || e.standards_referenced;
      validator_version    = validator_version    || e.validator_version;
      validated_at         = validated_at         || e.validated_at;
    }
    return {
      hard_fails, soft_warnings, passes, unverified,
      standards_referenced, validator_version, validated_at,
      is_aggregated: true,
    };
  }

  return engine.engineering || null;
}

// ── 4. Project margin percentage ───────────────────────────────────────────
// Returns the WORST (lowest) project margin across all tiers (multi-tier) or
// the single tier's margin (single-tier). Returns 0 when no cost computed.
export function getProjectMarginPct(evaluated) {
  const engine = evaluated?.engine;
  if (!engine) return 0;

  if (engine.is_multi_tier && Array.isArray(engine.tiers)) {
    let worst = null;
    for (const t of engine.tiers) {
      const m = t?.cost?.totals?.project_margin_pct;
      if (m == null) continue;
      if (worst == null || m < worst) worst = m;
    }
    return worst == null ? 0 : worst;
  }

  return engine.cost?.totals?.project_margin_pct ?? 0;
}

// ── 5. Can ship check (multi-tier-aware) ───────────────────────────────────
// Returns true only when ALL tiers can ship (no hard_fails, margin floor OK).
// Single-tier: pass through engine.can_ship.
export function getCanShip(evaluated) {
  const engine = evaluated?.engine;
  if (!engine) return false;

  if (engine.is_multi_tier && Array.isArray(engine.tiers)) {
    return engine.tiers.every(t => t?.can_ship === true);
  }

  return engine.can_ship === true;
}

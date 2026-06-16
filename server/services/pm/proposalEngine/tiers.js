// ────────────────────────────────────────────────────────────────────────────
// Multi-tier helpers.
//
// A spec can carry `spec.tiers[]` (1–3 entries). Each tier has:
//   - tier_id              UUID for stable ref
//   - label                e.g., "Solar only", "Solar + battery", "Solar + battery + EV"
//   - system_overrides     fields that override base spec.system for this tier
//   - pricing              per-tier customer_price + discount
//   - cost_overrides       per-tier labour/compliance/custom (P4 overlay)
//   - is_recommended       rep flag (exactly one tier should be true)
//
// Shared across all tiers (top-level on spec): customer, bills, preferences,
// site_survey, and the BASE system config (panel, inverter, smart_meter,
// string_topology, string_design, cable_run_metres_estimate, phase).
//
// Engine logic:
//   buildEffectiveSpec(spec, tier) merges the tier's overrides over the base
//   to produce a runnable single-spec. The rest of the engine consumes it
//   exactly like any other spec.
// ────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

// Generate a stable tier_id if a tier doesn't have one yet.
export function ensureTierIds(spec) {
  if (!Array.isArray(spec.tiers)) return spec;
  let mutated = false;
  const tiers = spec.tiers.map(t => {
    if (t.tier_id) return t;
    mutated = true;
    return { ...t, tier_id: crypto.randomUUID() };
  });
  return mutated ? { ...spec, tiers } : spec;
}

// Returns the spec a single-tier engine run would consume for THIS tier.
// Base spec.system is shallow-merged with tier.system_overrides; tier.pricing
// becomes spec.pricing; tier.cost_overrides becomes spec.cost_overrides.
// All other top-level fields (customer, bills, preferences, site_survey)
// are inherited unchanged.
export function buildEffectiveSpec(spec, tier) {
  const baseSystem = spec.system || {};
  const overrides = tier.system_overrides || {};

  // Shallow-merge of system. For nested objects (battery, string_design,
  // smart_meter), the tier override replaces the base entirely when present.
  // `null` explicitly removes (e.g., battery: null on a solar-only tier).
  const mergedSystem = { ...baseSystem };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) mergedSystem[k] = null;        // explicit removal
    else mergedSystem[k] = v;                       // replace
  }

  const effective = {
    ...spec,
    system: mergedSystem,
    pricing: tier.pricing || spec.pricing,
    cost_overrides: tier.cost_overrides || spec.cost_overrides,
  };
  // Strip the tiers array so downstream code doesn't recurse.
  delete effective.tiers;
  return effective;
}

// Validate the tier-shape itself before running per-tier engine.
// Returns array of { path, message } errors (empty when valid).
export function validateTiers(spec) {
  const errors = [];
  if (!Array.isArray(spec.tiers)) return errors;        // single-tier mode
  if (spec.tiers.length === 0) {
    errors.push({ path: 'tiers', message: 'tiers array cannot be empty when present' });
    return errors;
  }
  if (spec.tiers.length > 3) {
    errors.push({ path: 'tiers', message: `max 3 tiers allowed (got ${spec.tiers.length})` });
  }

  const recommendedCount = spec.tiers.filter(t => t.is_recommended === true).length;
  if (recommendedCount > 1) {
    errors.push({ path: 'tiers',
      message: `exactly one tier may be marked is_recommended (got ${recommendedCount})` });
  }

  const labels = new Set();
  for (const [i, t] of spec.tiers.entries()) {
    if (!t.label || typeof t.label !== 'string') {
      errors.push({ path: `tiers[${i}].label`, message: 'tier label required' });
    } else if (labels.has(t.label)) {
      errors.push({ path: `tiers[${i}].label`, message: `duplicate tier label "${t.label}"` });
    } else {
      labels.add(t.label);
    }
    // Pricing object is required (carries discount/stage/etc.) but the
    // customer_price_inc_gst inside it is now OPTIONAL — null means
    // auto-priced from the live engine. Only validate type if it's set.
    if (!t.pricing) {
      errors.push({ path: `tiers[${i}].pricing`, message: 'each tier needs a pricing object' });
    } else if (t.pricing.customer_price_inc_gst != null
            && typeof t.pricing.customer_price_inc_gst !== 'number') {
      errors.push({ path: `tiers[${i}].pricing.customer_price_inc_gst`,
                    message: 'customer_price_inc_gst must be a number or null' });
    }
  }
  return errors;
}

// Pick which tier the proposal's headline numbers come from.
// Returns the tier_id (or null in single-tier mode).
export function pickHeadlineTierId(spec) {
  if (!Array.isArray(spec.tiers) || spec.tiers.length === 0) return null;
  const rec = spec.tiers.find(t => t.is_recommended === true);
  if (rec) return rec.tier_id;
  // Fallback: middle tier when there are 3, last when 2, only when 1
  const i = spec.tiers.length === 3 ? 1 : spec.tiers.length - 1;
  return spec.tiers[i].tier_id;
}

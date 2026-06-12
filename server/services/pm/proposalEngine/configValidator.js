// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Config (spec.json) validator
//
// Schema validation for the 6-section spec.json. Run before the cost +
// engineering engines so they can assume well-formed input.
//
// Returns: { valid: boolean, errors: [{ path, message }] }
//
// Pure function — no I/O, no DB.
// ────────────────────────────────────────────────────────────────────────────

import { getCatalogue } from './catalogue/index.js';
import { REGIONS, COMPATIBILITY } from './data/engineeringRules.js';

const STAGES = ['stage_1_estimate', 'stage_2_firm'];
const STRING_TOPOLOGIES = ['series', 'parallel'];
const BACKUP_PRIORITIES = ['essentials_only', 'whole_home_essentials',
                          'multi_day_resilience', 'not_sure'];
const DECISION_MAKERS = ['solo', 'two_signers'];
const PROPERTY_OWNERSHIPS = ['own', 'mortgaged', 'rent'];

function err(errors, path, message) { errors.push({ path, message }); }

function requireField(obj, path, errors, message) {
  if (obj == null || obj === '') err(errors, path, message || `${path} is required`);
}

function checkType(value, type, path, errors) {
  if (value == null) return;
  if (type === 'string' && typeof value !== 'string') err(errors, path, `${path} must be a string`);
  if (type === 'number' && (typeof value !== 'number' || isNaN(value))) err(errors, path, `${path} must be a number`);
  if (type === 'integer' && !Number.isInteger(value)) err(errors, path, `${path} must be an integer`);
  if (type === 'boolean' && typeof value !== 'boolean') err(errors, path, `${path} must be a boolean`);
  if (type === 'array' && !Array.isArray(value)) err(errors, path, `${path} must be an array`);
  if (type === 'object' && (typeof value !== 'object' || Array.isArray(value))) err(errors, path, `${path} must be an object`);
}

function checkRange(value, min, max, path, errors) {
  if (value == null) return;
  if (min != null && value < min) err(errors, path, `${path} must be ≥ ${min}`);
  if (max != null && value > max) err(errors, path, `${path} must be ≤ ${max}`);
}

function checkEnum(value, allowed, path, errors) {
  if (value == null) return;
  if (!allowed.includes(value)) {
    err(errors, path, `${path} must be one of: ${allowed.join(', ')}`);
  }
}

// ── Section validators ─────────────────────────────────────────────────────

function validateCustomer(c, errors) {
  if (!c) { err(errors, 'customer', 'customer section required'); return; }
  requireField(c.full_name, 'customer.full_name', errors);
  requireField(c.email, 'customer.email', errors);
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) {
    err(errors, 'customer.email', 'customer.email is not a valid email format');
  }
  if (!c.address) {
    err(errors, 'customer.address', 'customer.address required');
  } else {
    requireField(c.address.street, 'customer.address.street', errors);
    requireField(c.address.suburb, 'customer.address.suburb', errors);
    requireField(c.address.city, 'customer.address.city', errors);
    requireField(c.address.region, 'customer.address.region', errors);
    if (c.address.region && !REGIONS[c.address.region]) {
      err(errors, 'customer.address.region',
        `unknown region "${c.address.region}". Allowed: ${Object.keys(REGIONS).join(', ')}`);
    }
  }
  if (c.property_ownership) checkEnum(c.property_ownership,
    PROPERTY_OWNERSHIPS, 'customer.property_ownership', errors);
}

function validateBills(b, errors) {
  if (!b) { err(errors, 'bills', 'bills section required'); return; }
  const hasArray = Array.isArray(b.bills) && b.bills.length > 0;
  const hasManual = b.manual_entry &&
                    typeof b.manual_entry.annual_kwh === 'number' &&
                    typeof b.manual_entry.annual_spend === 'number';
  if (!hasArray && !hasManual) {
    err(errors, 'bills', 'either bills[] (with at least 1 bill) or manual_entry (annual_kwh + annual_spend) required');
  }
  if (hasArray) {
    b.bills.forEach((bill, i) => {
      requireField(bill.kwh, `bills.bills[${i}].kwh`, errors);
      requireField(bill.total, `bills.bills[${i}].total`, errors);
      requireField(bill.days, `bills.bills[${i}].days`, errors);
    });
  }
  if (hasManual) {
    checkRange(b.manual_entry.annual_kwh, 1000, 60000, 'bills.manual_entry.annual_kwh', errors);
    checkRange(b.manual_entry.annual_spend, 100, 20000, 'bills.manual_entry.annual_spend', errors);
  }
}

function validateSystem(s, errors, catalogue) {
  if (!s) { err(errors, 'system', 'system section required'); return; }
  const { PANELS, INVERTERS, BATTERIES, SMART_METERS } = catalogue;

  // Panel
  if (!s.panel) {
    err(errors, 'system.panel', 'system.panel required');
  } else {
    requireField(s.panel.sku, 'system.panel.sku', errors);
    if (s.panel.sku && !PANELS[s.panel.sku]) {
      err(errors, 'system.panel.sku',
        `unknown panel SKU "${s.panel.sku}". Allowed: ${Object.keys(PANELS).join(', ')}`);
    }
    requireField(s.panel.count, 'system.panel.count', errors);
    checkType(s.panel.count, 'integer', 'system.panel.count', errors);
    checkRange(s.panel.count, 4, 60, 'system.panel.count', errors);
  }

  // Inverter
  if (!s.inverter) {
    err(errors, 'system.inverter', 'system.inverter required');
  } else {
    requireField(s.inverter.sku, 'system.inverter.sku', errors);
    if (s.inverter.sku && !INVERTERS[s.inverter.sku]) {
      err(errors, 'system.inverter.sku',
        `unknown inverter SKU "${s.inverter.sku}". Allowed: ${Object.keys(INVERTERS).join(', ')}`);
    }
  }

  // Battery (optional)
  if (s.battery && s.battery.sku) {
    if (!BATTERIES[s.battery.sku]) {
      err(errors, 'system.battery.sku',
        `unknown battery SKU "${s.battery.sku}". Allowed: ${Object.keys(BATTERIES).join(', ')}`);
    }
    requireField(s.battery.module_count, 'system.battery.module_count', errors);
    checkType(s.battery.module_count, 'integer', 'system.battery.module_count', errors);
    checkRange(s.battery.module_count, 1, 24, 'system.battery.module_count', errors);

    // Compatibility check (battery requires Plus inverter)
    if (s.inverter && s.inverter.sku && COMPATIBILITY[s.inverter.sku]) {
      if (!COMPATIBILITY[s.inverter.sku].battery_capable) {
        err(errors, 'system.battery',
          `inverter ${s.inverter.sku} is not battery-capable (requires Plus variant)`);
      } else if (BATTERIES[s.battery.sku]) {
        const series = BATTERIES[s.battery.sku].series;
        if (!COMPATIBILITY[s.inverter.sku].compatible_battery_series.includes(series)) {
          err(errors, 'system.battery',
            `battery series ${series} not compatible with inverter ${s.inverter.sku}`);
        }
      }
    }
  }

  // Smart meter
  if (s.smart_meter && s.smart_meter.sku && !SMART_METERS[s.smart_meter.sku]) {
    err(errors, 'system.smart_meter.sku',
      `unknown smart meter SKU. Allowed: ${Object.keys(SMART_METERS).join(', ')}`);
  }

  // String topology
  if (s.string_topology) {
    checkEnum(s.string_topology, STRING_TOPOLOGIES, 'system.string_topology', errors);
  }

  // String design
  if (s.string_design) {
    checkType(s.string_design.panels_per_string, 'integer', 'system.string_design.panels_per_string', errors);
    checkType(s.string_design.string_count, 'integer', 'system.string_design.string_count', errors);
    checkRange(s.string_design.panels_per_string, 2, 30, 'system.string_design.panels_per_string', errors);
    checkRange(s.string_design.string_count, 1, 8, 'system.string_design.string_count', errors);

    if (s.panel?.count && s.string_design.panels_per_string && s.string_design.string_count) {
      const symTotal = s.string_design.panels_per_string * s.string_design.string_count;
      // Option 2 §2.10 — asymmetric layouts add a tail string (e.g. 1×10 + 1×7).
      const asym = s.string_design.asymmetric_string;
      const asymContrib = asym
        ? (Number(asym.panels_per_string) || 0) * (Number(asym.string_count) || 1)
        : 0;
      const declaredTotal = symTotal + asymContrib;
      if (declaredTotal !== s.panel.count) {
        const asymPart = asym ? ` + ${asym.string_count || 1} × ${asym.panels_per_string}` : '';
        err(errors, 'system.string_design',
          `panels_per_string × string_count${asymPart} (${declaredTotal}) must equal panel count (${s.panel.count})`);
      }
    }
  }

  // Cable run estimate
  if (s.cable_run_metres_estimate != null) {
    checkRange(s.cable_run_metres_estimate, 5, 200, 'system.cable_run_metres_estimate', errors);
  }
}

function validatePricing(p, errors) {
  if (!p) { err(errors, 'pricing', 'pricing section required'); return; }
  requireField(p.customer_price_inc_gst, 'pricing.customer_price_inc_gst', errors);
  checkType(p.customer_price_inc_gst, 'number', 'pricing.customer_price_inc_gst', errors);
  checkRange(p.customer_price_inc_gst, 1000, 200000, 'pricing.customer_price_inc_gst', errors);

  if (p.stage) checkEnum(p.stage, STAGES, 'pricing.stage', errors);

  if (p.discount) {
    checkType(p.discount.applied_nzd, 'number', 'pricing.discount.applied_nzd', errors);
    if (p.discount.applied_nzd > 0) {
      requireField(p.discount.reason, 'pricing.discount.reason', errors,
        'discount reason is required whenever discount.applied_nzd > 0');
      if (p.discount.owner_approved !== true) {
        err(errors, 'pricing.discount.owner_approved',
          'discount.owner_approved must be true when discount.applied_nzd > 0');
      }
      requireField(p.discount.approved_by, 'pricing.discount.approved_by', errors);
      requireField(p.discount.approved_at, 'pricing.discount.approved_at', errors);
    }
  }
}

function validatePreferences(p, errors) {
  if (!p) return; // optional section
  if (p.backup_priority) checkEnum(p.backup_priority,
    BACKUP_PRIORITIES, 'preferences.backup_priority', errors);
  if (p.decision_makers) checkEnum(p.decision_makers,
    DECISION_MAKERS, 'preferences.decision_makers', errors);
  if (p.financing && p.financing.term_years != null) {
    checkRange(p.financing.term_years, 1, 30, 'preferences.financing.term_years', errors);
  }
}

function validateSiteSurvey(s, stage, errors) {
  // Only required for Stage 2
  if (stage !== 'stage_2_firm') return;
  if (!s) {
    err(errors, 'site_survey', 'site_survey required for Stage 2 firm quotes');
    return;
  }
  if (s.cable_run_metres_measured != null) {
    checkRange(s.cable_run_metres_measured, 1, 200, 'site_survey.cable_run_metres_measured', errors);
  }
  if (s.switchboard?.spare_rcbo_slots != null) {
    checkRange(s.switchboard.spare_rcbo_slots, 0, 50, 'site_survey.switchboard.spare_rcbo_slots', errors);
  }
}

// ── Public ──────────────────────────────────────────────────────────────────
export function validateSpec(spec, options = {}) {
  const catalogue = getCatalogue(options);
  const errors = [];
  if (!spec || typeof spec !== 'object') {
    return { valid: false, errors: [{ path: 'spec', message: 'spec must be an object' }] };
  }
  validateCustomer(spec.customer, errors);
  validateBills(spec.bills, errors);
  validateSystem(spec.system, errors, catalogue);
  validatePricing(spec.pricing, errors);
  validatePreferences(spec.preferences, errors);
  validateSiteSurvey(spec.site_survey, spec.pricing?.stage || 'stage_1_estimate', errors);
  return { valid: errors.length === 0, errors };
}

// ────────────────────────────────────────────────────────────────────────────
// Engine error → actionable hint mapper.
//
// The engine emits errors as { path, message } (config_errors) or a single
// string (bom_error / cost_error). For the rep we add:
//   - which form tab to open
//   - a human "how to fix" sentence
//
// Path prefixes map to tabs. Specific paths get specific fix hints.
// Bom / cost errors are matched by substring against the message.
// ────────────────────────────────────────────────────────────────────────────

// Prefix → tab key on QuoteFormPage
const PATH_TO_TAB = [
  ['customer',     'customer',    'Customer'],
  ['bills',        'bills',       'Bills'],
  ['system',       'system',      'System'],
  ['pricing',      'pricing',     'Pricing'],
  ['preferences',  'preferences', 'Preferences'],
  ['cost_overrides', 'costs',     'Costs'],
];

function tabForPath(path) {
  if (!path) return { tab: null, tabLabel: null };
  for (const [prefix, tab, tabLabel] of PATH_TO_TAB) {
    if (path === prefix || path.startsWith(prefix + '.') || path.startsWith(prefix + '[')) {
      return { tab, tabLabel };
    }
  }
  return { tab: null, tabLabel: null };
}

// Specific path → fix sentence. Falls back to a generic one keyed off the
// last segment if no exact match.
const SPECIFIC_FIXES = {
  'customer.full_name':           'Enter the customer\'s full name in the Customer tab.',
  'customer.email':               'Enter a valid email (e.g. name@example.com) in the Customer tab.',
  'customer.phone':               'Enter the customer\'s phone number in the Customer tab.',
  'customer.address':             'Open the Customer tab and fill in the street address.',
  'customer.address.street':      'Enter the street address (e.g. "12 Queen St") in the Customer tab.',
  'customer.address.suburb':      'Enter the suburb in the Customer tab.',
  'customer.address.city':        'Enter the city in the Customer tab.',
  'customer.address.postcode':    'Enter the postcode in the Customer tab.',
  'customer.address.region':      'Pick a network region from the dropdown in the Customer tab.',
  'customer.icp_number':          'Enter the 15-digit ICP number from the customer\'s power bill (Customer tab).',
  'customer.property_ownership':  'Set property ownership in the Customer tab.',

  'bills':                        'Open the Bills tab and either add a bill or fill in the manual-entry block.',
  'bills.manual_entry':           'Fill in the manual-entry block (annual kWh, retailer, variable rate, fixed charge) in the Bills tab.',
  'bills.manual_entry.annual_kwh':              'Enter the customer\'s annual kWh consumption in the Bills tab.',
  'bills.manual_entry.annual_spend':            'Enter the customer\'s annual electricity spend in the Bills tab.',
  'bills.manual_entry.retailer':                'Pick the retailer in the Bills tab.',
  'bills.manual_entry.variable_rate_per_kwh_incl_gst': 'Enter the variable rate per kWh (incl GST) in the Bills tab.',
  'bills.manual_entry.daily_fixed_charge_incl_gst':     'Enter the daily fixed charge (incl GST) in the Bills tab.',
  'bills.manual_entry.buyback_rate':            'Enter the buyback rate ($/kWh) in the Bills tab.',

  'system':                       'Open the System tab and pick panel / inverter / battery / smart meter.',
  'system.panel.sku':             'Pick a panel from the dropdown in the System tab.',
  'system.panel.count':           'Enter how many panels in the System tab (must be ≥ 1).',
  'system.inverter.sku':          'Pick an inverter from the dropdown in the System tab.',
  'system.battery.sku':           'Pick a battery from the dropdown in the System tab (or remove the battery block).',
  'system.battery.module_count':  'Set the battery module count in the System tab.',
  'system.smart_meter.sku':       'Pick a smart meter from the dropdown in the System tab.',
  'system.smart_meter.phase':     'Set 1-phase or 3-phase smart meter in the System tab (must match site phase).',
  'system.string_topology':       'Pick "series" or "parallel" string topology in the System tab.',
  'system.string_design.panels_per_string': 'Set panels per string in the System tab.',
  'system.string_design.string_count':       'Set number of strings in the System tab.',
  'system.cable_run_metres_estimate':         'Enter cable-run length (metres) in the System tab.',
  'system.phase':                 'Set site phase (1 or 3) in the System tab.',

  'pricing':                      'Open the Pricing tab and set the customer price (inc GST).',
  'pricing.customer_price_inc_gst': 'Enter the customer price (inc GST) in the Pricing tab.',
  'pricing.stage':                'Pick Stage 1 (estimate) or Stage 2 (firm offer) in the Pricing tab.',

  'preferences':                  'Open the Preferences tab and answer backup priority + decision-maker + financing.',
  'preferences.backup_priority':  'Pick a backup priority in the Preferences tab.',
  'preferences.decision_makers':  'Pick solo or joint-signer in the Preferences tab.',
  'preferences.financing.choice': 'Pick a financing option in the Preferences tab.',
};

function fixHintForPath(path, message) {
  if (!path) return null;
  if (SPECIFIC_FIXES[path]) return SPECIFIC_FIXES[path];
  // Match an enum-violation message like "must be one of: x, y" → reuse it.
  if (/must be one of/i.test(message || '')) {
    return `Pick a valid value from the dropdown for ${path}.`;
  }
  if (/required/i.test(message || '')) {
    return `Fill in ${path}.`;
  }
  if (/must be/i.test(message || '')) {
    return `Adjust ${path}: ${message}.`;
  }
  return null;
}

// Bom / cost errors come back as a single string. Match well-known phrases.
const BOM_HINTS = [
  { rx: /panel.*not found|unknown panel/i,
    hint: 'The panel SKU isn\'t in the catalogue. Pick one from the dropdown in the System tab.' },
  { rx: /inverter.*not found|unknown inverter/i,
    hint: 'The inverter SKU isn\'t in the catalogue. Pick one from the dropdown in the System tab.' },
  { rx: /battery.*not found|unknown battery/i,
    hint: 'The battery SKU isn\'t in the catalogue. Pick one from the dropdown in the System tab.' },
  { rx: /meter.*not found|unknown.*meter/i,
    hint: 'The smart-meter SKU isn\'t in the catalogue. Pick one from the dropdown in the System tab.' },
  { rx: /no compatible|incompatible/i,
    hint: 'These components aren\'t compatible. Try a different panel/inverter/battery combination in the System tab.' },
  { rx: /Voc|voltage/i,
    hint: 'Voltage limits exceeded — reduce panels-per-string or pick a higher-rated inverter in the System tab.' },
];

const COST_HINTS = [
  { rx: /margin|below floor|negative/i,
    hint: 'Cost compute failed because pricing is too low. Raise the customer price (Pricing tab) or reduce custom labour/compliance lines (Costs tab).' },
  { rx: /labour|labor/i,
    hint: 'Labour rate-card lookup failed. Check labour overrides in the Costs tab; ask admin to refresh the rate-card CSV.' },
  { rx: /compliance/i,
    hint: 'Compliance rate-card lookup failed. Check compliance overrides in the Costs tab; ask admin to refresh the rate-card CSV.' },
];

function hintForBomError(message) {
  for (const { rx, hint } of BOM_HINTS) if (rx.test(message || '')) return hint;
  return 'BoM build failed. Re-pick the panel / inverter / battery / smart-meter from the System tab dropdowns.';
}

function hintForCostError(message) {
  for (const { rx, hint } of COST_HINTS) if (rx.test(message || '')) return hint;
  return 'Cost computation failed. Check the Pricing and Costs tabs for invalid overrides.';
}

// Public: normalise any engine refusal (save or preview, single or multi-tier)
// into a flat list of { kind, path, message, tab, tabLabel, hint, tierLabel? }.
export function flattenEngineErrors(refusal) {
  const out = [];
  if (!refusal) return out;

  const push = (e, tierLabel) => out.push({ ...e, tierLabel });

  const fromConfigErrors = (errs, tierLabel) => {
    for (const e of errs || []) {
      const { tab, tabLabel } = tabForPath(e.path);
      push({
        kind: 'config',
        path: e.path,
        message: e.message,
        tab, tabLabel,
        hint: fixHintForPath(e.path, e.message),
      }, tierLabel);
    }
  };
  const fromBomError = (msg, tierLabel) => {
    if (!msg) return;
    push({ kind: 'bom', message: msg, tab: 'system', tabLabel: 'System',
           hint: hintForBomError(msg) }, tierLabel);
  };
  const fromCostError = (msg, tierLabel) => {
    if (!msg) return;
    push({ kind: 'cost', message: msg, tab: 'pricing', tabLabel: 'Pricing',
           hint: hintForCostError(msg) }, tierLabel);
  };

  // Top-level (single-tier or tier-shape errors)
  fromConfigErrors(refusal.config_errors);
  fromBomError(refusal.bom_error);
  fromCostError(refusal.cost_error);

  // Multi-tier — per-tier refusals from PATCH /spec
  for (const t of refusal.tier_errors || []) {
    fromConfigErrors(t.config_errors, t.label);
    fromBomError(t.bom_error, t.label);
    fromCostError(t.cost_error, t.label);
  }
  // Multi-tier — per-tier refusals from preview-validate
  for (const t of refusal.tiers || []) {
    fromConfigErrors(t.config_errors, t.label);
    fromBomError(t.bom_error, t.label);
    fromCostError(t.cost_error, t.label);
  }

  return out;
}

// Public: pull refusal info from a preview-validate response (returns null if
// the engine accepted the spec). Used to drive the same red panel when the
// rep is just typing (no save yet).
export function refusalFromPreview(previewData) {
  if (!previewData || previewData.ok !== false) return null;
  const eng = previewData.engine || {};
  return {
    error: 'Engine refused this spec.',
    config_errors: eng.config_errors,
    bom_error: eng.bom_error,
    cost_error: eng.cost_error,
    tiers: eng.tiers, // per-tier refusals for multi-tier
  };
}

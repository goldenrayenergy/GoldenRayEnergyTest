// ────────────────────────────────────────────────────────────────────────────
// PM Tool — quotes API client (MVP1_001 proposal generator)
//
// Wraps /api/pm/quotes + /api/pm/quotes/:id/* endpoints. Reuses the existing
// axios `api` instance (auth header + baseURL handled there).
// ────────────────────────────────────────────────────────────────────────────

import api from '../../services/api';

export const pmContactsAPI = {
  // Returns 200 + { bills_prefill, analysed_at, retailer, period_*, … }
  // or 204 with no body when the contact has no analyses on file.
  latestBillAnalysis: (contactId) =>
    api.get(`/pm/contacts/${contactId}/latest-bill-analysis`, { validateStatus: s => s === 200 || s === 204 }),
};

// MVP1_003 — live catalogue dropdown options sourced from Supabase products
// table (with engine field-aliasing applied: rated_kw → ac_kw etc.).
export const pmCatalogueAPI = {
  options: () => api.get('/pm/catalogue/options'),
  // P8.6 — active labour + compliance rate-card rows for the Costs tab picker
  costPicker: () => api.get('/pm/catalogue/cost-picker'),
};

// Option 2 — engine-side recommendations. Server reads the live catalogue
// (including mppt_v_min from Option 1) and runs the envelope-search string
// designer to recommend a layout for the given panel + inverter + count.
export const pmProposalEngineAPI = {
  recommendStringLayout: (body) =>
    api.post('/pm/proposal-engine/recommend-string-layout', body),
  // Option 4a — §2.8 decision tree inverter selector
  recommendInverter: (body) =>
    api.post('/pm/proposal-engine/recommend-inverter', body),
  // Option 4b — highest-wattage panel from live catalogue
  recommendPanel: (body) =>
    api.post('/pm/proposal-engine/recommend-panel', body),
  // Option 4b — §3.1 battery selector + module count for backup target
  recommendBattery: (body) =>
    api.post('/pm/proposal-engine/recommend-battery', body),
  // Option 4c — full-system orchestration in a single call (used by the
  // 3-tier autosizer to populate Tier 1 / Tier 2 / Tier 3 from one input).
  composeSystem: (body) =>
    api.post('/pm/proposal-engine/compose-system', body),
  // Option 4c (b) — server-side 3-tier composer with fallback handling
  composeThreeTiers: (body) =>
    api.post('/pm/proposal-engine/compose-three-tiers', body),
  // Option 4c — tier-strip multipliers + labels (read-only for now)
  tierSettings: () =>
    api.get('/pm/proposal-engine/tier-settings'),
};

export const pmQuotesAPI = {
  // CRUD
  list:        (params) => api.get('/pm/quotes', { params }),
  get:         (id)     => api.get(`/pm/quotes/${id}`),
  create:      (body)   => api.post('/pm/quotes', body),
  patchSpec:   (id, spec) => api.patch(`/pm/quotes/${id}/spec`, { spec }),
  withdraw:    (id)     => api.delete(`/pm/quotes/${id}`),
  versions:    (id)     => api.get(`/pm/quotes/${id}/versions`),

  // Validation
  validate:    (id)     => api.post(`/pm/quotes/${id}/validate`),
  // P6 — stateless live preview (does NOT persist; just runs the engine)
  previewValidate: (spec) => api.post('/pm/quotes/preview-validate', { spec }),

  // Discount workflow
  requestDiscount: (id, body) =>
    api.post(`/pm/quotes/${id}/discount-request`, body),
  decideDiscount:  (id, body) =>
    api.post(`/pm/quotes/${id}/discount-approve`, body),

  // Stage 1 → Stage 2 collapse — promotes the chosen tier into a single-tier
  // firm quote. `body.tier_id` optional; defaults to the recommended tier.
  convertToFirm: (id, body = {}) =>
    api.post(`/pm/quotes/${id}/convert-to-firm`, body),

  // P9 — Admin archive / unarchive (soft-archive, preserves history)
  archive:     (id, reason) => api.post(`/pm/quotes/${id}/archive`, { reason }),
  unarchive:   (id)         => api.post(`/pm/quotes/${id}/unarchive`),

  // Lifecycle (Day 5 endpoints — used by Day 7 detail page)
  generate:    (id)     => api.post(`/pm/quotes/${id}/generate`),
  email:       (id, body) => api.post(`/pm/quotes/${id}/email`, body),
  sign:        (id, body) => api.post(`/pm/quotes/${id}/sign`, body),
  counterSign: (id, body) => api.post(`/pm/quotes/${id}/counter-sign`, body),
  deposit:     (id, body) => api.post(`/pm/quotes/${id}/deposit`, body),
  auditLog:    (id)     => api.get(`/pm/quotes/${id}/audit-log`),
  pdfUrl:      (id, kind = 'customer', version) =>
    api.get(`/pm/quotes/${id}/pdf`, { params: { kind, version } }),
};

// ── Reference data the form needs (mirror of server catalogue) ──────────────
// These DON'T change customer-to-customer — they describe the SKUs available.
// Sourced from server/services/pm/proposalEngine/data/catalogue.js. Update
// here when a new SKU is added there.
export const REFERENCE = {
  panels: [
    { sku: 'PHN-PNL-595-DRC', label: 'Phono Solar 595W Draco (bifacial N-TOPCon)' },
    { sku: 'PHN-PNL-475-QSR',   label: 'Phono Solar 475W Quasar (all-black)' },
  ],
  inverters: [
    { sku: 'FRN-INV-100-G24P-1P', label: 'Fronius Primo 10kW GEN24 Plus (1-phase, battery-capable)' },
    { sku: 'FRN-INV-100-G24-1P',  label: 'Fronius Primo 10kW GEN24 (1-phase, no battery)' },
  ],
  batteries: [
    { sku: 'BYD-BAT-276-HVM', label: 'BYD HVM 2.76 kWh module', module_kwh: 2.76 },
    { sku: 'BYD-BAT-256-HVS', label: 'BYD HVS 2.56 kWh module', module_kwh: 2.56 },
    { sku: 'FRN-BAT-315-RSV', label: 'Fronius Reserva 3.15 kWh module', module_kwh: 3.15 },
  ],
  smartMeters: [
    { sku: 'FRN-MTR-63-S1P', label: 'Fronius Smart Meter 63A-1 (1-phase)', phase: 1 },
    { sku: 'FRN-MTR-63-S3P', label: 'Fronius Smart Meter 63A-3 (3-phase)', phase: 3 },
  ],
  regions: [
    { value: 'auckland_vector',    label: 'Auckland (Vector)' },
    { value: 'counties_franklin',  label: 'Counties / Franklin' },
    { value: 'northland',          label: 'Northland' },
    { value: 'waikato',            label: 'Waikato' },
    { value: 'bop_tauranga',       label: 'Bay of Plenty / Tauranga' },
    { value: 'taranaki',           label: 'Taranaki / Wairarapa' },
    { value: 'wellington',         label: 'Wellington' },
    { value: 'canterbury',         label: 'Canterbury' },
    { value: 'otago_queenstown',   label: 'Otago / Queenstown' },
  ],
  stages: [
    { value: 'stage_1_estimate', label: 'Stage 1 — Initial estimate' },
    { value: 'stage_2_firm',     label: 'Stage 2 — Firm offer (post site survey)' },
  ],
  topologies: [
    { value: 'series',   label: 'Series (single string per MPPT)' },
    { value: 'parallel', label: 'Parallel (multiple strings per MPPT)' },
  ],
  backupPriorities: [
    { value: 'essentials_only',       label: 'Essentials only (fridge, lights, wifi)' },
    { value: 'whole_home_essentials', label: 'Whole home essentials (+ hot water, heat pump)' },
    { value: 'multi_day_resilience',  label: 'Multi-day resilience (full backup)' },
    { value: 'not_sure',              label: 'Not sure yet — advise me' },
  ],
  decisionMakers: [
    { value: 'solo',         label: 'Solo decision-maker' },
    { value: 'two_signers',  label: 'Two signers required (joint owners)' },
  ],
  propertyOwnership: [
    { value: 'own',       label: 'Own outright' },
    { value: 'mortgaged', label: 'Mortgaged' },
    { value: 'rent',      label: 'Renting (landlord approval required)' },
  ],
  financing: [
    { value: 'cash',                 label: 'Cash (no loan)' },
    { value: 'anz_good_energy',      label: 'ANZ Good Energy Home Loan' },
    { value: 'westpac_warm_up',      label: 'Westpac Warm Up Loan' },
    { value: 'kiwibank_eco_loan',    label: 'Kiwibank Sustainable Energy Loan' },
    { value: 'bnz_healthy_homes',    label: 'BNZ Healthy Homes Loan' },
    { value: 'asb_better_homes',     label: 'ASB Better Homes Top-up' },
    { value: 'auckland_council_ryh', label: 'Auckland Council Retrofit Your Home' },
    { value: 'personal_loan',        label: 'Personal loan' },
    { value: 'other',                label: 'Other / customer-arranged' },
  ],
  statuses: [
    { value: 'draft',                  label: 'Draft' },
    { value: 'pending_owner_review',   label: 'Pending owner review' },
    { value: 'ready_to_generate',      label: 'Ready to generate' },
    { value: 'generated',              label: 'Generated' },
    { value: 'sent_to_customer',       label: 'Sent to customer' },
    { value: 'signed',                 label: 'Signed' },
    { value: 'counter_signed',         label: 'Counter-signed' },
    { value: 'deposit_received',       label: 'Deposit received' },
    { value: 'handed_off',             label: 'Handed off to PM' },
    { value: 'expired',                label: 'Expired' },
    { value: 'withdrawn',              label: 'Withdrawn' },
    { value: 'closed_lost',            label: 'Closed — lost' },
    { value: 'archived',               label: 'Archived (admin only)' },
  ],
};

export function emptySpec(contactDefaults = {}) {
  return {
    customer: {
      full_name: contactDefaults.name || '',
      email:     contactDefaults.email || '',
      phone:     contactDefaults.phone || '',
      address:   { street: '', suburb: '', city: '', postcode: '', region: 'auckland_vector' },
      icp_number: '',
      property_ownership: 'own',
    },
    bills: {
      manual_entry: {
        annual_kwh: 12000, annual_spend: 3500,
        retailer: 'Mercury',
        variable_rate_per_kwh_incl_gst: 0.23,
        daily_fixed_charge_incl_gst: 2.50,
        buyback_rate: 0.09,
      },
    },
    // Option 4c — no hardcoded SKUs. Engine recommends panel / inverter /
    // battery / string layout via composeSystem. New quotes open with
    // SKUs null; rep clicks "Recommend X" or picks from dropdown.
    system: {
      panel:      { sku: null, count: null },
      inverter:   { sku: null },
      battery:    null,                       // null = battery not included
      smart_meter: { sku: null, phase: 1 },
      string_topology: null,
      string_design: { panels_per_string: null, string_count: null },
      cable_run_metres_estimate: 24,
      phase: 1,
    },
    pricing: {
      customer_price_inc_gst: 45000,
      stage: 'stage_1_estimate',
      final_mode: true,
      discount: { applied_nzd: 0, owner_approved: false, reason: null },
    },
    preferences: {
      backup_priority: 'whole_home_essentials',
      decision_makers: 'solo',
      financing: { choice: 'cash' },
    },
  };
}

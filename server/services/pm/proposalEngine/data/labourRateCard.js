// ────────────────────────────────────────────────────────────────────────────
// Proposal engine — Labour + Compliance rate card
//
// Sell-side prices for install labour, supervisor, travel, transport,
// engineering design, inspection, commissioning, grid (DG) application, CoC.
//
// Convention: labour SELLS at these prices. By owner decision 2026-06-05
// labour cost = labour sell (no labour markup); all margin comes from
// hardware. So `cost_nzd` is identical to `sell_ex_gst` for labour lines.
//
// kW complexity tier drives install labour amount:
//   small  → < 8 kW
//   medium → 8–12 kW
//   large  → > 12 kW
// ────────────────────────────────────────────────────────────────────────────

export const LABOUR_RATE_CARD_VERSION = '2026-06-09';

// ── Installation labour by kW tier ──────────────────────────────────────────
export const INSTALLATION_LABOUR = {
  small: {
    sku: 'LAB-INSTALL-SMALL',
    name: 'Installation labour (small system · < 8 kW · 1-2 day crew)',
    cost_nzd: 2500,
    margin_pct: 0,
  },
  medium: {
    sku: 'LAB-INSTALL-MEDIUM',
    name: 'Installation labour (medium system · 8-12 kW · 2-3 day crew)',
    cost_nzd: 4000,
    margin_pct: 0,
  },
  large: {
    sku: 'LAB-INSTALL-LARGE',
    name: 'Installation labour (large system · > 12 kW · 3-4 day crew)',
    cost_nzd: 5500,
    margin_pct: 0,
  },
};

// ── Battery installation premium (extra labour when battery included) ───────
export const BATTERY_INSTALL_PREMIUM = {
  sku: 'LAB-INSTALL-BATTERY',
  name: 'Battery installation premium (BMS commissioning + DC wiring + customer training)',
  cost_nzd: 1500,
  margin_pct: 0,
};

// ── Supervisor + travel + logistics (per job, flat) ─────────────────────────
export const SUPERVISOR = {
  sku: 'LAB-SUPERVISOR',
  name: 'Site supervisor (1 day · 8 hours)',
  cost_nzd: 650,
  margin_pct: 0,
};

export const TRAVEL = {
  sku: 'LAB-TRAVEL',
  name: 'Travel cost (per job)',
  cost_nzd: 350,
  margin_pct: 0,
};

export const LOGISTICS = {
  sku: 'LAB-LOGISTICS',
  name: 'Loading / transport / logistics',
  cost_nzd: 650,
  margin_pct: 0,
};

// ── Compliance + design + commissioning ─────────────────────────────────────
export const SYSTEM_DESIGN = {
  sku: 'CMP-DESIGN',
  name: 'System design & engineering',
  cost_nzd: 400,
  margin_pct: 0,
};

export const INSPECTION_COMPLIANCE = {
  sku: 'CMP-INSPECTION',
  name: 'Independent electrical inspection + Record of Inspection (ROI)',
  cost_nzd: 500,
  margin_pct: 0,
};

export const COMMISSIONING = {
  sku: 'CMP-COMMISSIONING',
  name: 'System commissioning + Solar.web setup + customer training',
  cost_nzd: 500,
  margin_pct: 0,
};

export const GRID_APPLICATION = {
  sku: 'CMP-DG-APPLICATION',
  name: 'Distributed Generation (DG) application to network operator',
  cost_nzd: 250,
  margin_pct: 0,
};

export const COC = {
  sku: 'CMP-COC',
  name: 'Certificate of Compliance (CoC) issued by Licensed Electrical Worker',
  cost_nzd: 150,
  margin_pct: 0,
};

// ── Site survey fee (refundable on install) ─────────────────────────────────
export const SITE_SURVEY_FEE = {
  sku: 'SVY-FEE',
  name: 'Site survey fee (refundable on install)',
  cost_nzd: 150,
  margin_pct: 0,
};

// ── kW tier mapping ─────────────────────────────────────────────────────────
export function selectInstallationLabourTier(systemKw) {
  if (systemKw < 8) return INSTALLATION_LABOUR.small;
  if (systemKw <= 12) return INSTALLATION_LABOUR.medium;
  return INSTALLATION_LABOUR.large;
}

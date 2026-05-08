// ────────────────────────────────────────────────────────────────────────────
// Swim-lane checklist definitions for the PM tool (Phase A).
//
// Each lane has a list of items. Items marked `gateKeeper: true` MUST exist
// (and be completed) before that lane can be marked 'done'. Items not marked
// gate-keeper are supporting context — useful but not blocking.
//
// Project type modifies which items appear: residential rooftop is the
// minimum set; commercial / ground-mount / battery-addon / system-upgrade
// add or remove items.
//
// Keep this file pure data — no DB access, no side effects. The route layer
// composes lane state from this + the project's lane_status JSONB.
// ────────────────────────────────────────────────────────────────────────────

export const LANES = ['sales', 'engineering', 'compliance', 'operations', 'finance'];

// Base set — applies to every project_type
const BASE = {
  sales: [
    { key: 'qualification_call',  label: 'Qualification call done',         gateKeeper: true,  artifactType: null },
    { key: 'customer_profile',    label: 'Customer profile + bills captured', gateKeeper: false, artifactType: null },
    { key: 'proposal_initial',    label: 'Initial proposal sent',           gateKeeper: true,  artifactType: 'proposal_initial_pdf' },
    { key: 'proposal_final',      label: 'Final proposal sent',             gateKeeper: true,  artifactType: 'proposal_final_pdf' },
    { key: 'customer_accepted',   label: 'Customer accepted proposal',      gateKeeper: true,  artifactType: 'acceptance_record' },
    { key: 'contract_signed',     label: 'Contract signed',                 gateKeeper: true,  artifactType: 'signed_contract' },
  ],

  engineering: [
    { key: 'site_survey',         label: 'Site survey completed',           gateKeeper: true,  artifactType: 'site_survey_report' },
    { key: 'system_design',       label: 'System design locked',            gateKeeper: true,  artifactType: 'system_design_pdf' },
    { key: 'sld',                 label: 'Single-line diagram (SLD)',       gateKeeper: true,  artifactType: 'sld_pdf' },
    { key: 'simulation',          label: 'Energy yield simulation',         gateKeeper: false, artifactType: 'simulation_report' },
    { key: 'bom_locked',          label: 'Bill of Materials locked',        gateKeeper: true,  artifactType: null },
  ],

  compliance: [
    { key: 'distributor_app',     label: 'Distributor application submitted', gateKeeper: true, artifactType: 'distributor_application' },
    { key: 'distributor_approved',label: 'Distributor approval received',   gateKeeper: true,  artifactType: 'distributor_approval' },
    { key: 'meter_reconfig',      label: 'Meter reconfiguration requested', gateKeeper: true,  artifactType: null },
    { key: 'coc_issued',          label: 'COC issued by certifying electrician', gateKeeper: true, artifactType: 'coc_pdf' },
    { key: 'distributor_inspect', label: 'Distributor inspection passed',   gateKeeper: true,  artifactType: null },
  ],

  operations: [
    { key: 'materials_ordered',   label: 'Materials ordered',               gateKeeper: true,  artifactType: 'purchase_order' },
    { key: 'materials_received',  label: 'Materials received on site',      gateKeeper: true,  artifactType: null },
    { key: 'install_scheduled',   label: 'Install date confirmed',          gateKeeper: true,  artifactType: null },
    { key: 'install_complete',    label: 'Install completed',               gateKeeper: true,  artifactType: 'install_photos' },
    { key: 'commissioning_form',  label: 'Commissioning form submitted',    gateKeeper: true,  artifactType: 'commissioning_form' },
    { key: 'customer_trained',    label: 'Customer training delivered',     gateKeeper: true,  artifactType: null },
    { key: 'handover_pack',       label: 'Handover pack delivered',         gateKeeper: true,  artifactType: 'handover_pack' },
  ],

  finance: [
    { key: 'finance_method',      label: 'Finance method captured',         gateKeeper: true,  artifactType: null },
    { key: 'deposit_paid',        label: 'Deposit invoiced + received',     gateKeeper: true,  artifactType: null },
    { key: 'progress_paid',       label: 'Progress payment received',       gateKeeper: false, artifactType: null },
    { key: 'final_paid',          label: 'Final invoice paid',              gateKeeper: true,  artifactType: 'final_invoice' },
    { key: 'tax_invoice',         label: 'GST tax invoice issued',          gateKeeper: true,  artifactType: 'tax_invoice' },
  ],
};

// Project-type overrides. Only list deltas — items to ADD or items to mark
// as conditionally optional. Keys not mentioned inherit from BASE as-is.
const TYPE_OVERRIDES = {
  residential_rooftop: {
    // Default — no changes
  },

  commercial: {
    engineering: {
      add: [
        { key: 'switchboard_upgrade', label: 'Switchboard upgrade scoped', gateKeeper: true, artifactType: 'switchboard_assessment' },
        { key: 'structural_signoff',  label: 'Structural engineer sign-off (if roof load >2 kPa)', gateKeeper: true, artifactType: 'structural_signoff' },
      ],
    },
    compliance: {
      add: [
        { key: 'building_consent', label: 'Building consent (commercial)', gateKeeper: true, artifactType: 'building_consent' },
      ],
    },
    finance: {
      // Commercial projects often have multiple progress payments — make it gate-keeper
      modify: { progress_paid: { gateKeeper: true } },
    },
  },

  ground_mount: {
    engineering: {
      add: [
        { key: 'site_civils',         label: 'Civil works plan (concrete + cable trenching)', gateKeeper: true, artifactType: 'civils_plan' },
        { key: 'structural_signoff',  label: 'Structural engineer sign-off (frame design)',   gateKeeper: true, artifactType: 'structural_signoff' },
      ],
    },
    compliance: {
      add: [
        { key: 'resource_consent', label: 'Resource consent (council)',  gateKeeper: true, artifactType: 'resource_consent' },
        { key: 'building_consent', label: 'Building consent (frame)',    gateKeeper: true, artifactType: 'building_consent' },
      ],
    },
  },

  battery_addon: {
    engineering: {
      // No new survey if existing system data on file — but check is needed
      add: [
        { key: 'existing_system_audit', label: 'Existing inverter compatibility audit', gateKeeper: true, artifactType: 'compatibility_audit' },
      ],
    },
  },

  system_upgrade: {
    engineering: {
      add: [
        { key: 'existing_system_audit', label: 'Existing system audit + uplift design', gateKeeper: true, artifactType: 'upgrade_audit' },
      ],
    },
  },
};

/**
 * Compose the full checklist for a given project_type.
 * Returns: { sales: [...], engineering: [...], compliance: [...], operations: [...], finance: [...] }
 */
export function getChecklist(projectType = 'residential_rooftop') {
  const overrides = TYPE_OVERRIDES[projectType] || {};
  const result = {};

  for (const lane of LANES) {
    const baseItems = BASE[lane].map(it => ({ ...it }));
    const ov = overrides[lane] || {};

    // Apply modifications
    if (ov.modify) {
      for (const [key, patch] of Object.entries(ov.modify)) {
        const target = baseItems.find(it => it.key === key);
        if (target) Object.assign(target, patch);
      }
    }

    // Append additions
    if (ov.add) {
      baseItems.push(...ov.add);
    }

    result[lane] = baseItems;
  }

  return result;
}

/**
 * Cross-lane gates — explicit dependencies between lanes. The route layer
 * uses these to compute whether an item can be marked done right now.
 *
 * Format: { lane.item: [ { lane: 'other', item: 'their_item' } ] }
 *   "this item is blocked until ALL listed items are completed"
 */
export const CROSS_LANE_GATES = {
  'operations.materials_ordered': [
    { lane: 'sales',   item: 'contract_signed' },
    { lane: 'finance', item: 'deposit_paid' },
  ],
  'operations.install_scheduled': [
    { lane: 'compliance', item: 'distributor_approved' },
    { lane: 'operations', item: 'materials_received' },
  ],
  'operations.commissioning_form': [
    { lane: 'operations', item: 'install_complete' },
  ],
  'compliance.coc_issued': [
    { lane: 'operations', item: 'install_complete' },
  ],
  'finance.final_paid': [
    { lane: 'operations', item: 'install_complete' },
  ],
};

/**
 * For a given project_type and current lane_status, compute lane-level
 * health for each lane (whether all gate-keeper items are done).
 */
export function computeLaneCompletion(projectType, laneStatus) {
  const checklist = getChecklist(projectType);
  const result = {};
  for (const lane of LANES) {
    const items = checklist[lane];
    const stored = laneStatus?.[lane]?.items || {};
    const gateKeepers = items.filter(it => it.gateKeeper);
    const done = gateKeepers.filter(it => stored[it.key] === true).length;
    const total = gateKeepers.length;
    result[lane] = {
      gate_keepers_done: done,
      gate_keepers_total: total,
      complete: total > 0 && done === total,
    };
  }
  return result;
}

/**
 * Health rollup: derive 'green' | 'amber' | 'red' | 'blocked' from lane_status.
 * Phase A keeps this simple — SLA-driven amber/red comes in Phase B.
 */
export function computeHealth(laneStatus) {
  if (!laneStatus) return 'green';
  for (const lane of LANES) {
    if (laneStatus[lane]?.status === 'blocked') return 'blocked';
  }
  return 'green';
}

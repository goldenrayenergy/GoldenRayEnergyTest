export const PROJECT_STAGES = [
  { id: 'new',          label: 'New',          icon: '🌱', color: '#6B7280', desc: 'Lead captured' },
  { id: 'design',       label: 'Design',       icon: '📐', color: '#1E90FF', desc: 'Site assessment + system design' },
  { id: 'selling',      label: 'Selling',      icon: '💼', color: '#F5A623', desc: 'Proposal + negotiation' },
  { id: 'installation', label: 'Installation', icon: '🔧', color: '#FF6A00', desc: 'Scheduled + in progress' },
  { id: 'maintenance',  label: 'Maintenance',  icon: '🛠️', color: '#2ECC71', desc: 'Post-install support' },
  { id: 'exit',         label: 'Exit',         icon: '🏁', color: '#475569', desc: 'Closed / archived' },
];

export const getStage = (id) => PROJECT_STAGES.find(s => s.id === id) || PROJECT_STAGES[0];
export const stageIndex = (id) => PROJECT_STAGES.findIndex(s => s.id === id);

// Full tab catalog — every possible tab defined in one place
export const TAB_CATALOG = {
  manage:            { label: 'Manage',          desc: 'Stage checklist, linked tasks, internal notes, owner' },
  enquiry:           { label: 'Enquiry',         desc: 'Original website form submission (read-only)' },
  site:              { label: 'Site',            desc: 'Site photos, roof pitch / orientation / area, shading analysis' },
  design:            { label: 'Design',          desc: 'Panel layout, inverter selection, battery sizing, bill of materials' },
  energy:            { label: 'Energy',          desc: 'Simulated annual production chart + load profile + import/export split' },
  'online-proposal': { label: 'Online Proposal', desc: 'Shareable customer-facing quote link, view count, signed status' },
  'pdf-proposal':    { label: 'PDF Proposal',    desc: 'Versioned PDFs (v1, v2...), generate new version, email to customer' },
  schedule:          { label: 'Schedule',        desc: 'Install dates, crew lead, commissioning date' },
  sld:               { label: 'SLD',             desc: 'Single-line diagram upload + preview + version history' },
  payments:          { label: 'Payments',        desc: 'Deposit · progress · final payment schedule with invoices' },
  documents:         { label: 'Documents',       desc: 'Contracts, COC, install photos, maintenance reports' },
  maintenance:       { label: 'Maintenance',     desc: 'Visit history, warranty claims, inverter error log, scheduled visits' },
  overview:          { label: 'Overview',        desc: 'Final project snapshot: system installed, total paid, savings, commissioning cert' },
  nps:               { label: 'NPS',             desc: 'Customer satisfaction score, testimonial, referral + case-study capture' },
};

// Stage-specific tabs (Option A — strict per-stage; no overlap beyond "manage")
export const STAGE_TABS = {
  new:          ['manage', 'enquiry'],
  design:       ['manage', 'site', 'design', 'energy'],
  selling:      ['manage', 'online-proposal', 'pdf-proposal', 'design'],
  installation: ['manage', 'schedule', 'sld', 'payments', 'documents'],
  maintenance:  ['manage', 'maintenance', 'energy', 'payments'],
  exit:         ['overview', 'documents', 'nps'],
};

// Which tabs are fully implemented (rest render a placeholder)
export const IMPLEMENTED_TABS = new Set(['manage', 'enquiry', 'online-proposal', 'pdf-proposal']);

// Per-stage guidance shown in the Manage tab.
// Required items gate forward stage transitions (admins can override).
export const STAGE_CHECKLISTS = {
  new: {
    required: [
      { id: 'new.owner',   label: 'Assign owner' },
      { id: 'new.call',    label: 'Call customer within 24h' },
      { id: 'new.qualify', label: 'Qualify lead (yes/no)' },
    ],
    optional: [
      { id: 'new.enrich', label: 'Enrich contact data' },
      { id: 'new.tags',   label: 'Add tags' },
    ],
  },
  design: {
    required: [
      { id: 'design.photos',     label: 'Upload ≥4 site photos' },
      { id: 'design.roof_data',  label: 'Enter roof data (pitch, orientation, area)' },
      { id: 'design.system',     label: 'Generate system design' },
      { id: 'design.simulation', label: 'Run energy simulation' },
    ],
    optional: [
      { id: 'design.shading',    label: 'Shading analysis' },
      { id: 'design.drone',      label: 'Drone photos' },
      { id: 'design.structural', label: 'Structural engineer report' },
    ],
  },
  selling: {
    required: [
      { id: 'selling.proposal_pdf', label: 'Generate proposal PDF' },
      { id: 'selling.online_link',  label: 'Share online proposal link' },
      { id: 'selling.send_email',   label: 'Send proposal by email' },
      { id: 'selling.followup',     label: 'Schedule follow-up call' },
    ],
    optional: [
      { id: 'selling.revise',   label: 'Revise proposal (v2+)' },
      { id: 'selling.meeting',  label: 'In-person meeting' },
      { id: 'selling.approval', label: 'Manager approval if >$50k' },
    ],
  },
  installation: {
    required: [
      { id: 'install.deposit',    label: 'Confirm deposit received' },
      { id: 'install.schedule',   label: 'Schedule installation date' },
      { id: 'install.crew',       label: 'Assign crew lead' },
      { id: 'install.sld',        label: 'Generate SLD' },
      { id: 'install.commission', label: 'Commission system' },
      { id: 'install.final_pay',  label: 'Collect final payment' },
    ],
    optional: [
      { id: 'install.preinstall',  label: 'Pre-install site meeting' },
      { id: 'install.walkthrough', label: 'Customer walkthrough video' },
    ],
  },
  maintenance: {
    required: [
      { id: 'maint.6mo',     label: '6-month performance check' },
      { id: 'maint.annual',  label: 'Annual maintenance visit' },
      { id: 'maint.monitor', label: 'Monitor inverter errors' },
    ],
    optional: [
      { id: 'maint.warranty', label: 'Warranty claims' },
      { id: 'maint.training', label: 'Customer training' },
    ],
  },
  exit: {
    required: [
      { id: 'exit.invoice', label: 'Settle final invoice' },
      { id: 'exit.nps',     label: 'Send NPS survey' },
    ],
    optional: [
      { id: 'exit.referral',   label: 'Referral request' },
      { id: 'exit.case_study', label: 'Case-study ask' },
    ],
  },
};

// Compute completion for a stage given the stored progress map
export function stageCompletion(stageId, stageProgress) {
  const items = STAGE_CHECKLISTS[stageId]?.required || [];
  const done = items.filter(i => stageProgress?.[i.id] === true).length;
  return { done, total: items.length, complete: done === items.length };
}

// Is moving from `from` to `to` forward in the pipeline?
export function isForward(fromStage, toStage) {
  return stageIndex(toStage) > stageIndex(fromStage);
}

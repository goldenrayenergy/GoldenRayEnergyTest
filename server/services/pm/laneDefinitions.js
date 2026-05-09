// ────────────────────────────────────────────────────────────────────────────
// Swim-lane checklist definitions for the PM tool — Phase A.2 schema engine.
//
// Each item is now a full task definition with:
//   - states           — string[] of allowed states (initial → ... → done)
//   - initialState     — what state a fresh project starts in (default 'not_started')
//   - doneState        — when reached, items[key] flips to true
//   - transitions      — { fromState: [allowedToStates] }
//   - schema.fields    — typed form fields with { key, type, label, options,
//                                                 requiredAt: <state>, ... }
//   - ux               — 'generic' | 'site_survey' | 'system_design' |
//                        'commissioning_form' | 'coc' |
//                        'initial_proposal' | 'final_proposal'
//
// The frontend renders TaskFormGeneric for ux='generic' and a specialized
// component for the rest. The state machine is enforced server-side in the
// lane PATCH endpoint.
// ────────────────────────────────────────────────────────────────────────────

export const LANES = ['sales', 'engineering', 'compliance', 'operations', 'finance'];

// Common field types: text | textarea | number | date | datetime |
//                     select | multiselect | boolean | currency | percent |
//                     phone | email | url
//
// requiredAt: name of the state at which this field must be present to leave it.
//             A field with requiredAt='qualified' means: when transitioning OUT of
//             a state into 'qualified' or later, this field must be set.

// ── Reusable transition helper ──
const linear = (...states) => {
  const t = {};
  for (let i = 0; i < states.length; i++) {
    const next = [];
    if (i + 1 < states.length) next.push(states[i + 1]);
    if (i > 0) next.push(states[i - 1]);  // allow stepping back
    t[states[i]] = next;
  }
  return t;
};

// ── Base set ────────────────────────────────────────────────────────────────
const BASE = {
  sales: [
    {
      key: 'qualification_call', label: 'Qualification call done', gateKeeper: true,
      artifactType: null, ux: 'generic',
      states: ['not_started', 'attempted', 'reached', 'qualified', 'done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started', 'attempted', 'reached', 'qualified', 'done'),
      schema: { fields: [
        { key: 'attempted_at',    type: 'datetime', label: 'Call attempted at',  requiredAt: 'attempted' },
        { key: 'disposition',     type: 'select',   label: 'Outcome', options: ['reached','voicemail','no_answer','wrong_number'], requiredAt: 'attempted' },
        { key: 'rating',          type: 'select',   label: 'Lead rating', options: ['hot','warm','cold'], requiredAt: 'qualified' },
        { key: 'decision_maker',  type: 'boolean',  label: 'Decision-maker confirmed', requiredAt: 'qualified' },
        { key: 'budget_aligned',  type: 'boolean',  label: 'Budget aligned',           requiredAt: 'qualified' },
        { key: 'timeline',        type: 'select',   label: 'Timeline', options: ['immediate','3_months','6_months','12_months','no_timeline'], requiredAt: 'qualified' },
        { key: 'objections',      type: 'textarea', label: 'Objections / questions raised' },
        { key: 'next_action_at',  type: 'date',     label: 'Next follow-up date' },
      ]},
    },
    {
      key: 'customer_profile', label: 'Customer profile + bills captured', gateKeeper: false,
      artifactType: null, ux: 'generic',
      states: ['not_started', 'partial', 'complete', 'done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started', 'partial', 'complete', 'done'),
      schema: { fields: [
        { key: 'occupants',         type: 'number',  label: 'Household occupants' },
        { key: 'daytime_occupancy', type: 'select',  label: 'Daytime occupancy', options: ['always','sometimes','rarely','never'] },
        { key: 'hot_water',         type: 'select',  label: 'Hot water', options: ['electric_cylinder','heat_pump','gas','solar_thermal','other'] },
        { key: 'has_ev',            type: 'boolean', label: 'Has EV (or planned within 2y)' },
        { key: 'has_pool',          type: 'boolean', label: 'Has pool' },
        { key: 'has_heatpump',      type: 'boolean', label: 'Has heat pump' },
        { key: 'bills_supplied',    type: 'number',  label: 'Bills supplied (count)', requiredAt: 'complete' },
        { key: 'bill_analysis_id',  type: 'text',    label: 'Linked bill analysis ID' },
        { key: 'notes',             type: 'textarea',label: 'Profile notes' },
      ]},
    },
    {
      key: 'proposal_initial', label: 'Initial proposal sent', gateKeeper: true,
      artifactType: 'proposal_initial_pdf', ux: 'initial_proposal',
      states: ['not_started', 'drafted', 'sent', 'viewed', 'done'],
      initialState: 'not_started', doneState: 'done',
      transitions: { not_started: ['drafted'], drafted: ['sent','not_started'], sent: ['viewed','drafted'], viewed: ['done','sent'], done: ['viewed'] },
      schema: { fields: [
        { key: 'cost_low',     type: 'currency', label: 'Cost range — low ($NZ)',  requiredAt: 'drafted' },
        { key: 'cost_high',    type: 'currency', label: 'Cost range — high ($NZ)', requiredAt: 'drafted' },
        { key: 'payback_low',  type: 'number',   label: 'Payback — low (years)' },
        { key: 'payback_high', type: 'number',   label: 'Payback — high (years)' },
        { key: 'sent_at',      type: 'datetime', label: 'Sent at',  requiredAt: 'sent' },
        { key: 'sent_via',     type: 'select',   label: 'Sent via', options: ['email','portal_link','both'] },
        { key: 'viewed_at',    type: 'datetime', label: 'Customer viewed at' },
      ]},
    },
    {
      key: 'proposal_final', label: 'Final proposal sent', gateKeeper: true,
      artifactType: 'proposal_final_pdf', ux: 'final_proposal',
      states: ['not_started', 'awaiting_survey', 'drafted', 'sent', 'viewed', 'done'],
      initialState: 'not_started', doneState: 'done',
      transitions: {
        not_started:     ['awaiting_survey'],
        awaiting_survey: ['drafted','not_started'],
        drafted:         ['sent','awaiting_survey'],
        sent:            ['viewed','drafted'],
        viewed:          ['done','sent'],
        done:            ['viewed'],
      },
      schema: { fields: [
        { key: 'locked_cost',     type: 'currency', label: 'Locked cost ($NZ)',  requiredAt: 'drafted' },
        { key: 'locked_payback',  type: 'number',   label: 'Locked payback (yrs)' },
        { key: 'sld_url',         type: 'text',     label: 'SLD reference / URL' },
        { key: 'tc_version',      type: 'text',     label: 'T&Cs version', requiredAt: 'sent' },
        { key: 'sent_at',         type: 'datetime', label: 'Sent at', requiredAt: 'sent' },
        { key: 'viewed_at',       type: 'datetime', label: 'Customer viewed at' },
      ]},
    },
    {
      key: 'customer_accepted', label: 'Customer accepted proposal', gateKeeper: true,
      artifactType: 'acceptance_record', ux: 'generic',
      states: ['not_started', 'sent_to_customer', 'awaiting_signature', 'signed', 'done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started', 'sent_to_customer', 'awaiting_signature', 'signed', 'done'),
      schema: { fields: [
        { key: 'accepted_at',    type: 'datetime', label: 'Accepted at', requiredAt: 'signed' },
        { key: 'method',         type: 'select',   label: 'Method', options: ['portal_signature','email_reply','verbal','paper'], requiredAt: 'signed' },
        { key: 'signature_ip',   type: 'text',     label: 'Signature IP address' },
        { key: 'witness_name',   type: 'text',     label: 'Witness (if paper)' },
      ]},
    },
    {
      key: 'contract_signed', label: 'Contract signed', gateKeeper: true,
      artifactType: 'signed_contract', ux: 'generic',
      states: ['not_started', 'drafted', 'sent_to_customer', 'customer_signed', 'counter_signed', 'done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','drafted','sent_to_customer','customer_signed','counter_signed','done'),
      schema: { fields: [
        { key: 'contract_value',     type: 'currency', label: 'Contract value ($NZ)', requiredAt: 'drafted' },
        { key: 'customer_signed_at', type: 'datetime', label: 'Customer signed at',   requiredAt: 'customer_signed' },
        { key: 'company_signed_at',  type: 'datetime', label: 'Company counter-signed at', requiredAt: 'counter_signed' },
        { key: 'company_signer',     type: 'text',     label: 'Company signer name',  requiredAt: 'counter_signed' },
      ]},
    },
  ],

  engineering: [
    {
      key: 'site_survey', label: 'Site survey completed', gateKeeper: true,
      artifactType: 'site_survey_report', ux: 'site_survey',
      states: ['not_started', 'scheduled', 'on_site', 'review', 'done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started', 'scheduled', 'on_site', 'review', 'done'),
      schema: { fields: [
        { key: 'visit_date',        type: 'datetime', label: 'Visit date',          requiredAt: 'scheduled' },
        { key: 'surveyor',          type: 'text',     label: 'Surveyor name',       requiredAt: 'scheduled' },
        { key: 'roof_orientation',  type: 'select',   label: 'Primary roof aspect', options: ['N','NE','E','SE','S','SW','W','NW'], requiredAt: 'review' },
        { key: 'pitch_deg',         type: 'number',   label: 'Roof pitch (°)',      requiredAt: 'review' },
        { key: 'roof_area_m2',      type: 'number',   label: 'Available roof area (m²)' },
        { key: 'roof_age_yrs',      type: 'number',   label: 'Roof age (years)' },
        { key: 'roof_condition',    type: 'select',   label: 'Roof condition',      options: ['excellent','good','fair','poor'] },
        { key: 'shading_score',     type: 'number',   label: 'Shading score (0-10, 10=no shade)', min: 0, max: 10, requiredAt: 'review' },
        { key: 'switchboard_amp',   type: 'select',   label: 'Switchboard rating',  options: ['60A','80A','100A','200A','other'], requiredAt: 'review' },
        { key: 'meter_type',        type: 'select',   label: 'Meter type',          options: ['smart_import_export','smart_import_only','non_smart','unknown'] },
        { key: 'internet_quality',  type: 'select',   label: 'Internet at site',    options: ['fibre','dsl','wireless','none'] },
        { key: 'structural_ok',     type: 'boolean',  label: 'Structural assessment OK', requiredAt: 'review' },
        { key: 'notes',             type: 'textarea', label: 'Surveyor notes' },
      ]},
      // Specialized UX adds: required-shot photo checklist, GPS capture
    },
    {
      key: 'system_design', label: 'System design locked', gateKeeper: true,
      artifactType: 'system_design_pdf', ux: 'system_design',
      states: ['not_started', 'drafting', 'reviewing', 'approved', 'done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','drafting','reviewing','approved','done'),
      schema: { fields: [
        { key: 'system_size_kw',     type: 'number',  label: 'System size (kW)', requiredAt: 'reviewing' },
        { key: 'panel_count',        type: 'number',  label: 'Panel count',      requiredAt: 'reviewing' },
        { key: 'panel_make',         type: 'text',    label: 'Panel make',       requiredAt: 'reviewing' },
        { key: 'panel_model',        type: 'text',    label: 'Panel model',      requiredAt: 'reviewing' },
        { key: 'inverter_make',      type: 'text',    label: 'Inverter make',    requiredAt: 'reviewing' },
        { key: 'inverter_model',     type: 'text',    label: 'Inverter model',   requiredAt: 'reviewing' },
        { key: 'inverter_kw',        type: 'number',  label: 'Inverter (kW)' },
        { key: 'battery_make',       type: 'text',    label: 'Battery make' },
        { key: 'battery_model',      type: 'text',    label: 'Battery model' },
        { key: 'battery_kwh',        type: 'number',  label: 'Battery (kWh)' },
        { key: 'string_config',      type: 'textarea',label: 'String configuration notes' },
        { key: 'designer',           type: 'text',    label: 'Designer name', requiredAt: 'reviewing' },
        { key: 'reviewed_by',        type: 'text',    label: 'Reviewed by', requiredAt: 'approved' },
        { key: 'approved_at',        type: 'datetime',label: 'Approved at', requiredAt: 'approved' },
      ]},
    },
    {
      key: 'sld', label: 'Single-line diagram (SLD)', gateKeeper: true,
      artifactType: 'sld_pdf', ux: 'generic',
      states: ['not_started', 'drafted', 'reviewed', 'done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','drafted','reviewed','done'),
      schema: { fields: [
        { key: 'version',         type: 'text', label: 'SLD version', requiredAt: 'drafted' },
        { key: 'designer',        type: 'text', label: 'Designer (registered electrician)', requiredAt: 'drafted' },
        { key: 'designer_license',type: 'text', label: 'Designer license #' },
        { key: 'reviewer',        type: 'text', label: 'Reviewer', requiredAt: 'reviewed' },
        { key: 'reviewed_at',     type: 'datetime', label: 'Reviewed at' },
      ]},
    },
    {
      key: 'simulation', label: 'Energy yield simulation', gateKeeper: false,
      artifactType: 'simulation_report', ux: 'generic',
      states: ['not_started','running','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','running','done'),
      schema: { fields: [
        { key: 'tool_used',           type: 'select',  label: 'Tool', options: ['pvsyst','helioscope','solarius','in_house','other'] },
        { key: 'predicted_annual_kwh',type: 'number',  label: 'Predicted annual kWh' },
        { key: 'specific_yield',      type: 'number',  label: 'Specific yield (kWh/kWp)' },
        { key: 'performance_ratio',   type: 'percent', label: 'Performance ratio (%)' },
      ]},
    },
    {
      key: 'bom_locked', label: 'Bill of Materials locked', gateKeeper: true,
      artifactType: null, ux: 'bom_locked',
      states: ['not_started','drafting','locked','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','drafting','locked','done'),
      schema: { fields: [
        { key: 'locked_at',   type: 'datetime',label: 'Locked at',   requiredAt: 'locked' },
        { key: 'locked_by',   type: 'text',    label: 'Locked by',   requiredAt: 'locked' },
        { key: 'lock_notes',  type: 'textarea',label: 'Lock notes' },
      ]},
      // BOM line items and totals are stored in fields.bom (JSONB), populated
      // by the BOM picker in the specialized UX. line_count and bom_total_nzd
      // are computed from fields.bom on save and cached for the upstream
      // suggestion map.
    },
  ],

  compliance: [
    {
      key: 'distributor_app', label: 'Distributor application submitted', gateKeeper: true,
      artifactType: 'distributor_application', ux: 'generic',
      states: ['not_started','drafting','submitted','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','drafting','submitted','done'),
      schema: { fields: [
        { key: 'distributor', type: 'select', label: 'Distributor', options: ['Vector','Powerco','Aurora','Orion','WEL Networks','Unison','MainPower','Network Tasman','Top Energy','Buller Electricity','Westpower','Marlborough Lines','Network Waitaki','Eastland Network','EA Networks','Alpine Energy','Centralines','Counties Energy','Electra','OtagoNet','Scanpower','The Lines Company','Wellington Electricity','other'], requiredAt: 'drafting' },
        { key: 'application_ref', type: 'text', label: 'Application reference', requiredAt: 'submitted' },
        { key: 'declared_kw',     type: 'number', label: 'Declared system size (kW)', requiredAt: 'drafting' },
        { key: 'submitted_at',    type: 'date', label: 'Submitted at', requiredAt: 'submitted' },
      ]},
    },
    {
      key: 'distributor_approved', label: 'Distributor approval received', gateKeeper: true,
      artifactType: 'distributor_approval', ux: 'generic',
      states: ['not_started','awaiting','approved','rejected','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: { not_started:['awaiting'], awaiting:['approved','rejected'], approved:['done'], rejected:['awaiting'], done:['approved'] },
      schema: { fields: [
        { key: 'approval_ref',    type: 'text', label: 'Approval reference' },
        { key: 'approved_at',     type: 'date', label: 'Approval date', requiredAt: 'approved' },
        { key: 'conditions',      type: 'textarea', label: 'Conditions of approval' },
        { key: 'rejection_reason',type: 'textarea', label: 'Rejection reason (if rejected)' },
      ]},
    },
    {
      key: 'meter_reconfig', label: 'Meter reconfiguration requested', gateKeeper: true,
      artifactType: null, ux: 'generic',
      states: ['not_started','requested','scheduled','complete','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','requested','scheduled','complete','done'),
      schema: { fields: [
        { key: 'icp_number',     type: 'text', label: 'ICP number', requiredAt: 'requested' },
        { key: 'retailer',       type: 'text', label: 'Retailer notified',  requiredAt: 'requested' },
        { key: 'requested_at',   type: 'date', label: 'Requested at', requiredAt: 'requested' },
        { key: 'meter_swap_at',  type: 'datetime', label: 'Meter swap appointment' },
        { key: 'meter_type_new', type: 'select',   label: 'New meter type', options: ['smart_import_export','smart_import_only','non_smart'] },
      ]},
    },
    {
      key: 'coc_issued', label: 'COC issued by certifying electrician', gateKeeper: true,
      artifactType: 'coc_pdf', ux: 'coc',
      states: ['not_started','pending','signed','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','pending','signed','done'),
      schema: { fields: [
        { key: 'certifier_name',     type: 'text', label: 'Certifier name', requiredAt: 'signed' },
        { key: 'certifier_license',  type: 'text', label: 'EWRB license #', requiredAt: 'signed', pattern: '^E[0-9]{4,7}$', helpText: 'Format: E followed by 4–7 digits' },
        { key: 'esc_number',         type: 'text', label: 'ESC number', requiredAt: 'signed' },
        { key: 'issue_date',         type: 'date', label: 'Issue date', requiredAt: 'signed' },
        { key: 'work_description',   type: 'textarea', label: 'Description of prescribed electrical work' },
      ]},
    },
    {
      key: 'distributor_inspect', label: 'Distributor inspection passed', gateKeeper: true,
      artifactType: null, ux: 'generic',
      states: ['not_started','scheduled','complete','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','scheduled','complete','done'),
      schema: { fields: [
        { key: 'inspection_at', type: 'datetime', label: 'Inspection at', requiredAt: 'scheduled' },
        { key: 'inspector',     type: 'text', label: 'Inspector name' },
        { key: 'outcome',       type: 'select', label: 'Outcome', options: ['passed','passed_with_notes','failed'], requiredAt: 'complete' },
        { key: 'defects',       type: 'textarea', label: 'Defects (if any)' },
      ]},
    },
  ],

  operations: [
    {
      key: 'materials_ordered', label: 'Materials ordered', gateKeeper: true,
      artifactType: 'purchase_order', ux: 'generic',
      states: ['not_started','drafted','submitted','confirmed','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','drafted','submitted','confirmed','done'),
      schema: { fields: [
        { key: 'po_number',        type: 'text', label: 'PO number',  requiredAt: 'submitted' },
        { key: 'supplier',         type: 'text', label: 'Primary supplier', requiredAt: 'drafted' },
        { key: 'expected_delivery',type: 'date', label: 'Expected delivery', requiredAt: 'submitted' },
        { key: 'order_value',      type: 'currency', label: 'Order value ($NZ)' },
      ]},
    },
    {
      key: 'materials_received', label: 'Materials received on site', gateKeeper: true,
      artifactType: null, ux: 'generic',
      states: ['not_started','partial','complete','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','partial','complete','done'),
      schema: { fields: [
        { key: 'received_at',  type: 'date', label: 'Received at', requiredAt: 'complete' },
        { key: 'received_by',  type: 'text', label: 'Received by', requiredAt: 'complete' },
        { key: 'discrepancies',type: 'textarea', label: 'Missing or damaged items' },
      ]},
    },
    {
      key: 'install_scheduled', label: 'Install date confirmed', gateKeeper: true,
      artifactType: null, ux: 'generic',
      states: ['not_started','date_proposed','customer_confirmed','reminded','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','date_proposed','customer_confirmed','reminded','done'),
      schema: { fields: [
        { key: 'install_date',     type: 'date', label: 'Install date', requiredAt: 'date_proposed' },
        { key: 'lift_method',      type: 'select', label: 'Lift method', options: ['scaffold','ewp_cherry_picker','ladder_only','crane'], requiredAt: 'date_proposed' },
        { key: 'crew_lead',        type: 'text', label: 'Crew lead', requiredAt: 'customer_confirmed' },
        { key: 'crew_members',     type: 'text', label: 'Crew members (comma-separated)' },
        { key: 'customer_notified',type: 'boolean', label: 'Customer notified', requiredAt: 'customer_confirmed' },
        { key: 'reminder_sent_at', type: 'datetime', label: 'Day-before reminder sent at' },
      ]},
    },
    {
      key: 'install_complete', label: 'Install completed', gateKeeper: true,
      artifactType: 'install_photos', ux: 'generic',
      states: ['not_started','in_progress','photos_uploaded','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','in_progress','photos_uploaded','done'),
      schema: { fields: [
        { key: 'completion_date',  type: 'date',     label: 'Completion date', requiredAt: 'in_progress' },
        { key: 'crew_hours',       type: 'number',   label: 'Crew hours' },
        { key: 'system_turned_on', type: 'boolean',  label: 'System turned on + tested', requiredAt: 'photos_uploaded' },
      ]},
    },
    {
      key: 'commissioning_form', label: 'Commissioning form submitted', gateKeeper: true,
      artifactType: 'commissioning_form', ux: 'commissioning_form',
      states: ['not_started','in_progress','submitted','asset_populated','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','in_progress','submitted','asset_populated','done'),
      schema: { fields: [
        // Inverter
        { key: 'inverter_make',     type: 'text', label: 'Inverter make',  requiredAt: 'submitted' },
        { key: 'inverter_model',    type: 'text', label: 'Inverter model', requiredAt: 'submitted' },
        { key: 'inverter_serial',   type: 'text', label: 'Inverter serial #', requiredAt: 'submitted' },
        // Battery (if any)
        { key: 'battery_make',      type: 'text', label: 'Battery make' },
        { key: 'battery_model',     type: 'text', label: 'Battery model' },
        { key: 'battery_serial',    type: 'text', label: 'Battery serial #' },
        // Panels
        { key: 'panel_make',        type: 'text', label: 'Panel make',  requiredAt: 'submitted' },
        { key: 'panel_model',       type: 'text', label: 'Panel model', requiredAt: 'submitted' },
        // Monitoring
        { key: 'monitoring_provider',   type: 'select', label: 'Monitoring provider', options: ['fronius','sungrow','tesla','solaredge','enphase','huawei','growatt','other'] },
        { key: 'monitoring_external_id',type: 'text',   label: 'Monitoring system ID' },
        // Warranty windows
        { key: 'panel_warranty_until',     type: 'date', label: 'Panel warranty until' },
        { key: 'inverter_warranty_until',  type: 'date', label: 'Inverter warranty until' },
        { key: 'battery_warranty_until',   type: 'date', label: 'Battery warranty until' },
        { key: 'workmanship_warranty_until',type: 'date',label: 'Workmanship warranty until' },
        // VPP
        { key: 'vpp_consented',     type: 'boolean', label: 'Customer consented to future VPP enrollment' },
        // Sign-off
        { key: 'commissioned_by',   type: 'text',     label: 'Commissioned by', requiredAt: 'submitted' },
        { key: 'commissioned_at',   type: 'datetime', label: 'Commissioned at', requiredAt: 'submitted' },
      ]},
      // Specialized UX: validates inverter+battery model against vpp_compatible_hardware
      // lookup, auto-populates asset fields on projects_v2 when state → 'asset_populated'
    },
    {
      key: 'customer_trained', label: 'Customer training delivered', gateKeeper: true,
      artifactType: null, ux: 'generic',
      states: ['not_started','session_held','customer_acknowledged','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','session_held','customer_acknowledged','done'),
      schema: { fields: [
        { key: 'session_at',         type: 'datetime', label: 'Session at', requiredAt: 'session_held' },
        { key: 'trainer',            type: 'text',     label: 'Trainer', requiredAt: 'session_held' },
        { key: 'monitoring_login_ok',type: 'boolean',  label: 'Customer logged into monitoring app', requiredAt: 'customer_acknowledged' },
        { key: 'topics_covered',     type: 'textarea', label: 'Topics covered' },
      ]},
    },
    {
      key: 'handover_pack', label: 'Handover pack delivered', gateKeeper: true,
      artifactType: 'handover_pack', ux: 'generic',
      states: ['not_started','assembled','delivered','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','assembled','delivered','done'),
      schema: { fields: [
        { key: 'manuals_included',         type: 'boolean', label: 'Manuals included',         requiredAt: 'assembled' },
        { key: 'coc_copy_included',        type: 'boolean', label: 'COC copy included',        requiredAt: 'assembled' },
        { key: 'warranty_cards_included',  type: 'boolean', label: 'Warranty cards included',  requiredAt: 'assembled' },
        { key: 'monitoring_login_included',type: 'boolean', label: 'Monitoring login included',requiredAt: 'assembled' },
        { key: 'delivered_at',             type: 'datetime',label: 'Delivered at',             requiredAt: 'delivered' },
        { key: 'customer_acknowledged',    type: 'boolean', label: 'Customer signed for it' },
      ]},
    },
  ],

  finance: [
    {
      key: 'finance_method', label: 'Finance method captured', gateKeeper: true,
      artifactType: null, ux: 'generic',
      states: ['not_started','discussed','captured','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','discussed','captured','done'),
      schema: { fields: [
        { key: 'method',          type: 'select', label: 'Method', options: ['cash','bank_loan','green_loan','interest_free','ppa','mixed'], requiredAt: 'captured' },
        { key: 'lender',          type: 'text',   label: 'Lender (if loan)' },
        { key: 'consultation_notes',type: 'textarea', label: 'Consultation notes' },
      ]},
    },
    {
      key: 'deposit_paid', label: 'Deposit invoiced + received', gateKeeper: true,
      artifactType: null, ux: 'generic',
      states: ['not_started','invoiced','partial','received','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','invoiced','partial','received','done'),
      schema: { fields: [
        { key: 'invoice_ref',      type: 'text',     label: 'Invoice ref',      requiredAt: 'invoiced' },
        { key: 'invoice_amount',   type: 'currency', label: 'Invoice amount ($NZ)', requiredAt: 'invoiced' },
        { key: 'invoice_sent_at',  type: 'date',     label: 'Invoice sent at',  requiredAt: 'invoiced' },
        { key: 'received_amount',  type: 'currency', label: 'Received amount ($NZ)', requiredAt: 'received' },
        { key: 'received_at',      type: 'date',     label: 'Received at',      requiredAt: 'received' },
      ]},
    },
    {
      key: 'progress_paid', label: 'Progress payment received', gateKeeper: false,
      artifactType: null, ux: 'generic',
      states: ['not_started','invoiced','received','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','invoiced','received','done'),
      schema: { fields: [
        { key: 'invoice_ref',     type: 'text',     label: 'Invoice ref' },
        { key: 'invoice_amount',  type: 'currency', label: 'Invoice amount ($NZ)' },
        { key: 'received_amount', type: 'currency', label: 'Received amount ($NZ)' },
        { key: 'received_at',     type: 'date',     label: 'Received at' },
      ]},
    },
    {
      key: 'final_paid', label: 'Final invoice paid', gateKeeper: true,
      artifactType: 'final_invoice', ux: 'generic',
      states: ['not_started','invoiced','partial','received','reconciled','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','invoiced','partial','received','reconciled','done'),
      schema: { fields: [
        { key: 'invoice_ref',      type: 'text',     label: 'Invoice ref',      requiredAt: 'invoiced' },
        { key: 'invoice_amount',   type: 'currency', label: 'Invoice amount ($NZ)', requiredAt: 'invoiced' },
        { key: 'received_amount',  type: 'currency', label: 'Received amount ($NZ)', requiredAt: 'received' },
        { key: 'received_at',      type: 'date',     label: 'Received at',      requiredAt: 'received' },
        { key: 'reconciled_at',    type: 'date',     label: 'Reconciled at',    requiredAt: 'reconciled' },
      ]},
    },
    {
      key: 'tax_invoice', label: 'GST tax invoice issued', gateKeeper: true,
      artifactType: 'tax_invoice', ux: 'generic',
      states: ['not_started','draft','issued','done'],
      initialState: 'not_started', doneState: 'done',
      transitions: linear('not_started','draft','issued','done'),
      schema: { fields: [
        { key: 'tax_invoice_ref',  type: 'text', label: 'Tax invoice ref',  requiredAt: 'issued' },
        { key: 'gst_amount',       type: 'currency', label: 'GST amount ($NZ)', requiredAt: 'issued' },
        { key: 'issued_at',        type: 'date', label: 'Issued at', requiredAt: 'issued' },
      ]},
    },
  ],
};

// Project-type overrides — additions and modifications
const TYPE_OVERRIDES = {
  residential_rooftop: {},

  commercial: {
    engineering: {
      add: [
        {
          key: 'switchboard_upgrade', label: 'Switchboard upgrade scoped', gateKeeper: true,
          artifactType: 'switchboard_assessment', ux: 'generic',
          states: ['not_started','assessed','quoted','done'],
          initialState: 'not_started', doneState: 'done',
          transitions: linear('not_started','assessed','quoted','done'),
          schema: { fields: [
            { key: 'current_amp',  type: 'number', label: 'Current rating (A)', requiredAt: 'assessed' },
            { key: 'required_amp', type: 'number', label: 'Required rating (A)', requiredAt: 'assessed' },
            { key: 'upgrade_cost', type: 'currency', label: 'Upgrade cost ($NZ)' },
          ]},
        },
        {
          key: 'structural_signoff', label: 'Structural engineer sign-off', gateKeeper: true,
          artifactType: 'structural_signoff', ux: 'generic',
          states: ['not_started','requested','signed_off','done'],
          initialState: 'not_started', doneState: 'done',
          transitions: linear('not_started','requested','signed_off','done'),
          schema: { fields: [
            { key: 'engineer_name',    type: 'text', label: 'Engineer name', requiredAt: 'signed_off' },
            { key: 'engineer_cpeng',   type: 'text', label: 'CPEng / IPENZ #' },
            { key: 'roof_load_kpa',    type: 'number', label: 'Existing roof load capacity (kPa)' },
            { key: 'sign_off_date',    type: 'date', label: 'Sign-off date', requiredAt: 'signed_off' },
          ]},
        },
      ],
    },
    compliance: {
      add: [
        {
          key: 'building_consent', label: 'Building consent (commercial)', gateKeeper: true,
          artifactType: 'building_consent', ux: 'generic',
          states: ['not_started','submitted','approved','done'],
          initialState: 'not_started', doneState: 'done',
          transitions: linear('not_started','submitted','approved','done'),
          schema: { fields: [
            { key: 'council',          type: 'text', label: 'Council', requiredAt: 'submitted' },
            { key: 'application_ref',  type: 'text', label: 'Application reference', requiredAt: 'submitted' },
            { key: 'submitted_at',     type: 'date', label: 'Submitted at', requiredAt: 'submitted' },
            { key: 'approved_at',      type: 'date', label: 'Approved at', requiredAt: 'approved' },
          ]},
        },
      ],
    },
    finance: {
      modify: { progress_paid: { gateKeeper: true } },
    },
  },

  ground_mount: {
    engineering: {
      add: [
        {
          key: 'site_civils', label: 'Civil works plan', gateKeeper: true,
          artifactType: 'civils_plan', ux: 'generic',
          states: ['not_started','planning','approved','done'],
          initialState: 'not_started', doneState: 'done',
          transitions: linear('not_started','planning','approved','done'),
          schema: { fields: [
            { key: 'foundation_type', type: 'select', label: 'Foundation', options: ['ground_screws','concrete_piers','ballast','driven_piles'] },
            { key: 'cable_run_m',     type: 'number', label: 'Cable run length (m)' },
          ]},
        },
        {
          key: 'structural_signoff', label: 'Structural engineer sign-off (frame)', gateKeeper: true,
          artifactType: 'structural_signoff', ux: 'generic',
          states: ['not_started','requested','signed_off','done'],
          initialState: 'not_started', doneState: 'done',
          transitions: linear('not_started','requested','signed_off','done'),
          schema: { fields: [
            { key: 'engineer_name', type: 'text', label: 'Engineer name', requiredAt: 'signed_off' },
            { key: 'sign_off_date', type: 'date', label: 'Sign-off date', requiredAt: 'signed_off' },
          ]},
        },
      ],
    },
    compliance: {
      add: [
        {
          key: 'resource_consent', label: 'Resource consent (council)', gateKeeper: true,
          artifactType: 'resource_consent', ux: 'generic',
          states: ['not_started','submitted','approved','done'],
          initialState: 'not_started', doneState: 'done',
          transitions: linear('not_started','submitted','approved','done'),
          schema: { fields: [
            { key: 'council',         type: 'text', label: 'Council', requiredAt: 'submitted' },
            { key: 'application_ref', type: 'text', label: 'Application ref', requiredAt: 'submitted' },
          ]},
        },
        {
          key: 'building_consent', label: 'Building consent (frame)', gateKeeper: true,
          artifactType: 'building_consent', ux: 'generic',
          states: ['not_started','submitted','approved','done'],
          initialState: 'not_started', doneState: 'done',
          transitions: linear('not_started','submitted','approved','done'),
          schema: { fields: [
            { key: 'council',         type: 'text', label: 'Council', requiredAt: 'submitted' },
            { key: 'application_ref', type: 'text', label: 'Application ref', requiredAt: 'submitted' },
          ]},
        },
      ],
    },
  },

  battery_addon: {
    engineering: {
      add: [
        {
          key: 'existing_system_audit', label: 'Existing inverter compatibility audit', gateKeeper: true,
          artifactType: 'compatibility_audit', ux: 'generic',
          states: ['not_started','assessed','done'],
          initialState: 'not_started', doneState: 'done',
          transitions: linear('not_started','assessed','done'),
          schema: { fields: [
            { key: 'existing_inverter_make',  type: 'text', label: 'Existing inverter make' },
            { key: 'existing_inverter_model', type: 'text', label: 'Existing inverter model' },
            { key: 'battery_compatible',      type: 'boolean', label: 'Compatible with chosen battery' },
            { key: 'firmware_update_needed',  type: 'boolean', label: 'Firmware update needed' },
          ]},
        },
      ],
    },
  },

  system_upgrade: {
    engineering: {
      add: [
        {
          key: 'existing_system_audit', label: 'Existing system audit + uplift design', gateKeeper: true,
          artifactType: 'upgrade_audit', ux: 'generic',
          states: ['not_started','assessed','designed','done'],
          initialState: 'not_started', doneState: 'done',
          transitions: linear('not_started','assessed','designed','done'),
          schema: { fields: [
            { key: 'current_kw',  type: 'number', label: 'Current system (kW)' },
            { key: 'target_kw',   type: 'number', label: 'Target system (kW)' },
            { key: 'reuse_existing_inverter', type: 'boolean', label: 'Reuse existing inverter' },
          ]},
        },
      ],
    },
  },
};

/**
 * Compose the full checklist for a given project_type.
 */
export function getChecklist(projectType = 'residential_rooftop') {
  const overrides = TYPE_OVERRIDES[projectType] || {};
  const result = {};
  for (const lane of LANES) {
    const baseItems = BASE[lane].map(it => ({ ...it }));
    const ov = overrides[lane] || {};
    if (ov.modify) {
      for (const [key, patch] of Object.entries(ov.modify)) {
        const target = baseItems.find(it => it.key === key);
        if (target) Object.assign(target, patch);
      }
    }
    if (ov.add) baseItems.push(...ov.add);
    result[lane] = baseItems;
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// Cross-lane gates — keyed by `lane.item.targetState`.
//
// A gate fires when transitioning INTO that target state. Each entry lists
// the upstream tasks that must be `done` before the transition is allowed.
//
// When targetState === doneState the gate behaves like the original Phase A
// behaviour. With this richer keying we can also enforce intermediate-state
// gates (e.g., Stage-2 proposal can't be drafted until site survey is done).
//
// Blockers reference an upstream task by lane + item key. By default the
// upstream must be in its doneState; pass `state: '<state>'` to require a
// specific intermediate state.
// ────────────────────────────────────────────────────────────────────────────
export const CROSS_LANE_GATES = {
  // ── Hard sequential gates (Phase A) ──
  'operations.materials_ordered.drafted': [
    { lane: 'sales',   item: 'contract_signed' },
    { lane: 'finance', item: 'deposit_paid' },
  ],
  'operations.install_scheduled.date_proposed': [
    { lane: 'compliance', item: 'distributor_approved' },
    { lane: 'operations', item: 'materials_received' },
  ],
  'operations.commissioning_form.in_progress': [
    { lane: 'operations', item: 'install_complete' },
  ],
  'compliance.coc_issued.pending': [
    { lane: 'operations', item: 'install_complete' },
  ],
  'finance.final_paid.invoiced': [
    { lane: 'operations', item: 'install_complete' },
  ],

  // ── Soft gates promoted to enforced (Phase A.2.3) ──
  // Stage-2 proposal cannot begin drafting until the site survey is complete.
  'sales.proposal_final.drafted': [
    { lane: 'engineering', item: 'site_survey' },
    // Stage 2 has locked pricing — needs BOM finalised (Phase A.2.6).
    { lane: 'engineering', item: 'bom_locked' },
  ],
  // Distributor application needs declared system size from the design.
  'compliance.distributor_app.drafting': [
    { lane: 'engineering', item: 'system_design' },
  ],
  // BOM cannot be locked until system design is approved.
  'engineering.bom_locked.locked': [
    { lane: 'engineering', item: 'system_design' },
  ],

  // ── Phase A.2.6: additional Sales↔Engineering / Operations↔Compliance gates ──
  // Don't dispatch a designer to a tire-kicker — qualify the lead first.
  'engineering.site_survey.scheduled': [
    { lane: 'sales', item: 'qualification_call' },
  ],
  // Contract value comes from the BOM. No BOM, no contract.
  'sales.contract_signed.drafted': [
    { lane: 'engineering', item: 'bom_locked' },
  ],
  // Distributor will only inspect after commissioning is complete.
  'compliance.distributor_inspect.scheduled': [
    { lane: 'operations', item: 'commissioning_form' },
  ],
};

// ── Gate-check helper ──
// Returns { ok, blockers } where blockers is an array of { lane, item, state }
// describing what's missing.
export function checkCrossLaneGate(laneStatus, lane, item, targetState) {
  const key  = `${lane}.${item}.${targetState}`;
  const deps = CROSS_LANE_GATES[key];
  if (!deps) return { ok: true, blockers: [] };
  const blockers = deps.filter(d => {
    const upstream = laneStatus?.[d.lane]?.items?.[d.item];
    return upstream !== true;
  });
  return blockers.length === 0 ? { ok: true, blockers: [] } : { ok: false, blockers };
}

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

export function computeHealth(laneStatus) {
  if (!laneStatus) return 'green';
  for (const lane of LANES) {
    if (laneStatus[lane]?.status === 'blocked') return 'blocked';
  }
  return 'green';
}

// ── Upstream field map ─────────────────────────────────────────────────────
// Reduces typing for engineers/installers by pre-populating downstream
// task fields from already-captured upstream values. Keys are the
// downstream task ('lane.item') and values map downstream-field-key →
// 'lane.item.field_key' source path.
//
// The frontend uses this to suggest values; users always click to confirm
// (so they can override if reality differs from the plan — e.g., installer
// substituted a different panel model).

export const UPSTREAM_FIELD_MAP = {
  'sales.proposal_initial': {
    // Stage 1 cost range can hint from bill analysis later (Phase B)
  },
  'sales.proposal_final': {
    locked_cost:     'engineering.bom_locked.bom_total_nzd',
  },
  'sales.contract_signed': {
    contract_value:  'engineering.bom_locked.bom_total_nzd',
  },
  'compliance.distributor_app': {
    declared_kw:     'engineering.system_design.system_size_kw',
  },
  'operations.materials_ordered': {
    order_value:     'engineering.bom_locked.bom_total_nzd',
  },
  'operations.commissioning_form': {
    inverter_make:   'engineering.system_design.inverter_make',
    inverter_model:  'engineering.system_design.inverter_model',
    battery_make:    'engineering.system_design.battery_make',
    battery_model:   'engineering.system_design.battery_model',
    panel_make:      'engineering.system_design.panel_make',
    panel_model:     'engineering.system_design.panel_model',
  },
  'finance.deposit_paid': {
    invoice_amount:  'sales.contract_signed.contract_value',  // typically deposit % of contract; user adjusts
  },
  'finance.final_paid': {
    invoice_amount:  'sales.contract_signed.contract_value',
  },
};

/**
 * Resolve upstream field suggestions for a task. Returns an object of
 * { field_key: { value, source_lane, source_item, source_field } } for
 * fields where the upstream task has a value AND the downstream task does
 * not yet have one.
 */
export function getUpstreamSuggestions(lane, item, downstreamFields, laneStatus) {
  const map = UPSTREAM_FIELD_MAP[`${lane}.${item}`];
  if (!map) return {};
  const suggestions = {};
  for (const [downKey, sourcePath] of Object.entries(map)) {
    const [srcLane, srcItem, srcField] = sourcePath.split('.');
    const srcValue = laneStatus?.[srcLane]?.item_meta?.[srcItem]?.fields?.[srcField];
    const downValue = downstreamFields?.[downKey];
    if (srcValue !== undefined && srcValue !== null && srcValue !== '' &&
        (downValue === undefined || downValue === null || downValue === '')) {
      suggestions[downKey] = {
        value: srcValue,
        source_lane: srcLane,
        source_item: srcItem,
        source_field: srcField,
      };
    }
  }
  return suggestions;
}

// ── Auto-advance helpers ───────────────────────────────────────────────────

/**
 * Given the task definition, current state, and supplied fields + lane status,
 * compute the highest state reachable by walking the transition graph forward
 * while:
 *   - all required fields up to that state are filled
 *   - all cross-lane gates at each step are satisfied
 * Returns the target state (may equal currentState if nothing advances).
 */
export function computeReachableState(itemDef, currentState, fields, laneStatus, lane, item) {
  let state = currentState;
  const stateOrder = itemDef.states || [];
  // Safety: bail at 20 hops to prevent any infinite loop on a malformed graph
  for (let hop = 0; hop < 20; hop++) {
    const allowed = (itemDef.transitions?.[state] || []).filter(s =>
      stateOrder.indexOf(s) > stateOrder.indexOf(state)  // forward-only auto-advance
    );
    if (allowed.length === 0) break;
    // Pick the next state in declared order — for branching state machines we
    // advance along the "approved" branch (states declared earlier), never
    // along reject/error branches.
    const next = allowed.sort((a, b) => stateOrder.indexOf(a) - stateOrder.indexOf(b))[0];

    const v = validateTransition(itemDef, state, next, fields);
    if (!v.ok) break;
    const gate = checkCrossLaneGate(laneStatus, lane, item, next);
    if (!gate.ok) break;

    state = next;
  }
  return state;
}

/**
 * Identify why a task can't advance to its next forward state.
 * Returns { current_state, next_state, missing_fields[], cross_lane_blockers[] }
 * Used by the UI to render "Waiting on:" hints.
 */
export function getNextStateBlockers(itemDef, currentState, fields, laneStatus, lane, item) {
  const stateOrder = itemDef.states || [];
  const allowed = (itemDef.transitions?.[currentState] || []).filter(s =>
    stateOrder.indexOf(s) > stateOrder.indexOf(currentState)
  );
  if (allowed.length === 0) return { current_state: currentState, next_state: null, missing_fields: [], cross_lane_blockers: [] };

  const next = allowed.sort((a, b) => stateOrder.indexOf(a) - stateOrder.indexOf(b))[0];
  const v    = validateTransition(itemDef, currentState, next, fields || {});
  const gate = checkCrossLaneGate(laneStatus, lane, item, next);

  return {
    current_state:       currentState,
    next_state:          next,
    missing_fields:      v.ok ? [] : (v.missing_fields || []),
    cross_lane_blockers: gate.ok ? [] : gate.blockers,
  };
}

/**
 * Build a per-(lane, item) blockers map for the entire project. Used by the
 * detail GET response so the UI can show lock icons in the swim-lane card view
 * without a round-trip per task.
 */
export function computeAllTaskBlockers(projectType, laneStatus) {
  const checklist = getChecklist(projectType);
  const out = {};
  for (const lane of LANES) {
    out[lane] = {};
    const stored      = laneStatus?.[lane]?.item_meta || {};
    const itemsBools  = laneStatus?.[lane]?.items || {};
    for (const def of checklist[lane]) {
      const meta  = stored[def.key] || {};
      // Fallback for legacy data: if items[key]=true but no meta.state, treat as doneState.
      const state = meta.state
        || (itemsBools[def.key] === true ? def.doneState : (def.initialState || 'not_started'));
      out[lane][def.key] = {
        ...getNextStateBlockers(def, state, meta.fields || {}, laneStatus, lane, def.key),
        upstream_suggestions: getUpstreamSuggestions(lane, def.key, meta.fields || {}, laneStatus),
      };
    }
  }
  return out;
}

/**
 * Validate that a state transition is allowed and required fields are present.
 * Returns { ok: true } or { ok: false, error, missing_fields? }
 */
export function validateTransition(itemDef, fromState, toState, fields) {
  const allowed = itemDef.transitions?.[fromState] || [];
  if (!allowed.includes(toState)) {
    return { ok: false, error: `Cannot transition from '${fromState}' to '${toState}'. Allowed: ${allowed.join(', ') || '(none)'}` };
  }
  // Check fields requiredAt this target state (or earlier states reached on the way)
  const stateOrder = itemDef.states || [];
  const toIdx = stateOrder.indexOf(toState);
  const required = (itemDef.schema?.fields || []).filter(f => {
    if (!f.requiredAt) return false;
    const reqIdx = stateOrder.indexOf(f.requiredAt);
    return reqIdx >= 0 && reqIdx <= toIdx;
  });
  const missing = required.filter(f => fields?.[f.key] === undefined || fields[f.key] === null || fields[f.key] === '');
  if (missing.length > 0) {
    return { ok: false, error: 'Required fields missing', missing_fields: missing.map(f => ({ key: f.key, label: f.label })) };
  }
  return { ok: true };
}

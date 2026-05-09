// ────────────────────────────────────────────────────────────────────────────
// Seed v2 — fixtures that cover every Phase A.2.x feature.
//
// Cleans up any prior PM seeds (marker [PM_TEST_SEED] or [PM_TEST_SEED_V2])
// then inserts five projects, each at a different point in the lifecycle so
// you can immediately test:
//
//   01  Fresh enquiry          → tests early gates (engineering.site_survey
//                                 blocked by sales.qualification_call)
//   02  Qualified, designing   → tests Stage-2 + contract gates blocked on BOM
//   03  Sold, ordering         → tests install gates / mid-flow lane states
//   04  Installed, awaiting    → tests COC unblocking, distributor_inspect
//       commission                gate, asset population about to fire
//   05  Fully commissioned     → tests read-only lock, Reopen flow, lane
//                                 auto-DONE, asset/VPP fields populated
//
// Every item_meta entry uses the proper { state, fields } shape so the new
// state-machine UX (Phase A.2.3+) renders correctly without legacy fallback.
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('Missing SUPABASE_DATABASE_URL / DATABASE_URL'); process.exit(1); }
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const MARKER = '[PM_TEST_SEED_V2]';

// ── Helpers ──────────────────────────────────────────────────────────────
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString(); }
function hoursAgo(n) { return new Date(Date.now() - n * 3600000).toISOString(); }

function done(fields = {}, daysAgoCompleted = 1) {
  return { state: 'done', fields, completed_at: daysAgo(daysAgoCompleted) };
}
function partial(state, fields = {}) {
  return { state, fields };
}

// Default empty lane state
function lane(itemsAndMeta, status = 'in_progress') {
  const items     = {};
  const item_meta = {};
  for (const [k, v] of Object.entries(itemsAndMeta)) {
    if (v.state === 'done') items[k] = true;
    item_meta[k] = v;
  }
  const result = { status, items, item_meta };
  if (status === 'done') result.completed_at = daysAgo(1);
  return result;
}

const emptyLane = { status: 'not_started', items: {}, item_meta: {} };

// ── Fixtures ─────────────────────────────────────────────────────────────

const fixtures = [
  // ── 01. Fresh enquiry ──────────────────────────────────────────────────
  {
    label: 'Smith family — fresh enquiry, nothing started',
    project_type: 'residential_rooftop',
    address: '12 Beach Road', suburb: 'Browns Bay', city: 'Auckland',
    region: 'auckland', postcode: '0630',
    estimated_value_nzd: 14500,
    notes: `${MARKER} Came in via website form. Not contacted yet. Use this to test that engineering.site_survey can't be scheduled until sales.qualification_call.done.`,
    lane_status: {
      sales:       emptyLane,
      engineering: emptyLane,
      compliance:  emptyLane,
      operations:  emptyLane,
      finance:     emptyLane,
    },
  },

  // ── 02. Qualified, designing ───────────────────────────────────────────
  {
    label: 'Patel commercial — qualified, mid-design',
    project_type: 'commercial',
    address: '88 Industrial Drive', suburb: 'Penrose', city: 'Auckland',
    region: 'auckland', postcode: '1061',
    system_size_kw: 49.5, panel_count: 110, system_type: 'on-grid',
    estimated_value_nzd: 132000,
    notes: `${MARKER} Manufacturing premises. Stage 1 sent, customer keen. Engineering progressing — open Sales.proposal_final or Sales.contract_signed to see they're blocked on bom_locked (Phase A.2.6 gate).`,
    lane_status: {
      sales: lane({
        qualification_call: done({
          attempted_at: hoursAgo(96), disposition: 'reached',
          rating: 'hot', decision_maker: true, budget_aligned: true,
          timeline: '3_months', objections: 'Asked about commercial rebate eligibility',
        }, 4),
        customer_profile: done({
          occupants: 0, daytime_occupancy: 'always',
          hot_water: 'electric_cylinder', has_ev: false, has_pool: false, has_heatpump: true,
          bills_supplied: 12,
        }, 4),
        proposal_initial: partial('sent', {
          cost_low: 118000, cost_high: 142000,
          payback_low: 4, payback_high: 6,
          sent_at: hoursAgo(48), sent_via: 'email',
        }),
        proposal_final:    partial('not_started'),
        customer_accepted: partial('not_started'),
        contract_signed:   partial('not_started'),
      }, 'in_progress'),

      engineering: lane({
        site_survey: done({
          visit_date: daysAgo(3), surveyor: 'Mike R',
          roof_orientation: 'N', pitch_deg: 8, roof_area_m2: 600, roof_age_yrs: 4,
          roof_condition: 'excellent', shading_score: 9, switchboard_amp: '200A',
          meter_type: 'smart_import_export', internet_quality: 'fibre',
          structural_ok: true,
        }, 3),
        system_design: partial('reviewing', {
          system_size_kw: 49.5, panel_count: 110,
          panel_make: 'Jinko', panel_model: 'Tiger Neo 450W',
          inverter_make: 'Sungrow', inverter_model: 'SG50RT', inverter_kw: 50,
          designer: 'Mike R',
        }),
        switchboard_upgrade: done({
          current_amp: 200, required_amp: 200, upgrade_cost: 0,
        }, 2),
        structural_signoff: partial('not_started'),
        sld:           partial('not_started'),
        simulation:    partial('not_started'),
        bom_locked:    partial('not_started'),
      }, 'in_progress'),

      compliance: emptyLane,
      operations: emptyLane,
      finance: lane({
        finance_method: partial('captured', { method: 'bank_loan', lender: 'ASB Green Loan' }),
        deposit_paid:   partial('not_started'),
        progress_paid:  partial('not_started'),
        final_paid:     partial('not_started'),
        tax_invoice:    partial('not_started'),
      }, 'in_progress'),
    },
  },

  // ── 03. Sold, ordering materials ───────────────────────────────────────
  {
    label: 'Whangarei battery add-on — sold, ordering materials',
    project_type: 'battery_addon',
    address: '5 Coastal View', suburb: 'One Tree Point', city: 'Whangarei',
    region: 'northland', postcode: '0118',
    battery_kwh: 13.5, system_type: 'hybrid',
    estimated_value_nzd: 18500,
    notes: `${MARKER} Adding Sungrow SBR096 battery to existing 6.6 kW Sungrow inverter. Sales + Engineering done. Compliance distributor approved. Materials ordered. Use to test install_scheduled gate (waiting on materials_received) and lane auto-DONE (Engineering should auto-DONE).`,
    lane_status: {
      sales: lane({
        qualification_call: done({ disposition: 'reached', rating: 'hot', decision_maker: true, budget_aligned: true, timeline: 'immediate' }, 30),
        customer_profile:   done({ occupants: 4, daytime_occupancy: 'rarely', has_ev: true, bills_supplied: 6 }, 28),
        proposal_initial:   done({ cost_low: 17000, cost_high: 19500, payback_low: 9, payback_high: 11, sent_at: daysAgo(25), viewed_at: daysAgo(24), sent_via: 'portal_link' }, 22),
        proposal_final:     done({ locked_cost: 18500, locked_payback: 10, sent_at: daysAgo(20), tc_version: '2026.1', viewed_at: daysAgo(19) }, 18),
        customer_accepted:  done({ accepted_at: daysAgo(17), method: 'portal_signature', signature_ip: '203.97.x.x' }, 17),
        contract_signed:    done({ contract_value: 18500, customer_signed_at: daysAgo(16), company_signed_at: daysAgo(15), company_signer: 'Sarah Chen' }, 15),
      }, 'done'),

      engineering: lane({
        site_survey:   done({ visit_date: daysAgo(26), surveyor: 'Mike R', roof_orientation: 'N', pitch_deg: 22, shading_score: 9, switchboard_amp: '100A', structural_ok: true, internet_quality: 'fibre' }, 26),
        system_design: done({ system_size_kw: 6.6, panel_count: 16, panel_make: 'Jinko', panel_model: 'Tiger Neo 410W', inverter_make: 'Sungrow', inverter_model: 'SH10RT', inverter_kw: 10, battery_make: 'Sungrow', battery_model: 'SBR096', battery_kwh: 13.5, designer: 'Mike R', reviewed_by: 'Sarah Chen', approved_at: daysAgo(20) }, 20),
        sld:           done({ version: 'v1', designer: 'Mike R', designer_license: 'E12345', reviewer: 'Sarah Chen', reviewed_at: daysAgo(19) }, 19),
        simulation:    done({ tool_used: 'pvsyst', predicted_annual_kwh: 9800, specific_yield: 1485, performance_ratio: 84 }, 19),
        bom_locked:    done({ bom_total_nzd: 18500, line_count: 14, locked_at: daysAgo(18), locked_by: 'Mike R', lock_notes: 'Locked at customer acceptance' }, 18),
        existing_system_audit: done({ existing_inverter_make: 'Sungrow', existing_inverter_model: 'SG6K', battery_compatible: true, firmware_update_needed: true }, 22),
      }, 'done'),

      compliance: lane({
        distributor_app:      done({ distributor: 'Top Energy', application_ref: 'TE-2026-0042', declared_kw: 6.6, submitted_at: daysAgo(14) }, 14),
        distributor_approved: done({ approval_ref: 'TE-2026-0042-A', approved_at: daysAgo(10), conditions: 'Standard export limit 5kW' }, 10),
        meter_reconfig:       partial('scheduled', { icp_number: '1000234567XX1', retailer: 'Mercury', requested_at: daysAgo(8), meter_swap_at: daysAgo(-2) }),
        coc_issued:           partial('not_started'),
        distributor_inspect:  partial('not_started'),
      }, 'in_progress'),

      operations: lane({
        materials_ordered:   done({ po_number: 'PO-2026-0091', supplier: 'Solarworx NZ', expected_delivery: daysAgo(-3), order_value: 14200 }, 9),
        materials_received:  partial('partial', { received_at: daysAgo(2), received_by: 'Crew lead' }),
        install_scheduled:   partial('not_started'),
        install_complete:    partial('not_started'),
        commissioning_form:  partial('not_started'),
        customer_trained:    partial('not_started'),
        handover_pack:       partial('not_started'),
      }, 'in_progress'),

      finance: lane({
        finance_method: done({ method: 'cash' }, 16),
        deposit_paid:   done({ invoice_ref: 'INV-2026-0091', invoice_amount: 5550, invoice_sent_at: daysAgo(15), received_amount: 5550, received_at: daysAgo(13) }, 13),
        progress_paid:  partial('not_started'),
        final_paid:     partial('not_started'),
        tax_invoice:    partial('not_started'),
      }, 'in_progress'),
    },
  },

  // ── 04. Installed, awaiting commission ────────────────────────────────
  {
    label: 'Auckland 12 kW — installed, awaiting commission',
    project_type: 'residential_rooftop',
    address: '47 Kowhai Avenue', suburb: 'Mt Eden', city: 'Auckland',
    region: 'auckland', postcode: '1024',
    system_size_kw: 12.0, battery_kwh: 13.5, panel_count: 28, system_type: 'hybrid',
    estimated_value_nzd: 32500,
    notes: `${MARKER} Installed yesterday. COC issued. Use this project to test the CommissioningForm flow — open Operations.commissioning_form and the ⚡ Commission button is the highlight test.`,
    lane_status: {
      sales: lane({
        qualification_call: done({ disposition: 'reached', rating: 'hot', decision_maker: true, budget_aligned: true, timeline: 'immediate' }, 60),
        customer_profile:   done({ occupants: 3, daytime_occupancy: 'sometimes', has_ev: true, bills_supplied: 12 }, 58),
        proposal_initial:   done({ cost_low: 30000, cost_high: 34000, sent_at: daysAgo(55), viewed_at: daysAgo(54) }, 52),
        proposal_final:     done({ locked_cost: 32500, sent_at: daysAgo(50), viewed_at: daysAgo(49), tc_version: '2026.1' }, 48),
        customer_accepted:  done({ accepted_at: daysAgo(47), method: 'portal_signature' }, 47),
        contract_signed:    done({ contract_value: 32500, customer_signed_at: daysAgo(46), company_signed_at: daysAgo(45), company_signer: 'Sarah Chen' }, 45),
      }, 'done'),

      engineering: lane({
        site_survey:   done({ visit_date: daysAgo(56), surveyor: 'Mike R', roof_orientation: 'N', pitch_deg: 30, shading_score: 8, switchboard_amp: '100A', structural_ok: true, internet_quality: 'fibre' }, 56),
        system_design: done({ system_size_kw: 12, panel_count: 28, panel_make: 'REC', panel_model: 'Alpha Pure-R 430W', inverter_make: 'Fronius', inverter_model: 'GEN24 Plus 10', battery_make: 'BYD', battery_model: 'Premium HVS 12.8', battery_kwh: 12.8, designer: 'Mike R', reviewed_by: 'Sarah Chen', approved_at: daysAgo(50) }, 50),
        sld:           done({ version: 'v2', designer: 'Mike R', designer_license: 'E12345', reviewer: 'Sarah Chen', reviewed_at: daysAgo(49) }, 49),
        simulation:    done({ tool_used: 'pvsyst', predicted_annual_kwh: 17500, specific_yield: 1458, performance_ratio: 83 }, 49),
        bom_locked:    done({ bom_total_nzd: 28200, line_count: 22, locked_at: daysAgo(48), locked_by: 'Mike R' }, 48),
      }, 'done'),

      compliance: lane({
        distributor_app:      done({ distributor: 'Vector', application_ref: 'V-2026-1188', declared_kw: 12, submitted_at: daysAgo(44) }, 44),
        distributor_approved: done({ approval_ref: 'V-2026-1188-A', approved_at: daysAgo(38), conditions: 'Export limit 10kW' }, 38),
        meter_reconfig:       done({ icp_number: '0001112233XX4', retailer: 'Powershop', requested_at: daysAgo(36), meter_swap_at: daysAgo(8), meter_type_new: 'smart_import_export' }, 7),
        coc_issued:           done({ certifier_name: 'Tom Wilson', certifier_license: 'E66789', esc_number: 'ESC-2026-0287', issue_date: daysAgo(1), work_description: 'Solar PV grid-connect with battery storage' }, 1),
        distributor_inspect:  partial('not_started'),
      }, 'in_progress'),

      operations: lane({
        materials_ordered:   done({ po_number: 'PO-2026-0058', supplier: 'Solarworx NZ', expected_delivery: daysAgo(15), order_value: 26800 }, 36),
        materials_received:  done({ received_at: daysAgo(15), received_by: 'Mike R' }, 15),
        install_scheduled:   done({ install_date: daysAgo(2), lift_method: 'scaffold', crew_lead: 'Tom Wilson', crew_members: 'Tom, James, Aaron', customer_notified: true }, 4),
        install_complete:    done({ completion_date: daysAgo(1), crew_hours: 14, system_turned_on: true }, 1),
        commissioning_form:  partial('in_progress', {
          // Some fields pre-filled from system_design via upstream suggestions — test by confirming auto-fill
        }),
        customer_trained:    partial('not_started'),
        handover_pack:       partial('not_started'),
      }, 'in_progress'),

      finance: lane({
        finance_method: done({ method: 'cash' }, 46),
        deposit_paid:   done({ invoice_ref: 'INV-2026-0058D', invoice_amount: 9750, received_amount: 9750, received_at: daysAgo(43) }, 43),
        progress_paid:  done({ invoice_ref: 'INV-2026-0058P', invoice_amount: 13000, received_amount: 13000, received_at: daysAgo(14) }, 14),
        final_paid:     partial('not_started'),
        tax_invoice:    partial('not_started'),
      }, 'in_progress'),
    },
  },

  // ── 05. Fully commissioned (asset) ────────────────────────────────────
  {
    label: 'Wellington 6.6 kW — commissioned, in fleet',
    project_type: 'residential_rooftop',
    address: '23 Tinakori Road', suburb: 'Thorndon', city: 'Wellington',
    region: 'wellington', postcode: '6011',
    system_size_kw: 6.6, battery_kwh: 13.5, panel_count: 16, system_type: 'hybrid',
    estimated_value_nzd: 19800,
    // Asset fields — populated as if Commission was clicked
    inverter_make: 'Sungrow', inverter_model: 'SH10RT', inverter_serial: 'B2244SH10RT-00891',
    battery_make: 'Sungrow', battery_model: 'SBR096', battery_serial: 'B2244SBR096-00457',
    panel_make: 'Jinko', panel_model: 'Tiger Neo 410W',
    panel_warranty_until: '2051-04-15',
    inverter_warranty_until: '2036-04-15',
    battery_warranty_until: '2036-04-15',
    workmanship_warranty_until: '2031-04-15',
    monitoring_provider: 'sungrow', monitoring_external_id: 'iSolarCloud-PLT-227189',
    vpp_capable_hardware: true, vpp_consented: true, vpp_enrolled: false,
    commissioned_at: daysAgo(35),
    notes: `${MARKER} Fully commissioned, in fleet for 35 days. All lanes auto-DONE. Use to test the read-only "✓ Task completed — fields locked" banner and the 🔓 Reopen to edit flow on any task.`,
    lane_status: {
      sales: lane({
        qualification_call: done({ disposition: 'reached', rating: 'hot', decision_maker: true, budget_aligned: true, timeline: 'immediate' }, 100),
        customer_profile:   done({ occupants: 2, daytime_occupancy: 'always', has_ev: false, bills_supplied: 12 }, 95),
        proposal_initial:   done({ cost_low: 18500, cost_high: 21000, sent_at: daysAgo(92), viewed_at: daysAgo(91) }, 88),
        proposal_final:     done({ locked_cost: 19800, sent_at: daysAgo(85), viewed_at: daysAgo(84), tc_version: '2026.1' }, 80),
        customer_accepted:  done({ accepted_at: daysAgo(78), method: 'portal_signature' }, 78),
        contract_signed:    done({ contract_value: 19800, customer_signed_at: daysAgo(76), company_signed_at: daysAgo(75) }, 75),
      }, 'done'),
      engineering: lane({
        site_survey:   done({ visit_date: daysAgo(94), surveyor: 'Mike R', roof_orientation: 'N', pitch_deg: 25, shading_score: 9, switchboard_amp: '100A', structural_ok: true, internet_quality: 'fibre' }, 94),
        system_design: done({ system_size_kw: 6.6, panel_count: 16, panel_make: 'Jinko', panel_model: 'Tiger Neo 410W', inverter_make: 'Sungrow', inverter_model: 'SH10RT', battery_make: 'Sungrow', battery_model: 'SBR096', designer: 'Mike R', reviewed_by: 'Sarah Chen', approved_at: daysAgo(82) }, 82),
        sld:           done({ version: 'v1', designer: 'Mike R', designer_license: 'E12345', reviewer: 'Sarah Chen', reviewed_at: daysAgo(81) }, 81),
        simulation:    done({ tool_used: 'pvsyst', predicted_annual_kwh: 9650, specific_yield: 1462, performance_ratio: 84 }, 81),
        bom_locked:    done({ bom_total_nzd: 17200, line_count: 14, locked_at: daysAgo(80), locked_by: 'Mike R' }, 80),
      }, 'done'),
      compliance: lane({
        distributor_app:      done({ distributor: 'Wellington Electricity', application_ref: 'WE-2026-0091', declared_kw: 6.6, submitted_at: daysAgo(72) }, 72),
        distributor_approved: done({ approval_ref: 'WE-2026-0091-A', approved_at: daysAgo(60), conditions: 'Standard 5kW export' }, 60),
        meter_reconfig:       done({ icp_number: '0009987654XX0', retailer: 'Mercury', requested_at: daysAgo(58), meter_swap_at: daysAgo(50), meter_type_new: 'smart_import_export' }, 50),
        coc_issued:           done({ certifier_name: 'Tom Wilson', certifier_license: 'E66789', esc_number: 'ESC-2026-0185', issue_date: daysAgo(36), work_description: 'Solar PV grid-connect with battery' }, 36),
        distributor_inspect:  done({ inspection_at: daysAgo(34), inspector: 'WE inspector', outcome: 'passed' }, 34),
      }, 'done'),
      operations: lane({
        materials_ordered:   done({ po_number: 'PO-2026-0042', supplier: 'Solarworx NZ', order_value: 16500 }, 65),
        materials_received:  done({ received_at: daysAgo(45), received_by: 'Mike R' }, 45),
        install_scheduled:   done({ install_date: daysAgo(38), lift_method: 'scaffold', crew_lead: 'Tom Wilson', customer_notified: true }, 40),
        install_complete:    done({ completion_date: daysAgo(37), crew_hours: 12, system_turned_on: true }, 37),
        commissioning_form:  done({
          inverter_make: 'Sungrow', inverter_model: 'SH10RT', inverter_serial: 'B2244SH10RT-00891',
          battery_make: 'Sungrow', battery_model: 'SBR096', battery_serial: 'B2244SBR096-00457',
          panel_make: 'Jinko', panel_model: 'Tiger Neo 410W',
          monitoring_provider: 'sungrow', monitoring_external_id: 'iSolarCloud-PLT-227189',
          panel_warranty_until: '2051-04-15', inverter_warranty_until: '2036-04-15',
          battery_warranty_until: '2036-04-15', workmanship_warranty_until: '2031-04-15',
          vpp_consented: true,
          commissioned_by: 'Tom Wilson', commissioned_at: daysAgo(35),
        }, 35),
        customer_trained:    done({ session_at: daysAgo(35), trainer: 'Tom Wilson', monitoring_login_ok: true, topics_covered: 'Monitoring app, system overview, fault response' }, 35),
        handover_pack:       done({ manuals_included: true, coc_copy_included: true, warranty_cards_included: true, monitoring_login_included: true, delivered_at: daysAgo(35), customer_acknowledged: true }, 35),
      }, 'done'),
      finance: lane({
        finance_method: done({ method: 'cash' }, 76),
        deposit_paid:   done({ invoice_ref: 'INV-2026-0042D', invoice_amount: 5940, received_amount: 5940, received_at: daysAgo(73) }, 73),
        progress_paid:  done({ invoice_ref: 'INV-2026-0042P', invoice_amount: 7920, received_amount: 7920, received_at: daysAgo(46) }, 46),
        final_paid:     done({ invoice_ref: 'INV-2026-0042F', invoice_amount: 5940, received_amount: 5940, received_at: daysAgo(34), reconciled_at: daysAgo(33) }, 33),
        tax_invoice:    done({ tax_invoice_ref: 'TI-2026-0042', gst_amount: 2587, issued_at: daysAgo(33) }, 33),
      }, 'done'),
    },
  },
];

// ── DB ops ────────────────────────────────────────────────────────────

async function cleanup() {
  const { rowCount } = await client.query(
    `DELETE FROM projects_v2 WHERE notes LIKE '[PM_TEST_SEED]%' OR notes LIKE '[PM_TEST_SEED_V2]%'`
  );
  console.log(rowCount > 0 ? `🗑  Removed ${rowCount} prior seed project(s)` : '   (no prior seeds to clean)');
}

// ── Project payments seed (mirrors lane_status.finance.* into the
// project_payments table so the Owner Dashboard's cashflow zone can query
// them cleanly) ───────────────────────────────────────────────────────────
async function seedPayments(projectId, slug) {
  const PAYMENTS_BY_SLUG = {
    'residential-15kw-battery-15.2kw-12.6kwh': [],

    // Project 3 — Whangarei battery: deposit paid, progress invoiced
    'whangarei-battery': [
      { event: 'deposit',  expected_at: daysAgo(15).slice(0,10), expected_amount_nzd: 5550, received_at: daysAgo(13), received_amount_nzd: 5550, method: 'bank_transfer', invoice_ref: 'INV-2026-0091D' },
      { event: 'progress', expected_at: daysAgo(-2).slice(0,10), expected_amount_nzd: 7400, received_at: null, received_amount_nzd: null, method: null, invoice_ref: 'INV-2026-0091P' },
    ],

    // Project 4 — Auckland 12kW: deposit + progress paid; final overdue
    'auckland-12kw': [
      { event: 'deposit',  expected_at: daysAgo(43).slice(0,10), expected_amount_nzd:  9750, received_at: daysAgo(43), received_amount_nzd:  9750, method: 'bank_transfer', invoice_ref: 'INV-2026-0058D' },
      { event: 'progress', expected_at: daysAgo(15).slice(0,10), expected_amount_nzd: 13000, received_at: daysAgo(14), received_amount_nzd: 13000, method: 'bank_transfer', invoice_ref: 'INV-2026-0058P' },
      { event: 'final',    expected_at: daysAgo(15).slice(0,10), expected_amount_nzd:  9750, received_at: null,        received_amount_nzd: null,  method: null,            invoice_ref: 'INV-2026-0058F' },  // overdue 15 days
    ],

    // Project 5 — Wellington 6.6kW: all paid + reconciled
    'wellington-66kw': [
      { event: 'deposit',  expected_at: daysAgo(75).slice(0,10), expected_amount_nzd: 5940, received_at: daysAgo(73), received_amount_nzd: 5940, method: 'bank_transfer', invoice_ref: 'INV-2026-0042D' },
      { event: 'progress', expected_at: daysAgo(48).slice(0,10), expected_amount_nzd: 7920, received_at: daysAgo(46), received_amount_nzd: 7920, method: 'bank_transfer', invoice_ref: 'INV-2026-0042P' },
      { event: 'final',    expected_at: daysAgo(35).slice(0,10), expected_amount_nzd: 5940, received_at: daysAgo(34), received_amount_nzd: 5940, method: 'bank_transfer', invoice_ref: 'INV-2026-0042F' },
    ],
  };

  // Match by slug fragment in the address
  let key = null;
  if      (slug.includes('Whangarei'))        key = 'whangarei-battery';
  else if (slug.includes('Auckland 12 kW'))   key = 'auckland-12kw';
  else if (slug.includes('Wellington'))       key = 'wellington-66kw';
  if (!key) return 0;

  const rows = PAYMENTS_BY_SLUG[key] || [];
  for (const r of rows) {
    await client.query(
      `INSERT INTO project_payments (project_id, event, expected_at, expected_amount_nzd, received_at, received_amount_nzd, method, invoice_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [projectId, r.event, r.expected_at, r.expected_amount_nzd, r.received_at, r.received_amount_nzd, r.method, r.invoice_ref]
    );
  }
  return rows.length;
}

async function insertOne(fix) {
  const cols = [
    'project_type','address','suburb','city','region','postcode',
    'system_size_kw','battery_kwh','panel_count','system_type','estimated_value_nzd',
    'lane_status','status','notes',
    'inverter_make','inverter_model','inverter_serial',
    'battery_make','battery_model','battery_serial',
    'panel_make','panel_model',
    'panel_warranty_until','inverter_warranty_until','battery_warranty_until','workmanship_warranty_until',
    'monitoring_provider','monitoring_external_id',
    'vpp_capable_hardware','vpp_consented','vpp_enrolled',
    'commissioned_at',
  ];
  const vals = [
    fix.project_type, fix.address, fix.suburb, fix.city, fix.region, fix.postcode,
    fix.system_size_kw || null, fix.battery_kwh || null, fix.panel_count || null,
    fix.system_type || 'on-grid', fix.estimated_value_nzd || null,
    JSON.stringify(fix.lane_status), 'active', fix.notes,
    fix.inverter_make || null, fix.inverter_model || null, fix.inverter_serial || null,
    fix.battery_make || null, fix.battery_model || null, fix.battery_serial || null,
    fix.panel_make || null, fix.panel_model || null,
    fix.panel_warranty_until || null, fix.inverter_warranty_until || null,
    fix.battery_warranty_until || null, fix.workmanship_warranty_until || null,
    fix.monitoring_provider || null, fix.monitoring_external_id || null,
    fix.vpp_capable_hardware ?? false, fix.vpp_consented ?? false, fix.vpp_enrolled ?? false,
    fix.commissioned_at || null,
  ];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await client.query(
    `INSERT INTO projects_v2 (${cols.join(',')}) VALUES (${placeholders})
       RETURNING id, code`,
    vals
  );
  return rows[0];
}

try {
  await cleanup();
  let totalPayments = 0;
  for (const fix of fixtures) {
    const r = await insertOne(fix);
    const paymentCount = await seedPayments(r.id, fix.label);
    totalPayments += paymentCount;
    console.log(`✅ ${r.code}  ${fix.label}${paymentCount ? `  (+${paymentCount} payments)` : ''}`);
  }
  console.log(`\n${fixtures.length} test projects seeded · ${totalPayments} project_payments rows.`);
  console.log('Open http://localhost:5173/pm');
} catch (e) {
  console.error('❌ Seed failed:', e.message);
  process.exit(1);
}

await client.end();

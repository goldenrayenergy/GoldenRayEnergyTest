// ────────────────────────────────────────────────────────────────────────────
// PM Tool — Owner Dashboard endpoint.
//
// One endpoint returns all 7 zones in a single round-trip:
//   1. Owner Action Queue   — proposals/contracts/commissioning awaiting owner
//   2. Pipeline             — active project counts by lane status + this-week-closed
//   3. Cashflow             — owed/received/overdue from project_payments
//   4. Fleet (VPP)          — commissioned count, kW, VPP-capable %, consented %
//   5. Velocity             — avg time-in-stage from pm_task_events history
//   6. Install Capacity     — install_scheduled dates next 4 weeks vs crew capacity
//   7. Red Flags            — blocked projects, ghosted proposals, monitoring offline
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';
import pool from '../../config/db.js';

const router = Router();
router.use(authenticate);

// Default install crew capacity (overridable later via company_settings)
const DEFAULT_CREW_CAPACITY_PER_WEEK = 4;

router.get('/dashboard', async (_req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    // Run all zone queries in parallel
    const [
      actionQueue,
      pipeline,
      cashflow,
      fleet,
      velocity,
      capacity,
      redFlags,
    ] = await Promise.all([
      buildOwnerActionQueue(),
      buildPipeline(),
      buildCashflow(),
      buildFleet(),
      buildVelocity(),
      buildCapacity(),
      buildRedFlags(),
    ]);

    res.json({
      generated_at: new Date().toISOString(),
      action_queue: actionQueue,
      pipeline,
      cashflow,
      fleet,
      velocity,
      capacity,
      red_flags: redFlags,
    });
  } catch (e) {
    console.error('Owner dashboard error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Zone 1: Owner Action Queue ────────────────────────────────────────────
async function buildOwnerActionQueue() {
  const { rows } = await pool.query(`
    SELECT id, code, contact_id, address, system_size_kw, battery_kwh, lane_status
    FROM projects_v2
    WHERE status = 'active'
    ORDER BY updated_at DESC
    LIMIT 200
  `);

  const queue = [];
  for (const p of rows) {
    const ls = p.lane_status || {};

    // Stage-1 proposal drafted → owner must approve before send
    const initState = ls.sales?.item_meta?.proposal_initial?.state;
    if (initState === 'drafted') {
      queue.push({
        type:        'proposal_initial_approval',
        project_id:  p.id,
        project_code:p.code,
        title:       `Approve & send Stage 1 proposal — ${p.code}`,
        subtitle:    `${p.system_size_kw || '—'} kW${p.battery_kwh ? ` + ${p.battery_kwh} kWh` : ''} · ${p.address || ''}`,
        action_url:  `/pm/projects/${p.id}`,
      });
    }

    // Stage-2 proposal drafted → owner approval before send
    const finState = ls.sales?.item_meta?.proposal_final?.state;
    if (finState === 'drafted') {
      queue.push({
        type:        'proposal_final_approval',
        project_id:  p.id,
        project_code:p.code,
        title:       `Approve & send Stage 2 (locked) proposal — ${p.code}`,
        subtitle:    `${p.system_size_kw || '—'} kW${p.battery_kwh ? ` + ${p.battery_kwh} kWh` : ''} · ${p.address || ''}`,
        action_url:  `/pm/projects/${p.id}`,
      });
    }

    // Customer signed contract → owner counter-signs
    const contractState = ls.sales?.item_meta?.contract_signed?.state;
    if (contractState === 'customer_signed') {
      queue.push({
        type:        'contract_counter_sign',
        project_id:  p.id,
        project_code:p.code,
        title:       `Counter-sign contract — ${p.code}`,
        subtitle:    `Customer has signed; awaiting your counter-signature.`,
        action_url:  `/pm/projects/${p.id}`,
      });
    }

    // Commissioning form submitted → owner QC inspection
    const commState = ls.operations?.item_meta?.commissioning_form?.state;
    if (commState === 'submitted') {
      queue.push({
        type:        'commissioning_qc',
        project_id:  p.id,
        project_code:p.code,
        title:       `QC inspect commissioning — ${p.code}`,
        subtitle:    `Install crew submitted commissioning form. Inspect before final invoice.`,
        action_url:  `/pm/projects/${p.id}`,
      });
    }
  }

  return queue;
}

// ── Zone 2: Pipeline ──────────────────────────────────────────────────────
async function buildPipeline() {
  const { rows: byStatus } = await pool.query(`
    SELECT status, COUNT(*)::int AS n
    FROM projects_v2 GROUP BY status
  `);

  // Lane stage approximation — group active projects by their "furthest progressed" lane state.
  // Simpler approximation: count by which lane is currently in_progress (or done).
  const { rows: laneCounts } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE (lane_status->'sales'->>'status') = 'in_progress' AND
                              (lane_status->'engineering'->>'status') IN ('not_started','in_progress'))::int AS sales_lead,
      COUNT(*) FILTER (WHERE (lane_status->'engineering'->>'status') = 'in_progress' AND
                              (lane_status->'compliance'->>'status') IN ('not_started','in_progress'))::int AS design,
      COUNT(*) FILTER (WHERE (lane_status->'sales'->>'status') = 'done' AND
                              (lane_status->'operations'->>'status') IN ('not_started','in_progress') AND
                              commissioned_at IS NULL)::int AS selling_install,
      COUNT(*) FILTER (WHERE commissioned_at IS NOT NULL)::int AS commissioned,
      COUNT(*) FILTER (WHERE health = 'blocked')::int AS blocked
    FROM projects_v2
    WHERE status = 'active'
  `);

  // Closed/commissioned this week
  const { rows: thisWeek } = await pool.query(`
    SELECT COUNT(*)::int AS closed_count
    FROM projects_v2
    WHERE commissioned_at >= NOW() - INTERVAL '7 days'
  `);

  // Pipeline value (sum of estimated_value_nzd of active projects)
  const { rows: pipelineValue } = await pool.query(`
    SELECT COALESCE(SUM(estimated_value_nzd), 0)::numeric AS total_value
    FROM projects_v2 WHERE status = 'active'
  `);

  return {
    by_status:        Object.fromEntries(byStatus.map(r => [r.status, r.n])),
    lane_buckets:     laneCounts[0] || {},
    closed_this_week: thisWeek[0]?.closed_count || 0,
    total_value_nzd:  Number(pipelineValue[0]?.total_value || 0),
  };
}

// ── Zone 3: Cashflow ──────────────────────────────────────────────────────
async function buildCashflow() {
  // Owed (invoiced but not received) by event type
  const { rows: owed } = await pool.query(`
    SELECT
      event,
      COUNT(*)::int AS n,
      COALESCE(SUM(expected_amount_nzd), 0)::numeric AS amount,
      COUNT(*) FILTER (WHERE expected_at < NOW() - INTERVAL '14 days')::int AS overdue_count,
      COALESCE(SUM(expected_amount_nzd) FILTER (WHERE expected_at < NOW() - INTERVAL '14 days'), 0)::numeric AS overdue_amount
    FROM project_payments
    WHERE received_at IS NULL
    GROUP BY event
  `);

  // Received this month (MTD)
  const { rows: receivedMtd } = await pool.query(`
    SELECT
      COUNT(*)::int AS n,
      COALESCE(SUM(received_amount_nzd), 0)::numeric AS amount
    FROM project_payments
    WHERE received_at >= date_trunc('month', NOW())
  `);

  // Total receivables outstanding (any unreceived)
  const { rows: outstandingTotal } = await pool.query(`
    SELECT COALESCE(SUM(expected_amount_nzd), 0)::numeric AS amount,
           COUNT(*)::int AS n
    FROM project_payments WHERE received_at IS NULL
  `);

  const owedByEvent = Object.fromEntries(owed.map(r => [r.event, r]));

  return {
    owed_deposits:        owedByEvent.deposit  ? { count: owedByEvent.deposit.n,  amount: Number(owedByEvent.deposit.amount) }  : { count: 0, amount: 0 },
    owed_progress:        owedByEvent.progress ? { count: owedByEvent.progress.n, amount: Number(owedByEvent.progress.amount) } : { count: 0, amount: 0 },
    owed_finals:          owedByEvent.final    ? { count: owedByEvent.final.n,    amount: Number(owedByEvent.final.amount) }    : { count: 0, amount: 0 },
    received_mtd:         { count: receivedMtd[0]?.n || 0, amount: Number(receivedMtd[0]?.amount || 0) },
    overdue_total:        {
      count:  owed.reduce((s, r) => s + (r.overdue_count || 0), 0),
      amount: owed.reduce((s, r) => s + Number(r.overdue_amount || 0), 0),
    },
    outstanding_total: { count: outstandingTotal[0]?.n || 0, amount: Number(outstandingTotal[0]?.amount || 0) },
  };
}

// ── Zone 4: Fleet (VPP) ───────────────────────────────────────────────────
async function buildFleet() {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE commissioned_at IS NOT NULL)::int AS commissioned_count,
      COALESCE(SUM(system_size_kw) FILTER (WHERE commissioned_at IS NOT NULL), 0)::numeric AS kw_total,
      COALESCE(SUM(battery_kwh) FILTER (WHERE commissioned_at IS NOT NULL), 0)::numeric AS battery_kwh_total,
      COUNT(*) FILTER (WHERE commissioned_at IS NOT NULL AND vpp_capable_hardware)::int AS vpp_capable,
      COUNT(*) FILTER (WHERE commissioned_at IS NOT NULL AND vpp_consented)::int AS vpp_consented,
      COUNT(*) FILTER (WHERE vpp_enrolled)::int AS vpp_enrolled
    FROM projects_v2
  `);

  const r = rows[0];
  const total = r.commissioned_count;

  return {
    commissioned_count:   r.commissioned_count,
    kw_total:             Number(r.kw_total),
    battery_kwh_total:    Number(r.battery_kwh_total),
    vpp_capable:          r.vpp_capable,
    vpp_capable_pct:      total > 0 ? Math.round((r.vpp_capable / total) * 100) : 0,
    vpp_consented:        r.vpp_consented,
    vpp_consented_pct:    total > 0 ? Math.round((r.vpp_consented / total) * 100) : 0,
    vpp_enrolled:         r.vpp_enrolled,
  };
}

// ── Zone 5: Velocity ──────────────────────────────────────────────────────
async function buildVelocity() {
  // Average time between key state transitions, computed from pm_task_events.
  // For each project, find earliest state_changed event for each milestone, then
  // diff successive milestones. Average across projects with both endpoints.
  const milestoneQuery = async (laneFrom, itemFrom, toState_from, laneTo, itemTo, toState_to) => {
    const { rows } = await pool.query(`
      WITH a AS (
        SELECT project_id, MIN(occurred_at) AS at
        FROM pm_task_events
        WHERE event_type = 'state_changed'
          AND lane = $1 AND item_key = $2
          AND payload->>'to' = $3
        GROUP BY project_id
      ),
      b AS (
        SELECT project_id, MIN(occurred_at) AS at
        FROM pm_task_events
        WHERE event_type = 'state_changed'
          AND lane = $4 AND item_key = $5
          AND payload->>'to' = $6
        GROUP BY project_id
      )
      SELECT
        COUNT(*)::int AS n,
        COALESCE(AVG(EXTRACT(EPOCH FROM (b.at - a.at)) / 86400.0), 0)::numeric AS avg_days
      FROM a JOIN b USING (project_id)
      WHERE b.at >= a.at
    `, [laneFrom, itemFrom, toState_from, laneTo, itemTo, toState_to]);
    return { samples: rows[0]?.n || 0, avg_days: Number(rows[0]?.avg_days || 0) };
  };

  // Approximations using project timestamps (since state_history may be sparse for seeded data)
  const { rows: timings } = await pool.query(`
    SELECT
      AVG(EXTRACT(EPOCH FROM (commissioned_at - created_at)) / 86400.0) FILTER (WHERE commissioned_at IS NOT NULL) AS lead_to_commission_days,
      COUNT(*) FILTER (WHERE commissioned_at IS NOT NULL)::int AS commissioned_count
    FROM projects_v2
  `);

  return {
    // Lead-to-commission (overall)
    lead_to_commission: {
      avg_days: Number(timings[0]?.lead_to_commission_days || 0).toFixed(1),
      samples:  timings[0]?.commissioned_count || 0,
    },
    // Specific milestones — empty for now since seed data doesn't have full event history;
    // these populate as real projects flow through the state machine.
    stage1_to_stage2: await milestoneQuery('sales','proposal_initial','sent','sales','proposal_final','sent'),
    sent_to_signed:   await milestoneQuery('sales','proposal_final','sent','sales','contract_signed','done'),
    signed_to_install:await milestoneQuery('sales','contract_signed','done','operations','install_complete','done'),
    install_to_commission: await milestoneQuery('operations','install_complete','done','operations','commissioning_form','done'),
  };
}

// ── Zone 6: Install Capacity ──────────────────────────────────────────────
async function buildCapacity() {
  // Pull install_scheduled.fields.install_date for any project where install
  // is scheduled and not yet complete.
  const { rows } = await pool.query(`
    SELECT
      id, code, address,
      (lane_status->'operations'->'item_meta'->'install_scheduled'->'fields'->>'install_date') AS install_date,
      (lane_status->'operations'->'item_meta'->'install_scheduled'->'fields'->>'crew_lead')    AS crew_lead,
      (lane_status->'operations'->'items'->>'install_complete')::boolean AS install_done
    FROM projects_v2
    WHERE status = 'active'
      AND (lane_status->'operations'->'item_meta'->'install_scheduled'->'fields'->>'install_date') IS NOT NULL
  `);

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  // start of current ISO week (Monday)
  const dow = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - dow);

  const weeks = [
    { label: 'Week 1', start: new Date(weekStart),                           },
    { label: 'Week 2', start: new Date(weekStart.getTime() + 7  * 86400000), },
    { label: 'Week 3', start: new Date(weekStart.getTime() + 14 * 86400000), },
    { label: 'Week 4', start: new Date(weekStart.getTime() + 21 * 86400000), },
  ].map(w => ({ ...w, end: new Date(w.start.getTime() + 7 * 86400000), installs: [] }));

  for (const r of rows) {
    if (r.install_done === true) continue;
    const d = new Date(r.install_date);
    if (isNaN(d.getTime())) continue;
    const w = weeks.find(w => d >= w.start && d < w.end);
    if (w) {
      w.installs.push({
        project_id: r.id, code: r.code, address: r.address,
        date:       r.install_date, crew_lead: r.crew_lead,
      });
    }
  }

  return {
    crew_capacity_per_week: DEFAULT_CREW_CAPACITY_PER_WEEK,
    weeks: weeks.map(w => ({
      label:     w.label,
      start:     w.start.toISOString().slice(0, 10),
      booked:    w.installs.length,
      capacity:  DEFAULT_CREW_CAPACITY_PER_WEEK,
      installs:  w.installs,
      utilisation_pct: Math.round((w.installs.length / DEFAULT_CREW_CAPACITY_PER_WEEK) * 100),
    })),
  };
}

// ── Zone 7: Red Flags ─────────────────────────────────────────────────────
async function buildRedFlags() {
  // Blocked projects
  const { rows: blocked } = await pool.query(`
    SELECT id, code, address, updated_at,
           (NOW() - updated_at)::text AS blocked_for
    FROM projects_v2
    WHERE health = 'blocked' AND status = 'active'
    ORDER BY updated_at ASC
  `);

  // Ghosted Stage-2 proposals (sent but not signed for >7 days)
  const { rows: ghosted } = await pool.query(`
    SELECT id, code, address,
           (lane_status->'sales'->'item_meta'->'proposal_final'->'fields'->>'sent_at') AS sent_at
    FROM projects_v2
    WHERE status = 'active'
      AND (lane_status->'sales'->'item_meta'->'proposal_final'->>'state') IN ('sent','viewed')
      AND (lane_status->'sales'->'item_meta'->'contract_signed'->>'state') IN ('not_started')
      AND (lane_status->'sales'->'item_meta'->'proposal_final'->'fields'->>'sent_at')::timestamptz < NOW() - INTERVAL '7 days'
  `);

  // Overdue payments (already in cashflow but useful here as red flags too)
  const { rows: overduePayments } = await pool.query(`
    SELECT pp.id, pp.project_id, pp.event, pp.expected_at, pp.expected_amount_nzd,
           p.code, p.address,
           (NOW() - pp.expected_at::timestamp)::text AS overdue_for
    FROM project_payments pp
    JOIN projects_v2 p ON p.id = pp.project_id
    WHERE pp.received_at IS NULL
      AND pp.expected_at < NOW() - INTERVAL '14 days'
    ORDER BY pp.expected_at ASC
  `);

  return {
    blocked: blocked.map(r => ({
      project_id: r.id, code: r.code, address: r.address, blocked_for_days: Math.round((Date.now() - new Date(r.updated_at)) / 86400000),
    })),
    ghosted_proposals: ghosted.map(r => ({
      project_id: r.id, code: r.code, address: r.address,
      days_since_sent: r.sent_at ? Math.round((Date.now() - new Date(r.sent_at)) / 86400000) : null,
    })),
    overdue_payments: overduePayments.map(r => ({
      project_id: r.project_id, code: r.code, address: r.address,
      event: r.event, expected_amount_nzd: Number(r.expected_amount_nzd),
      overdue_days: Math.round((Date.now() - new Date(r.expected_at)) / 86400000),
    })),
  };
}

export default router;

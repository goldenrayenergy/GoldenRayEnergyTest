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
//   7. Red Flags            — blocked projects, ghosted proposals, overdue payments
//
// Uses supabaseAdmin (the supabase-js client, HTTPS REST) rather than raw pg
// pool so it works regardless of whether the direct DB hostname is reachable.
// JS-side aggregation is fine at the volume we deal with (≤ 500 active projects).
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';

const router = Router();
router.use(authenticate);

const DEFAULT_CREW_CAPACITY_PER_WEEK = 4;

router.get('/dashboard', async (_req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    // Pull every active project + commissioned project + payments in two calls.
    // 5-50 rows typical — fine for in-memory aggregation.
    const [{ data: projects, error: projErr }, { data: payments, error: payErr }, { data: events, error: evErr }] = await Promise.all([
      supabaseAdmin.from('projects_v2').select(`
        id, code, contact_id, address, suburb, city, region,
        project_type, system_size_kw, battery_kwh, panel_count,
        estimated_value_nzd, lane_status, health, status,
        commissioned_at, vpp_capable_hardware, vpp_consented, vpp_enrolled,
        created_at, updated_at
      `).limit(500),
      supabaseAdmin.from('project_payments').select('*').limit(2000),
      supabaseAdmin.from('pm_task_events')
        .select('project_id, lane, item_key, event_type, payload, occurred_at')
        .eq('event_type', 'state_changed')
        .limit(2000),
    ]);

    if (projErr) throw projErr;
    if (payErr)  throw payErr;
    if (evErr)   throw evErr;

    const all = projects || [];
    const active = all.filter(p => p.status === 'active');

    res.json({
      generated_at: new Date().toISOString(),
      action_queue: buildActionQueue(active),
      pipeline:     buildPipeline(active),
      cashflow:     buildCashflow(payments || []),
      fleet:        buildFleet(all),
      velocity:     buildVelocity(events || [], all),
      capacity:     buildCapacity(active),
      red_flags:    buildRedFlags(active, all, payments || []),
    });
  } catch (e) {
    console.error('Owner dashboard error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Zone 1: Owner Action Queue ────────────────────────────────────────────
function buildActionQueue(projects) {
  const queue = [];
  for (const p of projects) {
    const ls = p.lane_status || {};
    const itemMeta = (lane, key) => ls[lane]?.item_meta?.[key] || {};
    const stateOf  = (lane, key) => itemMeta(lane, key).state;

    if (stateOf('sales', 'proposal_initial') === 'drafted') {
      queue.push({
        type: 'proposal_initial_approval',
        project_id: p.id, project_code: p.code,
        title: `Approve & send Stage 1 proposal — ${p.code}`,
        subtitle: `${p.system_size_kw || '—'} kW${p.battery_kwh ? ` + ${p.battery_kwh} kWh` : ''} · ${p.address || ''}`,
        action_url: `/pm/projects/${p.id}`,
      });
    }
    if (stateOf('sales', 'proposal_final') === 'drafted') {
      queue.push({
        type: 'proposal_final_approval',
        project_id: p.id, project_code: p.code,
        title: `Approve & send Stage 2 (locked) proposal — ${p.code}`,
        subtitle: `${p.system_size_kw || '—'} kW${p.battery_kwh ? ` + ${p.battery_kwh} kWh` : ''} · ${p.address || ''}`,
        action_url: `/pm/projects/${p.id}`,
      });
    }
    if (stateOf('sales', 'contract_signed') === 'customer_signed') {
      queue.push({
        type: 'contract_counter_sign',
        project_id: p.id, project_code: p.code,
        title: `Counter-sign contract — ${p.code}`,
        subtitle: `Customer has signed; awaiting your counter-signature.`,
        action_url: `/pm/projects/${p.id}`,
      });
    }
    if (stateOf('operations', 'commissioning_form') === 'submitted') {
      queue.push({
        type: 'commissioning_qc',
        project_id: p.id, project_code: p.code,
        title: `QC inspect commissioning — ${p.code}`,
        subtitle: 'Install crew submitted commissioning form. Inspect before final invoice.',
        action_url: `/pm/projects/${p.id}`,
      });
    }
  }
  return queue;
}

// ── Zone 2: Pipeline ──────────────────────────────────────────────────────
function buildPipeline(active) {
  const buckets = { sales_lead: 0, design: 0, selling_install: 0, commissioned: 0, blocked: 0 };
  let totalValue = 0;
  let closedThisWeek = 0;
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

  for (const p of active) {
    totalValue += Number(p.estimated_value_nzd || 0);

    const ls = p.lane_status || {};
    const sStatus = ls.sales?.status;
    const eStatus = ls.engineering?.status;
    const cStatus = ls.compliance?.status;
    const oStatus = ls.operations?.status;

    if (p.health === 'blocked') buckets.blocked++;

    if (p.commissioned_at) {
      buckets.commissioned++;
      if (new Date(p.commissioned_at) >= sevenDaysAgo) closedThisWeek++;
    } else if (sStatus === 'done' && oStatus !== 'done') {
      buckets.selling_install++;
    } else if (eStatus === 'in_progress' && cStatus !== 'done') {
      buckets.design++;
    } else if (sStatus === 'in_progress' && eStatus !== 'in_progress' && eStatus !== 'done') {
      buckets.sales_lead++;
    } else {
      // Not started or in some other lane state — count as lead
      buckets.sales_lead++;
    }
  }

  return {
    by_status:        { active: active.length },
    lane_buckets:     buckets,
    closed_this_week: closedThisWeek,
    total_value_nzd:  totalValue,
  };
}

// ── Zone 3: Cashflow ──────────────────────────────────────────────────────
function buildCashflow(payments) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000);

  const owedByEvent = {};
  let receivedMtdAmount = 0, receivedMtdCount = 0;
  let overdueAmount = 0, overdueCount = 0;
  let outstandingAmount = 0, outstandingCount = 0;

  for (const p of payments) {
    const expected = Number(p.expected_amount_nzd || 0);
    const received = Number(p.received_amount_nzd || 0);

    if (!p.received_at) {
      // Outstanding
      outstandingAmount += expected;
      outstandingCount++;
      const ev = p.event;
      if (!owedByEvent[ev]) owedByEvent[ev] = { count: 0, amount: 0 };
      owedByEvent[ev].count++;
      owedByEvent[ev].amount += expected;

      // Overdue check
      if (p.expected_at && new Date(p.expected_at) < fourteenDaysAgo) {
        overdueAmount += expected;
        overdueCount++;
      }
    } else {
      // Received — check if MTD
      if (new Date(p.received_at) >= startOfMonth) {
        receivedMtdAmount += received;
        receivedMtdCount++;
      }
    }
  }

  return {
    owed_deposits:     owedByEvent.deposit  || { count: 0, amount: 0 },
    owed_progress:     owedByEvent.progress || { count: 0, amount: 0 },
    owed_finals:       owedByEvent.final    || { count: 0, amount: 0 },
    received_mtd:      { count: receivedMtdCount, amount: receivedMtdAmount },
    overdue_total:     { count: overdueCount,    amount: overdueAmount },
    outstanding_total: { count: outstandingCount, amount: outstandingAmount },
  };
}

// ── Zone 4: Fleet (VPP) ───────────────────────────────────────────────────
function buildFleet(allProjects) {
  let commissionedCount = 0;
  let kwTotal = 0, batteryKwhTotal = 0;
  let vppCapable = 0, vppConsented = 0, vppEnrolled = 0;

  for (const p of allProjects) {
    if (p.commissioned_at) {
      commissionedCount++;
      kwTotal += Number(p.system_size_kw || 0);
      batteryKwhTotal += Number(p.battery_kwh || 0);
      if (p.vpp_capable_hardware) vppCapable++;
      if (p.vpp_consented)        vppConsented++;
    }
    if (p.vpp_enrolled) vppEnrolled++;
  }

  const pct = (n) => commissionedCount > 0 ? Math.round((n / commissionedCount) * 100) : 0;

  return {
    commissioned_count: commissionedCount,
    kw_total:           kwTotal,
    battery_kwh_total:  batteryKwhTotal,
    vpp_capable:        vppCapable,
    vpp_capable_pct:    pct(vppCapable),
    vpp_consented:      vppConsented,
    vpp_consented_pct:  pct(vppConsented),
    vpp_enrolled:       vppEnrolled,
  };
}

// ── Zone 5: Velocity ──────────────────────────────────────────────────────
function buildVelocity(events, allProjects) {
  // Earliest 'state_changed' to a given (lane, item, target_state) per project
  function earliestTransition(lane, item, toState) {
    const map = new Map();
    for (const ev of events) {
      if (ev.lane !== lane || ev.item_key !== item) continue;
      if ((ev.payload?.to ?? '') !== toState) continue;
      const cur = map.get(ev.project_id);
      const t   = new Date(ev.occurred_at).getTime();
      if (!cur || t < cur) map.set(ev.project_id, t);
    }
    return map;
  }
  function avgDaysBetween(fromMap, toMap) {
    let count = 0, sumMs = 0;
    for (const [pid, fromT] of fromMap) {
      const toT = toMap.get(pid);
      if (toT && toT >= fromT) {
        sumMs += (toT - fromT);
        count++;
      }
    }
    return { samples: count, avg_days: count > 0 ? +(sumMs / count / 86400000).toFixed(1) : 0 };
  }

  // Lead → commissioned (overall, from project timestamps — most reliable for seeded data)
  let lcSum = 0, lcCount = 0;
  for (const p of allProjects) {
    if (p.commissioned_at && p.created_at) {
      lcSum += new Date(p.commissioned_at) - new Date(p.created_at);
      lcCount++;
    }
  }
  const leadToCommission = {
    avg_days: lcCount > 0 ? +(lcSum / lcCount / 86400000).toFixed(1) : 0,
    samples:  lcCount,
  };

  return {
    lead_to_commission:    leadToCommission,
    stage1_to_stage2:      avgDaysBetween(
      earliestTransition('sales', 'proposal_initial', 'sent'),
      earliestTransition('sales', 'proposal_final',   'sent'),
    ),
    sent_to_signed:        avgDaysBetween(
      earliestTransition('sales', 'proposal_final',  'sent'),
      earliestTransition('sales', 'contract_signed', 'done'),
    ),
    signed_to_install:     avgDaysBetween(
      earliestTransition('sales', 'contract_signed',  'done'),
      earliestTransition('operations', 'install_complete', 'done'),
    ),
    install_to_commission: avgDaysBetween(
      earliestTransition('operations', 'install_complete',  'done'),
      earliestTransition('operations', 'commissioning_form','done'),
    ),
  };
}

// ── Zone 6: Install Capacity ──────────────────────────────────────────────
function buildCapacity(active) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  const dow = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - dow);

  const weeks = [
    { label: 'Week 1' }, { label: 'Week 2' }, { label: 'Week 3' }, { label: 'Week 4' },
  ].map((w, i) => ({
    ...w,
    start: new Date(weekStart.getTime() + i * 7 * 86400000),
    end:   new Date(weekStart.getTime() + (i + 1) * 7 * 86400000),
    installs: [],
  }));

  for (const p of active) {
    const sched = p.lane_status?.operations?.item_meta?.install_scheduled?.fields;
    if (!sched?.install_date) continue;
    if (p.lane_status?.operations?.items?.install_complete === true) continue;
    const d = new Date(sched.install_date);
    if (isNaN(d.getTime())) continue;
    const w = weeks.find(w => d >= w.start && d < w.end);
    if (w) {
      w.installs.push({
        project_id: p.id, code: p.code, address: p.address,
        date:       sched.install_date, crew_lead: sched.crew_lead,
      });
    }
  }

  return {
    crew_capacity_per_week: DEFAULT_CREW_CAPACITY_PER_WEEK,
    weeks: weeks.map(w => ({
      label:    w.label,
      start:    w.start.toISOString().slice(0, 10),
      booked:   w.installs.length,
      capacity: DEFAULT_CREW_CAPACITY_PER_WEEK,
      installs: w.installs,
      utilisation_pct: Math.round((w.installs.length / DEFAULT_CREW_CAPACITY_PER_WEEK) * 100),
    })),
  };
}

// ── Zone 7: Red Flags ─────────────────────────────────────────────────────
function buildRedFlags(active, allProjects, payments) {
  const blocked = active
    .filter(p => p.health === 'blocked')
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))
    .map(p => ({
      project_id: p.id, code: p.code, address: p.address,
      blocked_for_days: Math.round((Date.now() - new Date(p.updated_at)) / 86400000),
    }));

  const sevenDaysAgo = Date.now() - 7 * 86400000;
  const ghosted = active.filter(p => {
    const finMeta = p.lane_status?.sales?.item_meta?.proposal_final;
    const conMeta = p.lane_status?.sales?.item_meta?.contract_signed;
    if (!finMeta || !conMeta) return false;
    const finState = finMeta.state;
    const conState = conMeta.state || 'not_started';
    if (!['sent', 'viewed'].includes(finState)) return false;
    if (conState !== 'not_started') return false;
    const sentAt = finMeta.fields?.sent_at;
    if (!sentAt || new Date(sentAt).getTime() > sevenDaysAgo) return false;
    return true;
  }).map(p => {
    const sentAt = p.lane_status.sales.item_meta.proposal_final.fields.sent_at;
    return {
      project_id: p.id, code: p.code, address: p.address,
      days_since_sent: sentAt ? Math.round((Date.now() - new Date(sentAt)) / 86400000) : null,
    };
  });

  const fourteenDaysAgo = Date.now() - 14 * 86400000;
  // Look up by ALL projects (not just active) so overdue finals on completed
  // projects still surface with the correct project code.
  const projectsById = Object.fromEntries(allProjects.map(p => [p.id, p]));
  const overduePayments = payments
    .filter(p => !p.received_at && p.expected_at && new Date(p.expected_at).getTime() < fourteenDaysAgo)
    .sort((a, b) => new Date(a.expected_at) - new Date(b.expected_at))
    .map(p => {
      const proj = projectsById[p.project_id] || {};
      return {
        project_id: p.project_id,
        code: proj.code, address: proj.address,
        event: p.event, expected_amount_nzd: Number(p.expected_amount_nzd || 0),
        overdue_days: Math.round((Date.now() - new Date(p.expected_at)) / 86400000),
      };
    });

  return { blocked, ghosted_proposals: ghosted, overdue_payments: overduePayments };
}

export default router;

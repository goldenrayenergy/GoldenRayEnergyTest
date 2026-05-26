import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pmOwnerAPI } from '../services/pmApi';
import { fmt$, fmtDate } from '../../utils/format';
import { SkeletonOwnerDashboard, LoadError } from '../components/LoadingSkeletons';

// ────────────────────────────────────────────────────────────────────────────
// Owner Dashboard — 7 zones, single screen.
//
// Zone 1  Owner Action Queue
// Zone 2  Pipeline (active project counts + pipeline value)
// Zone 3  Cashflow
// Zone 4  Fleet (VPP-readiness)
// Zone 5  Velocity
// Zone 6  Install Capacity (next 4 weeks)
// Zone 7  Red Flags
// ────────────────────────────────────────────────────────────────────────────

export default function OwnerDashboardPage() {
  const [data, setData]     = useState(null);
  const [loading, setL]     = useState(true);
  const [error, setError]   = useState('');

  const load = () => {
    setL(true); setError('');
    pmOwnerAPI.dashboard()
      .then(r => { setData(r.data); setL(false); })
      .catch(e => { setError(e.response?.data?.error || e.message); setL(false); });
  };
  useEffect(load, []);

  if (loading) return <SkeletonOwnerDashboard />;
  if (error)   return <LoadError error={error} onRetry={load} title="Couldn't load the Owner Dashboard" />;
  if (!data)   return null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Owner Dashboard</h1>
        <p className="text-xs text-slate-500 mt-1">
          One-screen view of approvals, pipeline, cashflow, fleet, velocity, capacity, and red flags. Generated {fmtDate(data.generated_at)}.
        </p>
      </div>

      <ActionQueueZone queue={data.action_queue} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PipelineZone pipeline={data.pipeline} />
        <CashflowZone cashflow={data.cashflow} />
        <FleetZone fleet={data.fleet} />
      </div>

      <VelocityZone velocity={data.velocity} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CapacityZone capacity={data.capacity} />
        <RedFlagsZone redFlags={data.red_flags} />
      </div>
    </div>
  );
}

// ── Zone 1 — Owner Action Queue ──────────────────────────────────────────
function ActionQueueZone({ queue }) {
  const ICONS = {
    proposal_initial_approval: '📄',
    proposal_final_approval:   '📋',
    contract_counter_sign:     '✍️',
    commissioning_qc:          '⚡',
  };
  return (
    <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-bold text-slate-900">🛎  Today's Owner Queue</h2>
          <p className="text-xs text-slate-600">Items awaiting your approval, sign-off, or QC.</p>
        </div>
        <span className="text-2xl font-bold text-amber-800">{queue.length}</span>
      </div>
      {queue.length === 0 ? (
        <p className="text-sm text-slate-500 italic">All clear — nothing waiting on you.</p>
      ) : (
        <ul className="space-y-2">
          {queue.map((item, i) => (
            <li key={i}>
              <Link
                to={item.action_url}
                className="flex items-center justify-between bg-white border border-amber-200 hover:border-amber-400 rounded px-3 py-2 group">
                <div className="flex items-start gap-3">
                  <span className="text-xl">{ICONS[item.type] || '•'}</span>
                  <div>
                    <div className="text-sm font-medium text-slate-800">{item.title}</div>
                    <div className="text-xs text-slate-500">{item.subtitle}</div>
                  </div>
                </div>
                <span className="text-xs text-amber-700 group-hover:underline font-medium">Review →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Zone 2 — Pipeline ─────────────────────────────────────────────────────
function PipelineZone({ pipeline }) {
  const buckets = pipeline.lane_buckets || {};
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h3 className="font-semibold text-sm text-slate-800 uppercase tracking-wide mb-2">📊 Pipeline</h3>
      <div className="text-3xl font-bold text-slate-900">
        {(buckets.sales_lead || 0) + (buckets.design || 0) + (buckets.selling_install || 0)}
        <span className="text-sm font-normal text-slate-500 ml-2">active</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">Total value: <strong>{fmt$(pipeline.total_value_nzd)}</strong></p>

      <table className="w-full text-xs">
        <tbody>
          <PipelineRow label="Sales / lead"     count={buckets.sales_lead     || 0} colour="bg-blue-400" />
          <PipelineRow label="Design"           count={buckets.design          || 0} colour="bg-sky-500" />
          <PipelineRow label="Sold / installing"count={buckets.selling_install || 0} colour="bg-amber-500" />
          <PipelineRow label="Commissioned"     count={buckets.commissioned    || 0} colour="bg-emerald-500" />
          <PipelineRow label="⚠ Blocked"        count={buckets.blocked         || 0} colour="bg-red-500" />
        </tbody>
      </table>

      <div className="border-t border-slate-100 mt-3 pt-2 text-xs">
        <span className="text-slate-500">This week closed: </span>
        <strong className="text-emerald-700">{pipeline.closed_this_week}</strong>
      </div>
    </div>
  );
}
function PipelineRow({ label, count, colour }) {
  if (count === 0) return null;
  return (
    <tr>
      <td className="py-0.5 text-slate-700 w-32">{label}</td>
      <td className="py-0.5 w-8 text-right font-medium">{count}</td>
      <td className="py-0.5 pl-2">
        <div className="bg-slate-100 h-2 rounded overflow-hidden">
          <div className={`h-full ${colour}`} style={{ width: `${Math.min(count * 10, 100)}%` }} />
        </div>
      </td>
    </tr>
  );
}

// ── Zone 3 — Cashflow ─────────────────────────────────────────────────────
function CashflowZone({ cashflow }) {
  const hasOverdue = cashflow.overdue_total.amount > 0;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h3 className="font-semibold text-sm text-slate-800 uppercase tracking-wide mb-2">💰 Cashflow</h3>
      <div className="text-3xl font-bold text-emerald-700">
        {fmt$(cashflow.received_mtd.amount)}
        <span className="text-sm font-normal text-slate-500 ml-2">received MTD ({cashflow.received_mtd.count})</span>
      </div>
      <div className="space-y-1.5 mt-3 text-sm">
        <CashRow label="Owed deposits"  data={cashflow.owed_deposits}  />
        <CashRow label="Owed progress"  data={cashflow.owed_progress}  />
        <CashRow label="Owed finals"    data={cashflow.owed_finals}    />
        <div className="border-t border-slate-200 pt-1.5 flex justify-between font-semibold">
          <span>Outstanding total</span>
          <span>{fmt$(cashflow.outstanding_total.amount)} <span className="text-xs text-slate-500 font-normal">({cashflow.outstanding_total.count})</span></span>
        </div>
      </div>
      {hasOverdue && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-800">
          ⚠ <strong>{cashflow.overdue_total.count}</strong> payment{cashflow.overdue_total.count === 1 ? '' : 's'} overdue (&gt; 14 days):
          <strong className="ml-1">{fmt$(cashflow.overdue_total.amount)}</strong>
        </div>
      )}
    </div>
  );
}
function CashRow({ label, data }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-900">{fmt$(data.amount)} <span className="text-xs text-slate-500">({data.count})</span></span>
    </div>
  );
}

// ── Zone 4 — Fleet (VPP) ──────────────────────────────────────────────────
function FleetZone({ fleet }) {
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
      <h3 className="font-semibold text-sm text-emerald-900 uppercase tracking-wide mb-2">⚡ Fleet · VPP-readiness</h3>
      <div className="text-3xl font-bold text-emerald-800">
        {fleet.commissioned_count}
        <span className="text-sm font-normal text-emerald-700 ml-2">commissioned · {fleet.kw_total.toFixed(1)} kW</span>
      </div>
      <div className="space-y-1.5 mt-3 text-sm">
        <FleetRow label="VPP-capable hardware" pct={fleet.vpp_capable_pct} count={fleet.vpp_capable} of={fleet.commissioned_count} />
        <FleetRow label="Customer consented"   pct={fleet.vpp_consented_pct} count={fleet.vpp_consented} of={fleet.commissioned_count} />
        <FleetRow label="Currently enrolled"   pct={fleet.commissioned_count > 0 ? Math.round((fleet.vpp_enrolled / fleet.commissioned_count) * 100) : 0}
                  count={fleet.vpp_enrolled} of={fleet.commissioned_count} />
      </div>
      <p className="text-[11px] text-emerald-700 mt-2 italic">
        ↑ Grow the consented % — this is your future VPP enrollment list.
      </p>
    </div>
  );
}
function FleetRow({ label, pct, count, of }) {
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-emerald-800">{label}</span>
        <span className="text-emerald-900 font-medium">{count}/{of} · <strong>{pct}%</strong></span>
      </div>
      <div className="h-1.5 bg-emerald-100 rounded overflow-hidden mt-0.5">
        <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Zone 5 — Velocity ─────────────────────────────────────────────────────
function VelocityZone({ velocity }) {
  const stages = [
    { label: 'Stage 1 → Stage 2',    data: velocity.stage1_to_stage2,     target: 5 },
    { label: 'Stage 2 → signed',     data: velocity.sent_to_signed,        target: 7 },
    { label: 'Signed → installed',   data: velocity.signed_to_install,     target: 30 },
    { label: 'Install → commissioned',data: velocity.install_to_commission,target: 3 },
  ];
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h3 className="font-semibold text-sm text-slate-800 uppercase tracking-wide mb-2">⏱ Velocity</h3>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="bg-slate-50 border border-slate-200 rounded p-3">
          <div className="text-xs text-slate-500">Lead → commissioned</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {velocity.lead_to_commission.avg_days}<span className="text-sm font-normal text-slate-500 ml-1">days</span>
          </div>
          <div className="text-[11px] text-slate-500">{velocity.lead_to_commission.samples} sample{velocity.lead_to_commission.samples === 1 ? '' : 's'}</div>
        </div>
        {stages.map(s => (
          <div key={s.label} className="bg-slate-50 border border-slate-200 rounded p-3">
            <div className="text-xs text-slate-500">{s.label}</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              {s.data.samples > 0 ? s.data.avg_days.toFixed(1) : '—'}<span className="text-sm font-normal text-slate-500 ml-1">days</span>
            </div>
            <div className="text-[11px] text-slate-500">
              {s.data.samples > 0
                ? `${s.data.samples} samples · target ${s.target}d ${s.data.avg_days <= s.target ? '✓' : '⚠'}`
                : 'no data yet'}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-2 italic">
        Velocity samples populate as projects flow through the state machine. Seeded projects don't have full event history yet.
      </p>
    </div>
  );
}

// ── Zone 6 — Install Capacity ─────────────────────────────────────────────
function CapacityZone({ capacity }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h3 className="font-semibold text-sm text-slate-800 uppercase tracking-wide mb-2">🔧 Install Capacity (next 4 weeks)</h3>
      <p className="text-xs text-slate-500 mb-3">Crew capacity: {capacity.crew_capacity_per_week} installs/week</p>
      <div className="space-y-2">
        {capacity.weeks.map(w => {
          const overbooked = w.utilisation_pct > 100;
          const tight = w.utilisation_pct >= 75 && !overbooked;
          return (
            <div key={w.label}>
              <div className="flex justify-between text-xs mb-0.5">
                <span className="font-medium text-slate-700">{w.label} · from {w.start}</span>
                <span className={overbooked ? 'text-red-700 font-bold' : tight ? 'text-amber-700' : 'text-slate-600'}>
                  {w.booked}/{w.capacity} {overbooked ? '⚠ OVER' : tight ? 'tight' : 'OK'}
                </span>
              </div>
              <div className="h-3 bg-slate-100 rounded overflow-hidden">
                <div
                  className={`h-full ${overbooked ? 'bg-red-500' : tight ? 'bg-amber-400' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(w.utilisation_pct, 100)}%` }}
                />
              </div>
              {w.installs.length > 0 && (
                <ul className="text-[11px] text-slate-500 mt-1 space-y-0.5">
                  {w.installs.map(i => (
                    <li key={i.project_id}>· {i.code} — {i.address?.slice(0, 40) || '(no address)'} {i.crew_lead && <span className="text-slate-400">[{i.crew_lead}]</span>}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Zone 7 — Red Flags ────────────────────────────────────────────────────
function RedFlagsZone({ redFlags }) {
  const totalFlags = redFlags.blocked.length + redFlags.ghosted_proposals.length + redFlags.overdue_payments.length;
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
      <h3 className="font-semibold text-sm text-red-900 uppercase tracking-wide mb-2">🚩 Red Flags ({totalFlags})</h3>
      {totalFlags === 0 ? (
        <p className="text-sm text-emerald-700 italic">All clear. No blocked projects, ghosted proposals, or overdue payments.</p>
      ) : (
        <div className="space-y-3">
          {redFlags.blocked.length > 0 && (
            <div>
              <div className="text-xs font-bold text-red-900 uppercase tracking-wide mb-1">Blocked ({redFlags.blocked.length})</div>
              <ul className="space-y-1">
                {redFlags.blocked.map(b => (
                  <li key={b.project_id} className="text-xs">
                    <Link to={`/pm/projects/${b.project_id}`} className="text-red-800 hover:underline">
                      <strong>{b.code}</strong> — {b.address?.slice(0, 40) || '(no address)'} · blocked {b.blocked_for_days}d
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {redFlags.ghosted_proposals.length > 0 && (
            <div>
              <div className="text-xs font-bold text-red-900 uppercase tracking-wide mb-1">Ghosted Stage-2 proposals ({redFlags.ghosted_proposals.length})</div>
              <ul className="space-y-1">
                {redFlags.ghosted_proposals.map(g => (
                  <li key={g.project_id} className="text-xs">
                    <Link to={`/pm/projects/${g.project_id}`} className="text-red-800 hover:underline">
                      <strong>{g.code}</strong> — sent {g.days_since_sent ?? '?'}d ago, no response · nudge customer
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {redFlags.overdue_payments.length > 0 && (
            <div>
              <div className="text-xs font-bold text-red-900 uppercase tracking-wide mb-1">Overdue payments ({redFlags.overdue_payments.length})</div>
              <ul className="space-y-1">
                {redFlags.overdue_payments.map(p => (
                  <li key={p.project_id + p.event} className="text-xs">
                    <Link to={`/pm/projects/${p.project_id}`} className="text-red-800 hover:underline">
                      <strong>{p.code}</strong> — {p.event} {fmt$(p.expected_amount_nzd)} · overdue {p.overdue_days}d
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

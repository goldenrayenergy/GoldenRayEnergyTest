// ReferralsPage — Phase 3 Session 3 (2026-08-22)
//
// Portal admin view for the referral program. Backend endpoints
// (server/routes/referrals.js) provide the data + action mutations.
//
// Lifecycle stages a row can be in (see referralService.js):
//   attributed             — friend submitted quote, fraud check passed
//   blocked_fraud_check    — flagged for admin review
//   install_complete       — friend's install done, credit unlocked
//   credit_paid            — admin has mailed cheque / bank transfer
//   expired                — 6 months elapsed without payout
//   cancelled              — admin override / dispute
//
// Admin actions per row (server-side validated):
//   Approve   — clears blocked_fraud_check → attributed
//   Mark Paid — install_complete → credit_paid (opens modal for method +
//               reference + note)
//   Cancel    — any non-terminal → cancelled (opens modal for reason)

import { useEffect, useState, useCallback } from 'react';
import {
  Users, ShieldCheck, DollarSign, Clock, Check, AlertTriangle,
  Ban, Loader2, X, MailCheck, Filter, PackageCheck,
} from 'lucide-react';
import api from '../../services/api';

const STATUS_META = {
  attributed:          { label: 'Attributed',       color: 'bg-blue-100 text-blue-800 border-blue-300' },
  blocked_fraud_check: { label: 'Fraud check',      color: 'bg-amber-100 text-amber-800 border-amber-300' },
  install_complete:    { label: 'Ready to pay',     color: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  credit_paid:         { label: 'Paid',             color: 'bg-purple-100 text-purple-800 border-purple-300' },
  expired:             { label: 'Expired',          color: 'bg-gray-100 text-gray-700 border-gray-300' },
  cancelled:           { label: 'Cancelled',        color: 'bg-red-100 text-red-800 border-red-300' },
};

const FILTER_OPTIONS = [
  { key: '',                       label: 'All' },
  { key: 'blocked_fraud_check',    label: 'Fraud check' },
  { key: 'install_complete',       label: 'Ready to pay' },
  { key: 'attributed',             label: 'Attributed' },
  { key: 'credit_paid',            label: 'Paid' },
  { key: 'expired',                label: 'Expired' },
  { key: 'cancelled',              label: 'Cancelled' },
];

export default function ReferralsPage() {
  const [referrals, setReferrals] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded]   = useState(null);   // referral.id | null

  // Modal state for Mark Paid + Cancel — kept as one shape so only one
  // modal is open at a time. { referralId, kind: 'mark-paid' | 'cancel' }.
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = statusFilter ? { status: statusFilter } : {};
      const { data } = await api.get('/referrals/admin', { params });
      setReferrals(data.referrals || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Could not load referrals.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  // Row-level actions — optimistic in the sense that we reload after
  // success, so the UI reflects the server's new state without needing to
  // patch it in-place. Simpler + robust to concurrent edits by another
  // admin in another tab.
  const handleApprove = async (id) => {
    if (!confirm('Approve this referral? It will move from Fraud check → Attributed.')) return;
    try {
      await api.post(`/referrals/admin/${id}/approve-fraud`, { note: 'Approved via portal' });
      await load();
    } catch (e) {
      alert(`Approve failed: ${e.response?.data?.error || e.message}`);
    }
  };

  const handleMarkPaidSubmit = async ({ id, method, reference, note }) => {
    try {
      await api.post(`/referrals/admin/${id}/mark-paid`, { method, reference, note });
      setModal(null);
      await load();
    } catch (e) {
      alert(`Mark paid failed: ${e.response?.data?.error || e.message}`);
    }
  };

  const handleCancelSubmit = async ({ id, reason }) => {
    try {
      await api.post(`/referrals/admin/${id}/cancel`, { reason });
      setModal(null);
      await load();
    } catch (e) {
      alert(`Cancel failed: ${e.response?.data?.error || e.message}`);
    }
  };

  const handleMarkInstallComplete = async (id) => {
    if (!confirm('Confirm the friend\'s solar install is complete? This unlocks the $250 credit + emails the referrer to send their address for the cheque. Not reversible.')) return;
    try {
      await api.post(`/referrals/admin/${id}/mark-install-complete`);
      await load();
    } catch (e) {
      alert(`Unlock failed: ${e.response?.data?.error || e.message}`);
    }
  };

  // Summary stats — computed client-side from the current filter set so
  // the numbers always match what's on screen.
  const summary = {
    total:          referrals.length,
    ready_to_pay:   referrals.filter(r => r.status === 'install_complete').length,
    fraud_pending:  referrals.filter(r => r.status === 'blocked_fraud_check').length,
    unpaid_cents:   referrals
      .filter(r => r.status === 'install_complete')
      .reduce((s, r) => s + (r.credit_amount_referrer || 0), 0),
    paid_cents:     referrals
      .filter(r => r.status === 'credit_paid')
      .reduce((s, r) => s + (r.credit_amount_referrer || 0), 0),
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-purple-100 grid place-items-center">
            <Users className="w-5 h-5 text-purple-700" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1A1614]">Referrals</h1>
            <p className="text-sm text-[#8F887E]">Customer referral tracking + credit payouts</p>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Total" value={summary.total} icon={Users} tone="neutral" />
        <SummaryCard label="Ready to pay" value={summary.ready_to_pay} icon={DollarSign} tone="emerald" hint={centsToNzd(summary.unpaid_cents)} />
        <SummaryCard label="Fraud check" value={summary.fraud_pending} icon={ShieldCheck} tone={summary.fraud_pending > 0 ? 'amber' : 'neutral'} />
        <SummaryCard label="Paid" value={centsToNzd(summary.paid_cents)} icon={MailCheck} tone="purple" hint={`${referrals.filter(r => r.status === 'credit_paid').length} referrals`} />
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Filter className="w-4 h-4 text-[#8F887E]" />
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.key || 'all'}
            type="button"
            onClick={() => setStatusFilter(opt.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              statusFilter === opt.key
                ? 'bg-[#1A1614] text-white'
                : 'bg-white border border-[#E3D9C4] text-[#55504A] hover:bg-[#F4EEE1]'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading && (
        <div className="py-16 text-center text-[#8F887E]">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
          Loading referrals…
        </div>
      )}

      {error && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 text-sm text-red-900 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-bold">Could not load referrals</div>
            <div className="mt-1">{error}</div>
            <button type="button" onClick={load} className="mt-3 px-4 py-2 rounded-full bg-red-600 text-white text-sm font-semibold hover:bg-red-700">
              Retry
            </button>
          </div>
        </div>
      )}

      {!loading && !error && referrals.length === 0 && (
        <div className="py-16 text-center text-[#8F887E] rounded-xl border-2 border-dashed border-[#E3D9C4]">
          No referrals {statusFilter ? `in "${STATUS_META[statusFilter]?.label || statusFilter}" state` : 'yet'}.
        </div>
      )}

      {!loading && !error && referrals.length > 0 && (
        <div className="rounded-xl border border-[#E3D9C4] bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#F4EEE1] text-[#55504A]">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Created</th>
                <th className="text-left px-4 py-3 font-semibold">Referrer</th>
                <th className="text-left px-4 py-3 font-semibold">Referred friend</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Credit</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {referrals.map(r => (
                <ReferralRow
                  key={r.id}
                  referral={r}
                  expanded={expanded === r.id}
                  onToggleExpand={() => setExpanded(expanded === r.id ? null : r.id)}
                  onApprove={() => handleApprove(r.id)}
                  onMarkInstallComplete={() => handleMarkInstallComplete(r.id)}
                  onMarkPaid={() => setModal({ referralId: r.id, kind: 'mark-paid' })}
                  onCancel={() => setModal({ referralId: r.id, kind: 'cancel' })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {modal?.kind === 'mark-paid' && (
        <MarkPaidModal
          referralId={modal.referralId}
          onClose={() => setModal(null)}
          onSubmit={handleMarkPaidSubmit}
        />
      )}
      {modal?.kind === 'cancel' && (
        <CancelModal
          referralId={modal.referralId}
          onClose={() => setModal(null)}
          onSubmit={handleCancelSubmit}
        />
      )}
    </div>
  );
}

// ─── Table row + expand ─────────────────────────────────────────────────

function ReferralRow({ referral: r, expanded, onToggleExpand, onApprove, onMarkInstallComplete, onMarkPaid, onCancel }) {
  const status = STATUS_META[r.status] || { label: r.status, color: 'bg-gray-100 text-gray-800 border-gray-300' };
  const created = new Date(r.created_at);

  return (
    <>
      <tr className="border-t border-[#E3D9C4] hover:bg-[#F4EEE1]/50">
        <td className="px-4 py-3 text-[#55504A] whitespace-nowrap">
          {created.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' })}
        </td>
        <td className="px-4 py-3">
          {r.referrer?.name || <span className="text-[#8F887E] italic">deleted</span>}
          {r.referrer?.email && <div className="text-xs text-[#8F887E]">{r.referrer.email}</div>}
        </td>
        <td className="px-4 py-3">
          {r.referred?.name || <span className="text-[#8F887E] italic">unknown</span>}
          {r.referred?.email && <div className="text-xs text-[#8F887E]">{r.referred.email}</div>}
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${status.color}`}>
            {status.label}
          </span>
        </td>
        <td className="px-4 py-3 text-right font-mono">
          {centsToNzd(r.credit_amount_referrer || 0)}
          {r.credit_paid_at && <div className="text-xs text-[#8F887E] font-sans">paid {new Date(r.credit_paid_at).toLocaleDateString('en-NZ')}</div>}
          {r.credit_expires_at && r.status === 'install_complete' && (
            <div className="text-xs text-amber-700 font-sans">expires {new Date(r.credit_expires_at).toLocaleDateString('en-NZ')}</div>
          )}
        </td>
        <td className="px-4 py-3 text-right whitespace-nowrap">
          <div className="inline-flex items-center gap-2">
            {r.status === 'blocked_fraud_check' && (
              <button
                type="button"
                onClick={onApprove}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
              >
                <Check className="w-3 h-3" /> Approve
              </button>
            )}
            {r.status === 'attributed' && (
              <button
                type="button"
                onClick={onMarkInstallComplete}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
                title="Unlock the $250 credit + email the referrer to collect"
              >
                <PackageCheck className="w-3 h-3" /> Install done
              </button>
            )}
            {r.status === 'install_complete' && (
              <button
                type="button"
                onClick={onMarkPaid}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700"
              >
                <MailCheck className="w-3 h-3" /> Mark paid
              </button>
            )}
            {!['credit_paid', 'cancelled', 'expired'].includes(r.status) && (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-white border border-red-300 text-red-700 text-xs font-semibold hover:bg-red-50"
              >
                <Ban className="w-3 h-3" /> Cancel
              </button>
            )}
            <button
              type="button"
              onClick={onToggleExpand}
              className="px-2 py-1.5 text-xs text-[#8F887E] hover:text-[#1A1614]"
            >
              {expanded ? 'Hide' : 'Details'}
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="px-4 py-4 bg-[#F4EEE1]/30 border-t border-[#E3D9C4]">
            <ReferralDetail referral={r} />
          </td>
        </tr>
      )}
    </>
  );
}

function ReferralDetail({ referral: r }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
      {/* Fraud check */}
      <div className="bg-white rounded-lg border border-[#E3D9C4] p-3">
        <div className="text-[10px] uppercase tracking-widest text-[#8F887E] font-semibold mb-1">Fraud check</div>
        {r.fraud_check ? (
          <>
            <div><span className="text-[#8F887E]">Result:</span> <strong>{r.fraud_check.result}</strong></div>
            {r.fraud_check.matched_fields?.length > 0 && (
              <div className="mt-1">
                <span className="text-[#8F887E]">Matched:</span>{' '}
                {r.fraud_check.matched_fields.join(', ')}
              </div>
            )}
            <div className="text-[10px] text-[#8F887E] mt-1">
              checked {new Date(r.fraud_check.checked_at).toLocaleString('en-NZ')}
            </div>
          </>
        ) : (
          <div className="text-[#8F887E] italic">no check recorded</div>
        )}
      </div>

      {/* Enquiry + project links */}
      <div className="bg-white rounded-lg border border-[#E3D9C4] p-3">
        <div className="text-[10px] uppercase tracking-widest text-[#8F887E] font-semibold mb-1">Friend&apos;s quote</div>
        {r.enquiry ? (
          <>
            <div className="truncate">{r.enquiry.address || 'no address'}</div>
            {r.enquiry.chosen_tier_id && (
              <div><span className="text-[#8F887E]">Tier:</span> {r.enquiry.chosen_tier_id}</div>
            )}
            {r.enquiry.tier_price && (
              <div><span className="text-[#8F887E]">Price:</span> ${Number(r.enquiry.tier_price).toLocaleString('en-NZ')}</div>
            )}
            {r.project?.code && (
              <div className="mt-1"><span className="text-[#8F887E]">Project:</span> <a href={`/portal/projects/${r.project.id}`} className="text-[#D9531E] hover:underline">{r.project.code}</a> · <em>{r.project.status}</em></div>
            )}
          </>
        ) : (
          <div className="text-[#8F887E] italic">enquiry not found</div>
        )}
      </div>

      {/* Payout + notes */}
      <div className="bg-white rounded-lg border border-[#E3D9C4] p-3">
        <div className="text-[10px] uppercase tracking-widest text-[#8F887E] font-semibold mb-1">Payout</div>
        {r.credit_paid_at ? (
          <>
            <div><span className="text-[#8F887E]">Method:</span> {r.credit_paid_method}</div>
            {r.credit_paid_reference && <div className="truncate"><span className="text-[#8F887E]">Ref:</span> {r.credit_paid_reference}</div>}
            <div className="text-[10px] text-[#8F887E] mt-1">
              paid {new Date(r.credit_paid_at).toLocaleString('en-NZ')}
            </div>
          </>
        ) : r.credit_unlocked_at ? (
          <div>
            <span className="text-[#8F887E]">Unlocked:</span> {new Date(r.credit_unlocked_at).toLocaleDateString('en-NZ')}
            {r.credit_expires_at && (
              <div className="mt-1 text-amber-700"><Clock className="inline w-3 h-3" /> expires {new Date(r.credit_expires_at).toLocaleDateString('en-NZ')}</div>
            )}
          </div>
        ) : (
          <div className="text-[#8F887E] italic">credit not yet unlocked</div>
        )}
        {r.notes && (
          <div className="mt-2 pt-2 border-t border-[#E3D9C4]">
            <div className="text-[#8F887E] text-[10px] uppercase">Notes</div>
            <div className="mt-0.5">{r.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Modals ─────────────────────────────────────────────────────────────

function MarkPaidModal({ referralId, onClose, onSubmit }) {
  const [method, setMethod]       = useState('cheque');
  const [reference, setReference] = useState('');
  const [note, setNote]           = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    await onSubmit({ id: referralId, method, reference: reference.trim() || null, note: note.trim() || null });
    setSubmitting(false);
  };

  return (
    <ModalShell title="Mark referral as paid" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-[#8F887E] font-semibold">Payment method</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="mt-1 w-full px-3 py-2.5 rounded-lg border-2 border-[#E3D9C4] focus:border-[#D9531E] focus:outline-none text-sm"
          >
            <option value="cheque">Cheque (posted)</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-[#8F887E] font-semibold">Reference (optional)</span>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. cheque #10234, tx ref, receipt no."
            className="mt-1 w-full px-3 py-2.5 rounded-lg border-2 border-[#E3D9C4] focus:border-[#D9531E] focus:outline-none text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-[#8F887E] font-semibold">Note (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. Posted to residential address 22-Aug"
            className="mt-1 w-full px-3 py-2.5 rounded-lg border-2 border-[#E3D9C4] focus:border-[#D9531E] focus:outline-none text-sm"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full border border-[#E3D9C4] text-[#55504A] text-sm font-semibold hover:bg-[#F4EEE1]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-purple-600 text-white text-sm font-bold hover:bg-purple-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <MailCheck className="w-4 h-4" />}
            Mark paid
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function CancelModal({ referralId, onClose, onSubmit }) {
  const [reason, setReason]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    await onSubmit({ id: referralId, reason: reason.trim() || 'Admin cancelled' });
    setSubmitting(false);
  };

  return (
    <ModalShell title="Cancel this referral" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-[#55504A]">
          This will move the referral to <strong>cancelled</strong> and prevent
          any future credit unlock. Not reversible. Enter a reason for the
          audit trail.
        </p>
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-[#8F887E] font-semibold">Reason</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Referrer withdrew consent"
            className="mt-1 w-full px-3 py-2.5 rounded-lg border-2 border-[#E3D9C4] focus:border-[#D9531E] focus:outline-none text-sm"
            autoFocus
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full border border-[#E3D9C4] text-[#55504A] text-sm font-semibold hover:bg-[#F4EEE1]"
          >
            Keep active
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
            Cancel referral
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[#E3D9C4]">
          <h2 className="text-lg font-bold text-[#1A1614]">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-[#F4EEE1] text-[#8F887E]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ─── Bits ───────────────────────────────────────────────────────────────

function SummaryCard({ label, value, hint, icon: Icon, tone }) {
  const toneMap = {
    neutral: 'bg-white border-[#E3D9C4] text-[#1A1614]',
    emerald: 'bg-emerald-50 border-emerald-300 text-emerald-900',
    amber:   'bg-amber-50 border-amber-300 text-amber-900',
    purple:  'bg-purple-50 border-purple-300 text-purple-900',
  };
  return (
    <div className={`rounded-xl border-2 p-4 ${toneMap[tone] || toneMap.neutral}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs uppercase tracking-widest font-semibold opacity-70">{label}</div>
        <Icon className="w-4 h-4 opacity-70" />
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="text-xs opacity-70 mt-0.5">{hint}</div>}
    </div>
  );
}

function centsToNzd(cents) {
  const dollars = Math.round((cents || 0) / 100);
  return `$${dollars.toLocaleString('en-NZ')}`;
}

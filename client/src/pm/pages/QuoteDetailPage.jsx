import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { pmQuotesAPI } from '../services/pmQuotesApi';
import { fmtDate } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';

const fmt$ = n => '$' + Math.round(Number(n) || 0).toLocaleString('en-NZ');

// Day-6 stub. The full detail page (Validation panel + Generate / Email / Sign /
// Deposit action buttons + audit timeline) lands in Day 7. This stub just
// surfaces the existing quote data + a link into the edit form, so the
// /pm/quotes/:id route doesn't 404 between Day 6 and Day 7.
export default function QuoteDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [showReqModal, setShowReqModal] = useState(false);

  function load() {
    return pmQuotesAPI.get(id)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || e.message));
  }
  useEffect(() => { load(); }, [id]);

  async function handleArchive() {
    const reason = prompt('Archive reason (min 10 chars):', '');
    if (reason == null) return;
    if (reason.trim().length < 10) return alert('Reason must be at least 10 chars.');
    setArchiveBusy(true);
    try {
      await pmQuotesAPI.archive(id, reason);
      await load();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally { setArchiveBusy(false); }
  }
  async function handleUnarchive() {
    if (!confirm('Restore this quote to draft? (You can re-transition it via lifecycle actions.)')) return;
    setArchiveBusy(true);
    try {
      await pmQuotesAPI.unarchive(id);
      await load();
    } catch (e) {
      alert(e.response?.data?.error || e.message);
    } finally { setArchiveBusy(false); }
  }

  if (error) return <div className="bg-rose-50 border border-rose-200 rounded p-4 text-sm text-rose-700">{error}</div>;
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;

  const { quote, current_version, pending_discount } = data;
  const isArchived = quote.status === 'archived';

  return (
    <div>
      <div className="mb-6">
        <Link to="/pm/quotes" className="text-sm text-slate-500 hover:text-slate-800">← back to quotes</Link>
        <div className="mt-2 flex items-baseline justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-900 font-mono">
            {quote.quote_ref}
            {isArchived && (
              <span className="ml-3 align-middle text-xs font-sans font-semibold uppercase tracking-wide px-2 py-0.5 bg-slate-200 text-slate-600 rounded">
                Archived
              </span>
            )}
          </h1>
          <div className="flex gap-2">
            {!isArchived && (
              <Link to={`/pm/quotes/${id}/edit`}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm font-medium">
                Edit spec
              </Link>
            )}
            {!isArchived && !pending_discount && (
              <button onClick={() => setShowReqModal(true)}
                      className="px-3 py-1.5 border border-amber-400 text-amber-700 hover:bg-amber-50 rounded text-sm">
                Request discount
              </button>
            )}
            {isAdmin && !isArchived && (
              <button onClick={handleArchive} disabled={archiveBusy}
                      className="px-3 py-1.5 border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded text-sm">
                {archiveBusy ? '…' : 'Archive'}
              </button>
            )}
            {isAdmin && isArchived && (
              <button onClick={handleUnarchive} disabled={archiveBusy}
                      className="px-3 py-1.5 border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 rounded text-sm font-medium">
                {archiveBusy ? '…' : 'Unarchive (→ draft)'}
              </button>
            )}
          </div>
        </div>
        {isArchived && quote.archive_reason && (
          <div className="mt-3 bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-700">
            <b>Archived {quote.archived_at ? fmtDate(quote.archived_at) : ''}:</b> {quote.archive_reason}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Quote</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd className="font-medium">{quote.status.replace(/_/g, ' ')}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Stage</dt><dd>{quote.stage}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Version</dt><dd>v{quote.current_version_number}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Created</dt><dd>{fmtDate(quote.created_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Valid until</dt><dd>{quote.valid_until ? fmtDate(quote.valid_until) : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Customer</dt><dd>{quote.contacts?.name}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Email</dt><dd className="font-mono text-xs">{quote.contacts?.email}</dd></div>
          </dl>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Current spec snapshot</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Panels</dt><dd>{current_version?.spec?.system?.panel?.count} × {current_version?.spec?.system?.panel?.sku}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Inverter</dt><dd className="font-mono text-xs">{current_version?.spec?.system?.inverter?.sku}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Battery</dt><dd>{current_version?.spec?.system?.battery?.sku ? `${current_version.spec.system.battery.module_count}× ${current_version.spec.system.battery.sku}` : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Customer price</dt><dd>${Number(current_version?.spec?.pricing?.customer_price_inc_gst || 0).toLocaleString()} inc GST</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Generated PDF</dt><dd>{current_version?.generated_at ? fmtDate(current_version.generated_at) : 'Not yet generated'}</dd></div>
          </dl>
        </div>

        {pending_discount && (
          <PendingDiscountPanel
            req={pending_discount}
            isAdmin={isAdmin}
            currentPriceIncGst={current_version?.spec?.pricing?.customer_price_inc_gst || 0}
            onDecided={load}
            quoteId={id}
          />
        )}

        <div className="lg:col-span-2 bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs text-slate-600">
          <b>Day 7 will add:</b> Generate PDF · Email customer (dry-run + real) · Upload signed PDF ·
          Counter-sign · Record deposit + handoff · Audit timeline. For now use the API directly or
          the e2e-quote-flow.js script.
        </div>
      </div>

      {showReqModal && (
        <RequestDiscountModal
          quoteId={id}
          currentPriceIncGst={current_version?.spec?.pricing?.customer_price_inc_gst || 0}
          onClose={() => setShowReqModal(false)}
          onSubmitted={() => { setShowReqModal(false); load(); }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Rep-side: request a discount. Shows projected margin server-computed only
// after submit (the modal stays a thin form — engine is the source of truth).
// ────────────────────────────────────────────────────────────────────────────
function RequestDiscountModal({ quoteId, currentPriceIncGst, onClose, onSubmitted }) {
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const newPrice = Math.max(0, currentPriceIncGst - amount);
  const pctOff = currentPriceIncGst > 0 ? (amount / currentPriceIncGst * 100) : 0;
  const canSubmit = amount > 0 && reason.trim().length >= 10 && !busy;

  async function submit() {
    setBusy(true); setError('');
    try {
      await pmQuotesAPI.requestDiscount(quoteId, {
        requested_amount_nzd: Number(amount), reason: reason.trim(),
      });
      onSubmitted();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full">
        <h3 className="font-bold text-lg mb-1">Request owner discount</h3>
        <p className="text-xs text-slate-500 mb-4">
          Admin will see this request and decide. The engine recomputes margin against the discounted price —
          requests that would push the project below floor can still be raised but admin will see the projected margin.
        </p>

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div>
            <div className="text-xs text-slate-500">Current price (inc GST)</div>
            <div className="font-semibold">{fmt$(currentPriceIncGst)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Customer would pay</div>
            <div className="font-semibold text-amber-700">{fmt$(newPrice)}</div>
          </div>
        </div>

        <label className="block text-xs font-medium text-slate-700 mb-1">Discount amount ($ NZD inc GST)</label>
        <input type="number" min={0} value={amount}
               onChange={e => setAmount(Number(e.target.value) || 0)}
               className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
        {amount > 0 && (
          <p className="text-[11px] text-slate-500 mt-1">≈ {pctOff.toFixed(1)}% off current list</p>
        )}

        <label className="block text-xs font-medium text-slate-700 mt-3 mb-1">
          Reason for admin <span className="text-red-700">*</span>
        </label>
        <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Customer comparing 2 other quotes; willing to sign today at this price."
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
        {reason && reason.trim().length < 10 && (
          <p className="text-[11px] text-red-600 mt-1">Reason must be at least 10 characters.</p>
        )}

        {error && <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}

        <div className="flex gap-2 mt-5">
          <button onClick={submit} disabled={!canSubmit}
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded text-sm font-medium">
            {busy ? 'Submitting…' : 'Submit request'}
          </button>
          <button onClick={onClose}
                  className="px-4 py-1.5 border border-slate-300 hover:bg-slate-50 rounded text-sm">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Pending request panel — shows what was asked + admin decision controls.
// ────────────────────────────────────────────────────────────────────────────
function PendingDiscountPanel({ req, isAdmin, currentPriceIncGst, onDecided, quoteId }) {
  const [mode, setMode] = useState(null);             // null | 'modify' | 'reject'
  const [modifiedAmount, setModifiedAmount] = useState(req.requested_amount_nzd);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function decide(decision, amountOverride) {
    setBusy(true); setError('');
    try {
      await pmQuotesAPI.decideDiscount(quoteId, {
        decision,
        discount_request_id: req.id,
        approved_amount_nzd: decision === 'approved_modified' ? Number(amountOverride) : undefined,
        admin_notes: notes.trim() || null,
      });
      onDecided();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="lg:col-span-2 bg-amber-50 border border-amber-300 rounded-lg p-4 text-sm">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <b className="text-amber-900">Pending discount approval</b>
          <span className="text-amber-800 ml-2">
            · {fmt$(req.requested_amount_nzd)} requested · projected margin{' '}
            <b>{Number(req.requested_margin_pct).toFixed(1)}%</b>
          </span>
        </div>
        <div className="text-xs text-amber-700">
          Customer would pay {fmt$(currentPriceIncGst - req.requested_amount_nzd)} inc GST
        </div>
      </div>
      {req.reason && (
        <div className="mt-2 text-xs text-amber-900 italic">"{req.reason}"</div>
      )}

      {!isAdmin && (
        <div className="mt-3 text-xs text-amber-700">Awaiting admin decision. The quote is in pending owner review until decided.</div>
      )}

      {isAdmin && mode === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => decide('approved')} disabled={busy}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold disabled:opacity-50">
            ✓ Approve as requested
          </button>
          <button onClick={() => setMode('modify')} disabled={busy}
                  className="px-3 py-1.5 border border-amber-400 text-amber-800 hover:bg-amber-100 rounded text-xs font-medium">
            Approve modified amount…
          </button>
          <button onClick={() => setMode('reject')} disabled={busy}
                  className="px-3 py-1.5 border border-rose-400 text-rose-700 hover:bg-rose-50 rounded text-xs font-medium">
            ✕ Reject
          </button>
        </div>
      )}

      {isAdmin && mode === 'modify' && (
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <label className="block text-[11px] font-medium text-slate-700 mb-1">Approved amount ($ inc GST)</label>
            <input type="number" min={0} value={modifiedAmount}
                   onChange={e => setModifiedAmount(Number(e.target.value) || 0)}
                   className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-[11px] font-medium text-slate-700 mb-1">Admin notes (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                   placeholder="e.g. Approved $1500 instead of $2000 — keeps margin above floor."
                   className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
          </div>
          <div className="md:col-span-3 flex gap-2">
            <button onClick={() => decide('approved_modified', modifiedAmount)} disabled={busy || !(modifiedAmount > 0)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold disabled:opacity-50">
              {busy ? '…' : 'Approve modified'}
            </button>
            <button onClick={() => setMode(null)} className="px-3 py-1.5 border border-slate-300 hover:bg-slate-100 rounded text-xs">
              Back
            </button>
          </div>
        </div>
      )}

      {isAdmin && mode === 'reject' && (
        <div className="mt-3 space-y-2">
          <label className="block text-[11px] font-medium text-slate-700">Reason for rejection (shown in audit log)</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                    placeholder="e.g. Margin too low; suggest customer wait for next campaign promo."
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
          <div className="flex gap-2">
            <button onClick={() => decide('rejected')} disabled={busy}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-bold disabled:opacity-50">
              {busy ? '…' : 'Reject discount'}
            </button>
            <button onClick={() => setMode(null)} className="px-3 py-1.5 border border-slate-300 hover:bg-slate-100 rounded text-xs">
              Back
            </button>
          </div>
        </div>
      )}

      {error && <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">{error}</div>}
    </div>
  );
}

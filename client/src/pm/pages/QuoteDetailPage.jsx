import { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { pmQuotesAPI } from '../services/pmQuotesApi';
import { fmt$, fmtDate, fmtDateTime } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';

// ────────────────────────────────────────────────────────────────────────────
// Day 7 — Quote detail page.
//
// Surfaces the full quote lifecycle the Day-5 endpoints already implement:
//   draft → generated → sent_to_customer → signed → counter_signed →
//   deposit_received → handed_off
//
// Each section is status-aware: buttons + modals only show up when the
// corresponding endpoint is callable (matches the server-side status guards
// in routes/pm/quote-actions.js).
//
// Lifecycle action endpoints used here:
//   POST /:id/generate · /email · /sign · /counter-sign · /deposit
//   GET  /:id/audit-log · /pdf
// All wired via pmQuotesAPI.
// ────────────────────────────────────────────────────────────────────────────

// ── Lifecycle state machine — derived from server guards ──────────────────
// Mirror of the status check in routes/pm/quote-actions.js. If the server
// ever changes a guard, update here too.
const LIFECYCLE_STEPS = [
  { id: 'draft',             label: 'Draft',              terminalStatuses: ['draft'] },
  { id: 'generated',         label: 'PDF generated',      terminalStatuses: ['generated'] },
  { id: 'sent_to_customer',  label: 'Sent to customer',   terminalStatuses: ['sent_to_customer'] },
  { id: 'signed',            label: 'Customer signed',    terminalStatuses: ['signed'] },
  { id: 'counter_signed',    label: 'Counter-signed',     terminalStatuses: ['counter_signed'] },
  { id: 'deposit_received',  label: 'Deposit received',   terminalStatuses: ['deposit_received'] },
  { id: 'handed_off',        label: 'Handed off to PM',   terminalStatuses: ['handed_off'] },
];

const STATUS_RANK = {
  draft: 0,
  pending_owner_review: 0,
  ready_to_generate: 0,
  generated: 1,
  sent_to_customer: 2,
  signed: 3,
  counter_signed: 4,
  deposit_received: 5,
  handed_off: 6,
};

function actionAvailability(status) {
  return {
    generate:    ['draft', 'ready_to_generate', 'generated'].includes(status),
    email:       ['generated', 'sent_to_customer'].includes(status),
    sign:        ['generated', 'sent_to_customer'].includes(status),
    counterSign: status === 'signed',
    deposit:     ['counter_signed', 'signed'].includes(status),
  };
}

// Mapping audit action codes → display labels + icon + colour.
// Keep in sync with the action strings written in quote-actions.js writeAudit.
const AUDIT_ACTION_META = {
  'pdf.generated':       { icon: '📄', label: 'PDF generated',         tone: 'sky' },
  'email.sent':          { icon: '📧', label: 'Email sent',             tone: 'sky' },
  'email.dry_run':       { icon: '🧪', label: 'Email dry-run',          tone: 'slate' },
  'customer.signed':     { icon: '✍️',  label: 'Customer signed',       tone: 'emerald' },
  'counter_signed':      { icon: '🖋️',  label: 'Counter-signed',         tone: 'emerald' },
  'deposit.received':    { icon: '💰', label: 'Deposit received',       tone: 'emerald' },
  'handoff.to_pm':       { icon: '🤝', label: 'Handed off to PM',       tone: 'emerald' },
  'discount.requested':  { icon: '🏷️',  label: 'Discount requested',    tone: 'amber' },
  'discount.approved':   { icon: '✅', label: 'Discount approved',       tone: 'emerald' },
  'discount.rejected':   { icon: '❌', label: 'Discount rejected',       tone: 'rose'    },
  'spec.changed':        { icon: '✏️',  label: 'Spec edited',           tone: 'slate' },
  'quote.created':       { icon: '✨', label: 'Quote created',          tone: 'slate' },
  'validate.run':        { icon: '⚙️',  label: 'Validation re-run',     tone: 'slate' },
  'archived':            { icon: '🗄️',  label: 'Archived',              tone: 'slate' },
  'unarchived':          { icon: '↩️',  label: 'Restored from archive', tone: 'slate' },
  'withdrawn':           { icon: '🚪', label: 'Withdrawn',              tone: 'slate' },
};

function auditMeta(action) {
  return AUDIT_ACTION_META[action] || { icon: '•', label: action, tone: 'slate' };
}

// ────────────────────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────────────────────
export default function QuoteDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [data, setData] = useState(null);
  const [auditLog, setAuditLog] = useState([]);
  const [error, setError] = useState('');

  // Global "which action is in-flight" — disables other action buttons while
  // one is running so we don't race the server with stale status guards.
  const [busyAction, setBusyAction] = useState(null);   // 'generate' | 'email' | …
  const [actionMsg, setActionMsg]   = useState('');
  const [actionErr, setActionErr]   = useState('');

  // Modal state — one open at a time.
  const [openModal, setOpenModal] = useState(null);     // 'discount' | 'email' | 'sign' | 'countersign' | 'deposit'
  // Phase F — multi-tier detail page. Default to 0; auto-switches to the
  // recommended tier when data lands (useEffect below). Must be declared at
  // the TOP of the component, before any early returns, per Rules of Hooks.
  const [detailTierIdx, setDetailTierIdx] = useState(0);

  const load = useCallback(() => {
    return Promise.all([
      pmQuotesAPI.get(id),
      pmQuotesAPI.auditLog(id).catch(() => ({ data: [] })),
    ])
      .then(([q, a]) => { setData(q.data); setAuditLog(a.data || []); })
      .catch(e => setError(e.response?.data?.error || e.message));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Phase F — when a new version's data lands, default the detail-page tier
  // selector to the recommended tier (if any). Runs once per version_id so
  // user clicks aren't overridden mid-view.
  useEffect(() => {
    const tiers = data?.current_version?.spec?.tiers;
    if (Array.isArray(tiers) && tiers.length > 0) {
      const rec = tiers.findIndex(t => t.is_recommended === true);
      if (rec >= 0) setDetailTierIdx(rec);
    }
  }, [data?.current_version?.id]);

  function flashMsg(m) { setActionMsg(m); setTimeout(() => setActionMsg(''), 3000); }
  function flashErr(m) { setActionErr(m); setTimeout(() => setActionErr(''), 6000); }

  // Generic action runner — wraps every lifecycle endpoint with busy + reload.
  async function runAction(key, fn, successMsg) {
    setBusyAction(key); setActionErr('');
    try {
      const r = await fn();
      await load();
      if (successMsg) flashMsg(successMsg);
      return r;
    } catch (e) {
      flashErr(e.response?.data?.error || e.message);
      throw e;
    } finally {
      setBusyAction(null);
    }
  }

  async function handleArchive() {
    const reason = prompt('Archive reason (min 10 chars):', '');
    if (reason == null) return;
    if (reason.trim().length < 10) return alert('Reason must be at least 10 chars.');
    await runAction('archive', () => pmQuotesAPI.archive(id, reason), 'Archived.');
  }
  async function handleUnarchive() {
    if (!confirm('Restore this quote to draft? (You can re-transition it via lifecycle actions.)')) return;
    await runAction('unarchive', () => pmQuotesAPI.unarchive(id), 'Restored to draft.');
  }

  if (error) {
    return <div className="bg-rose-50 border border-rose-200 rounded p-4 text-sm text-rose-700">{error}</div>;
  }
  if (!data) return <div className="text-sm text-slate-500">Loading…</div>;

  const { quote, current_version, pending_discount } = data;
  const isArchived = quote.status === 'archived';
  const avail = actionAvailability(quote.status);

  // Pricing snapshot is set on /generate. Surfacing it on PDF download card.
  const snap = current_version?.pricing_snapshot;
  const margin = current_version?.validator_output
    ? snap?.totals?.project_margin_pct
    : null;

  // Multi-tier awareness: the quote may carry 3 tiers, each with its own
  // system_overrides + pricing. The detail page used to read top-level
  // spec.system.* which is a stale snapshot from quote creation. Now we
  // resolve the SELECTED tier (default: recommended ★) and merge its
  // overrides over the top-level for display.
  const spec = current_version?.spec || {};
  const tiers = Array.isArray(spec.tiers) ? spec.tiers : [];
  const isMultiTier = tiers.length > 0;
  // Clamp the user's selection to the current tiers array (handles version
  // refreshes that change the tier count).
  const safeTierIdx = Math.min(detailTierIdx, Math.max(0, tiers.length - 1));
  const selectedTier = isMultiTier ? tiers[safeTierIdx] : null;
  const viewSystem = isMultiTier
    ? { ...(spec.system || {}), ...(selectedTier?.system_overrides || {}) }
    : (spec.system || {});
  const viewPricing = isMultiTier
    ? (selectedTier?.pricing || {})
    : (spec.pricing || {});

  return (
    <div>
      {/* ── Header ─────────────────────────────────────────────────────── */}
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
            <StatusBadge status={quote.status} />
          </h1>
          <div className="flex gap-2 flex-wrap">
            {!isArchived && (
              <Link to={`/pm/quotes/${id}/edit`}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded text-sm font-medium">
                Edit spec
              </Link>
            )}
            {!isArchived && !pending_discount && (
              <button onClick={() => setOpenModal('discount')}
                      className="px-3 py-1.5 border border-amber-400 text-amber-700 hover:bg-amber-50 rounded text-sm">
                Request discount
              </button>
            )}
            {isAdmin && !isArchived && (
              <button onClick={handleArchive} disabled={!!busyAction}
                      className="px-3 py-1.5 border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded text-sm">
                {busyAction === 'archive' ? '…' : 'Archive'}
              </button>
            )}
            {isAdmin && isArchived && (
              <button onClick={handleUnarchive} disabled={!!busyAction}
                      className="px-3 py-1.5 border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 rounded text-sm font-medium">
                {busyAction === 'unarchive' ? '…' : 'Unarchive (→ draft)'}
              </button>
            )}
          </div>
        </div>
        {isArchived && quote.archive_reason && (
          <div className="mt-3 bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-700">
            <b>Archived {quote.archived_at ? fmtDate(quote.archived_at) : ''}:</b> {quote.archive_reason}
          </div>
        )}

        {actionMsg && (
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded px-3 py-2 text-sm text-emerald-800">
            {actionMsg}
          </div>
        )}
        {actionErr && (
          <div className="mt-3 bg-rose-50 border border-rose-200 rounded px-3 py-2 text-sm text-rose-700">
            {actionErr}
          </div>
        )}
      </div>

      {/* ── Lifecycle stepper ──────────────────────────────────────────── */}
      <LifecycleStepper status={quote.status} />

      {/* ── 2-column grid ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 mt-6">

        {/* Left column ─────────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Quote summary card */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Quote</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Row k="Status">{quote.status.replace(/_/g, ' ')}</Row>
              <Row k="Stage">{quote.stage}</Row>
              <Row k="Version">v{quote.current_version_number}</Row>
              <Row k="Created">{fmtDate(quote.created_at)}</Row>
              <Row k="Valid until">{quote.valid_until ? fmtDate(quote.valid_until) : '—'}</Row>
              <Row k="Customer">{quote.contacts?.name}</Row>
              <Row k="Email"><span className="font-mono text-xs">{quote.contacts?.email}</span></Row>
              <Row k="Phone">{quote.contacts?.phone || '—'}</Row>
            </dl>
          </div>

          {/* Current spec snapshot card */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                {isMultiTier ? 'Spec snapshot — viewing tier' : 'Current spec snapshot'}
              </h2>
              {isMultiTier && (
                <div className="flex items-center gap-1 flex-wrap">
                  {tiers.map((t, i) => (
                    <button
                      key={t.tier_id || i}
                      type="button"
                      onClick={() => setDetailTierIdx(i)}
                      className={
                        'px-2.5 py-0.5 rounded text-xs font-medium border transition-colors ' +
                        (i === safeTierIdx
                          ? 'border-amber-500 bg-amber-100 text-amber-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
                      }
                      title={t.is_recommended ? 'Recommended tier' : ''}>
                      {t.is_recommended && '★ '}
                      {t.label || `Tier ${i + 1}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Row k="Panels">
                {viewSystem?.panel?.count != null
                  ? `${viewSystem.panel.count} × ${viewSystem.panel.sku || '—'}`
                  : '—'}
              </Row>
              <Row k="Inverter">
                <span className="font-mono text-xs">{viewSystem?.inverter?.sku || '—'}</span>
              </Row>
              <Row k="Battery">
                {viewSystem?.battery?.sku
                  ? `${viewSystem.battery.module_count}× ${viewSystem.battery.sku}`
                  : '— (no battery)'}
              </Row>
              <Row k="EV charger">
                {viewSystem?.wattpilot_included ? 'Wattpilot included' : '—'}
              </Row>
              <Row k="Customer price">
                {viewPricing?.customer_price_inc_gst != null
                  ? `$${Number(viewPricing.customer_price_inc_gst).toLocaleString()} inc GST`
                  : <span className="text-emerald-700">Auto-priced ⚡ (tracks live engine list)</span>}
              </Row>
              <Row k="Engine LIST">
                {snap?.totals?.total_list_inc_gst
                  ? fmt$(snap.totals.total_list_inc_gst)
                  : '— (run Generate PDF)'}
                {isMultiTier && snap?.totals?.total_list_inc_gst && (
                  <span className="text-[10px] text-slate-500 ml-1">(headline tier snapshot)</span>
                )}
              </Row>
              <Row k="Margin %">{margin != null ? margin.toFixed(1) + '%' : '—'}</Row>
              <Row k="Generated">{current_version?.generated_at ? fmtDateTime(current_version.generated_at) : 'Not yet generated'}</Row>
              <Row k="Signed">{current_version?.signed_at ? fmtDateTime(current_version.signed_at) : '—'}</Row>
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

          {/* Lifecycle actions */}
          {!isArchived && (
            <LifecycleActions
              status={quote.status}
              avail={avail}
              isAdmin={isAdmin}
              busyAction={busyAction}
              onGenerate={() => runAction('generate',
                () => pmQuotesAPI.generate(id),
                'PDFs generated.')}
              onEmail={() => setOpenModal('email')}
              onSign={() => setOpenModal('sign')}
              onCounterSign={() => setOpenModal('countersign')}
              onDeposit={() => setOpenModal('deposit')}
            />
          )}

          {/* PDF downloads */}
          <PdfDownloads
            quoteId={id}
            version={current_version}
            onError={flashErr}
          />
        </div>

        {/* Right column — audit timeline ───────────────────────────────── */}
        <AuditTimeline rows={auditLog} />
      </div>

      {/* ── Modals (one at a time) ─────────────────────────────────────── */}
      {openModal === 'discount' && (
        <RequestDiscountModal
          quoteId={id}
          currentPriceIncGst={current_version?.spec?.pricing?.customer_price_inc_gst || 0}
          onClose={() => setOpenModal(null)}
          onSubmitted={() => { setOpenModal(null); load(); }}
        />
      )}
      {openModal === 'email' && (
        <EmailCustomerModal
          quoteId={id}
          quote={quote}
          onClose={() => setOpenModal(null)}
          onSent={(result) => {
            setOpenModal(null);
            flashMsg(result.dry_run
              ? `Dry-run OK — would send to ${result.would_send.to}`
              : `Email sent (${result.provider_message_id || 'no message id'})`);
            load();
          }}
        />
      )}
      {openModal === 'sign' && (
        <SignedPdfUploadModal
          quoteId={id}
          onClose={() => setOpenModal(null)}
          onUploaded={() => { setOpenModal(null); flashMsg('Signed PDF uploaded.'); load(); }}
        />
      )}
      {openModal === 'countersign' && (
        <CounterSignModal
          quoteId={id}
          onClose={() => setOpenModal(null)}
          onSigned={() => { setOpenModal(null); flashMsg('Counter-signed.'); load(); }}
        />
      )}
      {openModal === 'deposit' && (
        <DepositModal
          quoteId={id}
          onClose={() => setOpenModal(null)}
          onRecorded={(result) => {
            setOpenModal(null);
            flashMsg(result.project_id
              ? `Deposit recorded + handed off to PM (project ${result.project_id.slice(0, 8)}…)`
              : 'Deposit recorded.');
            load();
          }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tiny presentational helpers
// ────────────────────────────────────────────────────────────────────────────
function Row({ k, children }) {
  return (
    <>
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-900 text-right sm:text-left">{children}</dd>
    </>
  );
}

function StatusBadge({ status }) {
  const tone =
    ['draft', 'ready_to_generate'].includes(status)    ? 'bg-slate-200 text-slate-700' :
    status === 'pending_owner_review'                   ? 'bg-amber-200 text-amber-800' :
    ['generated', 'sent_to_customer'].includes(status)  ? 'bg-sky-200 text-sky-800' :
    ['signed', 'counter_signed'].includes(status)       ? 'bg-emerald-200 text-emerald-800' :
    ['deposit_received', 'handed_off'].includes(status) ? 'bg-emerald-300 text-emerald-900' :
    ['withdrawn', 'expired', 'closed_lost'].includes(status) ? 'bg-rose-200 text-rose-800' :
                                                          'bg-slate-200 text-slate-700';
  return (
    <span className={`ml-3 align-middle text-xs font-sans font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle stepper — visual indicator across the top
// ────────────────────────────────────────────────────────────────────────────
function LifecycleStepper({ status }) {
  const currentRank = STATUS_RANK[status] ?? 0;
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center justify-between gap-1 text-[10px] uppercase tracking-wide font-semibold">
        {LIFECYCLE_STEPS.map((step, i) => {
          const rank = i;
          const done    = rank < currentRank;
          const current = rank === currentRank;
          const dotClass = done    ? 'bg-emerald-500 border-emerald-500 text-white'
                         : current ? 'bg-amber-500 border-amber-500 text-white'
                                   : 'bg-white border-slate-300 text-slate-400';
          const textClass = done ? 'text-emerald-700'
                         : current ? 'text-amber-700'
                                   : 'text-slate-400';
          return (
            <div key={step.id} className="flex-1 flex flex-col items-center">
              <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold mb-1 ${dotClass}`}>
                {done ? '✓' : i + 1}
              </div>
              <div className={`text-center leading-tight ${textClass}`}>{step.label}</div>
              {i < LIFECYCLE_STEPS.length - 1 && (
                <div className={`absolute hidden ${done ? 'bg-emerald-300' : 'bg-slate-200'}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle actions panel — status-aware buttons
// ────────────────────────────────────────────────────────────────────────────
function LifecycleActions({ status, avail, isAdmin, busyAction, onGenerate, onEmail, onSign, onCounterSign, onDeposit }) {
  const allBusy = !!busyAction;

  const ActionBtn = ({ id, available, onClick, primary, children, title }) => (
    <button
      onClick={onClick}
      disabled={!available || allBusy}
      title={title || (available ? '' : `Not available from status "${status}"`)}
      className={
        'px-3 py-2 rounded text-sm font-medium transition-colors ' +
        (!available
          ? 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
          : primary
            ? 'bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white'
            : 'bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 border border-slate-300')
      }>
      {busyAction === id ? 'Working…' : children}
    </button>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Lifecycle actions</h2>
        <span className="text-[11px] text-slate-500">Buttons disable when not allowed at this status.</span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Each action flips the quote's status forward. The server enforces the same gating —
        clicking a disabled button would 409.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <ActionBtn id="generate" available={avail.generate} onClick={onGenerate} primary>
          Generate PDF
        </ActionBtn>
        <ActionBtn id="email" available={avail.email} onClick={onEmail}>
          Email customer
        </ActionBtn>
        <ActionBtn id="sign" available={avail.sign} onClick={onSign}>
          Upload signed PDF
        </ActionBtn>
        <ActionBtn id="countersign" available={avail.counterSign && isAdmin} onClick={onCounterSign}
                   title={!isAdmin ? 'Counter-sign is admin-only' : undefined}>
          Counter-sign {!isAdmin && '(admin)'}
        </ActionBtn>
        <ActionBtn id="deposit" available={avail.deposit} onClick={onDeposit}>
          Record deposit
        </ActionBtn>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PDF downloads card — calls GET /pdf to get signed URL, opens in new tab
// ────────────────────────────────────────────────────────────────────────────
function PdfDownloads({ quoteId, version, onError }) {
  const [busyKind, setBusyKind] = useState(null);

  // Available kinds depend on which storage paths the current version row has set.
  const available = [
    { kind: 'customer',         label: 'Customer proposal',  has: !!version?.customer_pdf_storage_path },
    { kind: 'sales-console',    label: 'Sales console',      has: !!version?.internal_onepager_pdf_storage_path },
    { kind: 'signed-customer',  label: 'Customer-signed',    has: !!version?.signed_pdf_storage_path },
    { kind: 'counter-signed',   label: 'Counter-signed',     has: !!version?.counter_signed_pdf_storage_path },
  ];
  const anyAvailable = available.some(a => a.has);

  async function open(kind) {
    setBusyKind(kind);
    try {
      const r = await pmQuotesAPI.pdfUrl(quoteId, kind, version?.version_number);
      window.open(r.data.url, '_blank', 'noopener');
    } catch (e) {
      onError(e.response?.data?.error || e.message);
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">PDF downloads</h2>
      {!anyAvailable ? (
        <p className="text-xs text-slate-500 italic">
          No PDFs generated for this version yet. Click <b>Generate PDF</b> above to render.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {available.map(a => (
            <button
              key={a.kind}
              onClick={() => open(a.kind)}
              disabled={!a.has || busyKind === a.kind}
              className={
                'px-3 py-2 rounded text-sm text-left flex items-center justify-between transition-colors ' +
                (a.has
                  ? 'bg-slate-50 hover:bg-slate-100 text-slate-800 border border-slate-200'
                  : 'bg-slate-50 text-slate-400 border border-slate-200 cursor-not-allowed')
              }>
              <span>📄 {a.label}</span>
              <span className="text-[11px] text-slate-500">
                {busyKind === a.kind ? '…'
                  : a.has ? 'download →'
                          : 'not on file'}
              </span>
            </button>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-slate-500">
        Downloads use short-lived signed URLs from Supabase Storage (1-hour TTL). The link opens in a new tab.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Audit timeline — reverse-chrono from GET /audit-log
// ────────────────────────────────────────────────────────────────────────────
function AuditTimeline({ rows }) {
  const [expanded, setExpanded] = useState(new Set());
  function toggle(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 lg:sticky lg:top-4 self-start">
      <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">Audit timeline</h2>
      <p className="text-xs text-slate-500 mb-4">
        Every lifecycle event, append-only. Newest at the top.
      </p>
      {(rows || []).length === 0 ? (
        <p className="text-xs text-slate-500 italic">No events yet.</p>
      ) : (
        <ol className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
          {rows.map(r => {
            const meta = auditMeta(r.action);
            const toneClass =
              meta.tone === 'emerald' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
              meta.tone === 'sky'     ? 'bg-sky-50 border-sky-200 text-sky-800'             :
              meta.tone === 'amber'   ? 'bg-amber-50 border-amber-200 text-amber-800'       :
              meta.tone === 'rose'    ? 'bg-rose-50 border-rose-200 text-rose-800'          :
                                        'bg-slate-50 border-slate-200 text-slate-700';
            const hasDetail = r.before || r.after || r.metadata;
            const isOpen = expanded.has(r.id);
            return (
              <li key={r.id} className={`border rounded p-2.5 ${toneClass}`}>
                <div className="flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2 flex-wrap">
                      <div className="text-xs font-semibold">{meta.label}</div>
                      <div className="text-[10px] text-slate-500 whitespace-nowrap">
                        {fmtDateTime(r.occurred_at)}
                      </div>
                    </div>
                    <div className="text-[11px] mt-0.5 text-slate-600">
                      {r.actor_role && <><b>{r.actor_role}</b></>}
                      {r.actor_user_id && <span className="font-mono"> · {String(r.actor_user_id).slice(0, 8)}</span>}
                      {!r.actor_user_id && <i className="text-slate-400">system</i>}
                    </div>
                    {hasDetail && (
                      <button onClick={() => toggle(r.id)}
                              className="mt-1 text-[10px] text-slate-500 hover:text-slate-800 underline">
                        {isOpen ? 'Hide detail' : 'Show detail'}
                      </button>
                    )}
                    {isOpen && (
                      <pre className="mt-2 text-[10px] bg-white/70 border border-slate-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify({ before: r.before, after: r.after, metadata: r.metadata }, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Email customer modal — to/cc/bcc + dry-run toggle
// ────────────────────────────────────────────────────────────────────────────
function EmailCustomerModal({ quoteId, quote, onClose, onSent }) {
  const defaultTo = quote.contacts?.email || '';
  const [to, setTo]   = useState(defaultTo);
  const [cc, setCc]   = useState('');
  const [bcc, setBcc] = useState('');
  const [dryRun, setDryRun] = useState(true);  // default to dry-run for safety
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!to) return setErr('"To" address required.');
    setBusy(true); setErr('');
    try {
      const body = {
        to,
        cc:  cc ? cc.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        bcc: bcc ? bcc.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        dry_run: dryRun,
      };
      const r = await pmQuotesAPI.email(quoteId, body);
      onSent(r.data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Email customer proposal" onClose={onClose}>
      <p className="text-xs text-slate-500 mb-4">
        Attaches the current customer PDF and sends via Resend.
        {' '}<b>Dry-run</b> validates the recipient + builds the body without actually sending — use for a first pass.
      </p>

      <Field label="To" required>
        <input type="email" value={to} onChange={e => setTo(e.target.value)} placeholder="customer@example.com"
               className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
      </Field>
      <Field label="Cc (comma-separated)">
        <input type="text" value={cc} onChange={e => setCc(e.target.value)} placeholder="rep@goldenray.energy"
               className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
      </Field>
      <Field label="Bcc (comma-separated)">
        <input type="text" value={bcc} onChange={e => setBcc(e.target.value)}
               className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
      </Field>

      <label className="flex items-center gap-2 mt-3 text-sm">
        <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
        <span>Dry-run (do not actually send)</span>
      </label>

      {err && <Inline err={err} />}
      <Buttons
        primaryLabel={busy ? '…' : (dryRun ? 'Run dry-run' : 'Send email')}
        primaryClass={dryRun ? 'bg-slate-600 hover:bg-slate-700' : 'bg-amber-500 hover:bg-amber-600'}
        onPrimary={submit}
        primaryDisabled={busy}
        onCancel={onClose}
      />
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Upload customer-signed PDF modal — file picker + signer info
// ────────────────────────────────────────────────────────────────────────────
function SignedPdfUploadModal({ quoteId, onClose, onUploaded }) {
  const [file, setFile] = useState(null);
  const [signerName, setSignerName] = useState('');
  const [signedAt, setSignedAt] = useState(new Date().toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    if (!file) return setErr('Pick a PDF file first.');
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return setErr('File must be a PDF.');
    }
    setBusy(true); setErr('');
    try {
      const buffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      await pmQuotesAPI.sign(quoteId, {
        signed_pdf_base64: base64,
        signed_at: new Date(signedAt).toISOString(),
        signer_name: signerName || null,
      });
      onUploaded();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Upload customer-signed PDF" onClose={onClose}>
      <p className="text-xs text-slate-500 mb-4">
        Drop the customer-signed PDF here. The file is uploaded as-is — make sure
        it's the right version (matches the customer-proposal PDF you sent).
      </p>

      <Field label="Signed PDF file" required>
        <input type="file" accept=".pdf,application/pdf"
               onChange={e => { setFile(e.target.files?.[0] || null); setErr(''); }}
               className="block w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-amber-50 file:text-amber-800 file:font-semibold file:cursor-pointer hover:file:bg-amber-100" />
        {file && (
          <p className="text-[11px] text-slate-500 mt-1">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>
        )}
      </Field>
      <Field label="Signer name (optional)">
        <input type="text" value={signerName} onChange={e => setSignerName(e.target.value)}
               placeholder="Customer's full name as signed"
               className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
      </Field>
      <Field label="Signed at (when customer signed)">
        <input type="datetime-local" value={signedAt} onChange={e => setSignedAt(e.target.value)}
               className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
      </Field>

      {err && <Inline err={err} />}
      <Buttons
        primaryLabel={busy ? 'Uploading…' : 'Upload + mark signed'}
        onPrimary={submit}
        primaryDisabled={!file || busy}
        onCancel={onClose}
      />
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Counter-sign modal (admin only) — optional PDF upload + signer name
// ────────────────────────────────────────────────────────────────────────────
function CounterSignModal({ quoteId, onClose, onSigned }) {
  const [file, setFile] = useState(null);
  const [signerName, setSignerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setBusy(true); setErr('');
    try {
      let base64 = undefined;
      if (file) {
        const buffer = await file.arrayBuffer();
        base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      }
      await pmQuotesAPI.counterSign(quoteId, {
        counter_signed_pdf_base64: base64,
        counter_signer_name: signerName || null,
      });
      onSigned();
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Counter-sign (admin)" onClose={onClose}>
      <p className="text-xs text-slate-500 mb-4">
        Marks Goldenray's binding counter-signature. Optionally attach the
        counter-signed PDF (if you signed a copy with sig pad / e-sign).
      </p>

      <Field label="Counter-signed PDF (optional)">
        <input type="file" accept=".pdf,application/pdf"
               onChange={e => { setFile(e.target.files?.[0] || null); setErr(''); }}
               className="block w-full text-xs file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-amber-50 file:text-amber-800 file:font-semibold file:cursor-pointer hover:file:bg-amber-100" />
        {file && (
          <p className="text-[11px] text-slate-500 mt-1">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>
        )}
      </Field>
      <Field label="Counter-signer name (optional)">
        <input type="text" value={signerName} onChange={e => setSignerName(e.target.value)}
               placeholder="e.g. Sarah Chen, Director"
               className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
      </Field>

      {err && <Inline err={err} />}
      <Buttons
        primaryLabel={busy ? 'Signing…' : 'Counter-sign'}
        onPrimary={submit}
        primaryDisabled={busy}
        onCancel={onClose}
      />
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Record deposit modal — amount + reference + handoff toggle
// ────────────────────────────────────────────────────────────────────────────
function DepositModal({ quoteId, onClose, onRecorded }) {
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 16));
  const [handoff, setHandoff] = useState(true);   // default to YES — record + handoff is the typical flow
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const amt = Number(amount) || 0;

  async function submit() {
    if (amt <= 0) return setErr('Amount must be > 0.');
    setBusy(true); setErr('');
    try {
      const r = await pmQuotesAPI.deposit(quoteId, {
        deposit_amount_nzd: amt,
        deposit_reference: reference || null,
        deposit_received_at: new Date(receivedAt).toISOString(),
        handoff_to_pm: handoff,
      });
      onRecorded(r.data);
    } catch (e) {
      setErr(e.response?.data?.error || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Record deposit" onClose={onClose}>
      <p className="text-xs text-slate-500 mb-4">
        Records the deposit payment. Optional handoff creates a row in
        <code className="mx-1 bg-slate-100 px-1 rounded">projects_v2</code> linked back to this quote,
        starting the install workflow.
      </p>

      <Field label="Amount (NZD inc GST)" required>
        <input type="number" min={0} step="0.01" value={amount}
               onChange={e => setAmount(e.target.value)} placeholder="e.g. 13500.00"
               className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
        {amt > 0 && (
          <p className="text-[11px] text-slate-500 mt-1">Recording {fmt$(amt)}</p>
        )}
      </Field>
      <Field label="Bank reference (optional but recommended)">
        <input type="text" value={reference} onChange={e => setReference(e.target.value)}
               placeholder="e.g. ASB statement ref RM-2026-0612-XYZ"
               className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
      </Field>
      <Field label="Received at">
        <input type="datetime-local" value={receivedAt} onChange={e => setReceivedAt(e.target.value)}
               className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm" />
      </Field>

      <label className="flex items-start gap-2 mt-3 text-sm">
        <input type="checkbox" checked={handoff} onChange={e => setHandoff(e.target.checked)} className="mt-0.5" />
        <span>
          <b>Hand off to PM Tool</b> — creates the <code>projects_v2</code> row + flips quote status to
          <code className="mx-1 bg-slate-100 px-1 rounded">handed_off</code>. Untick to leave at
          <code className="mx-1 bg-slate-100 px-1 rounded">deposit_received</code> (you can hand off later).
        </span>
      </label>

      {err && <Inline err={err} />}
      <Buttons
        primaryLabel={busy ? 'Recording…' : (handoff ? 'Record + hand off' : 'Record deposit')}
        onPrimary={submit}
        primaryDisabled={!(amt > 0) || busy}
        onCancel={onClose}
      />
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Modal shell + form bits (kept here so this file has zero external deps
// beyond what was already imported)
// ────────────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-bold text-lg">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 -mt-1 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, required, children }) {
  return (
    <div className="mt-3">
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}{required && <span className="text-red-700"> *</span>}
      </label>
      {children}
    </div>
  );
}
function Inline({ err }) {
  return (
    <div className="mt-3 px-3 py-2 bg-rose-50 border border-rose-200 rounded text-xs text-rose-700">{err}</div>
  );
}
function Buttons({ primaryLabel, primaryClass, onPrimary, primaryDisabled, onCancel }) {
  return (
    <div className="flex gap-2 mt-5">
      <button onClick={onPrimary} disabled={primaryDisabled}
              className={`px-4 py-1.5 text-white disabled:opacity-50 rounded text-sm font-medium ${primaryClass || 'bg-amber-500 hover:bg-amber-600'}`}>
        {primaryLabel}
      </button>
      <button onClick={onCancel}
              className="px-4 py-1.5 border border-slate-300 hover:bg-slate-50 rounded text-sm">Cancel</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Below: existing discount UX preserved verbatim from the prior version.
// Kept end of file so the Day-7 lifecycle code reads top-down.
// ════════════════════════════════════════════════════════════════════════════

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
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 text-sm">
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

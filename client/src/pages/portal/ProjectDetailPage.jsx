import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../services/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { fmt$, fmtDateLong, fmtDate } from '../../utils/format';
import { PROJECT_STAGES, getStage, stageIndex, STAGE_CHECKLISTS, STAGE_TABS, TAB_CATALOG, IMPLEMENTED_TABS, STAGES_REQUIRING_CUSTOMER_ACTION, stageCompletion } from '../../utils/stages';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowLeft, Calendar, Activity as ActivityIcon, Sun, User as UserIcon,
  Mail, Phone, MapPin, Zap, DollarSign, CheckSquare, Square, Clock, ChevronDown, Lock, ShieldAlert,
  Flame, Snowflake, ThermometerSun, FileText, Home, Save, RefreshCw, Download, Send, Eye, FileCheck2, TrendingUp, Leaf, Plus, CheckCircle2, X, ArrowRight, AlertTriangle,
} from 'lucide-react';

const CALL_OUTCOMES = [
  { value: 'reached',       label: 'Reached customer' },
  { value: 'voicemail',     label: 'Left voicemail' },
  { value: 'no_answer',     label: 'No answer' },
  { value: 'wrong_number',  label: 'Wrong number' },
];

const QUALITY_OPTIONS = [
  { value: 'hot',  label: 'Hot',  desc: 'High intent, ready to move',     color: 'bg-red-50 border-red-300 text-red-700 ring-red-300',           icon: Flame },
  { value: 'warm', label: 'Warm', desc: 'Interested, needs nurturing',    color: 'bg-amber-50 border-amber-300 text-amber-700 ring-amber-300',   icon: ThermometerSun },
  { value: 'cold', label: 'Cold', desc: 'Low intent, long-term nurture',  color: 'bg-sky-50 border-sky-300 text-sky-700 ring-sky-300',           icon: Snowflake },
];

function StageProgressBar({ currentStage }) {
  const current = stageIndex(currentStage);
  return (
    <div className="flex items-center w-full">
      {PROJECT_STAGES.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={s.id} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition
                  ${active ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white ring-4 ring-amber-100 shadow' :
                    done    ? 'bg-emerald-500 text-white' :
                              'bg-gray-100 text-gray-300'}`}
              >
                {done ? '✓' : s.icon}
              </div>
              <div className={`text-[10px] font-bold mt-1.5 uppercase tracking-wide ${active ? 'text-amber-600' : done ? 'text-emerald-600' : 'text-gray-300'}`}>
                {s.label}
              </div>
            </div>
            {i < PROJECT_STAGES.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1 -mt-5 ${done ? 'bg-emerald-500' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StageMoveDropdown({ currentStage, onMove, disabled, completion, isAdmin }) {
  const [open, setOpen] = useState(false);
  const [backwardTarget, setBackwardTarget] = useState(null); // { id, label } when admin clicked a backward stage
  const [resetProgress, setResetProgress] = useState(false);
  const [advancingBackward, setAdvancingBackward] = useState(false);
  const currentIdx = stageIndex(currentStage);
  const forwardBlocked = !isAdmin && !completion.complete;
  const missingCount = completion.total - completion.done;

  const confirmBackward = async () => {
    if (!backwardTarget) return;
    setAdvancingBackward(true);
    try {
      await onMove(backwardTarget.id, { reset_progress: resetProgress });
      setBackwardTarget(null);
      setResetProgress(false);
    } finally {
      setAdvancingBackward(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-1 hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-white/5 text-xs font-semibold text-gray-700 dark:text-gray-200 disabled:opacity-50"
      >
        Change stage <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white dark:bg-brand-dark-1 border border-gray-200 dark:border-white/10 rounded-lg shadow-lg py-1 z-20 w-60">
          {forwardBlocked && (
            <div className="px-3 py-2 mb-1 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-100 dark:border-amber-500/20 text-[10px] text-amber-700 dark:text-amber-300 font-semibold flex items-center gap-1.5">
              <Lock size={11} /> {missingCount} required item{missingCount > 1 ? 's' : ''} left in current stage
            </div>
          )}
          {PROJECT_STAGES.map(s => {
            const i = stageIndex(s.id);
            const isCurrent  = s.id === currentStage;
            const isForwardMove  = i > currentIdx;
            const isBackwardMove = i < currentIdx;
            const forwardLocked  = isForwardMove  && forwardBlocked;
            const backwardLocked = isBackwardMove && !isAdmin; // only admins can move backward
            const blocked = isCurrent || forwardLocked || backwardLocked;
            const onClickStage = () => {
              setOpen(false);
              if (isBackwardMove) {
                // Don't fire the move yet — open the confirmation modal first.
                setBackwardTarget({ id: s.id, label: s.label });
              } else {
                onMove(s.id);
              }
            };
            return (
              <button
                key={s.id}
                disabled={blocked}
                onClick={onClickStage}
                title={isCurrent ? 'Current stage' : forwardLocked ? 'Complete required items first' : backwardLocked ? 'Backward moves require admin role' : isBackwardMove ? `Move backward to ${s.label}` : `Move to ${s.label}`}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-amber-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              >
                <span>{s.icon}</span>
                <span className="flex-1">{s.label}</span>
                {isCurrent && <span className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">CURRENT</span>}
                {!isCurrent && forwardLocked && <Lock size={11} className="text-gray-300 dark:text-gray-500" />}
                {!isCurrent && isBackwardMove && isAdmin && <span className="text-[9px] text-gray-400">↩ back</span>}
                {!isCurrent && backwardLocked && <Lock size={11} className="text-gray-300 dark:text-gray-500" />}
              </button>
            );
          })}
          {forwardBlocked && isAdmin && (
            <>
              <div className="my-1 border-t border-gray-100 dark:border-white/10" />
              <button
                onClick={() => {
                  setOpen(false);
                  const next = PROJECT_STAGES[currentIdx + 1]?.id;
                  if (next) onMove(next, { override: true });
                }}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400 flex items-center gap-2 font-semibold"
              >
                <ShieldAlert size={12} /> Admin: Force advance
              </button>
            </>
          )}
        </div>
      )}

      {/* Backward-move confirmation modal. Triggered when an admin clicks an
          earlier stage in the dropdown — explains exactly what data is
          preserved and offers an optional checklist-progress reset. */}
      {backwardTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm animate-fade-in" onClick={() => !advancingBackward && setBackwardTarget(null)}>
          <div className="relative w-full max-w-lg bg-white dark:bg-brand-dark-1 rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 overflow-hidden" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => !advancingBackward && setBackwardTarget(null)}
              disabled={advancingBackward}
              className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/80 hover:bg-gray-100 dark:bg-brand-dark-2 dark:hover:bg-brand-dark-3 flex items-center justify-center text-gray-500 dark:text-gray-300 transition z-10 disabled:opacity-50">
              <X size={14} />
            </button>
            <div className="p-6 text-white" style={{ background: 'linear-gradient(135deg,#7c2d12 0%,#9f1239 50%,#500724 100%)' }}>
              <h3 className="text-lg font-extrabold font-display flex items-center gap-2">
                <ShieldAlert size={18} /> Move project backward?
              </h3>
              <p className="text-xs text-white/85 mt-1.5 leading-relaxed">
                You're about to move this project from <strong>{stageIndex(currentStage) >= 0 ? PROJECT_STAGES[stageIndex(currentStage)].label : currentStage}</strong> back to <strong>{backwardTarget.label}</strong>. This is unusual — confirm the implications below.
              </p>
            </div>
            <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
              <section>
                <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">What stays attached</div>
                <ul className="space-y-1.5 text-xs text-gray-700 dark:text-gray-200">
                  <li className="flex items-start gap-2"><CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0 mt-0.5" /><span>Linked proposals (any version, any status — accepted ones stay accepted)</span></li>
                  <li className="flex items-start gap-2"><CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0 mt-0.5" /><span>Outstanding tasks (including any starter tasks from later stages)</span></li>
                  <li className="flex items-start gap-2"><CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0 mt-0.5" /><span>Qualification data (owner, call notes, quality, qualified-at timestamp)</span></li>
                  <li className="flex items-start gap-2"><CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0 mt-0.5" /><span>Activity history (this move adds an audit entry)</span></li>
                </ul>
              </section>
              <section className="pt-3 border-t border-gray-100 dark:border-white/10">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={resetProgress}
                    onChange={e => setResetProgress(e.target.checked)}
                    disabled={advancingBackward}
                    className="mt-0.5 w-4 h-4 accent-amber-500"
                  />
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-gray-800 dark:text-gray-100">Also reset checklist progress for {backwardTarget.label} and beyond</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                      Clears the stage-progress JSON for the target stage and every stage after it. Earlier-stage history is preserved. Useful if you're rolling back because items shouldn't have been ticked.
                    </div>
                  </div>
                </label>
              </section>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 italic">
                If you wanted a brand-new project, cancel here and create one from a fresh website enquiry.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 dark:border-white/10 flex items-center justify-end gap-2">
              <button
                onClick={() => setBackwardTarget(null)}
                disabled={advancingBackward}
                className="px-4 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
                Cancel
              </button>
              <button
                onClick={confirmBackward}
                disabled={advancingBackward}
                className="px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
                {advancingBackward ? <RefreshCw size={12} className="animate-spin" /> : <ShieldAlert size={12} />}
                Move backward to {backwardTarget.label}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Reusable confirmation modal for stage transitions. Shows what was just
// completed (or auto-bypassed) and what will happen on advance, then asks
// for explicit confirmation.
function StageAdvanceModal({ open, onClose, onConfirm,
  title, subtitle, completed = [], nextActions = [],
  ctaLabel = 'Continue', confirming = false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="relative w-full max-w-lg bg-white dark:bg-brand-dark-1 rounded-2xl shadow-2xl border border-gray-100 dark:border-white/10 overflow-hidden" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} disabled={confirming}
          className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/80 hover:bg-gray-100 dark:bg-brand-dark-2 dark:hover:bg-brand-dark-3 flex items-center justify-center text-gray-500 dark:text-gray-300 transition z-10 disabled:opacity-50">
          <X size={14} />
        </button>
        <div className="p-6 text-white" style={{ background: 'linear-gradient(135deg,#0f766e 0%,#0e7490 50%,#1e40af 100%)' }}>
          <h3 className="text-lg font-extrabold font-display">{title}</h3>
          {subtitle && <p className="text-xs text-white/85 mt-1.5 leading-relaxed">{subtitle}</p>}
        </div>
        <div className="p-6 space-y-5 max-h-[60vh] overflow-y-auto">
          {completed.length > 0 && (
            <section>
              <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">What's been done</div>
              <ul className="space-y-1.5">
                {completed.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-200">
                    <CheckCircle2 size={13} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {nextActions.length > 0 && (
            <section>
              <div className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2">What happens next</div>
              <ul className="space-y-1.5">
                {nextActions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-700 dark:text-gray-200">
                    <ArrowRight size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 dark:border-white/10 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={confirming}
            className="px-4 py-2 rounded-lg border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={confirming}
            className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5">
            {confirming ? <RefreshCw size={12} className="animate-spin" /> : null}
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabPlaceholder({ tabId, stageLabel }) {
  const meta = TAB_CATALOG[tabId];
  return (
    <Card className="py-12 text-center">
      <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-3">
        <Clock size={24} className="text-amber-400" />
      </div>
      <h3 className="text-sm font-bold text-gray-700">{meta?.label} — Phase 2</h3>
      <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">{meta?.desc}</p>
      <p className="text-[10px] text-gray-300 mt-3 italic">Available at the {stageLabel} stage once built.</p>
    </Card>
  );
}

// Reusable "Accept proposal" button. Server gates acceptance on the selling
// checklist; if the rep hits a 409 with `requires_override`, we surface the
// missing items and give admins a one-click "Force accept" path.
function AcceptProposalButton({ proposal, onAccepted }) {
  const { user } = useAuth();
  const isAdmin  = user?.role === 'admin';
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const [missing, setMissing] = useState([]);
  const [confirm, setConfirm] = useState(false);

  if (proposal.status === 'accepted') {
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
        <CheckCircle2 size={12} /> Accepted
      </div>
    );
  }

  const doAccept = async (override = false) => {
    setBusy(true);
    setError('');
    setMissing([]);
    try {
      const r = await api.post(`/proposals/${proposal.id}/accept`, override ? { override: true } : {});
      onAccepted?.(r.data);
      setConfirm(false);
    } catch (e) {
      const data = e.response?.data || {};
      setError(data.error || 'Accept failed');
      if (Array.isArray(data.missing)) setMissing(data.missing);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      {!confirm ? (
        <button
          onClick={() => { setConfirm(true); setError(''); setMissing([]); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold transition"
        >
          <CheckCircle2 size={12} /> Mark as accepted
        </button>
      ) : (
        <div className="inline-flex items-center gap-1.5 text-[11px]">
          <span className="text-gray-600 font-semibold">Confirm: customer accepted v{proposal.version || 1}?</span>
          <button onClick={() => doAccept(false)} disabled={busy} className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-white font-bold disabled:opacity-50">
            {busy ? '...' : 'Yes'}
          </button>
          <button onClick={() => { setConfirm(false); setError(''); setMissing([]); }} disabled={busy} className="px-2.5 py-1 rounded border border-gray-200 text-gray-600">
            Cancel
          </button>
        </div>
      )}
      {error && (
        <div className="mt-1 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[11px] max-w-md">
          <div className="font-semibold mb-1">{error}</div>
          {missing.length > 0 && (
            <ul className="list-disc ml-4 space-y-0.5 mb-2">
              {missing.map(m => <li key={m.id}>{m.label}</li>)}
            </ul>
          )}
          {missing.length > 0 && isAdmin && (
            <button
              onClick={() => doAccept(true)}
              disabled={busy}
              className="mt-1 px-2.5 py-1 rounded bg-red-500 hover:bg-red-400 text-white font-bold disabled:opacity-50 inline-flex items-center gap-1"
              title="Admin: accept the proposal even though selling-stage requirements are incomplete. The skipped items stay un-ticked for audit."
            >
              <ShieldAlert size={11} /> Force accept (admin override)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Header buttons: Mark Lost / Put on Hold / Reactivate. Updates project.sub_status.
function ProjectStatusControls({ project, onChange }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const setStatus = async (sub_status) => {
    setBusy(sub_status || 'clear');
    setError('');
    try {
      await api.patch(`/projects/${project.id}`, { sub_status });
      onChange?.();
    } catch (e) {
      setError(e.response?.data?.error || 'Update failed');
    } finally {
      setBusy('');
    }
  };

  if (project.sub_status) {
    const labels = { lost: '✕ Lost', on_hold: '⏸ On hold', cancelled: '✕ Cancelled', disqualified: '⊘ Disqualified' };
    return (
      <div className="inline-flex items-center gap-2">
        <span className="px-2 py-1 rounded text-[10px] font-bold bg-gray-100 dark:bg-brand-dark-2 text-gray-600 dark:text-gray-300">{labels[project.sub_status] || project.sub_status}</span>
        <button
          onClick={() => setStatus(null)}
          disabled={!!busy}
          className="px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <RefreshCw size={11} /> Reactivate
        </button>
        {error && <span className="text-[10px] text-red-500">{error}</span>}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        onClick={() => setStatus('on_hold')}
        disabled={!!busy}
        title="Put project on hold (no cancellation)"
        className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 hover:border-amber-300 hover:bg-amber-50 text-xs font-semibold text-gray-600 disabled:opacity-50 inline-flex items-center gap-1"
      >
        ⏸ Hold
      </button>
      <button
        onClick={() => setStatus('lost')}
        disabled={!!busy}
        title="Lost: customer was real but went elsewhere. Cancels nurture cadence + sends a courtesy close email."
        className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 hover:border-red-300 hover:bg-red-50 text-xs font-semibold text-gray-600 disabled:opacity-50 inline-flex items-center gap-1"
      >
        ✕ Lost
      </button>
      <button
        onClick={() => setStatus('disqualified')}
        disabled={!!busy}
        title="Disqualified: not a real lead (spam, wrong number, out of service area, not a homeowner). Cancels nurture cadence."
        className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 hover:border-gray-400 hover:bg-gray-50 text-xs font-semibold text-gray-600 disabled:opacity-50 inline-flex items-center gap-1"
      >
        ⊘ Disqualify
      </button>
      {error && <span className="text-[10px] text-red-500">{error}</span>}
    </div>
  );
}

// Read-only render of the original website form submission, shown on the
// Enquiry tab once a project is linked to a website_enquiries row.
function EnquiryTab({ enquiry }) {
  if (!enquiry) {
    return (
      <Card className="py-12 text-center">
        <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
          <FileText size={24} className="text-gray-400" />
        </div>
        <h3 className="text-sm font-bold text-gray-700">No linked enquiry</h3>
        <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
          This project was not created from a website form submission. Manually-created projects have no enquiry record.
        </p>
      </Card>
    );
  }
  const Row = ({ label, value }) => (
    <div className="flex justify-between py-1.5 border-b border-gray-100 last:border-0 gap-3">
      <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{label}</span>
      <span className="text-xs text-gray-700 text-right">{value || <span className="text-gray-300 italic">not provided</span>}</span>
    </div>
  );
  const fmtMoney = (n) => n ? `$${Number(n).toLocaleString('en-NZ', { maximumFractionDigits: 0 })}` : null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card title="Contact details" subtitle="As submitted via the website form">
        <Row label="First name"     value={enquiry.first_name} />
        <Row label="Last name"      value={enquiry.last_name} />
        <Row label="Email"          value={enquiry.email} />
        <Row label="Phone"          value={enquiry.phone} />
        <Row label="Address"        value={enquiry.address} />
        <Row label="Submitted"      value={fmtDateLong(enquiry.created_at)} />
      </Card>
      <Card title="Property + system" subtitle="Self-reported by the customer">
        <Row label="Owns home"               value={enquiry.owns_home} />
        <Row label="Floors"                  value={enquiry.floors} />
        <Row label="Roof type"               value={enquiry.roof_type} />
        <Row label="Installation type"       value={enquiry.installation_type} />
        <Row label="Battery option"          value={enquiry.battery_option} />
        <Row label="Wants a callback"        value={enquiry.call_to_discuss} />
        <Row label="Installation timeframe"  value={enquiry.installation_timeframe} />
        <Row label="Monthly bill"            value={fmtMoney(enquiry.monthly_bill)} />
      </Card>
      <Card title="Computed estimate" subtitle="From server-side solar calculation">
        <Row label="System size"     value={enquiry.system_size_kw ? `${enquiry.system_size_kw} kW` : null} />
        <Row label="Panels"          value={enquiry.panels} />
        <Row label="Battery"         value={enquiry.battery_kwh ? `${enquiry.battery_kwh} kWh` : null} />
        <Row label="Total cost"      value={fmtMoney(enquiry.total_cost)} />
        <Row label="Monthly savings" value={fmtMoney(enquiry.monthly_savings)} />
        <Row label="Annual savings"  value={fmtMoney(enquiry.annual_savings)} />
        <Row label="Payback"         value={enquiry.payback_years ? `${enquiry.payback_years} years` : null} />
        <Row label="ROI"             value={enquiry.roi_percent ? `${enquiry.roi_percent}%` : null} />
      </Card>
      <Card title="Lead status" subtitle="Captured at submission time">
        <Row label="Lead score"      value={enquiry.lead_score ? `${enquiry.lead_score} / 100` : null} />
        <Row label="Status"          value={enquiry.status} />
        <Row label="Enquiry ID"      value={<span className="font-mono text-[10px]">{enquiry.id}</span>} />
      </Card>
    </div>
  );
}

// ── Selling-stage tabs ─────────────────────────────────────────────────────
// OnlineProposalTab — in-app, customer-facing proposal display. Shows the
// latest proposal for this project; if none exists, offers a "Generate" CTA.
function OnlineProposalTab({ project, customer, onProjectChange }) {
  const [proposals, setProposals] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error,     setError]     = useState('');

  const load = () => {
    setLoading(true);
    api.get(`/proposals?project_id=${project.id}`)
      .then(r => setProposals(r.data || []))
      .catch(e => setError(e.response?.data?.error || 'Failed to load proposals'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [project.id]);

  // After any proposal action that may have moved the project's stage
  // (generate from Design = Trigger 2, accept = Trigger 3), reload BOTH
  // the local proposal list AND the parent project so the header badge,
  // tabs, and stage progress bar update immediately.
  const reloadAll = () => {
    load();
    onProjectChange?.();
  };

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      await api.post('/proposals/generate', { project_id: project.id });
      reloadAll();
    } catch (e) {
      setError(e.response?.data?.error || 'Generate failed');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <Card className="py-12 text-center"><div className="animate-spin w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full mx-auto" /></Card>;

  const latest = proposals[0];
  const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });

  if (!latest) {
    return (
      <Card className="py-12 text-center">
        <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-3">
          <FileCheck2 size={24} className="text-amber-500" />
        </div>
        <h3 className="text-sm font-bold text-gray-700">No proposal yet</h3>
        <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">
          Generate a proposal from the customer's monthly bill, system size, and roof data. You can always create a v2, v3, etc. afterwards.
        </p>
        {error && <p className="text-[11px] text-red-500 mt-2">{error}</p>}
        <button
          onClick={generate}
          disabled={generating}
          className="mt-4 px-5 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {generating ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
          {generating ? 'Generating…' : 'Generate proposal'}
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <Card className="!p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center"><FileCheck2 size={18} className="text-amber-500" /></div>
            <div>
              <div className="text-sm font-bold">Proposal v{latest.version || 1}</div>
              <div className="text-[10px] text-gray-400">For {customer?.name || 'customer'} · created {fmtDate(latest.created_at)}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge color={latest.status === 'accepted' ? '#10b981' : latest.status === 'sent' ? '#3b82f6' : latest.status === 'viewed' ? '#8b5cf6' : '#9ca3af'}>{latest.status}</Badge>
            <AcceptProposalButton proposal={latest} onAccepted={reloadAll} />
            <button
              onClick={generate}
              disabled={generating}
              className="px-3 py-1.5 rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50 text-[11px] font-semibold text-gray-700 inline-flex items-center gap-1 disabled:opacity-50"
              title="Create a new version"
            >
              {generating ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />}
              New version
            </button>
          </div>
        </div>
      </Card>

      {/* Customer-facing proposal preview */}
      <Card className="!p-0 overflow-hidden relative">
        {latest.mode === 'preliminary' && (
          <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-800 text-[10px] font-extrabold tracking-widest shadow-sm" title="No site visit logged. Numbers may shift after the visit.">
            ⚠ PRELIMINARY
          </div>
        )}
        <div className="px-7 py-6 text-white" style={{ background: 'linear-gradient(135deg,#f59e0b 0%,#d97706 50%,#b45309 100%)' }}>
          <div className="text-[10px] font-bold tracking-widest opacity-90">{latest.mode === 'final' ? 'FINAL SOLAR PROPOSAL' : 'PRELIMINARY ESTIMATE'}</div>
          <h2 className="text-2xl font-extrabold font-display mt-1">For {customer?.name || 'You'}</h2>
          <div className="text-xs mt-2 opacity-95">{project.address || customer?.location || 'New Zealand'}</div>
          {latest.mode === 'preliminary' && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-white/15 backdrop-blur text-[11px] leading-relaxed">
              ⚠ This is a <strong>preliminary estimate</strong> based on self-reported bill data. A site visit is needed to confirm roof orientation, shading, and structural fit. Final pricing may shift up to ±15%.
            </div>
          )}
        </div>

        <div className="p-7 space-y-6">
          {/* System specs */}
          <section>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Recommended system</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat icon={Sun}  label="System size" value={`${latest.system_size_kw} kW`} accent="#f59e0b" />
              <Stat icon={Zap}  label="Panels"      value={latest.panel_count} accent="#3b82f6" />
              <Stat icon={Home} label="Battery"     value={latest.battery_kwh > 0 ? `${latest.battery_kwh} kWh` : 'No battery'} accent="#8b5cf6" />
              <Stat icon={Leaf} label="CO₂/yr"      value={`${latest.co2_tons_year || 0} t`} accent="#10b981" />
            </div>
          </section>

          {/* Investment block */}
          <section className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-5 border border-amber-100">
            <div className="text-[10px] font-bold text-amber-700 uppercase tracking-widest mb-2">Total investment</div>
            <div className="text-4xl font-extrabold font-display text-gray-900">{fmt$(latest.total_cost)}</div>
            <div className="text-xs text-gray-500 mt-1">incl. GST · supply, install, grid connection, monitoring app</div>
          </section>

          {/* Savings */}
          <section>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Your savings</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat icon={DollarSign} label="Monthly"   value={fmt$(latest.monthly_savings)} accent="#10b981" />
              <Stat icon={DollarSign} label="Annual"    value={fmt$(latest.annual_savings)} accent="#10b981" />
              <Stat icon={Clock}      label="Payback"   value={`${latest.payback_years || 0} yrs`} accent="#f59e0b" />
              <Stat icon={TrendingUp} label="ROI"       value={`${latest.roi_percent || 0}%`} accent="#3b82f6" />
            </div>
          </section>

          {/* Lifetime */}
          <section className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center">
            <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-widest">25-Year savings</div>
            <div className="text-3xl font-extrabold font-display text-emerald-700 mt-1">{fmt$((latest.annual_savings || 0) * 25)}</div>
            <div className="text-xs text-emerald-600 mt-1">Solar panels are warranted for 25 years of performance.</div>
          </section>

          {/* What's included */}
          <section>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">What's included</div>
            <ul className="space-y-1.5 text-sm text-gray-700">
              {[
                `${latest.panel_count} Tier-1 monocrystalline solar panels (25-yr performance warranty)`,
                'Premium hybrid inverter (10-yr warranty)',
                latest.battery_kwh > 0 ? `${latest.battery_kwh} kWh battery storage (10-yr warranty)` : null,
                'Mounting, wiring, and DC isolators (10-yr workmanship guarantee)',
                'Council consent + grid connection paperwork',
                'Live monitoring app (smartphone access)',
                'Free annual system health check (year 1)',
              ].filter(Boolean).map((item, i) => (
                <li key={i} className="flex gap-2">
                  <CheckSquare size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Footer note */}
          <div className="border-t border-gray-100 pt-4 text-[10px] text-gray-400 leading-relaxed">
            Proposal valid for 30 days from {fmtDate(latest.created_at)}. Final pricing subject to a site survey to confirm roof structure, shading, and electrical capacity. Finance options available — talk to your advisor.
          </div>
        </div>
      </Card>
    </div>
  );
}

const Stat = ({ icon: Icon, label, value, accent }) => (
  <div className="bg-white border border-gray-100 rounded-lg p-3">
    <div className="flex items-center gap-2 mb-1.5">
      <div className="w-7 h-7 rounded-md flex items-center justify-center" style={{ background: accent + '15' }}>
        <Icon size={14} style={{ color: accent }} />
      </div>
      <div className="text-[9px] text-gray-400 uppercase font-semibold tracking-wide">{label}</div>
    </div>
    <div className="text-base font-extrabold text-gray-800">{value}</div>
  </div>
);

// PdfProposalTab — generate, download, and email PDF versions.
function PdfProposalTab({ project, customer, onProjectChange }) {
  const [proposals, setProposals]   = useState([]);
  const [loading,   setLoading]     = useState(true);
  const [busyId,    setBusyId]      = useState('');
  const [error,     setError]       = useState('');
  const [success,   setSuccess]     = useState('');

  const load = () => {
    setLoading(true);
    api.get(`/proposals?project_id=${project.id}`)
      .then(r => setProposals(r.data || []))
      .catch(e => setError(e.response?.data?.error || 'Failed to load proposals'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [project.id]);

  // Reload local proposals + parent project (so stage badge updates after
  // a proposal acceptance bumps the project to Installation).
  const reloadAll = () => {
    load();
    onProjectChange?.();
  };

  const downloadPdf = async (id, version) => {
    setBusyId(id + ':pdf');
    setError(''); setSuccess('');
    try {
      const r = await api.post(`/proposals/${id}/pdf`, {}, { responseType: 'blob' });
      const blob = new Blob([r.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(customer?.name || 'customer').replace(/\s+/g, '-')}-Proposal-v${version || 1}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setSuccess('PDF downloaded');
    } catch (e) {
      setError('PDF generation failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setBusyId('');
    }
  };

  const sendPdf = async (id) => {
    setBusyId(id + ':send');
    setError(''); setSuccess('');
    try {
      const r = await api.post(`/proposals/${id}/send`);
      setSuccess(r.data?.message || 'Proposal email sent.');
      load();
    } catch (e) {
      setError('Send failed: ' + (e.response?.data?.error || e.message));
    } finally {
      setBusyId('');
    }
  };

  const generate = async () => {
    setBusyId('new');
    setError(''); setSuccess('');
    try {
      await api.post('/proposals/generate', { project_id: project.id });
      reloadAll();
    } catch (e) {
      setError(e.response?.data?.error || 'Generate failed');
    } finally {
      setBusyId('');
    }
  };

  if (loading) return <Card className="py-12 text-center"><div className="animate-spin w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full mx-auto" /></Card>;

  return (
    <Card title="Proposal versions" subtitle={`${proposals.length} version${proposals.length === 1 ? '' : 's'} on file`}>
      {error   && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600">{error}</div>}
      {success && <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">{success}</div>}

      <div className="flex justify-end mb-3">
        <button
          onClick={generate}
          disabled={busyId === 'new'}
          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busyId === 'new' ? <RefreshCw size={11} className="animate-spin" /> : <Plus size={11} />}
          {busyId === 'new' ? 'Generating…' : 'Generate new version'}
        </button>
      </div>

      {proposals.length === 0 ? (
        <div className="text-xs text-gray-400 italic text-center py-6">No proposals yet — generate one above.</div>
      ) : (
        <ul className="space-y-2">
          {proposals.map(p => {
            const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });
            return (
              <li key={p.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition">
                <div className="w-9 h-9 rounded-md bg-amber-50 flex items-center justify-center flex-shrink-0"><FileText size={16} className="text-amber-500" /></div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold flex items-center gap-2">
                    <span>v{p.version || 1}</span>
                    <Badge color={p.status === 'accepted' ? '#10b981' : p.status === 'sent' ? '#3b82f6' : p.status === 'viewed' ? '#8b5cf6' : '#9ca3af'}>{p.status}</Badge>
                    {p.mode === 'preliminary' && <Badge color="#f59e0b">⚠ preliminary</Badge>}
                    {p.mode === 'final' && <Badge color="#059669">final</Badge>}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {p.system_size_kw} kW · {fmt$(p.total_cost)} · created {fmtDate(p.created_at)}
                    {p.sent_at && ` · sent ${fmtDate(p.sent_at)}`}
                  </div>
                </div>
                <button
                  onClick={() => downloadPdf(p.id, p.version)}
                  disabled={busyId === p.id + ':pdf'}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50 text-[11px] font-semibold text-gray-700 inline-flex items-center gap-1 disabled:opacity-50"
                  title="Generate + download PDF"
                >
                  {busyId === p.id + ':pdf' ? <RefreshCw size={11} className="animate-spin" /> : <Download size={11} />} PDF
                </button>
                <button
                  onClick={() => sendPdf(p.id)}
                  disabled={busyId === p.id + ':send' || !customer?.email}
                  title={customer?.email ? `Email PDF to ${customer.email} (dev mode redirects to test mailbox)` : 'No customer email on file'}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-[11px] font-semibold inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {busyId === p.id + ':send' ? <RefreshCw size={11} className="animate-spin" /> : <Send size={11} />} Email PDF
                </button>
                <AcceptProposalButton proposal={p} onAccepted={reloadAll} />
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[10px] text-gray-400 mt-4 leading-relaxed">
        <strong>Dev mode:</strong> emails are redirected to <code>goldenrayenergy.nz@gmail.com</code> regardless of the customer's address — set <code>NODE_ENV=production</code> to send to real customers.
      </p>
    </Card>
  );
}

// Shows the customer-cadence email schedule for a project, derived from
// qualified_at + the fixed [3, 7, 14] day cadence we use server-side. Done
// purely client-side (no Resend API roundtrip) to stay free-tier-friendly.
function CadenceScheduleCard({ project }) {
  if (!project.qualified_at) return null;
  const qualifiedAt = new Date(project.qualified_at).getTime();
  const now = Date.now();
  const ids = project.cadence_email_ids || [];
  const hasEmails = ids.length > 0;
  const cancelled = !hasEmails && project.qualified_at; // Lost/Disqualified clears the IDs

  const steps = [
    { day: 3,  label: 'D+3 nurture · savings calculator + case studies' },
    { day: 7,  label: 'D+7 nurture · "ready for a tailored proposal?"' },
    { day: 14, label: 'D+14 final · "still a good time to talk solar?"' },
  ];

  return (
    <Card title="Customer email cadence" subtitle={cancelled ? 'Cancelled when project was marked Lost or Disqualified' : `Auto-scheduled when lead was qualified${project.quality ? ` (${project.quality})` : ''}`}>
      <ul className="space-y-2">
        {steps.map(s => {
          const due = qualifiedAt + s.day * 86400000;
          const sent = !cancelled && due < now;
          const scheduled = !cancelled && due >= now;
          const dotColor = cancelled ? 'bg-gray-300' : sent ? 'bg-emerald-500' : 'bg-amber-400';
          const statusLabel = cancelled ? 'cancelled' : sent ? `sent ${Math.floor((now - due) / 86400000)}d ago` : `scheduled ${new Date(due).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}`;
          return (
            <li key={s.day} className="flex items-start gap-2 text-xs">
              <div className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${dotColor}`} />
              <div className="flex-1 min-w-0">
                <div className={cancelled ? 'text-gray-400 line-through' : 'text-gray-700 dark:text-gray-200 font-medium'}>{s.label}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {sent      && <span className="text-emerald-600 dark:text-emerald-400">✓ </span>}
                  {scheduled && <span>⏳ </span>}
                  {statusLabel}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {!cancelled && (
        <p className="text-[10px] text-gray-400 italic mt-3 pt-3 border-t border-gray-100 dark:border-white/10">
          Resend handles delivery server-side. Mark project Lost or Disqualified to cancel pending emails.
        </p>
      )}
    </Card>
  );
}

// ── Universal "Stage requirements" panel ───────────────────────────────────
// Shown on every stage's Manage tab (in addition to the stage-specific
// cards). Lists what's required to advance, lets reps tick off items that
// don't have a backing UI yet (Phase 2 placeholders), and exposes an
// "Advance to next stage" button that opens a confirmation modal explaining
// what was done and what will happen.
const STAGE_LABELS = {
  new: 'New', design: 'Design', selling: 'Selling',
  installation: 'Installation', maintenance: 'Maintenance', exit: 'Exit',
};

const NEXT_STAGE = {
  new: 'design', design: 'selling', selling: 'installation',
  installation: 'maintenance', maintenance: 'exit', exit: null,
};

// What auto-actions happen when the rep clicks Advance from each stage.
// Used to populate the "What will happen" list in the confirmation modal.
const NEXT_ACTIONS_BY_STAGE = {
  new: [
    'Project moves to Design and the Site / Design / Energy tabs become available',
    'Three follow-up emails (D+3, D+7, D+14) are scheduled to the customer if not already',
  ],
  design: [
    'Project moves to Selling and the Online Proposal / PDF Proposal tabs become available',
    'Design checklist items are marked as bypassed so the gate doesn\'t trip on the next move',
  ],
  selling: [
    'Project moves to Installation and the Schedule / SLD / Payments / Documents tabs become available',
    'Five starter tasks are seeded for the install team: deposit, schedule, crew, SLD, supplier order',
    'Selling checklist items are marked as bypassed',
  ],
  installation: [
    'Project moves to Maintenance — the system is commissioned and the customer is generating power',
    'Annual + 6-month performance check tasks become trackable',
  ],
  maintenance: [
    'Project moves to Exit — final invoice settled and NPS survey sent',
    'Project becomes read-only / archived for reporting',
  ],
};

function StageRequirementsPanel({ project, onProjectChange }) {
  const stage = project.stage;
  const next  = NEXT_STAGE[stage];
  const checklist = STAGE_CHECKLISTS[stage]?.required || [];
  const completion = stageCompletion(stage, project.stage_progress);
  const [savingItem, setSavingItem] = useState('');
  const [error, setError] = useState('');

  // Don't show on Exit (no further stage) or New (NewStagePanel covers it)
  if (!next || stage === 'new') return null;

  const toggle = async (itemId, completed) => {
    setSavingItem(itemId);
    setError('');
    try {
      await api.patch(`/projects/${project.id}/checklist`, { itemId, completed });
      onProjectChange?.();
    } catch (e) {
      setError(e.response?.data?.error || 'Save failed');
    } finally {
      setSavingItem('');
    }
  };

  return (
    <Card
      title={`${STAGE_LABELS[stage]} stage requirements`}
      subtitle={completion.complete
        ? `All ${completion.total} required items complete — ready to advance to ${STAGE_LABELS[next]}.`
        : `${completion.done} of ${completion.total} complete · ${completion.total - completion.done} still required to advance to ${STAGE_LABELS[next]}.`}
    >
      {error && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs">{error}</div>}

      <ul className="space-y-1.5">
        {checklist.map(item => {
          const done = project.stage_progress?.[item.id] === true;
          const saving = savingItem === item.id;
          return (
            <li key={item.id}>
              <button
                onClick={() => toggle(item.id, !done)}
                disabled={saving}
                className={`w-full flex items-start gap-2 text-left text-xs rounded-md px-2 py-2 transition
                  ${done ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/5'}
                  ${saving ? 'opacity-60' : ''}`}
              >
                {done
                  ? <CheckSquare size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                  : <Square      size={14} className="text-amber-400 dark:text-amber-500 mt-0.5 flex-shrink-0" />}
                <span className={done ? 'line-through text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200'}>{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {!completion.complete && (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/5 text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          Complete all required items above. Once the last item is ticked, you'll be prompted to confirm the move to <strong className="text-gray-700 dark:text-gray-200">{STAGE_LABELS[next]}</strong>.
        </div>
      )}
    </Card>
  );
}

// ── Stage-specific Manage cards ────────────────────────────────────────────
// Replaces the bare Tasks list once the lead has graduated past New. Each
// stage shows a contextual snapshot card that surfaces the data + decisions
// most relevant at that point.

// Design: system being designed + key customer numbers
function SystemSpecSnapshot({ project, customer }) {
  const fmt$ = (n) => n ? '$' + Number(n).toLocaleString('en-NZ', { maximumFractionDigits: 0 }) : '—';
  const Row = ({ label, value, highlight }) => (
    <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-white/5 last:border-0">
      <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide font-semibold">{label}</span>
      <span className={`text-sm font-bold ${highlight === 'amber' ? 'text-amber-600' : highlight === 'emerald' ? 'text-emerald-600' : 'text-gray-800 dark:text-gray-100'}`}>{value || '—'}</span>
    </div>
  );
  return (
    <Card title="System being designed" subtitle="Working numbers — these become the proposal once you click Generate">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">
        <div>
          <Row label="System size"   value={project.system_size_kw ? `${project.system_size_kw} kW` : null} highlight="amber" />
          <Row label="Panels"        value={project.panels} />
          <Row label="Battery"       value={project.battery_kwh > 0 ? `${project.battery_kwh} kWh` : 'No battery'} />
          <Row label="System type"   value={project.system_type} />
        </div>
        <div>
          <Row label="Est. value"    value={fmt$(project.estimated_value)} highlight="emerald" />
          <Row label="Monthly bill"  value={customer?.monthly_bill ? `${fmt$(customer.monthly_bill)}/mo` : null} />
          <Row label="Address"       value={project.address} />
          <Row label="Quality"       value={project.quality ? project.quality.toUpperCase() : null} highlight={project.quality === 'hot' ? 'amber' : null} />
        </div>
      </div>
    </Card>
  );
}

// Selling: latest proposal status + customer engagement signals
function ProposalStatusSnapshot({ project }) {
  const [latest, setLatest] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/proposals?project_id=${project.id}`)
      .then(r => setLatest((r.data || [])[0] || null))
      .catch(() => setLatest(null))
      .finally(() => setLoading(false));
  }, [project.id]);

  if (loading) return <Card className="py-6 text-center"><div className="animate-spin w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full mx-auto" /></Card>;
  if (!latest) return (
    <Card title="Proposal status" subtitle="No proposal generated yet">
      <p className="text-xs text-gray-400 italic">Switch to the Online Proposal tab to create one.</p>
    </Card>
  );

  const fmt$ = (n) => '$' + Number(n || 0).toLocaleString('en-NZ', { maximumFractionDigits: 0 });
  const statusColor = latest.status === 'accepted' ? '#10b981'
    : latest.status === 'sent'     ? '#3b82f6'
    : latest.status === 'viewed'   ? '#8b5cf6'
    : latest.status === 'rejected' ? '#ef4444'
                                    : '#9ca3af';
  const daysAgo = (iso) => iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null;

  return (
    <Card title="Latest proposal" subtitle={`v${latest.version || 1} · created ${fmtDate(latest.created_at)}`}>
      <div className="flex items-center gap-3 mb-4">
        <Badge color={statusColor}>{latest.status}</Badge>
        <span className="text-xs text-gray-500">
          {latest.system_size_kw} kW · {latest.panel_count} panels · {fmt$(latest.total_cost)}
        </span>
      </div>
      <div className="space-y-2 border-t border-gray-100 dark:border-white/5 pt-3">
        {[
          { label: 'Drafted',  done: !!latest.created_at, when: latest.created_at },
          { label: 'Sent',     done: !!latest.sent_at,    when: latest.sent_at },
          { label: 'Viewed',   done: !!latest.viewed_at,  when: latest.viewed_at },
          { label: 'Accepted', done: latest.status === 'accepted', when: latest.status === 'accepted' ? latest.updated_at : null },
        ].map((step, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${step.done ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-white/10'}`} />
            <span className={step.done ? 'text-gray-700 dark:text-gray-200 font-medium' : 'text-gray-400 dark:text-gray-500'}>{step.label}</span>
            {step.when && <span className="text-[10px] text-gray-400">· {daysAgo(step.when)}d ago</span>}
          </div>
        ))}
      </div>
    </Card>
  );
}

// Installation+: project install snapshot
function ProjectSnapshot({ project, customer }) {
  const fmt$ = (n) => n ? '$' + Number(n).toLocaleString('en-NZ', { maximumFractionDigits: 0 }) : '—';
  return (
    <Card title="Project snapshot" subtitle="Quick view for the install + handover phase">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-amber-50 dark:bg-amber-500/10 rounded-lg p-3">
          <div className="text-[9px] text-amber-700 uppercase font-bold tracking-wider">System</div>
          <div className="text-base font-extrabold text-amber-700 mt-0.5">{project.system_size_kw ? `${project.system_size_kw} kW` : '—'}</div>
          <div className="text-[10px] text-amber-600 mt-0.5">{project.panels ? `${project.panels} panels` : ''}{project.battery_kwh > 0 ? ` · ${project.battery_kwh} kWh` : ''}</div>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-lg p-3">
          <div className="text-[9px] text-emerald-700 uppercase font-bold tracking-wider">Contract value</div>
          <div className="text-base font-extrabold text-emerald-700 mt-0.5">{fmt$(project.estimated_value)}</div>
          <div className="text-[10px] text-emerald-600 mt-0.5">incl. supply + install</div>
        </div>
        <div className="col-span-2 bg-gray-50 dark:bg-brand-dark-2 rounded-lg p-3">
          <div className="text-[9px] text-gray-500 uppercase font-bold tracking-wider">Customer</div>
          <div className="text-sm font-bold mt-0.5 dark:text-gray-100">{customer?.name || '—'}</div>
          <div className="text-[11px] text-gray-500 truncate">{customer?.email || customer?.phone || ''}</div>
          <div className="text-[11px] text-gray-500 truncate">{project.address || ''}</div>
        </div>
      </div>
    </Card>
  );
}

// Last N activities — replaces the obsolete Tasks list in Design+
function RecentActivityFeed({ activities, limit = 6 }) {
  const recent = (activities || []).slice(0, limit);
  if (recent.length === 0) return (
    <Card title="Recent activity">
      <p className="text-xs text-gray-400 italic py-3 text-center">No activity yet.</p>
    </Card>
  );
  const typeStyle = (t) => ({
    system:  { bg: 'bg-blue-50 dark:bg-blue-500/10',     dot: 'bg-blue-400'    },
    call:    { bg: 'bg-emerald-50 dark:bg-emerald-500/10', dot: 'bg-emerald-400' },
    email:   { bg: 'bg-amber-50 dark:bg-amber-500/10',   dot: 'bg-amber-400'   },
    meeting: { bg: 'bg-violet-50 dark:bg-violet-500/10', dot: 'bg-violet-400'  },
    note:    { bg: 'bg-gray-50 dark:bg-brand-dark-2',    dot: 'bg-gray-300'    },
  })[t] || { bg: 'bg-gray-50 dark:bg-brand-dark-2', dot: 'bg-gray-300' };
  return (
    <Card title={`Recent activity (${activities.length})`} subtitle="Most recent events on this project">
      <ul className="space-y-2.5">
        {recent.map(a => {
          const s = typeStyle(a.type);
          return (
            <li key={a.id} className={`flex gap-3 p-2.5 rounded-lg ${s.bg}`}>
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${s.dot}`} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-700 dark:text-gray-200">{a.description}</div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{fmtDateLong(a.created_at)} · <span className="uppercase tracking-wide">{a.type}</span></div>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// Filter out nurture cadence tasks (they're noise once the lead is engaged).
// We tag them in projects.js with title prefix "Follow-up #N — ".
function relevantTasks(tasks, stage) {
  if (stage === 'new') return tasks; // nurture tasks are still useful at intake
  return (tasks || []).filter(t => !/^Follow-up #\d+\b/.test(t.title || ''));
}

// Quick-action panel for the Design stage. The Design tabs (Site, Design,
// Energy) are Phase-2 placeholders, but salespeople still need a path forward.
// Generating a proposal from here fires the Design → Selling auto-trigger
// server-side and lands the user on the proposal flow.
function DesignStagePanel({ project, onProjectChange }) {
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [siteVisitBusy, setSiteVisitBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const r = await api.post('/proposals/generate', { project_id: project.id });
      const v    = r.data?.proposal?.version || 1;
      const mode = r.data?.proposal?.mode    || 'preliminary';
      setSuccess(`✓ Proposal v${v} created — ${mode === 'final' ? 'FINAL mode' : 'PRELIMINARY (no site visit yet)'}`);
      onProjectChange?.();
      setTimeout(() => setSuccess(''), 6000);
    } catch (e) {
      setError(e.response?.data?.error || 'Generate failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleSiteVisit = async () => {
    setSiteVisitBusy(true);
    try {
      await api.patch(`/projects/${project.id}/site-visit`, { done: !project.site_visit_done_at });
      onProjectChange?.();
    } finally {
      setSiteVisitBusy(false);
    }
  };

  const visitDone = !!project.site_visit_done_at;

  return (
    <Card title="Generate the customer-facing proposal" subtitle="Generate a preliminary proposal at any time. Mark the site visit done to switch future proposals to FINAL mode (no preliminary watermark).">
      {/* Site-visit gate. Without it, any proposal generated is labelled
          PRELIMINARY on the customer-facing PDF + online preview. */}
      <div className={`mb-4 px-3 py-2.5 rounded-lg border ${visitDone ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/30' : 'border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] flex items-center gap-1.5">
            {visitDone
              ? <><CheckCircle2 size={13} className="text-emerald-600" /><span className="text-emerald-800 dark:text-emerald-200 font-semibold">Site visit complete</span><span className="text-emerald-700 dark:text-emerald-300">— future proposals will be FINAL mode</span></>
              : <><AlertTriangle size={13} className="text-amber-600" /><span className="text-amber-800 dark:text-amber-200 font-semibold">No site visit logged</span><span className="text-amber-700 dark:text-amber-300">— proposals will be marked PRELIMINARY</span></>}
          </div>
          <button
            onClick={toggleSiteVisit}
            disabled={siteVisitBusy}
            className={`px-2.5 py-1 rounded text-[11px] font-bold disabled:opacity-50 ${visitDone ? 'bg-white border border-emerald-300 text-emerald-700' : 'bg-amber-500 hover:bg-amber-400 text-white'}`}
          >
            {siteVisitBusy ? '...' : visitDone ? 'Revert' : 'Mark site visit done'}
          </button>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0"><FileCheck2 size={18} className="text-amber-500" /></div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-gray-500 leading-relaxed mb-3">
            We'll calculate system size from <strong>{project.contacts?.monthly_bill ? `$${project.contacts.monthly_bill}/mo` : 'the customer\'s bill'}</strong>{project.system_type ? ` and the ${project.system_type} system type` : ''}, then create a v1 proposal you can refine.
          </p>
          {error   && <p className="text-[11px] text-red-500 mb-2">{error}</p>}
          {success && <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mb-2 px-2 py-1.5 rounded bg-emerald-50 dark:bg-emerald-500/10">{success}</p>}
          <button
            onClick={generate}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {busy ? <RefreshCw size={13} className="animate-spin" /> : <FileCheck2 size={13} />}
            {busy ? 'Generating…' : visitDone ? 'Generate FINAL proposal' : 'Generate preliminary proposal'}
          </button>
        </div>
      </div>
    </Card>
  );
}

// Data-capture panel for the New stage — replaces the bare checkbox toggles
// for "Assign owner / Call customer / Qualify". Saving these fields auto-ticks
// the corresponding checklist items server-side and unlocks the Design stage.
function NewStagePanel({ project, users, onSave, saving }) {
  const [ownerId,     setOwnerId]     = useState(project.owner_id || '');
  const [callOutcome, setCallOutcome] = useState(project.call_outcome || '');
  const [callNotes,   setCallNotes]   = useState(project.call_notes || '');
  const [quality,     setQuality]     = useState(project.quality || '');
  const [success,     setSuccess]     = useState('');

  // Sales pool for the owner picker — sales executives + sales managers.
  const salesUsers = users.filter(u => u.role === 'sales_exec' || u.role === 'sales_mgr');

  const dirty =
    ownerId     !== (project.owner_id     || '') ||
    callOutcome !== (project.call_outcome || '') ||
    callNotes   !== (project.call_notes   || '') ||
    quality     !== (project.quality      || '');

  const submit = async () => {
    const patch = {};
    if (ownerId     !== (project.owner_id     || '')) patch.owner_id     = ownerId || null;
    if (callOutcome !== (project.call_outcome || '')) patch.call_outcome = callOutcome || null;
    if (callNotes   !== (project.call_notes   || '')) patch.call_notes   = callNotes;
    if (quality     !== (project.quality      || '')) patch.quality     = quality || null;
    const wasFirstQualification = !project.quality && quality;
    await onSave(patch);
    if (wasFirstQualification) {
      setSuccess(`✓ Lead qualified as ${quality.toUpperCase()}. 3 follow-up emails scheduled (D+3, D+7, D+14). All requirements complete — confirm the move to Design above.`);
      setTimeout(() => setSuccess(''), 8000);
    }
  };

  return (
    <Card title="Qualify this lead" subtitle="Fill these fields to unlock the Design stage. A follow-up cadence is auto-created when quality is set.">
      {success && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-200 text-xs leading-relaxed animate-fade-in">
          {success}
        </div>
      )}
      {/* Assign owner */}
      <div className="mb-4">
        <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
          Assign owner <span className="text-red-500">*</span>
        </label>
        <select
          value={ownerId}
          onChange={e => setOwnerId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
        >
          <option value="">— Select a salesperson —</option>
          {salesUsers.map(u => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.role === 'sales_mgr' ? 'Sales Mgr' : 'Sales Exec'})
            </option>
          ))}
        </select>
        {salesUsers.length === 0 && (
          <p className="text-[10px] text-amber-600 mt-1">No sales users found. Add users with role <code>sales_exec</code> or <code>sales_mgr</code> in Admin → Team.</p>
        )}
      </div>

      {/* Call outcome + notes */}
      <div className="mb-4">
        <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
          Call outcome <span className="text-red-500">*</span>
        </label>
        <select
          value={callOutcome}
          onChange={e => setCallOutcome(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400"
        >
          <option value="">— Select outcome —</option>
          {CALL_OUTCOMES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <textarea
          value={callNotes}
          onChange={e => setCallNotes(e.target.value)}
          rows={3}
          placeholder="Call notes — what did the customer say? Next-step intent, objections, scheduling preferences..."
          className="mt-2 w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 resize-none"
        />
      </div>

      {/* Quality */}
      <div className="mb-4">
        <label className="block text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
          Lead quality <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {QUALITY_OPTIONS.map(opt => {
            const Icon = opt.icon;
            const active = quality === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setQuality(opt.value)}
                className={`p-3 rounded-lg border-2 transition text-left
                  ${active ? `${opt.color} ring-1` : 'border-gray-200 hover:border-gray-300 bg-white text-gray-600'}`}
              >
                <Icon size={16} className="mb-1" />
                <div className="text-sm font-bold">{opt.label}</div>
                <div className="text-[10px] opacity-80">{opt.desc}</div>
              </button>
            );
          })}
        </div>
        {quality && !project.quality && (
          <p className="text-[10px] text-emerald-600 mt-2">
            Saving will auto-create 3 follow-up tasks (D+3, D+7, D+14) for the owner — regardless of quality.
          </p>
        )}
      </div>

      <div className="flex justify-end pt-2 border-t border-gray-100">
        <button
          onClick={submit}
          disabled={!dirty || saving}
          className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold disabled:opacity-40 flex items-center gap-1.5 transition"
        >
          <Save size={13} /> {saving ? 'Saving…' : 'Save qualification'}
        </button>
      </div>
    </Card>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [activities, setActivities] = useState([]);
  const [enquiry, setEnquiry] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('manage');
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [movingStage, setMovingStage] = useState(false);
  const [checkSaving, setCheckSaving] = useState('');
  const [savingNew, setSavingNew] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const [advancingFromCompletion, setAdvancingFromCompletion] = useState(false);
  const prevCompleteRef = useRef(null);

  const loadProject = () => {
    api.get(`/projects/${id}`)
      .then(r => {
        setProject(r.data.project);
        setTasks(r.data.tasks || []);
        setActivities(r.data.activities || []);
        setEnquiry(r.data.enquiry || null);
        setNotesDraft(r.data.project.notes || '');
      })
      .catch(e => setError(e.response?.data?.error || 'Failed to load project'))
      .finally(() => setLoading(false));
  };
  useEffect(loadProject, [id]);

  // Users list for the New-stage owner picker. Loaded once.
  useEffect(() => {
    api.get('/auth/users').then(r => setUsers(r.data || [])).catch(() => setUsers([]));
  }, []);

  // Detect when the current stage's required checklist becomes complete.
  // Fires the central completion modal on the false→true transition only —
  // never on initial page load — so users aren't ambushed by a popup the
  // moment they open a project that was already complete but not advanced.
  //
  // Skipped for stages where the actual transition is driven by a customer
  // fact rather than checklist completion (e.g. Selling — the rep finishing
  // their prep work doesn't mean the customer has accepted the proposal).
  // Those stages get a "ready" banner instead.
  useEffect(() => {
    if (!project) return;
    const stageId = project.stage;
    if (!stageId || stageId === 'exit') return;
    if (STAGES_REQUIRING_CUSTOMER_ACTION.has(stageId)) {
      // Track completion for the banner, but never auto-fire the modal.
      const c = stageCompletion(stageId, project.stage_progress);
      prevCompleteRef.current = c.complete;
      return;
    }
    const c = stageCompletion(stageId, project.stage_progress);
    const prev = prevCompleteRef.current;
    if (prev === false && c.complete) {
      setCompletionModalOpen(true);
      setCompletionDismissed(false);
    }
    prevCompleteRef.current = c.complete;
  }, [project?.stage, project?.stage_progress]);

  // Advance to the next stage from the completion modal acknowledgment.
  const advanceFromCompletion = async () => {
    if (!project) return;
    const next = NEXT_STAGE[project.stage];
    if (!next) { setCompletionModalOpen(false); return; }
    setAdvancingFromCompletion(true);
    try {
      await api.patch(`/projects/${project.id}`, { stage: next, previous_stage: project.stage });
      setCompletionModalOpen(false);
      setCompletionDismissed(false);
      loadProject();
    } catch (e) {
      alert(e.response?.data?.error || 'Advance failed');
    } finally {
      setAdvancingFromCompletion(false);
    }
  };

  const saveNewStageQualification = async (patch) => {
    setSavingNew(true);
    try {
      await api.patch(`/projects/${id}`, patch);
      loadProject();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to save qualification');
    } finally {
      setSavingNew(false);
    }
  };

  const moveStage = async (newStage, opts = {}) => {
    setMovingStage(true);
    try {
      await api.patch(`/projects/${id}`, {
        stage: newStage,
        previous_stage: project.stage,
        override: !!opts.override,
        reset_progress: !!opts.reset_progress,
      });
      loadProject();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to change stage');
    } finally {
      setMovingStage(false);
    }
  };

  const toggleChecklistItem = async (itemId, nextValue) => {
    setCheckSaving(itemId);
    setProject(p => ({ ...p, stage_progress: { ...(p.stage_progress || {}), [itemId]: nextValue } }));
    try {
      await api.patch(`/projects/${id}/checklist`, { itemId, completed: nextValue });
    } catch (e) {
      // revert on failure
      setProject(p => ({ ...p, stage_progress: { ...(p.stage_progress || {}), [itemId]: !nextValue } }));
      alert(e.response?.data?.error || 'Failed to save checklist');
    } finally {
      setCheckSaving('');
    }
  };

  const saveNotes = async () => {
    if (notesDraft === project.notes) return;
    setSavingNotes(true);
    try {
      await api.patch(`/projects/${id}`, { notes: notesDraft });
      setProject(p => ({ ...p, notes: notesDraft }));
    } finally {
      setSavingNotes(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;
  }
  if (error) {
    return <div className="p-6"><div className="bg-red-50 border border-red-200 text-red-600 p-4 rounded-lg text-sm">{error}</div></div>;
  }
  if (!project) return null;

  const stage = getStage(project.stage);
  const customer = project.contacts;
  const checklist = STAGE_CHECKLISTS[project.stage] || { required: [], optional: [] };
  const stageTabIds = STAGE_TABS[project.stage] || ['manage'];
  const activeTab = stageTabIds.includes(tab) ? tab : stageTabIds[0];
  const completion = stageCompletion(project.stage, project.stage_progress);
  const progressPct = completion.total > 0 ? Math.round((completion.done / completion.total) * 100) : 100;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to="/portal/projects" className="w-8 h-8 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:border-gray-300 transition">
            <ArrowLeft size={15} />
          </Link>
          <div>
            <div className="text-[10px] font-mono font-bold tracking-wider text-amber-600">{project.code}</div>
            <h2 className="text-lg font-bold font-display">{customer?.name || 'Unnamed Project'}</h2>
          </div>
          <Badge color={stage.color}>{stage.icon} {stage.label}</Badge>
          {project.sub_status && <Badge color="#ef4444">{project.sub_status}</Badge>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StageMoveDropdown
            currentStage={project.stage}
            onMove={moveStage}
            disabled={movingStage}
            completion={completion}
            isAdmin={isAdmin}
          />
          <ProjectStatusControls project={project} onChange={loadProject} />
          <button
            onClick={() => setLogOpen(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-1 hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-white/5 text-xs font-semibold text-gray-700 dark:text-gray-200"
          >
            <ActivityIcon size={13} /> Activity Log ({activities.length})
          </button>
        </div>
      </div>

      {/* "Ready" banner. Two variants:
          - For stages whose transition is driven by checklist completion
            (New, Design, Installation, Maintenance), this banner re-opens
            the completion modal if the user previously dismissed it.
          - For Selling (customer-action-driven), this banner is a self-check
            confirmation — "rep prep work is done, awaiting customer accept".
            No advance button; clicking through to Online Proposal tab is the
            natural next step. */}
      {completion.complete && NEXT_STAGE[project.stage] && (
        STAGES_REQUIRING_CUSTOMER_ACTION.has(project.stage) ? (
          <div className="rounded-xl border border-blue-200 dark:border-blue-500/30 bg-gradient-to-r from-blue-50 to-sky-50 dark:from-blue-500/10 dark:to-sky-500/10 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-200">
              <CheckCircle2 size={16} className="flex-shrink-0" />
              <span><strong>Selling prep complete.</strong> Awaiting customer decision — use <em>Mark as accepted</em> on the Online Proposal tab when they sign.</span>
            </div>
            <button
              onClick={() => setTab('online-proposal')}
              className="px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <FileCheck2 size={11} /> Open proposal
            </button>
          </div>
        ) : completionDismissed ? (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-500/10 dark:to-teal-500/10 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 size={16} className="flex-shrink-0" />
              <span><strong>{stage.label} requirements complete.</strong> Ready to move to {STAGE_LABELS[NEXT_STAGE[project.stage]]}.</span>
            </div>
            <button
              onClick={() => { setCompletionModalOpen(true); setCompletionDismissed(false); }}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <ArrowRight size={11} /> Advance
            </button>
          </div>
        ) : null
      )}

      {/* Stage progress bar */}
      <Card className="py-5 px-6">
        <StageProgressBar currentStage={project.stage} />
        <div className="text-center text-[10px] text-gray-400 mt-3">
          In stage since {fmtDate(project.stage_entered_at)} · {stage.desc}
        </div>
      </Card>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="!p-3">
          <div className="flex items-start gap-2">
            <div className="w-9 h-9 rounded-md bg-blue-50 flex items-center justify-center flex-shrink-0">
              <UserIcon size={16} className="text-blue-500" />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] text-gray-400 uppercase font-semibold">Customer</div>
              <div className="text-xs font-bold truncate">{customer?.name || '—'}</div>
              <div className="text-[10px] text-gray-400 truncate">{customer?.email || customer?.phone || '—'}</div>
            </div>
          </div>
        </Card>
        <Card className="!p-3">
          <div className="flex items-start gap-2">
            <div className="w-9 h-9 rounded-md bg-emerald-50 flex items-center justify-center flex-shrink-0">
              <MapPin size={16} className="text-emerald-500" />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] text-gray-400 uppercase font-semibold">Address</div>
              <div className="text-xs font-semibold truncate">{project.address || '—'}</div>
              <div className="text-[10px] text-gray-400 truncate">
                {[project.suburb, project.city, project.postcode].filter(Boolean).join(', ') || 'NZ'}
              </div>
            </div>
          </div>
        </Card>
        <Card className="!p-3">
          <div className="flex items-start gap-2">
            <div className="w-9 h-9 rounded-md bg-amber-50 flex items-center justify-center flex-shrink-0">
              <Sun size={16} className="text-amber-500" />
            </div>
            <div className="min-w-0">
              <div className="text-[9px] text-gray-400 uppercase font-semibold">System</div>
              <div className="text-xs font-bold">
                {project.system_size_kw ? `${project.system_size_kw} kW` : '—'}
                {project.panels && <span className="text-gray-400"> · {project.panels} panels</span>}
              </div>
              <div className="text-[10px] text-gray-400">
                {project.system_type || 'TBD'}
                {project.battery_kwh > 0 && ` · ${project.battery_kwh} kWh battery`}
              </div>
            </div>
          </div>
        </Card>
        <Card className="!p-3">
          <div className="flex items-start gap-2">
            <div className="w-9 h-9 rounded-md bg-violet-50 flex items-center justify-center flex-shrink-0">
              <DollarSign size={16} className="text-violet-500" />
            </div>
            <div>
              <div className="text-[9px] text-gray-400 uppercase font-semibold">Est. Value</div>
              <div className="text-sm font-extrabold">{project.estimated_value ? fmt$(project.estimated_value) : '—'}</div>
              <div className="text-[10px] text-gray-400">Owner: {project.users?.name?.split(' ')[0] || 'Unassigned'}</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Tabs — stage-specific */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1 overflow-x-auto">
          {stageTabIds.map(id => {
            const meta = TAB_CATALOG[id];
            const ready = IMPLEMENTED_TABS.has(id);
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-4 py-2 text-xs font-semibold whitespace-nowrap border-b-2 transition flex items-center gap-1.5
                  ${active ? 'border-amber-500 text-amber-600' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
              >
                {meta?.label}
                {!ready && <span className="text-[8px] bg-gray-100 text-gray-400 px-1 py-0.5 rounded font-medium">Phase 2</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab routing — manage + enquiry + online-proposal + pdf-proposal are implemented; rest fall back to placeholder */}
      {activeTab === 'enquiry'         && <EnquiryTab enquiry={enquiry} />}
      {activeTab === 'online-proposal' && <OnlineProposalTab project={project} customer={customer} onProjectChange={loadProject} />}
      {activeTab === 'pdf-proposal'    && <PdfProposalTab    project={project} customer={customer} onProjectChange={loadProject} />}
      {!['manage', 'enquiry', 'online-proposal', 'pdf-proposal'].includes(activeTab) && <TabPlaceholder tabId={activeTab} stageLabel={stage.label} />}

      {/* Manage tab content */}
      {activeTab === 'manage' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {project.stage === 'new' && (
              <NewStagePanel
                project={project}
                users={users}
                onSave={saveNewStageQualification}
                saving={savingNew}
              />
            )}
            {project.stage === 'design' && (
              <DesignStagePanel project={project} onProjectChange={loadProject} />
            )}
            {project.stage !== 'new' && (
              <StageRequirementsPanel project={project} onProjectChange={loadProject} />
            )}
            {/* Legacy unified checklist card. Hidden for non-New stages because
                StageRequirementsPanel covers the same checklist + advance flow.
                Kept for New stage only — that's where the data-driven items
                (owner / call / quality) need to be visible as ticked. */}
            {project.stage === 'new' && (
            <Card
              title={`${stage.label} checklist`}
              subtitle={completion.total > 0
                ? `${completion.done} of ${completion.total} required · ${completion.complete ? 'ready to advance' : 'blocking next stage'}`
                : 'No required items for this stage'}
            >
              {completion.total > 0 && (
                <div className="mb-4">
                  <div className="h-1.5 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${completion.complete ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-400 to-orange-500'}`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="space-y-4">
                <div>
                  <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Required</div>
                  <ul className="space-y-1.5">
                    {checklist.required.map(item => {
                      const done = project.stage_progress?.[item.id] === true;
                      const saving = checkSaving === item.id;
                      // New-stage items are gated by the qualification panel above — no direct toggling.
                      const dataDriven = project.stage === 'new' && ['new.owner', 'new.call', 'new.qualify'].includes(item.id);
                      return (
                        <li key={item.id}>
                          <button
                            onClick={() => !dataDriven && toggleChecklistItem(item.id, !done)}
                            disabled={saving || dataDriven}
                            title={dataDriven ? 'Fill the qualification form above to tick this' : ''}
                            className={`w-full flex items-start gap-2 text-left text-xs rounded-md px-2 py-1.5 transition
                              ${done
                                ? 'bg-emerald-50 dark:bg-emerald-500/10 text-gray-700 dark:text-gray-200'
                                : 'hover:bg-gray-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200'}
                              ${saving ? 'opacity-60' : ''}
                              ${dataDriven ? 'cursor-not-allowed' : ''}`}
                          >
                            {done
                              ? <CheckSquare size={14} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                              : <Square size={14} className="text-amber-400 dark:text-amber-500 mt-0.5 flex-shrink-0" />}
                            <span className={done ? 'line-through text-gray-400 dark:text-gray-500' : ''}>{item.label}</span>
                            {dataDriven && <Lock size={10} className="text-gray-300 ml-auto flex-shrink-0 mt-0.5" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                {checklist.optional.length > 0 && (
                  <div>
                    <div className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Optional</div>
                    <ul className="space-y-1.5">
                      {checklist.optional.map(item => {
                        const done = project.stage_progress?.[item.id] === true;
                        const saving = checkSaving === item.id;
                        return (
                          <li key={item.id}>
                            <button
                              onClick={() => toggleChecklistItem(item.id, !done)}
                              disabled={saving}
                              className={`w-full flex items-start gap-2 text-left text-xs rounded-md px-2 py-1.5 transition
                                ${done
                                  ? 'bg-emerald-50/50 dark:bg-emerald-500/5 text-gray-500 dark:text-gray-400'
                                  : 'hover:bg-gray-50 dark:hover:bg-white/5 text-gray-500 dark:text-gray-400'}
                                ${saving ? 'opacity-60' : ''}`}
                            >
                              {done
                                ? <CheckSquare size={14} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                                : <Square size={14} className="text-gray-300 dark:text-gray-600 mt-0.5 flex-shrink-0" />}
                              <span className={done ? 'line-through' : ''}>{item.label}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
            )}

            {/* Stage-specific Manage content. New stage shows the Tasks list as
                normal (the nurture cadence tasks are useful at intake). Other
                stages get a snapshot card for the work that matters here. */}
            {project.stage === 'new' && (
              <Card title={`Tasks (${tasks.length})`} subtitle="Action items linked to this project">
                {tasks.length === 0 ? (
                  <div className="text-xs text-gray-400 italic py-4 text-center">No tasks yet.</div>
                ) : (
                  <ul className="space-y-2">
                    {tasks.map(t => (
                      <li key={t.id} className="flex items-start justify-between gap-3 p-2 rounded-lg border border-gray-100 hover:bg-gray-50">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-gray-800">{t.title}</div>
                          {t.description && <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{t.description}</div>}
                        </div>
                        <div className="flex flex-col items-end gap-1 flex-shrink-0">
                          <Badge color={t.priority === 'high' ? '#ef4444' : t.priority === 'low' ? '#9ca3af' : '#f59e0b'}>{t.priority}</Badge>
                          {t.due_date && <span className="text-[10px] text-gray-400 flex items-center gap-1"><Clock size={9} /> {fmtDate(t.due_date)}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}

            {project.stage === 'design'  && <SystemSpecSnapshot   project={project} customer={customer} />}
            {project.stage === 'selling' && <ProposalStatusSnapshot project={project} />}
            {(project.stage === 'installation' || project.stage === 'maintenance' || project.stage === 'exit') && (
              <ProjectSnapshot project={project} customer={customer} />
            )}
            {/* Cadence schedule — visible from Design onwards while the
                cadence is active. Helps reps know what the customer is
                receiving in the background. */}
            {project.qualified_at && project.stage !== 'new' && (
              <CadenceScheduleCard project={project} />
            )}

            {/* Recent Activity replaces the noisy Tasks list in non-New stages.
                It surfaces system events (auto-triggers, emails, calls) so the
                rep sees exactly what's happened. The handful of relevant
                non-nurture tasks (e.g. installation starter tasks) are shown
                in a lighter list below it. */}
            {project.stage !== 'new' && (
              <>
                <RecentActivityFeed activities={activities} />
                {(() => {
                  const ts = relevantTasks(tasks, project.stage);
                  if (ts.length === 0) return null;
                  return (
                    <Card title={`Tasks (${ts.length})`} subtitle="Outstanding items on this project (nurture cadence hidden)">
                      <ul className="space-y-2">
                        {ts.map(t => (
                          <li key={t.id} className="flex items-start justify-between gap-3 p-2 rounded-lg border border-gray-100 hover:bg-gray-50">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-semibold text-gray-800">{t.title}</div>
                              {t.description && <div className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{t.description}</div>}
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <Badge color={t.priority === 'high' ? '#ef4444' : t.priority === 'low' ? '#9ca3af' : '#f59e0b'}>{t.priority}</Badge>
                              {t.due_date && <span className="text-[10px] text-gray-400 flex items-center gap-1"><Clock size={9} /> {fmtDate(t.due_date)}</span>}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  );
                })()}
              </>
            )}

            <Card title="Internal notes" subtitle="Team-only — not shown to customer">
              <textarea
                value={notesDraft}
                onChange={e => setNotesDraft(e.target.value)}
                onBlur={saveNotes}
                rows={4}
                placeholder="Add internal notes for this project..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition resize-none"
              />
              {savingNotes && <div className="text-[10px] text-amber-500 mt-1">Saving…</div>}
            </Card>
          </div>

          <div className="lg:col-span-1 space-y-4">
            <Card title="Contact details" subtitle="Quick reference">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs"><Mail size={12} className="text-gray-300" /> {customer?.email || '—'}</div>
                <div className="flex items-center gap-2 text-xs"><Phone size={12} className="text-gray-300" /> {customer?.phone || '—'}</div>
                <div className="flex items-center gap-2 text-xs"><Zap size={12} className="text-gray-300" /> {customer?.monthly_bill ? `${fmt$(customer.monthly_bill)}/mo` : '—'}</div>
              </div>
            </Card>

            <Card title="Timeline" subtitle="Key dates">
              <div className="space-y-2">
                <div>
                  <div className="text-[9px] text-gray-400 uppercase font-semibold">Created</div>
                  <div className="text-xs text-gray-700">{fmtDateLong(project.created_at)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-gray-400 uppercase font-semibold">Entered {stage.label}</div>
                  <div className="text-xs text-gray-700">{fmtDateLong(project.stage_entered_at)}</div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Central stage-completion modal — fires when the current stage's
          checklist transitions from incomplete to complete. Hoisted to the
          top-level page so it survives the actual stage-move re-render. */}
      <StageAdvanceModal
        open={completionModalOpen}
        onClose={() => { setCompletionModalOpen(false); setCompletionDismissed(true); }}
        onConfirm={advanceFromCompletion}
        confirming={advancingFromCompletion}
        title={`${stage.label} stage complete`}
        subtitle={NEXT_STAGE[project.stage]
          ? `All required activities for the ${stage.label} stage are done. Ready to move to ${STAGE_LABELS[NEXT_STAGE[project.stage]]}?`
          : `All required activities for the ${stage.label} stage are done.`}
        completed={(STAGE_CHECKLISTS[project.stage]?.required || []).map(it => `${it.label} ✓`)}
        nextActions={NEXT_ACTIONS_BY_STAGE[project.stage] || []}
        ctaLabel={NEXT_STAGE[project.stage] ? `Acknowledge & move to ${STAGE_LABELS[NEXT_STAGE[project.stage]]}` : 'Acknowledge'}
      />

      {/* Activity log drawer */}
      {logOpen && (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={() => setLogOpen(false)}>
          <div className="w-full max-w-md bg-white h-full shadow-2xl overflow-y-auto border-l border-gray-100" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold font-display">Activity Log</h3>
                <p className="text-[10px] text-gray-400">Most recent {activities.length} events</p>
              </div>
              <button onClick={() => setLogOpen(false)} className="text-gray-400 hover:text-gray-700 text-lg leading-none px-2">×</button>
            </div>
            <div className="p-5 space-y-3">
              {activities.length === 0 ? (
                <div className="text-xs text-gray-400 italic text-center py-10">No activity yet.</div>
              ) : (
                activities.map(a => (
                  <div key={a.id} className="flex gap-3 pb-3 border-b border-gray-100 last:border-0">
                    <div className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-800">{a.description}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{fmtDateLong(a.created_at)} · <span className="uppercase tracking-wide">{a.type}</span></div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

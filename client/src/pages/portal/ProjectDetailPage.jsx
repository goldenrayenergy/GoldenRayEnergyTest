import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../../services/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { fmt$, fmtDateLong, fmtDate } from '../../utils/format';
import { PROJECT_STAGES, getStage, stageIndex, STAGE_CHECKLISTS, STAGE_TABS, TAB_CATALOG, IMPLEMENTED_TABS, stageCompletion } from '../../utils/stages';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowLeft, Calendar, Activity as ActivityIcon, Sun, User as UserIcon,
  Mail, Phone, MapPin, Zap, DollarSign, CheckSquare, Square, Clock, ChevronDown, Lock, ShieldAlert,
  Flame, Snowflake, ThermometerSun, FileText, Home, Save,
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
  const currentIdx = stageIndex(currentStage);
  const forwardBlocked = !isAdmin && !completion.complete;
  const missingCount = completion.total - completion.done;

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
            const isCurrent = s.id === currentStage;
            const isForwardMove = i > currentIdx;
            const blocked = isCurrent || (isForwardMove && forwardBlocked);
            return (
              <button
                key={s.id}
                disabled={blocked}
                onClick={() => { setOpen(false); onMove(s.id); }}
                title={isCurrent ? 'Current stage' : blocked ? 'Complete required items first' : `Move to ${s.label}`}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-amber-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200 flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              >
                <span>{s.icon}</span>
                <span className="flex-1">{s.label}</span>
                {isCurrent && <span className="text-[9px] text-amber-600 dark:text-amber-400 font-bold">CURRENT</span>}
                {!isCurrent && isForwardMove && forwardBlocked && <Lock size={11} className="text-gray-300 dark:text-gray-500" />}
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

// Data-capture panel for the New stage — replaces the bare checkbox toggles
// for "Assign owner / Call customer / Qualify". Saving these fields auto-ticks
// the corresponding checklist items server-side and unlocks the Design stage.
function NewStagePanel({ project, users, onSave, saving }) {
  const [ownerId,     setOwnerId]     = useState(project.owner_id || '');
  const [callOutcome, setCallOutcome] = useState(project.call_outcome || '');
  const [callNotes,   setCallNotes]   = useState(project.call_notes || '');
  const [quality,     setQuality]     = useState(project.quality || '');

  // Sales pool for the owner picker — sales executives + sales managers.
  const salesUsers = users.filter(u => u.role === 'sales_exec' || u.role === 'sales_mgr');

  const dirty =
    ownerId     !== (project.owner_id     || '') ||
    callOutcome !== (project.call_outcome || '') ||
    callNotes   !== (project.call_notes   || '') ||
    quality     !== (project.quality      || '');

  const submit = () => {
    const patch = {};
    if (ownerId     !== (project.owner_id     || '')) patch.owner_id     = ownerId || null;
    if (callOutcome !== (project.call_outcome || '')) patch.call_outcome = callOutcome || null;
    if (callNotes   !== (project.call_notes   || '')) patch.call_notes   = callNotes;
    if (quality     !== (project.quality      || '')) patch.quality     = quality || null;
    onSave(patch);
  };

  return (
    <Card title="Qualify this lead" subtitle="Fill these fields to unlock the Design stage. A follow-up cadence is auto-created when quality is set.">
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
        <div className="flex items-center gap-2">
          <StageMoveDropdown
            currentStage={project.stage}
            onMove={moveStage}
            disabled={movingStage}
            completion={completion}
            isAdmin={isAdmin}
          />
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-1 hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-white/5 text-xs font-semibold text-gray-700 dark:text-gray-200">
            <Calendar size={13} /> Schedule
          </button>
          <button
            onClick={() => setLogOpen(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-brand-dark-1 hover:border-amber-300 hover:bg-amber-50 dark:hover:bg-white/5 text-xs font-semibold text-gray-700 dark:text-gray-200"
          >
            <ActivityIcon size={13} /> Activity Log ({activities.length})
          </button>
        </div>
      </div>

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

      {/* Tab routing — manage + enquiry are implemented; the rest fall back to a Phase 2 placeholder */}
      {activeTab === 'enquiry' && <EnquiryTab enquiry={enquiry} />}
      {activeTab !== 'manage' && activeTab !== 'enquiry' && <TabPlaceholder tabId={activeTab} stageLabel={stage.label} />}

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

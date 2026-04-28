import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { fmtDateLong } from '../../utils/format';
import { ShieldAlert, CheckCircle2, XCircle, Clock } from 'lucide-react';

const ACTION_LABELS = {
  force_advance:  'Force advance stage',
  force_accept:   'Force accept proposal',
  backward_move:  'Backward stage move',
};

const STATUS_COLORS = {
  pending:  '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444',
  cancelled: '#9ca3af',
};

export default function OverrideRequestsPage() {
  const { user } = useAuth();
  const isAdmin  = user?.role === 'admin';
  const [requests, setRequests] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState('pending');
  const [busyId,   setBusyId]   = useState('');
  const [decisionDraft, setDecisionDraft] = useState({});

  const load = () => {
    setLoading(true);
    api.get(`/overrides${filter ? `?status=${filter}` : ''}`)
      .then(r => setRequests(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(load, [filter]);

  const decide = async (id, action) => {
    setBusyId(id + ':' + action);
    try {
      await api.post(`/overrides/${id}/${action}`, { decision_reason: decisionDraft[id] || '' });
      load();
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold font-display flex items-center gap-2">
            <ShieldAlert size={18} className="text-amber-500" /> Override Requests
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {isAdmin
              ? 'Review and decide on stage / acceptance overrides submitted by the team.'
              : 'Your override requests and their status.'}
          </p>
        </div>
        <div className="flex gap-1.5">
          {['pending', 'approved', 'rejected', ''].map(s => (
            <button
              key={s || 'all'}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold ${filter === s ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-brand-dark-2 text-gray-600 dark:text-gray-300'}`}
            >
              {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Card className="py-12 text-center"><div className="animate-spin w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full mx-auto" /></Card>
      ) : requests.length === 0 ? (
        <Card className="py-10 text-center">
          <CheckCircle2 size={28} className="text-emerald-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600 dark:text-gray-300">No {filter || ''} override requests.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map(r => (
            <Card key={r.id} className="!p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <Badge color={STATUS_COLORS[r.status] || '#9ca3af'}>{r.status}</Badge>
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-100">{ACTION_LABELS[r.action_type] || r.action_type}</span>
                    {r.project && (
                      <Link to={`/portal/projects/${r.project.id}`} className="text-xs text-amber-600 hover:underline">
                        {r.project.code} · {r.project.contacts?.name || 'Unknown'}
                      </Link>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                    Requested by <strong>{r.requester?.name || 'Unknown'}</strong> on {fmtDateLong(r.requested_at)}
                  </div>
                  <div className="bg-gray-50 dark:bg-brand-dark-2 rounded-md px-3 py-2 mb-2">
                    <div className="text-[10px] uppercase tracking-wide font-bold text-gray-400 mb-1">Reason</div>
                    <div className="text-xs text-gray-700 dark:text-gray-200 whitespace-pre-wrap">{r.reason}</div>
                  </div>
                  {r.action_payload && Object.keys(r.action_payload).length > 0 && (
                    <div className="bg-gray-50 dark:bg-brand-dark-2 rounded-md px-3 py-2 mb-2">
                      <div className="text-[10px] uppercase tracking-wide font-bold text-gray-400 mb-1">Payload</div>
                      <code className="text-[11px] text-gray-600 dark:text-gray-300">{JSON.stringify(r.action_payload, null, 2)}</code>
                    </div>
                  )}
                  {r.status !== 'pending' && (
                    <div className="text-[11px] text-gray-500 dark:text-gray-400">
                      Decided by <strong>{r.decider?.name || 'system'}</strong> on {fmtDateLong(r.decided_at)}
                      {r.decision_reason && <span className="block mt-0.5 italic">"{r.decision_reason}"</span>}
                    </div>
                  )}
                </div>
                {isAdmin && r.status === 'pending' && (
                  <div className="flex flex-col gap-2 min-w-[220px]">
                    <textarea
                      value={decisionDraft[r.id] || ''}
                      onChange={e => setDecisionDraft(d => ({ ...d, [r.id]: e.target.value }))}
                      placeholder="Decision reason (optional)"
                      rows={2}
                      className="w-full px-2 py-1.5 rounded border border-gray-200 dark:border-white/10 text-[11px] resize-none"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => decide(r.id, 'approve')}
                        disabled={busyId.startsWith(r.id)}
                        className="flex-1 px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-white text-[11px] font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1"
                      >
                        <CheckCircle2 size={11} /> Approve
                      </button>
                      <button
                        onClick={() => decide(r.id, 'reject')}
                        disabled={busyId.startsWith(r.id)}
                        className="flex-1 px-3 py-1.5 rounded bg-red-500 hover:bg-red-400 text-white text-[11px] font-bold disabled:opacity-50 inline-flex items-center justify-center gap-1"
                      >
                        <XCircle size={11} /> Reject
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { fmt$, fmtDateLong } from '../../utils/format';
import SolarFinance from '../../components/website/SolarFinance';
import { CreditCard, ShieldAlert } from 'lucide-react';

// Admin-only — log new finance applications on behalf of customers
// who phoned/emailed in, and review existing ones.
export default function FinanceApplicationsPage() {
  const { user } = useAuth();
  const [apps, setApps] = useState([]);
  const [loadingApps, setLoadingApps] = useState(true);

  // Hard gate: non-admins are redirected to the dashboard. This is in
  // addition to the route guard in App.jsx — defense in depth.
  if (user && user.role !== 'admin') {
    return <Navigate to="/portal" replace />;
  }

  useEffect(() => {
    api.get('/finance')
      .then(r => setApps(r.data || []))
      .catch(() => setApps([]))
      .finally(() => setLoadingApps(false));
  }, []);

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold font-display flex items-center gap-2">
            <CreditCard size={18} className="text-amber-500" /> Finance Applications
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Log applications taken over the phone or email, and review submissions in the queue.
          </p>
        </div>
        <Badge color="#dc2626"><ShieldAlert size={11} className="inline -mt-0.5 mr-1" /> Admin only</Badge>
      </div>

      <Card title="Recent applications" subtitle={loadingApps ? 'Loading…' : `${apps.length} on file`}>
        {!loadingApps && apps.length === 0 && (
          <div className="text-xs text-gray-400 italic py-6 text-center">
            No finance applications yet. Use the form below to log a new one.
          </div>
        )}
        {!loadingApps && apps.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 font-semibold border-b border-gray-100">
                  <th className="py-2 pr-3">Submitted</th>
                  <th className="py-2 pr-3">Applicant</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3 text-right">Amount</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {apps.map(a => (
                  <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="py-2 pr-3 text-gray-400">{fmtDateLong(a.created_at)}</td>
                    <td className="py-2 pr-3 font-semibold text-gray-800">
                      {[a.first_name, a.last_name].filter(Boolean).join(' ') || '—'}
                    </td>
                    <td className="py-2 pr-3 text-gray-600">{a.email || '—'}</td>
                    <td className="py-2 pr-3 capitalize">{(a.product || '').replace(/_/g, ' ')}</td>
                    <td className="py-2 pr-3 text-right font-bold">{fmt$(a.loan_amount)}</td>
                    <td className="py-2 pr-3">
                      <Badge color={a.status === 'approved' ? '#10b981' : a.status === 'rejected' ? '#ef4444' : '#f59e0b'}>
                        {a.status || 'pending'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Log a new application" subtitle="Use this form when you receive an enquiry by phone or email">
        <div className="-mx-6 -mb-6">
          <SolarFinance />
        </div>
      </Card>
    </div>
  );
}

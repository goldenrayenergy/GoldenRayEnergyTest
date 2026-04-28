import { useState, useEffect } from 'react';
import api from '../../services/api';
import KPI from '../../components/ui/KPI';
import DataTable from '../../components/ui/DataTable';
import Badge from '../../components/ui/Badge';
import { fmt$, pct } from '../../utils/format';
import { Send, Eye, MousePointer, AlertCircle } from 'lucide-react';

export default function EmailAnalyticsPage() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.get('/campaigns').then(r => setCampaigns(r.data.filter(c => c.channel === 'email'))).finally(() => setLoading(false)); }, []);
  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" /></div>;

  const totalSent = campaigns.reduce((s, c) => s + Number(c.emails_sent || 0), 0);
  const totalOpened = campaigns.reduce((s, c) => s + Number(c.emails_opened || 0), 0);
  const totalClicked = campaigns.reduce((s, c) => s + Number(c.emails_clicked || 0), 0);
  const totalBounced = campaigns.reduce((s, c) => s + Number(c.emails_bounced || 0), 0);

  return (
    <div className="animate-fade-in space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <KPI icon={Send} label="Total sent" value={totalSent.toLocaleString()} accent="#3b82f6" />
        <KPI icon={Eye} label="Open rate" value={`${pct(totalOpened, totalSent)}%`} sub={`${totalOpened} opened`} accent="#10b981" trend={4} />
        <KPI icon={MousePointer} label="Click rate" value={`${pct(totalClicked, totalSent)}%`} accent="#f59e0b" trend={2} />
        <KPI icon={AlertCircle} label="Bounce rate" value={`${pct(totalBounced, totalSent)}%`} accent="#ef4444" trend={-1} />
      </div>
      <DataTable columns={[
        { label: 'Campaign', render: r => <div className="text-xs font-semibold">{r.name}</div> },
        { label: 'Status', render: r => <Badge color={r.status === 'active' ? '#10b981' : '#999'}>{r.status}</Badge> },
        { label: 'Sent', render: r => <span className="text-xs">{(Number(r.emails_sent) || 0).toLocaleString()}</span> },
        { label: 'Open rate', render: r => <span className="text-xs font-semibold text-emerald-500">{pct(r.emails_opened, r.emails_sent)}%</span> },
        { label: 'Click rate', render: r => <span className="text-xs font-semibold text-amber-500">{pct(r.emails_clicked, r.emails_sent)}%</span> },
        { label: 'Revenue', render: r => <span className="text-xs font-bold text-emerald-500">{fmt$(r.revenue_attributed)}</span> },
      ]} data={campaigns} />
    </div>
  );
}
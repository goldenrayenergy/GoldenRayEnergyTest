import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { LayoutDashboard, Briefcase, TrendingUp, CheckCircle, GitBranch, Megaphone, Mail, Target, Users, Building2, BarChart3, Settings, LogOut, Inbox, FolderKanban, CreditCard, ShieldAlert, Package } from 'lucide-react';
import ThemeToggle from '../ui/ThemeToggle';

const NAV = [
  { header: 'Overview', items: [{ to: '/portal', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  { header: 'Sales Hub', items: [
    { to: '/portal/projects', label: 'Projects', icon: FolderKanban },
    { to: '/portal/deals', label: 'Deals', icon: Briefcase },
    { to: '/portal/sales', label: 'Sales Analytics', icon: TrendingUp },
    { to: '/portal/tasks', label: 'Tasks', icon: CheckCircle },
    { to: '/portal/pipeline', label: 'Pipeline', icon: GitBranch },
  ]},
  { header: 'Marketing Hub', items: [
    { to: '/portal/campaigns', label: 'Campaigns', icon: Megaphone },
    { to: '/portal/email-analytics', label: 'Email Analytics', icon: Mail },
    { to: '/portal/lead-scoring', label: 'Lead Scoring', icon: Target },
  ]},
  { header: 'Data Hub', items: [
    { to: '/portal/enquiries', label: 'Website Enquiries', icon: Inbox },
    { to: '/portal/contacts', label: 'Contacts', icon: Users },
    { to: '/portal/companies', label: 'Companies', icon: Building2 },
    { to: '/portal/products', label: 'Products', icon: Package },
    { to: '/portal/reports', label: 'Reports', icon: BarChart3 },
  ]},
  { header: 'Approvals', items: [{ to: '/portal/overrides', label: 'Override Requests', icon: ShieldAlert }] },
  { header: 'Finance', items: [{ to: '/portal/finance', label: 'Applications', icon: CreditCard }], adminOnly: true },
  { header: 'Settings', items: [{ to: '/portal/admin', label: 'Admin', icon: Settings }], adminOnly: true },
];

// Map nav `to` paths to badge keys returned by /api/reports/sidebar-counts
const BADGE_KEY_BY_PATH = {
  '/portal/projects':  'atRisk',
  '/portal/overrides': 'pendingOverrides',
};

export default function Sidebar() {
  const { user, logout } = useAuth();
  const sections = user?.role === 'admin' ? NAV : NAV.filter(s => !s.adminOnly);
  const [counts, setCounts] = useState({ pendingOverrides: 0, atRisk: 0 });

  // Refresh counts on mount + every time the tab regains focus.
  useEffect(() => {
    const load = () => api.get('/reports/sidebar-counts').then(r => setCounts(r.data || { pendingOverrides: 0, atRisk: 0 })).catch(() => {});
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    // Also refresh every 60 seconds — light polling so badges don't go stale
    // mid-session. Single endpoint, head-counts only, very cheap.
    const interval = setInterval(load, 60000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      clearInterval(interval);
    };
  }, []);

  return (
    <aside className="w-56 flex-shrink-0 bg-white dark:bg-brand-dark-1 border-r border-gray-100 dark:border-white/5 flex flex-col transition-colors">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-white/5 flex items-center gap-2">
        <img src="/logo.jpg" alt="Goldenray Energy NZ" className="h-10 w-auto object-contain" />
        <div className="leading-tight min-w-0">
          <div className="text-[11px] font-extrabold font-display tracking-tight truncate text-gray-900 dark:text-gray-100">GOLDENRAY <span className="text-gray-500 dark:text-gray-400">NZ</span></div>
          <div className="text-[8px] text-gray-400 dark:text-gray-500 italic truncate">Sustainable Future</div>
          <div className="text-[8px] text-amber-600 dark:text-amber-400 font-semibold">CRM Portal</div>
        </div>
      </div>

      <nav className="flex-1 py-2 px-2 overflow-y-auto">
        {sections.map((section, si) => (
          <div key={si} className="mb-2">
            <div className="px-3 py-1.5 text-[9px] font-bold text-gray-300 dark:text-gray-600 uppercase tracking-widest">{section.header}</div>
            {section.items.map(item => {
              const badgeKey = BADGE_KEY_BY_PATH[item.to];
              const count = badgeKey ? counts[badgeKey] : 0;
              const badgeColor = badgeKey === 'pendingOverrides' ? 'bg-red-500' : 'bg-amber-500';
              return (
                <NavLink key={item.to} to={item.to} end={item.end}
                  className={({ isActive }) => `flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium mb-0.5 transition-all
                    ${isActive
                      ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                  <item.icon size={14} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {count > 0 && (
                    <span className={`${badgeColor} text-white text-[9px] font-extrabold rounded-full px-1.5 py-0.5 leading-none min-w-[16px] text-center`}>
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-gray-100 dark:border-white/5">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-md bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center text-[10px] font-bold text-amber-600 dark:text-amber-400">
            {user?.avatar || user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold truncate text-gray-900 dark:text-gray-100">{user?.name}</div>
            <div className="text-[9px] text-gray-400 dark:text-gray-500 capitalize">{user?.role?.replace('_', ' ')}</div>
          </div>
          <ThemeToggle />
        </div>
        <button onClick={logout}
          className="flex items-center gap-1.5 w-full px-2 py-1 border border-gray-200 dark:border-white/10 rounded-md bg-gray-50 dark:bg-brand-dark-2 text-gray-500 dark:text-gray-400 text-[10px] hover:bg-gray-100 dark:hover:bg-brand-dark-3 transition">
          <LogOut size={11} /> Sign Out
        </button>
      </div>
    </aside>
  );
}

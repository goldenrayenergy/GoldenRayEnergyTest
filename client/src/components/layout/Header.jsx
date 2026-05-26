import { Link, useLocation } from 'react-router-dom';
import { ArrowRight, ArrowLeft, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const PAGE_TITLES = {
  '/portal': 'Dashboard', '/portal/deals': 'Deals', '/portal/sales': 'Sales Analytics',
  '/portal/tasks': 'Tasks', '/portal/pipeline': 'Pipeline', '/portal/campaigns': 'Campaigns',
  '/portal/email-analytics': 'Email Analytics', '/portal/lead-scoring': 'Lead Scoring',
  '/portal/contacts': 'Contacts', '/portal/companies': 'Companies', '/portal/reports': 'Reports',
  '/portal/admin': 'Admin', '/portal/projects': 'Projects', '/portal/enquiries': 'Website Enquiries',
};

export default function Header() {
  const { pathname } = useLocation();
  const { logout } = useAuth();
  const title = PAGE_TITLES[pathname] || 'Portal';
  return (
    <header className="h-12 border-b border-gray-100 dark:border-white/5 flex items-center justify-between px-5 bg-white dark:bg-brand-dark-1 transition-colors">
      <h1 className="text-sm font-bold font-display text-gray-900 dark:text-gray-100">{title}</h1>
      <div className="flex items-center gap-3">
        <Link
          to="/"
          title="View the public website — you stay signed in"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Website
        </Link>
        <span className="text-gray-200 dark:text-white/10">|</span>
        <Link
          to="/pm"
          title="Open the new PM Tool (Phase A) — runs in parallel with /portal/projects, no data shared"
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors shadow-sm"
        >
          <span className="text-[9px] bg-white/25 px-1 py-px rounded font-bold tracking-wider">NEW</span>
          Try the PM Tool
          <ArrowRight size={12} />
        </Link>
        <button
          onClick={logout}
          title="Sign out of the CRM portal"
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 hover:border-red-300 hover:text-red-600 transition-colors"
        >
          <LogOut size={12} />
          Sign Out
        </button>
      </div>
    </header>
  );
}

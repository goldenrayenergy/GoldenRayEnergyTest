import { useLocation } from 'react-router-dom';

const PAGE_TITLES = {
  '/portal': 'Dashboard', '/portal/deals': 'Deals', '/portal/sales': 'Sales Analytics',
  '/portal/tasks': 'Tasks', '/portal/pipeline': 'Pipeline', '/portal/campaigns': 'Campaigns',
  '/portal/email-analytics': 'Email Analytics', '/portal/lead-scoring': 'Lead Scoring',
  '/portal/contacts': 'Contacts', '/portal/companies': 'Companies', '/portal/reports': 'Reports',
  '/portal/admin': 'Admin', '/portal/projects': 'Projects', '/portal/enquiries': 'Website Enquiries',
};

export default function Header() {
  const { pathname } = useLocation();
  const title = PAGE_TITLES[pathname] || 'Portal';
  return (
    <header className="h-12 border-b border-gray-100 dark:border-white/5 flex items-center justify-between px-5 bg-white dark:bg-brand-dark-1 transition-colors">
      <h1 className="text-sm font-bold font-display text-gray-900 dark:text-gray-100">{title}</h1>
      <span className="text-[10px] text-gray-300 dark:text-gray-600">Goldenray Energy NZ — CRM</span>
    </header>
  );
}

import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function PortalLayout() {
  return (
    <div className="flex min-h-screen bg-gray-50/80 dark:bg-brand-dark font-body text-gray-900 dark:text-gray-100 transition-colors">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-auto p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

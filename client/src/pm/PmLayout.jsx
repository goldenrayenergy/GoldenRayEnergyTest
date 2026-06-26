import { Outlet, Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import ErrorBoundary from './components/ErrorBoundary';

// ── Shell layout for the PM tool ──
// Visually distinct from the portal so it's obvious which surface you're on.
// Header strip is slate (vs portal's amber) and labels itself "PM Tool · Phase A"
// to make the experimental nature obvious.
export default function PmLayout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-6">
          <Link to="/pm" className="font-semibold text-amber-300 tracking-wide">
            PM Tool <span className="text-xs text-slate-400 font-normal ml-1">· Phase A</span>
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link
              to="/pm/owner"
              className={`px-2 py-1 rounded ${pathname === '/pm' || pathname === '/pm/owner' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white'}`}>
              Owner Dashboard
            </Link>
            <Link
              to="/pm/projects"
              className={`px-2 py-1 rounded ${pathname.startsWith('/pm/projects') ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white'}`}>
              Projects
            </Link>
            <Link
              to="/pm/quotes"
              className={`px-2 py-1 rounded ${pathname.startsWith('/pm/quotes') ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white'}`}>
              Quotes
            </Link>
            <Link
              to="/pm/troubleshooting"
              className={`px-2 py-1 rounded ${pathname.startsWith('/pm/troubleshooting') ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white'}`}>
              Troubleshooting
            </Link>
            <Link
              to="/pm/admin"
              className={`px-2 py-1 rounded ${pathname.startsWith('/pm/admin') ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white'}`}>
              Admin
            </Link>
          </nav>
          <div className="flex-1" />
          <Link
            to="/portal"
            title="Return to the main CRM portal — you stay signed in"
            className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-md bg-amber-500/15 border border-amber-400/50 text-amber-200 hover:bg-amber-500/25 hover:text-white hover:border-amber-300 transition-colors"
          >
            <ArrowLeft size={15} />
            Back to Main Portal
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Global safety net: a page crash shows a card here, not a white screen;
            the nav above stays usable. */}
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}

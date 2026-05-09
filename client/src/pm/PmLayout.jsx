import { Outlet, Link, useLocation } from 'react-router-dom';

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
          </nav>
          <div className="flex-1" />
          <Link to="/portal" className="text-xs text-slate-400 hover:text-white">
            ← back to main portal
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

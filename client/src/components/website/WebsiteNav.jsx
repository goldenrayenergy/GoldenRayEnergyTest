import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Menu, X, Phone, Mail, ArrowRight, TrendingUp, Lock,
  Zap, Package, ShoppingBag, DollarSign, Award, Users, FileText,
  HelpCircle, MapPin, MessageCircle, Calendar, Sun,
} from 'lucide-react';
import FinanceModal from './FinanceModal';

// ────────────────────────────────────────────────────────────────────────────
// WebsiteNav — shared public-website navigation (Option B design).
//
// Identical UX across desktop / tablet / mobile:
//   [LOGO]                         [📞] [⚡ Bill Analysis CTA] [☰]
//
// Tapping the hamburger slides a drawer in from the right with all
// navigation grouped into 4 sections: Solutions, About, Resources, Contact.
// Adding a new page = one entry in the relevant group; never breaks layout.
//
// Includes the Finance modal (extracted from WebsitePage) so it works on
// every page that mounts this nav.
// ────────────────────────────────────────────────────────────────────────────

export default function WebsiteNav({ extras }) {
  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [financeOpen, setFinanceOpen] = useState(false);
  const { pathname } = useLocation();

  // On home page, anchors stay #anchor; on other pages they need to navigate
  // back to / first then anchor.
  const isHome = pathname === '/';
  const a = (anchor) => (isHome ? `#${anchor}` : `/#${anchor}`);

  // Lock body scroll while drawer is open
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [drawerOpen]);

  // Close drawer on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Close drawer when clicking any link inside it
  const close = () => setDrawerOpen(false);

  return (
    <>
      {/* ── Top nav bar (always visible across all breakpoints) ── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 px-3 md:px-8 h-16 flex items-center justify-between backdrop-blur-md shadow-lg shadow-black/20"
        style={{ background: 'linear-gradient(90deg, rgba(11,15,26,0.96) 0%, rgba(17,23,42,0.96) 50%, rgba(11,15,26,0.96) 100%)' }}>
        <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-amber-500 via-orange-500 to-emerald-500" />

        {/* Logo + brand */}
        <Link to="/" className="flex items-center gap-2.5 min-w-0">
          <div className="bg-white rounded-xl p-1.5 shadow-lg shadow-amber-500/30 ring-2 ring-amber-300/40 flex-shrink-0">
            <img src="/logo.jpg" alt="Goldenray Energy NZ" className="h-8 md:h-10 w-auto object-contain" />
          </div>
          <div className="leading-tight min-w-0 hidden xs:block">
            <div className="text-[11px] md:text-[13px] font-extrabold font-display tracking-tight text-white truncate">
              GOLDENRAY <span className="bg-gradient-to-r from-amber-300 via-orange-300 to-emerald-300 bg-clip-text text-transparent">ENERGY NZ</span>
            </div>
            <div className="hidden md:block text-[9px] text-amber-200/80 italic">Powering a Sustainable Future</div>
          </div>
        </Link>

        {/* Right cluster */}
        <div className="flex items-center gap-2 md:gap-3">
          {/* Phone — icon only on mobile, full label on desktop */}
          <a
            href="tel:+6421839356"
            className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 rounded-lg text-amber-300 hover:text-amber-200 hover:bg-white/5 transition"
            title="Call us">
            <Phone size={14} />
            <span className="hidden md:inline text-xs font-bold">+64 21 839 356</span>
          </a>

          {/* Primary CTA — Bill Analysis (always visible) */}
          <Link
            to="/bill-analysis"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 md:px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white text-xs md:text-sm font-bold transition shadow-md shadow-amber-500/30">
            <TrendingUp size={14} />
            <span className="hidden md:inline">See My 25-Year Savings</span>
            <span className="md:hidden">Bill Analysis</span>
          </Link>

          {/* Page-specific extras (e.g. shop cart button) */}
          {extras}

          {/* Hamburger — opens drawer */}
          <button
            onClick={() => setDrawerOpen(true)}
            className="w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white flex items-center justify-center transition"
            aria-label="Open menu">
            <Menu size={20} />
          </button>
        </div>
      </nav>

      {/* Spacer so page content doesn't sit under the fixed nav */}
      <div className="h-16" aria-hidden />

      {/* ── Drawer ── */}
      {drawerOpen && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={close}
            aria-hidden
          />
          <aside
            className="fixed top-0 right-0 bottom-0 z-[70] w-full max-w-md bg-white dark:bg-brand-dark shadow-2xl flex flex-col overflow-hidden"
            role="dialog" aria-label="Site menu">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-white/10 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
              <div className="flex items-center gap-2">
                <Sun size={18} className="text-amber-400" />
                <span className="text-sm font-extrabold tracking-wide">MENU</span>
              </div>
              <button
                onClick={close}
                className="w-9 h-9 rounded-lg hover:bg-white/10 flex items-center justify-center transition"
                aria-label="Close menu">
                <X size={18} />
              </button>
            </div>

            {/* Drawer body — scrollable */}
            <div className="flex-1 overflow-y-auto">
              {/* Primary actions — most prominent */}
              <div className="p-5 space-y-2 bg-gradient-to-b from-amber-50 to-white dark:from-amber-500/10 dark:to-brand-dark">
                <DrawerCTA to="/bill-analysis" icon={TrendingUp} label="See My 25-Year Savings" sub="Upload bills, get the most honest quote in NZ" onClick={close} primary />
                <DrawerCTA to="/solar-packages" icon={Package} label="Solar Packages" sub="Pre-designed systems with fixed pricing" onClick={close} />
                <DrawerCTA to="/shop" icon={ShoppingBag} label="Trade Shop" sub="For NZ electricians — wholesale + delivery" onClick={close} />
                <DrawerCTA onClickButton={() => { setFinanceOpen(true); close(); }} icon={DollarSign} label="Finance Options" sub="$0 upfront · Q Card · green loans" />
              </div>

              {/* About us */}
              <Section title="About Us">
                <DrawerLink href={a('mission')}      icon={Award}     label="Our Mission"           onClick={close} />
                <DrawerLink href={a('case-studies')} icon={FileText}  label="Case Studies"          onClick={close} />
                <DrawerLink href={a('testimonials')} icon={Users}     label="Testimonials"          onClick={close} />
                <DrawerLink href={a('partners')}     icon={Award}     label="Partners & Certifications" onClick={close} />
              </Section>

              {/* Resources */}
              <Section title="Resources">
                <DrawerLink href={a('how-it-works')} icon={HelpCircle} label="How It Works"          onClick={close} />
                <DrawerLink href={a('vpp')}          icon={Zap}        label="Future Earnings (VPP)" sub="Earn from your battery, from 2027" onClick={close} />
                <DrawerLink href={a('faq')}          icon={HelpCircle} label="FAQ"                   onClick={close} />
              </Section>

              {/* Contact */}
              <Section title="Get in Touch">
                <DrawerLink href="tel:+6421839356"        icon={Phone}        label="+64 21 839 356"     sub="Mon–Fri 8am–6pm · Sat 9am–1pm" />
                <DrawerLink href="mailto:hello@goldenrayenergy.co.nz" icon={Mail}  label="hello@goldenrayenergy.co.nz" />
                <DrawerLink href={a('callback')}       icon={MessageCircle} label="Request a callback" sub="Quick form, no bills needed" onClick={close} />
                <DrawerLink href={a('contact')}        icon={MapPin}      label="Level 3, 45 Queen St, Auckland" onClick={close} />
              </Section>

              {/* Footer of drawer */}
              <div className="p-5 border-t border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-brand-dark-1 mt-auto">
                <Link
                  to="/login"
                  onClick={close}
                  className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-300 transition">
                  <Lock size={11} />
                  Employee Login
                </Link>
              </div>
            </div>
          </aside>
        </>
      )}

      {/* Finance modal — accessible from drawer + can be opened by parent pages */}
      <FinanceModal open={financeOpen} onClose={() => setFinanceOpen(false)} />
    </>
  );
}

// ── Drawer building blocks ────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="px-5 py-4 border-t border-gray-100 dark:border-white/10">
      <div className="text-[10px] font-bold tracking-widest text-gray-400 dark:text-gray-500 uppercase mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function DrawerCTA({ to, onClickButton, icon: Icon, label, sub, onClick, primary }) {
  const cls = `flex items-start gap-3 px-3 py-2.5 rounded-lg transition ${
    primary
      ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400 shadow-md'
      : 'hover:bg-amber-50 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200'
  }`;
  const content = (
    <>
      <Icon size={18} className={primary ? 'text-white mt-0.5' : 'text-amber-500 mt-0.5 flex-shrink-0'} />
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-bold ${primary ? '' : 'dark:text-gray-100'}`}>{label}</div>
        {sub && <div className={`text-[11px] ${primary ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>{sub}</div>}
      </div>
      <ArrowRight size={14} className={`mt-1 flex-shrink-0 ${primary ? 'text-white' : 'text-gray-400'}`} />
    </>
  );
  if (to) return <Link to={to} onClick={onClick} className={cls}>{content}</Link>;
  return <button onClick={onClickButton} className={cls + ' w-full text-left'}>{content}</button>;
}

function DrawerLink({ href, icon: Icon, label, sub, onClick }) {
  return (
    <a
      href={href}
      onClick={onClick}
      className="flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-amber-50 dark:hover:bg-white/5 transition group">
      <Icon size={15} className="text-gray-400 group-hover:text-amber-500 mt-0.5 flex-shrink-0 transition" />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-gray-700 dark:text-gray-200 group-hover:text-amber-600 dark:group-hover:text-amber-300 transition">{label}</div>
        {sub && <div className="text-[10px] text-gray-400 dark:text-gray-500">{sub}</div>}
      </div>
    </a>
  );
}

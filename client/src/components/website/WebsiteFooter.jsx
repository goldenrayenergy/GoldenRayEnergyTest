import { Link } from 'react-router-dom';
import { Lock, ArrowLeft } from 'lucide-react';
import Button from '../ui/Button';
import { useAuth } from '../../context/AuthContext';

export default function WebsiteFooter({ homepage = true }) {
  // When on the homepage, anchor links scroll within the page.
  // On other public routes they must navigate to `/#anchor`.
  const anchor = (slug) => (homepage ? `#${slug}` : `/#${slug}`);
  const { user } = useAuth();
  const firstName = user?.name?.split(' ')[0] || '';

  return (
    <footer className="text-gray-300 px-4 md:px-16 py-10 md:py-12 relative overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 35%, #500724 70%, #7c2d12 100%)' }}>
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-pink-500 via-fuchsia-500 via-violet-500 to-teal-400" />
      <div className="absolute -top-20 right-1/4 w-72 h-72 rounded-full bg-gradient-to-br from-pink-500 to-violet-600 opacity-10 blur-3xl" />
      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 mb-8 relative">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-white rounded-xl p-1.5 shadow-lg shadow-amber-500/20 ring-2 ring-amber-300/30">
              <img src="/logo.jpg" alt="Goldenray Energy NZ" className="h-12 w-auto object-contain" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-extrabold font-display text-white tracking-tight">GOLDENRAY <span className="text-amber-400">ENERGY NZ</span></div>
              <div className="text-[9px] text-gray-400 italic">Powering a Sustainable Future</div>
            </div>
          </div>
          <p className="text-xs leading-relaxed">New Zealand's trusted solar specialists since 2018 — designing, installing, and supporting systems that deliver measurable savings and long-term energy independence.</p>
        </div>
        <div>
          <h4 className="text-xs font-bold text-white uppercase tracking-wide mb-3">Quick Links</h4>
          <div className="space-y-2">
            {['Products', 'Calculator', 'Case Studies', 'FAQ', 'Contact'].map(l => (
              <a key={l} href={anchor(l.toLowerCase().replace(/\s+/g, '-'))} className="block text-xs hover:text-amber-400 transition">{l}</a>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-xs font-bold text-white uppercase tracking-wide mb-3">Contact</h4>
          <div className="space-y-2 text-xs">
            <p>Level 3, 45 Queen St</p>
            <p>Auckland, New Zealand</p>
            <p className="text-amber-400">+64 21 839 356</p>
            <p className="text-amber-400">hello@goldenrayenergy.co.nz</p>
          </div>
        </div>
        <div>
          <h4 className="text-xs font-bold text-white uppercase tracking-wide mb-3">Follow Us</h4>
          <div className="grid grid-cols-2 gap-2">
            {[
              { name: 'Instagram', emoji: '📸' },
              { name: 'Facebook',  emoji: '👍' },
              { name: 'LinkedIn',  emoji: '💼' },
              { name: 'YouTube',   emoji: '▶️' },
              { name: 'TikTok',    emoji: '🎵' },
              { name: 'Twitter',   emoji: '🐦' },
            ].map(s => (
              <span key={s.name} className="flex items-center gap-1.5 text-xs hover:text-amber-400 cursor-pointer transition">
                <span>{s.emoji}</span> {s.name}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="max-w-5xl mx-auto border-t border-gray-800 pt-6 flex flex-wrap justify-between items-center gap-3 relative">
        <span className="text-[11px]">© 2026 Goldenray Energy NZ Ltd. All rights reserved. New Zealand.</span>
        <div className="flex items-center gap-4">
          <span className="text-[11px] hover:text-amber-400 cursor-pointer transition">Privacy Policy</span>
          <span className="text-[11px] hover:text-amber-400 cursor-pointer transition">Terms of Service</span>
          {user ? (
            <Link to="/portal" title={`Signed in as ${user.name}`}>
              <Button variant="dark" size="sm" icon={ArrowLeft}>Back to Portal · {firstName}</Button>
            </Link>
          ) : (
            <Link to="/login"><Button variant="dark" size="sm" icon={Lock}>Employee Portal</Button></Link>
          )}
        </div>
      </div>
    </footer>
  );
}

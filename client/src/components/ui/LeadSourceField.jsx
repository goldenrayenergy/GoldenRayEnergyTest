import { Search, Megaphone, Facebook, Instagram, Users, MoreHorizontal, Gift, User, Phone } from 'lucide-react';

const OPTIONS = [
  { value: 'online_search',   label: 'Online Search', Icon: Search },
  { value: 'google_ads',      label: 'Google Ads',    Icon: Megaphone },
  { value: 'facebook',        label: 'Facebook',      Icon: Facebook },
  { value: 'instagram',       label: 'Instagram',     Icon: Instagram },
  { value: 'friend_referral', label: 'Friend Referral', Icon: Users },
  { value: 'other',           label: 'Other',         Icon: MoreHorizontal },
];

export default function LeadSourceField({ form, onChange }) {
  const handle = (e) => onChange?.(e);

  return (
    <div>
      <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2 block">
        How did you hear about us? <span className="text-red-500">*</span>
      </label>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {OPTIONS.map(opt => {
          const selected = form.leadSource === opt.value;
          const { Icon } = opt;
          return (
            <label
              key={opt.value}
              className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer transition-all text-xs font-semibold
                ${selected ? 'border-amber-400 bg-amber-50 text-amber-700 ring-1 ring-amber-300' : 'border-gray-200 hover:bg-gray-50 text-gray-500'}`}
            >
              <input
                type="radio"
                name="leadSource"
                value={opt.value}
                checked={selected}
                onChange={handle}
                className="hidden"
              />
              <Icon size={12} />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>

      {/* Friend Referral — capture who referred them so we can credit the rewards program */}
      {form.leadSource === 'friend_referral' && (
        <div className="mt-3 p-3 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 space-y-2.5 animate-fade-in">
          <div className="flex items-start gap-2">
            <Gift size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-700 leading-snug">
              We'll thank them through our referral reward program. Both fields are required.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div className="relative">
              <User size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                name="referrerName"
                type="text"
                value={form.referrerName || ''}
                onChange={handle}
                placeholder="Referrer's full name *"
                className="w-full pl-7 pr-3 py-2 rounded-lg border border-amber-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition bg-white"
              />
            </div>
            <div className="relative">
              <Phone size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                name="referrerPhone"
                type="tel"
                value={form.referrerPhone || ''}
                onChange={handle}
                placeholder="Referrer's phone *"
                className="w-full pl-7 pr-3 py-2 rounded-lg border border-amber-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* Other — single free-text */}
      {form.leadSource === 'other' && (
        <div className="mt-3 animate-fade-in">
          <input
            name="leadSourceOther"
            type="text"
            value={form.leadSourceOther || ''}
            onChange={handle}
            placeholder="Tell us briefly how you found us…"
            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 transition"
          />
        </div>
      )}
    </div>
  );
}

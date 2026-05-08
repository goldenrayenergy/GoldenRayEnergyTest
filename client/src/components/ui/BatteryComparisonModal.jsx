import { X, Battery, Zap, CheckCircle, XCircle } from 'lucide-react';

const ROWS = [
  {
    label: "What's included",
    with: 'Solar panels + grid-tied inverter + battery storage (Tesla Powerwall, Fronius Reserva, BYD)',
    without: 'Solar panels + grid-tied inverter only',
  },
  {
    label: 'Backup during power outages',
    with: 'Yes — keeps essentials running when the grid goes down',
    without: 'No — system shuts off automatically with the grid',
    withIcon: 'check', withoutIcon: 'x',
  },
  {
    label: 'Self-consumption of solar power',
    with: '~80–95% (use stored energy at night & on cloudy days)',
    without: '~30–40% (excess sold back to the grid at low rates)',
  },
  {
    label: 'Best suited for',
    with: 'Energy independence, frequent outages, future-proofing',
    without: 'Lower upfront cost, daytime usage, simpler systems',
  },
  {
    label: 'Indicative cost (NZ)',
    with: 'Adds ~$10,000–$20,000 NZD on top of base solar',
    without: 'Base solar system price',
  },
];

export default function BatteryComparisonModal({ open, onClose, onChoose }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-bold font-display">Battery vs No-Battery — How They Differ</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">Choose the right setup for your home and budget.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Side-by-side comparison */}
        <div className="grid md:grid-cols-2 gap-3 p-4">
          {/* With Battery */}
          <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/40 p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <div className="bg-emerald-500 text-white rounded-lg p-1.5"><Battery size={16} /></div>
              <h3 className="font-bold text-sm font-display">With Battery</h3>
            </div>
            <ul className="space-y-2.5 flex-1">
              {ROWS.map((r, i) => (
                <li key={i} className="text-[11px]">
                  <div className="font-semibold text-gray-500 uppercase tracking-wide text-[9px] mb-0.5">{r.label}</div>
                  <div className="flex items-start gap-1.5 text-gray-700">
                    {r.withIcon === 'check' && <CheckCircle size={11} className="mt-0.5 flex-shrink-0 text-emerald-500" />}
                    <span>{r.with}</span>
                  </div>
                </li>
              ))}
            </ul>
            <button
              onClick={() => { onChoose?.('with-battery'); onClose(); }}
              className="mt-4 w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-bold transition"
            >
              Choose With Battery
            </button>
          </div>

          {/* Without Battery */}
          <div className="rounded-xl border-2 border-amber-200 bg-amber-50/40 p-4 flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <div className="bg-amber-500 text-white rounded-lg p-1.5"><Zap size={16} /></div>
              <h3 className="font-bold text-sm font-display">Without Battery</h3>
            </div>
            <ul className="space-y-2.5 flex-1">
              {ROWS.map((r, i) => (
                <li key={i} className="text-[11px]">
                  <div className="font-semibold text-gray-500 uppercase tracking-wide text-[9px] mb-0.5">{r.label}</div>
                  <div className="flex items-start gap-1.5 text-gray-700">
                    {r.withoutIcon === 'x' && <XCircle size={11} className="mt-0.5 flex-shrink-0 text-gray-400" />}
                    <span>{r.without}</span>
                  </div>
                </li>
              ))}
            </ul>
            <button
              onClick={() => { onChoose?.('without-battery'); onClose(); }}
              className="mt-4 w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold transition"
            >
              Choose Without Battery
            </button>
          </div>
        </div>

        <div className="px-5 pb-4">
          <p className="text-[10px] text-gray-400 leading-relaxed">
            Not sure which is right for you? Tick "Call me to discuss" further down the form — our team will help you choose based on your usage, roof and budget.
          </p>
        </div>
      </div>
    </div>
  );
}

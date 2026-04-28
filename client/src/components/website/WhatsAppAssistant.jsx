import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const WA_NUMBER = '6421839356';
const WA_MESSAGE = "Hi GoldenRay — I'd like a solar quote for my home or business. Could you walk me through the next steps?";

const WhatsAppIcon = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
    <path d="M16.002 3C9.374 3 4 8.373 4 15c0 2.39.682 4.62 1.855 6.497L4 29l7.702-1.824A11.97 11.97 0 0 0 16 27c6.627 0 12-5.373 12-12s-5.37-12-11.998-12Zm0 21.818a9.82 9.82 0 0 1-5.01-1.377l-.36-.214-4.57 1.082 1.096-4.452-.234-.376A9.814 9.814 0 1 1 16.002 24.818Zm5.646-7.37c-.31-.155-1.83-.903-2.114-1.005-.284-.103-.49-.155-.698.155-.207.31-.8 1.005-.98 1.212-.18.207-.36.233-.67.078-.31-.155-1.308-.482-2.49-1.536-.92-.82-1.54-1.832-1.72-2.142-.18-.31-.02-.477.136-.632.14-.138.31-.36.466-.54.155-.18.207-.31.31-.517.103-.207.052-.388-.025-.543-.077-.155-.698-1.684-.957-2.308-.252-.605-.508-.523-.698-.533l-.595-.01c-.207 0-.543.077-.828.388-.284.31-1.085 1.06-1.085 2.584 0 1.525 1.111 2.998 1.266 3.205.155.207 2.187 3.34 5.297 4.684.74.32 1.317.51 1.767.653.742.236 1.418.203 1.951.123.595-.09 1.83-.748 2.09-1.47.258-.723.258-1.343.18-1.47-.076-.13-.283-.207-.593-.362Z"/>
  </svg>
);

export default function WhatsAppAssistant() {
  const [tipOpen, setTipOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('wa_tip_dismissed') === '1') { setDismissed(true); return; }
    const t = setTimeout(() => setTipOpen(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const handleDismiss = (e) => {
    e.stopPropagation();
    setTipOpen(false);
    setDismissed(true);
    sessionStorage.setItem('wa_tip_dismissed', '1');
  };

  const handleClick = () => {
    setTipOpen(false);
    sessionStorage.setItem('wa_tip_dismissed', '1');
    const url = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(WA_MESSAGE)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      {tipOpen && !dismissed && (
        <div className="fixed bottom-24 left-6 z-50 w-[280px] bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 pr-8 animate-fade-in">
          <button onClick={handleDismiss}
            className="absolute top-2 right-2 w-6 h-6 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition">
            <X size={12} />
          </button>
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center flex-shrink-0 text-white shadow-md">
              <WhatsAppIcon size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-gray-800">GoldenRay Support</p>
              <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">
                Message us on WhatsApp for a same-day solar quote.
              </p>
            </div>
          </div>
          <button onClick={handleClick}
            className="mt-3 w-full py-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 text-white text-xs font-bold shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center justify-center gap-1.5">
            <WhatsAppIcon size={13} /> Start Chat
          </button>
          <div className="absolute -bottom-2 left-7 w-4 h-4 bg-white border-r border-b border-gray-100 rotate-45" />
        </div>
      )}

      <button onClick={handleClick} title="Chat with us on WhatsApp"
        className="fixed bottom-6 left-6 z-50 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 bg-gradient-to-br from-green-500 to-emerald-600 text-white">
        <span className="absolute inset-0 rounded-full bg-green-400 opacity-60 animate-ping" />
        <WhatsAppIcon size={28} />
      </button>
    </>
  );
}

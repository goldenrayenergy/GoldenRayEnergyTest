// ReferralPanel — Phase 3 Session 2 (2026-08-22)
//
// Renders inline on the Step 5 confirmation screen when the customer
// clicks "Refer a friend, save $250". Fetches the referral status from
// GET /api/referrals/status?token=<shareToken>, shows the customer their
// unique link + one-click share buttons + rolling credit stats.
//
// Authenticated via the projects_v2.share_token that Step 5 already has
// (`submitted.shareToken`). No login, no OTP.
//
// The status endpoint is idempotent — it auto-creates the customer's
// referral code on first call. So the panel doesn't need a separate
// "generate" click; opening the panel IS the generation.

import { useEffect, useState, useCallback } from 'react';
import { Copy, Check, MessageCircle, Mail, Loader2, Gift, X } from 'lucide-react';
import { publicApi } from '../../services/api';

export default function ReferralPanel({ shareToken, onClose }) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [copied, setCopied] = useState(false);

  // Fetch on mount. shareToken should always be present when this panel
  // is rendered (Step 5 doesn't show the CTA until submit succeeded),
  // but guard anyway.
  useEffect(() => {
    if (!shareToken) {
      setState({ loading: false, data: null, error: 'Referral link unavailable — please refresh.' });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await publicApi.get('/referrals/status', {
          params: { token: shareToken },
        });
        if (!cancelled) setState({ loading: false, data, error: null });
      } catch (e) {
        if (cancelled) return;
        const msg = e.response?.data?.error || e.message || 'Could not load your referral link.';
        setState({ loading: false, data: null, error: msg });
      }
    })();
    return () => { cancelled = true; };
  }, [shareToken]);

  const codeText = state.data?.code?.code || '';
  const referralUrl = codeText
    ? `${window.location.origin}/get-quote?ref=${codeText}`
    : '';
  const shareMessage = codeText
    ? `Hey — I just switched to solar with GoldenRay Energy and thought you'd be interested. Use my link and we both get $250: ${referralUrl}`
    : '';

  const handleCopy = useCallback(async () => {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard API blocked (rare — Safari private mode); fall back to
      // focusing the input so user can Cmd/Ctrl+C manually.
      const input = document.getElementById('gr-ref-link-input');
      if (input) { input.select(); }
    }
  }, [referralUrl]);

  const handleWhatsApp = useCallback(() => {
    if (!shareMessage) return;
    const url = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [shareMessage]);

  const handleEmail = useCallback(() => {
    if (!shareMessage) return;
    const subject = encodeURIComponent('Thought you might want $250 off solar');
    const body    = encodeURIComponent(shareMessage);
    // mailto: doesn't need window.open — the OS handles the handoff.
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }, [shareMessage]);

  return (
    <div className="mt-6 rounded-2xl border-2 border-purple-300 bg-gradient-to-br from-purple-50 via-white to-purple-50 dark:from-purple-950/30 dark:via-brand-dark dark:to-purple-950/30 p-6 md:p-7 print:hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-purple-600 grid place-items-center flex-shrink-0">
            <Gift className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-purple-700 dark:text-purple-300 font-bold">
              Refer a friend
            </div>
            <h3 className="font-serif text-xl md:text-2xl font-bold text-[#1A1614] dark:text-white">
              $250 for you. $250 for them.
            </h3>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-purple-100 dark:hover:bg-purple-900/40 text-[#8F887E]"
          aria-label="Close referral panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {state.loading && (
        <div className="py-8 flex items-center justify-center gap-2 text-[#8F887E]">
          <Loader2 className="w-4 h-4 animate-spin" /> Getting your link…
        </div>
      )}

      {state.error && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
          {state.error}
        </div>
      )}

      {state.data && !state.loading && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <MiniStat
              label="Referrals used"
              value={`${state.data.stats.used_in_window} / ${state.data.stats.cap}`}
              hint="per year"
            />
            <MiniStat
              label="Pending credit"
              value={centsToNzd(state.data.stats.pending_credit_cents)}
              hint="unlocks at install"
            />
            <MiniStat
              label="Paid credit"
              value={centsToNzd(state.data.stats.paid_credit_cents)}
              hint="cheques mailed"
            />
          </div>

          {/* Link + copy */}
          <div className="rounded-xl bg-white dark:bg-brand-dark/60 border border-purple-200 dark:border-purple-800 p-4">
            <div className="text-[10px] uppercase tracking-widest text-[#8F887E] font-semibold mb-1.5">
              Your unique link
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="gr-ref-link-input"
                readOnly
                value={referralUrl}
                className="flex-1 px-3 py-2 rounded-lg border border-[#E3D9C4] dark:border-gray-700 bg-[#F4EEE1] dark:bg-brand-dark font-mono text-xs md:text-sm text-[#1A1614] dark:text-white overflow-x-auto"
                onClick={(e) => e.target.select()}
              />
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold transition whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" /> Copy link
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Share buttons */}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleWhatsApp}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border-2 border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-800 text-sm font-semibold transition"
            >
              <MessageCircle className="w-4 h-4" /> Share via WhatsApp
            </button>
            <button
              type="button"
              onClick={handleEmail}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border-2 border-blue-300 bg-white hover:bg-blue-50 text-blue-800 text-sm font-semibold transition"
            >
              <Mail className="w-4 h-4" /> Share via email
            </button>
          </div>

          {/* Fine print */}
          <div className="mt-5 pt-4 border-t border-purple-200 dark:border-purple-800 text-xs text-[#8F887E] dark:text-gray-500 leading-relaxed">
            Your credit unlocks when your friend&apos;s system is installed —
            we&apos;ll mail you a cheque within 30 days after install completion.
            Credits expire 6 months after unlock, and there&apos;s a max of{' '}
            {state.data.stats.cap} successful referrals per rolling year. Referrals
            using the same email or phone as your contact are automatically
            flagged for review.
          </div>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value, hint }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[#8F887E] font-semibold">{label}</div>
      <div className="text-lg md:text-xl font-bold text-purple-800 dark:text-purple-300 tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-[#8F887E] mt-0.5">{hint}</div>}
    </div>
  );
}

function centsToNzd(cents) {
  const dollars = Math.round((cents || 0) / 100);
  return `$${dollars.toLocaleString('en-NZ')}`;
}

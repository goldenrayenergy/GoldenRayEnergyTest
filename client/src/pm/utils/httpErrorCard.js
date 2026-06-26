// ────────────────────────────────────────────────────────────────────────────
// HTTP / action error → catalogue card.
//
// The global safety net: turn ANY failed request or action into a plain-language
// ErrorCard entry — system-layer errors (offline, session, permission, server)
// by status code, and known server messages (convert/generate/discount/ship) by
// content. Anything unrecognised still returns the FALLBACK card, so a raw error
// never reaches a rep.
//
// Returns { entry, detail } — spread straight into <ErrorCard>.
// ────────────────────────────────────────────────────────────────────────────
import { lookupError } from './errorCatalogue';

// Map a server/error MESSAGE string to a catalogue entry. These are top-level
// API messages (not the coded engineering findings) — a small, centralised set.
export function cardFromServerMessage(msg, detail) {
  const m = String(msg || '');
  const pick = (code) => ({ entry: lookupError(code), detail: detail || m });

  if (/Collapsed spec failed/i.test(m))                       return pick('convert_failed');
  if (/site.?survey|site_survey/i.test(m))                    return pick('generate_needs_site_survey');
  if (/cannot ship/i.test(m))                                 return pick('quote_cannot_ship');
  if (/owner.?approved|discount/i.test(m))                    return pick('discount_needs_approval');
  if (/margin|below.?floor/i.test(m))                         return pick('margin_below_floor');
  if (/permission|forbidden|not allowed|admin only/i.test(m)) return pick('permission_denied');
  if (/session|unauthor|token|expired|please log ?in/i.test(m)) return pick('session_expired');
  if (/tier.?(mode|sizing)/i.test(m))                         return pick('tier_mode_not_allowed');
  // Unknown message → FALLBACK card (still no raw error on screen).
  return { entry: lookupError(null), detail: detail || m };
}

// Map an axios/fetch error OBJECT to a catalogue entry — status-aware, with the
// server message + any block_reasons folded into the technical detail.
export function cardFromHttpError(err) {
  // No response → the request never reached the server (offline / DNS / CORS).
  if (err && !err.response && (err.request || /network|fetch|timeout/i.test(err.message || ''))) {
    return { entry: lookupError('network_offline'), detail: err.message || 'No response from server.' };
  }

  const status = err?.response?.status;
  const serverMsg = err?.response?.data?.error || err?.message || 'Request failed';
  const blockReasons = err?.response?.data?.block_reasons;
  const detail = [serverMsg, ...(Array.isArray(blockReasons) ? blockReasons : [])]
    .filter(Boolean).join('\n');

  if (status === 401) return { entry: lookupError('session_expired'),   detail };
  if (status === 403) return { entry: lookupError('permission_denied'), detail };
  if (status === 408) return { entry: lookupError('network_offline'),   detail };
  if (status >= 500)  return { entry: lookupError('save_failed_server'),detail };

  // 4xx (400/409/422…) → decide by message, keep the full detail.
  return { ...cardFromServerMessage(serverMsg, detail) };
}

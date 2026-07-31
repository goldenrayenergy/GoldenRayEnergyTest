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
// server message + any block_reasons + any config_errors folded into the
// technical detail.
//
// config_errors is the primary refusal payload from the engine (422 responses
// from /generate, /preview-validate) — a list of { path, message } describing
// specific fields the engine needs before it can accept the spec. Rendering
// them turns a useless "Engine refused current spec." card into an actionable
// "here's what to fix: cable run measured, roof pitch, ..." card.
export function cardFromHttpError(err) {
  // No response → the request never reached the server (offline / DNS / CORS).
  if (err && !err.response && (err.request || /network|fetch|timeout/i.test(err.message || ''))) {
    return { entry: lookupError('network_offline'), detail: err.message || 'No response from server.' };
  }

  const status = err?.response?.status;
  const serverMsg = err?.response?.data?.error || err?.message || 'Request failed';
  const blockReasons = err?.response?.data?.block_reasons;
  const configErrors = err?.response?.data?.config_errors;

  // Format config_errors as human lines: "cable_run_metres: required"
  // Falls back to the raw item if path/message aren't both present.
  const configLines = Array.isArray(configErrors)
    ? configErrors.map(e => {
        if (typeof e === 'string') return e;
        if (e?.path && e?.message) return `${e.path}: ${e.message}`;
        if (e?.message) return e.message;
        if (e?.path)    return `${e.path}: (missing detail)`;
        try { return JSON.stringify(e); } catch { return String(e); }
      })
    : [];

  const detail = [
    serverMsg,
    ...(Array.isArray(blockReasons) ? blockReasons : []),
    ...configLines,
  ].filter(Boolean).join('\n');

  if (status === 401) return { entry: lookupError('session_expired'),   detail };
  if (status === 403) return { entry: lookupError('permission_denied'), detail };
  if (status === 408) return { entry: lookupError('network_offline'),   detail };
  if (status >= 500)  return { entry: lookupError('save_failed_server'),detail };

  // 4xx (400/409/422…) — prefer routing by config_errors content when
  // present (e.g. site_survey.* paths → 'generate_needs_site_survey'),
  // else fall back to server-message-based routing.
  if (configErrors?.length && configLines.some(l => /site.?survey|site_survey/i.test(l))) {
    return { entry: lookupError('generate_needs_site_survey'), detail };
  }
  return { ...cardFromServerMessage(serverMsg, detail) };
}

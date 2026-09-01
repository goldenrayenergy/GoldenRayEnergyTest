// Pure helper for building server-hosted image URLs (satellite tiles,
// streetview) that the browser loads via <img src> — as opposed to
// axios-fetched JSON APIs which use `api.js`'s baseURL.
//
// Fix (2026-09-01) — the aerial-image tags (Aerial2DPanelView, roof-
// material picker Streetview) were coded with plain relative paths
// like `/api/aerial/google?...`. On localhost:5173 that works because
// Vite's dev-proxy forwards `/api/*` to `localhost:5000`. On the
// Vercel-frontend/Render-backend prod setup there IS no such proxy —
// Vercel serves index.html for any unrecognised path (SPA fallback),
// so the browser downloads a 980-byte HTML doc, tries to render it as
// a JPEG, and shows a blank/broken image tile.
//
// axios calls already handle this via `VITE_API_BASE_URL` (see
// services/api.js). Image tags need the same treatment, but they can't
// share the axios instance directly — they're static `src` attributes,
// not runtime `fetch` calls.
//
// This helper accepts the base URL + path and returns a fully-qualified
// URL. Kept as a pure function (no Vite `import.meta.env`) so it can
// unit-test under Node.

/**
 * @param {string} baseUrl  the API root — e.g. 'https://api.example.com' —
 *                          or empty string/null for localhost dev (uses
 *                          relative path)
 * @param {string} path     the request path, e.g. '/api/aerial/google?...'
 *                          — MUST include the leading slash
 * @returns {string}        absolute URL when baseUrl set, relative when not
 */
export function buildApiImageUrl(baseUrl, path) {
  // Strip trailing slashes from base so we don't produce host//api/foo.
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '');
  const safePath  = typeof path === 'string' ? path : '';
  return `${cleanBase}${safePath}`;
}

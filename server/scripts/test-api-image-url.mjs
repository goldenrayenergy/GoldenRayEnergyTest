// Unit tests for buildApiImageUrl — the helper that prefixes
// VITE_API_BASE_URL onto server-hosted <img src> URLs.
//
// Fix (2026-09-01) — Aerial2DPanelView's satellite tile + QuotePage's
// Streetview image were plain `/api/aerial/*` relative paths that broke
// on Vercel-frontend/Render-backend prod (Vercel served index.html for
// unknown paths, browser tried to render HTML as JPEG, blank tiles).

import { buildApiImageUrl } from '../../client/src/services/apiImageUrl.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};

// ── Empty base (localhost dev) — keep relative path unchanged ────────────
console.log('\n── Empty base URL (localhost dev) ──');
{
  assert(buildApiImageUrl('', '/api/aerial/google?lat=-41&lng=174') === '/api/aerial/google?lat=-41&lng=174',
    'empty string base → returns path unchanged (Vite dev proxy handles it)');
  assert(buildApiImageUrl(null, '/api/foo') === '/api/foo',
    'null base → treated as empty');
  assert(buildApiImageUrl(undefined, '/api/foo') === '/api/foo',
    'undefined base → treated as empty');
}

// ── Real prod base URL ───────────────────────────────────────────────────
console.log('\n── Prod base URL prefix ──');
{
  const base = 'https://golden-ray-energy-test-api.onrender.com';
  const path = '/api/aerial/google?lat=-41.3&lng=174.7';
  assert(buildApiImageUrl(base, path) === 'https://golden-ray-energy-test-api.onrender.com/api/aerial/google?lat=-41.3&lng=174.7',
    'production base + path → full absolute URL');
}

// ── Trailing slash on base — stripped so we don't get //api ──────────────
console.log('\n── Trailing slash handling ──');
{
  assert(buildApiImageUrl('https://api.example.com/', '/api/foo') === 'https://api.example.com/api/foo',
    'single trailing slash → stripped');
  assert(buildApiImageUrl('https://api.example.com///', '/api/foo') === 'https://api.example.com/api/foo',
    'multiple trailing slashes → all stripped');
  assert(buildApiImageUrl('https://api.example.com', '/api/foo') === 'https://api.example.com/api/foo',
    'no trailing slash → unchanged behaviour');
}

// ── Real production URL builder — verifies the exact string a browser sees
console.log('\n── Regression: exact image URLs sent by production browser ──');
{
  // Aerial2DPanelView produces this shape.
  const aerialUrl = buildApiImageUrl(
    'https://golden-ray-energy-test-api.onrender.com',
    '/api/aerial/google?lat=-41.30232&lng=174.77304&zoom=20&size=640x640&marker=0',
  );
  assert(aerialUrl.startsWith('https://'),
    'aerial URL is absolute (browser routes to Render, not Vercel)');
  assert(aerialUrl.includes('/api/aerial/google?'),
    'aerial URL preserves the path + query correctly');

  // QuotePage's MaterialStage streetview.
  const svUrl = buildApiImageUrl(
    'https://golden-ray-energy-test-api.onrender.com',
    '/api/aerial/streetview?lat=-41.3&lng=174.7&size=640x480&pitch=15',
  );
  assert(svUrl === 'https://golden-ray-energy-test-api.onrender.com/api/aerial/streetview?lat=-41.3&lng=174.7&size=640x480&pitch=15',
    'streetview URL exact-match check');
}

// ── Edge cases ───────────────────────────────────────────────────────────
console.log('\n── Edge cases ──');
{
  assert(buildApiImageUrl('', '') === '',
    'both empty → empty string (defensive, no crash)');
  assert(buildApiImageUrl('https://api.com', '') === 'https://api.com',
    'empty path + base → base returned (no crash)');
  assert(buildApiImageUrl('https://api.com', null) === 'https://api.com',
    'null path → treated as empty');
  assert(typeof buildApiImageUrl(42, '/api/foo') === 'string',
    'non-string base → still returns a string (no crash)');
}

console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);

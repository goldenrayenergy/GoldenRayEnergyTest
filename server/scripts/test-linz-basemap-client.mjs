// ────────────────────────────────────────────────────────────────────────────
// test-linz-basemap-client.mjs
//
// Offline unit tests for server/services/linz/basemapClient.js.
// Verifies URL construction, response parsing, error handling, and boundary
// validation. All HTTP calls go through an injected fake fetch.
//
// Runner: server/scripts/run-regression.mjs
// ────────────────────────────────────────────────────────────────────────────

import { createBasemapClient } from '../services/linz/basemapClient.js';

let pass = 0, fail = 0;
const failures = [];
function assert(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? '  ← ' + detail : ''}`); }
}
console.log('test-linz-basemap-client\n');

// Fake fetch factory — records the last call + returns configurable response.
function makeFakeFetch(response = { ok: true, status: 200, body: 'RGB', contentType: 'image/webp' }) {
  const state = { calls: [] };
  const fake = async (url, opts) => {
    state.calls.push({ url, opts });
    if (response.throw) throw response.throw;
    const body = Buffer.from(response.body || '');
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText || (response.ok ? 'OK' : 'ERR'),
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      text: async () => body.toString(),
      headers: { get: (k) => k === 'content-type' ? (response.contentType || 'image/webp') : null },
    };
  };
  return { fake, state };
}

// ── Factory validation ────────────────────────────────────────────────────
{
  console.log('\n▸ createBasemapClient — boundary checks');
  let thrown = false;
  try { createBasemapClient({}); } catch (e) { thrown = /apiKey required/.test(e.message); }
  assert('no apiKey → throws', thrown);

  thrown = false;
  try { createBasemapClient({ apiKey: 'k', fetch: null }); } catch (e) { thrown = /fetch is required/.test(e.message); }
  assert('no fetch → throws', thrown);

  const c = createBasemapClient({ apiKey: 'test-key', fetch: () => {} });
  assert('valid config → returns client', typeof c.fetchTile === 'function');
  assert('exposes getBaseUrl', c.getBaseUrl() === 'https://basemaps.linz.govt.nz');
  assert('exposes getTileFormat', c.getTileFormat() === 'webp');
}

// ── fetchTile URL construction ────────────────────────────────────────────
{
  console.log('\n▸ fetchTile — URL construction');
  const { fake, state } = makeFakeFetch();
  const c = createBasemapClient({ apiKey: 'testkey123', fetch: fake });
  await c.fetchTile({ z: 20, x: 512345, y: 678901 });
  const url = state.calls[0].url;
  assert('URL includes base', url.startsWith('https://basemaps.linz.govt.nz'));
  assert('URL includes aerial layer', url.includes('/v1/tiles/aerial/EPSG:3857/'));
  assert('URL includes z/x/y', url.includes('/20/512345/678901.'));
  assert('URL includes tile format', url.includes('.webp'));
  assert('URL includes api key', url.includes('?api=testkey123'));
}

{
  console.log('\n▸ fetchTile — custom baseUrl + format');
  const { fake, state } = makeFakeFetch();
  const c = createBasemapClient({
    apiKey: 'k', fetch: fake,
    baseUrl: 'https://custom.example',
    tileFormat: 'png',
  });
  await c.fetchTile({ z: 5, x: 1, y: 2 });
  const url = state.calls[0].url;
  assert('uses custom base', url.startsWith('https://custom.example'));
  assert('uses custom format', url.includes('.png'));
}

// ── fetchTile — boundary validation ───────────────────────────────────────
{
  console.log('\n▸ fetchTile — boundary validation');
  const c = createBasemapClient({ apiKey: 'k', fetch: () => {} });

  async function throws(args, pattern) {
    try { await c.fetchTile(args); return false; }
    catch (e) { return pattern.test(e.message); }
  }

  assert('z=-1 → throws', await throws({ z: -1, x: 0, y: 0 }, /z must be integer 0\.\.22/));
  assert('z=23 → throws', await throws({ z: 23, x: 0, y: 0 }, /z must be integer 0\.\.22/));
  assert('z=15.5 → throws', await throws({ z: 15.5, x: 0, y: 0 }, /z must be integer 0\.\.22/));
  assert('x=-1 → throws', await throws({ z: 15, x: -1, y: 0 }, /x must be non-negative/));
  assert('y=-1 → throws', await throws({ z: 15, x: 0, y: -1 }, /y must be non-negative/));
  assert('x=1.5 → throws', await throws({ z: 15, x: 1.5, y: 0 }, /x must be non-negative integer/));
}

// ── fetchTile — success + error paths ─────────────────────────────────────
{
  console.log('\n▸ fetchTile — success returns buffer');
  const { fake } = makeFakeFetch({ ok: true, status: 200, body: 'PNGBYTES', contentType: 'image/png' });
  const c = createBasemapClient({ apiKey: 'k', fetch: fake });
  const r = await c.fetchTile({ z: 10, x: 5, y: 5 });
  assert('ok=true', r.ok === true);
  assert('buffer present', Buffer.isBuffer(r.buffer));
  assert('buffer contents match', r.buffer.toString() === 'PNGBYTES');
  assert('contentType preserved', r.contentType === 'image/png');
}

{
  console.log('\n▸ fetchTile — HTTP 404');
  const { fake } = makeFakeFetch({ ok: false, status: 404, statusText: 'Not Found', body: 'tile missing' });
  const c = createBasemapClient({ apiKey: 'k', fetch: fake });
  const r = await c.fetchTile({ z: 22, x: 0, y: 0 });
  assert('ok=false', r.ok === false);
  assert('status=404', r.status === 404);
  assert('error includes 404 code', /404/.test(r.error));
  assert('error includes body snippet', /tile missing/.test(r.error));
}

{
  console.log('\n▸ fetchTile — HTTP 429 (rate limit)');
  const { fake } = makeFakeFetch({ ok: false, status: 429, statusText: 'Too Many Requests', body: 'rate limit exceeded' });
  const c = createBasemapClient({ apiKey: 'k', fetch: fake });
  const r = await c.fetchTile({ z: 15, x: 10, y: 10 });
  assert('ok=false', r.ok === false);
  assert('status=429', r.status === 429);
}

{
  console.log('\n▸ fetchTile — network error');
  const { fake } = makeFakeFetch({ throw: new Error('ENOTFOUND') });
  const c = createBasemapClient({ apiKey: 'k', fetch: fake, logger: { warn: () => {} } });
  const r = await c.fetchTile({ z: 15, x: 10, y: 10 });
  assert('ok=false', r.ok === false);
  assert('status=0 for network error', r.status === 0);
  assert('error includes DNS message', /ENOTFOUND/.test(r.error));
}

{
  console.log('\n▸ fetchTile — timeout');
  const timeoutErr = new Error('The operation was aborted');
  timeoutErr.name = 'AbortError';
  const { fake } = makeFakeFetch({ throw: timeoutErr });
  const c = createBasemapClient({ apiKey: 'k', fetch: fake, timeoutMs: 100, logger: { warn: () => {} } });
  const r = await c.fetchTile({ z: 15, x: 10, y: 10 });
  assert('ok=false', r.ok === false);
  assert('error mentions timeout', /timeout/i.test(r.error));
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.detail}`));
  process.exit(1);
}

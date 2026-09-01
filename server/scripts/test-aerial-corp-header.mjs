// Unit test: aerial routes must send Cross-Origin-Resource-Policy:
// cross-origin so browsers on a different origin (vercel.app frontend
// vs onrender.com backend) can render the satellite/streetview images
// via <img src>.
//
// Regression test for the 2026-09-01 "blank tile" bug: Helmet's default
// CORP=same-origin was silently blocking cross-origin image embedding —
// fetch succeeded (200 image/png), CORS headers were correct, but the
// browser refused to display the resource because CORP restricted
// embedding to same-origin pages only.

import { aerialRouter } from '../routes/roof.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};

console.log('\n── aerialRouter: CORP override middleware ──');
{
  // The router's stack starts with our CORP-override middleware. Invoke
  // it directly with mock req/res to verify it sets the header.
  const stack = aerialRouter.stack;
  assert(Array.isArray(stack) && stack.length > 0, 'aerialRouter has middleware stack');

  // First layer should be our anonymous middleware (a `use` handler
  // registered before the .get() routes). Find any layer whose handle
  // is a plain function (not a specific route).
  const middlewareLayer = stack.find(l => !l.route && typeof l.handle === 'function');
  assert(!!middlewareLayer, 'router has a use-middleware layer registered');

  // Invoke it with mocks + verify header set.
  const setHeaders = {};
  const mockReq = { headers: {}, method: 'GET' };
  const mockRes = {
    setHeader(name, value) { setHeaders[name] = value; },
    getHeader(name) { return setHeaders[name]; },
  };
  let nextCalled = false;
  middlewareLayer.handle(mockReq, mockRes, () => { nextCalled = true; });

  assert(setHeaders['Cross-Origin-Resource-Policy'] === 'cross-origin',
    `sets CORP header to 'cross-origin' (got: ${setHeaders['Cross-Origin-Resource-Policy']})`);
  assert(nextCalled === true,
    'calls next() to continue middleware chain');
}

console.log('\n── Header value MUST be exactly "cross-origin" ──');
{
  // Guards against typos or drift — the browser only accepts these
  // exact strings: 'same-origin', 'same-site', 'cross-origin'.
  const validValues = ['same-origin', 'same-site', 'cross-origin'];
  const setHeaders = {};
  const mockRes = { setHeader(n, v) { setHeaders[n] = v; }, getHeader(n) { return setHeaders[n]; } };
  const middleware = aerialRouter.stack.find(l => !l.route && typeof l.handle === 'function').handle;
  middleware({ headers: {} }, mockRes, () => {});

  const value = setHeaders['Cross-Origin-Resource-Policy'];
  assert(validValues.includes(value),
    `header value is one of ${validValues.join('|')} (got: ${value})`);
  assert(value !== 'same-origin',
    'header value is NOT same-origin (the whole point of the fix)');
}

console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);

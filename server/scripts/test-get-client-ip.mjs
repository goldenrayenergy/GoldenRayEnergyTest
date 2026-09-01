// Unit tests for getClientIp + isPrivateIp — the helpers that survive
// multi-hop proxy chains (Vercel edge → Render proxy → Express).
//
// Verifies fix (2026-09-01) for the rate-limit bug where req.ip returned
// Render's internal 10.x proxy IP instead of the customer's real public
// IP → rate limit counters spread across rotating internal IPs → cap
// unenforceable in practice.

import { getClientIp, isPrivateIp } from '../middleware/getClientIp.js';

let pass = 0, fail = 0;
const assert = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else      { fail++; console.error(`  ✗ ${msg}`); }
};

// ── isPrivateIp: IPv4 ─────────────────────────────────────────────────────
console.log('\n── isPrivateIp: IPv4 ranges ──');
{
  // RFC 1918 private
  assert(isPrivateIp('10.198.108.133') === true,      '10.x.x.x → private (Render proxy IP that broke us)');
  assert(isPrivateIp('10.0.0.1') === true,            '10.0.0.1 → private');
  assert(isPrivateIp('172.16.0.1') === true,          '172.16.x → private');
  assert(isPrivateIp('172.31.255.255') === true,      '172.31.x → private');
  assert(isPrivateIp('192.168.1.1') === true,         '192.168.x → private');
  // Loopback + special
  assert(isPrivateIp('127.0.0.1') === true,           '127.x → loopback (private)');
  assert(isPrivateIp('169.254.1.1') === true,         '169.254.x → link-local (private)');
  assert(isPrivateIp('0.0.0.0') === true,             '0.x → this-network (private)');
  // CGNAT
  assert(isPrivateIp('100.64.0.1') === true,          '100.64.x → CGNAT (private, common on NZ mobile)');
  assert(isPrivateIp('100.127.255.255') === true,     '100.127.x → CGNAT upper edge (private)');
  assert(isPrivateIp('100.128.0.1') === false,        '100.128.x → PUBLIC (just outside CGNAT range)');
  assert(isPrivateIp('100.63.255.255') === false,     '100.63.x → PUBLIC (just below CGNAT range)');
  // Just OUTSIDE private ranges — should be public
  assert(isPrivateIp('11.0.0.1') === false,           '11.x → PUBLIC (just past 10/8)');
  assert(isPrivateIp('172.15.0.1') === false,         '172.15.x → PUBLIC (just below 172.16/12)');
  assert(isPrivateIp('172.32.0.1') === false,         '172.32.x → PUBLIC (just past 172.16/12)');
  assert(isPrivateIp('192.169.0.1') === false,        '192.169.x → PUBLIC (just past 192.168/16)');
  // Real NZ customer IPs — should be public
  assert(isPrivateIp('203.104.28.42') === false,      '203.104.x → PUBLIC (typical NZ residential Spark)');
  assert(isPrivateIp('122.60.0.1') === false,         '122.60.x → PUBLIC (typical NZ 2degrees)');
}

// ── isPrivateIp: IPv6 ─────────────────────────────────────────────────────
console.log('\n── isPrivateIp: IPv6 ranges ──');
{
  assert(isPrivateIp('::1') === true,                                'IPv6 ::1 → loopback (private)');
  assert(isPrivateIp('fc00::1') === true,                           'fc00::/7 → unique-local (private)');
  assert(isPrivateIp('fd00:1234::5') === true,                      'fdxx::/7 → unique-local (private)');
  assert(isPrivateIp('fe80::1') === true,                           'fe80::/10 → link-local (private)');
  assert(isPrivateIp('2001:db8::1') === false,                      '2001:db8:: → PUBLIC (IANA docs range but treated public)');
  assert(isPrivateIp('2404:4408:1234::5') === false,                '2404:4408:: → PUBLIC (typical NZ Spark IPv6)');
}

// ── isPrivateIp: IPv6-mapped IPv4 ────────────────────────────────────────
console.log('\n── isPrivateIp: IPv6-mapped IPv4 ──');
{
  assert(isPrivateIp('::ffff:10.198.108.133') === true,   '::ffff:10.x → private (mapped IPv4 unwraps to private)');
  assert(isPrivateIp('::ffff:127.0.0.1') === true,        '::ffff:127.x → private (mapped loopback)');
  assert(isPrivateIp('::ffff:203.104.28.42') === false,   '::ffff:203.x → PUBLIC (mapped IPv4 unwraps to public)');
  // Case-insensitive
  assert(isPrivateIp('::FFFF:10.0.0.1') === true,         'uppercase ::FFFF prefix → still detected');
}

// ── isPrivateIp: edge cases ──────────────────────────────────────────────
console.log('\n── isPrivateIp: edge cases ──');
{
  assert(isPrivateIp(null) === true,        'null → private (fail-safe: skip)');
  assert(isPrivateIp(undefined) === true,   'undefined → private (fail-safe: skip)');
  assert(isPrivateIp('') === true,          "'' → private (fail-safe: skip)");
  assert(isPrivateIp('   ') === true,       'whitespace → private (fail-safe: skip)');
  assert(isPrivateIp(42) === true,          'non-string → private (fail-safe: skip)');
}

// ── getClientIp: XFF chain walking ────────────────────────────────────────
console.log('\n── getClientIp: X-Forwarded-For chain ──');
{
  // Real Vercel→Render production scenario — the bug we're fixing.
  {
    const req = {
      headers: { 'x-forwarded-for': '203.104.28.42, 76.223.126.88, 10.198.108.133' },
      ip: '10.198.108.133',
    };
    assert(getClientIp(req) === '203.104.28.42',
      'Vercel→Render chain: leftmost public wins (not req.ip which is 10.x)');
  }

  // Single-hop (localhost dev, no proxy).
  {
    const req = {
      headers: { 'x-forwarded-for': '203.104.28.42' },
      ip: '203.104.28.42',
    };
    assert(getClientIp(req) === '203.104.28.42',
      'single-hop XFF: returns the one IP');
  }

  // Chain starts with a private IP (spoofed / weird proxy config) — skip to next.
  {
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.5, 203.104.28.42, 10.198.108.133' },
      ip: '10.198.108.133',
    };
    assert(getClientIp(req) === '203.104.28.42',
      'chain with leading private IP: skip to first public');
  }

  // All-private chain — fall through to req.ip fallback.
  {
    const req = {
      headers: { 'x-forwarded-for': '10.0.0.1, 172.16.0.5, 192.168.1.1' },
      ip: 'fallback-ip',
    };
    assert(getClientIp(req) === 'fallback-ip',
      'all-private chain: falls through to req.ip fallback');
  }

  // Chain with IPv6-mapped IPv4 private → skip.
  {
    const req = {
      headers: { 'x-forwarded-for': '::ffff:203.104.28.42' },
      ip: 'x',
    };
    assert(getClientIp(req) === '::ffff:203.104.28.42',
      'IPv6-mapped public IPv4: returned as-is (still uniquely identifies user)');
  }
}

// ── getClientIp: alternate headers ────────────────────────────────────────
console.log('\n── getClientIp: alternate proxy headers ──');
{
  // Vercel-specific header when XFF is absent.
  {
    const req = {
      headers: { 'x-vercel-forwarded-for': '203.104.28.42, 10.0.0.5' },
      ip: 'unused',
    };
    assert(getClientIp(req) === '203.104.28.42',
      'x-vercel-forwarded-for when XFF absent: works');
  }

  // X-Real-IP fallback.
  {
    const req = {
      headers: { 'x-real-ip': '203.104.28.42' },
      ip: 'unused',
    };
    assert(getClientIp(req) === '203.104.28.42',
      'x-real-ip when other headers absent: works');
  }

  // Private X-Real-IP is ignored, falls through.
  {
    const req = {
      headers: { 'x-real-ip': '10.0.0.1' },
      ip: 'real-fallback',
    };
    assert(getClientIp(req) === 'real-fallback',
      'private x-real-ip: ignored, falls through');
  }
}

// ── getClientIp: fallbacks ────────────────────────────────────────────────
console.log('\n── getClientIp: fallback chain ──');
{
  assert(getClientIp({ headers: {}, ip: '203.104.28.42' }) === '203.104.28.42',
    'no proxy headers: uses req.ip');
  assert(getClientIp({ headers: {}, socket: { remoteAddress: '203.104.28.42' } }) === '203.104.28.42',
    'no headers + no req.ip: uses socket.remoteAddress');
  assert(getClientIp({}) === 'unknown',
    'empty request: returns "unknown" (never crashes)');
  assert(getClientIp(null) === 'unknown',
    'null request: returns "unknown" (never crashes)');
  assert(getClientIp(undefined) === 'unknown',
    'undefined request: returns "unknown"');
}

// ── Regression: the exact bug we're fixing ────────────────────────────────
console.log('\n── Regression: 2026-09-01 rate-limit bug ──');
{
  // Real request shape from production logs: XFF chain with client at
  // the front and Render's internal 10.198 IP at the end. req.ip on
  // Express was returning the 10.198 which caused every real user's
  // requests to be attributed to a rotating pool of internal IPs.
  const productionRequestShape = {
    headers: {
      'x-forwarded-for': '203.104.28.42, 76.223.126.88, 10.198.108.133',
      'x-vercel-forwarded-for': '203.104.28.42',
      'x-real-ip': '10.198.108.133',
    },
    ip: '10.198.108.133',
    socket: { remoteAddress: '10.198.108.133' },
  };
  const resolved = getClientIp(productionRequestShape);
  assert(resolved === '203.104.28.42',
    `production shape resolves to real client IP (got ${resolved})`);
  assert(!isPrivateIp(resolved),
    'resolved IP is public — safe to use as rate-limit key');
}

console.log(`\n━━━ ${pass} passed · ${fail} failed ━━━\n`);
if (fail > 0) process.exit(1);

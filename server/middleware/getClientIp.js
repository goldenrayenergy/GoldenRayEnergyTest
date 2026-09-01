// Client-IP extraction that survives multi-hop proxy chains.
//
// Fix (2026-09-01) — replaces the naïve `req.ip` used by quoteRateLimit
// which was returning Render's INTERNAL proxy IP (10.x.x.x) instead of
// the customer's real public IP on the Vercel-frontend/Render-backend
// setup. Result: rate-limit counters keyed on rotating internal IPs,
// customers accidentally sharing counters with each other, cap
// unenforceable in practice. Root cause: Express `trust proxy 1` only
// walks ONE hop; the deploy chain has TWO (Vercel edge → Render proxy
// → Express).
//
// This helper parses X-Forwarded-For explicitly, walks the chain
// left-to-right, and returns the FIRST non-private IP — that's the
// customer's actual public IP regardless of how many proxies added
// their internal address to the chain after it.
//
// Falls back to `req.ip` / socket IP if X-Forwarded-For is absent
// (single-hop local dev, direct hits, tests).
//
// Pure JS — no Express dependency at the type level, so it can be
// unit-tested in Node against a plain `{headers, ip, socket}` shape.

/**
 * Returns true if the given string is a private/internal IP that should
 * never be used as a rate-limit key. Covers:
 *   • IPv4 RFC 1918 (10/8, 172.16/12, 192.168/16)
 *   • IPv4 loopback (127/8)
 *   • IPv4 link-local (169.254/16)
 *   • IPv4 "this-network" (0/8)
 *   • IPv4 CGNAT (100.64/10) — shared carrier NAT, not a specific customer
 *   • IPv6 loopback (::1)
 *   • IPv6 unique-local (fc00::/7)
 *   • IPv6 link-local (fe80::/10)
 *   • IPv6-mapped IPv4 (::ffff:1.2.3.4) — normalises then re-checks
 *   • null / undefined / empty
 */
export function isPrivateIp(ip) {
  if (!ip || typeof ip !== 'string') return true;

  // Strip IPv6-mapped IPv4 prefix so a mapped 10.x is caught by the
  // IPv4 rules below (e.g. "::ffff:10.198.108.133" → "10.198.108.133").
  const clean = ip.replace(/^::ffff:/i, '').trim();
  if (!clean) return true;

  // IPv6 checks (before IPv4 to catch pure IPv6 addresses).
  if (clean === '::1') return true;
  if (/^fc[0-9a-f]{2}:/i.test(clean)) return true;  // fc00::/7 unique-local part 1
  if (/^fd[0-9a-f]{2}:/i.test(clean)) return true;  // fc00::/7 unique-local part 2
  if (/^fe[89ab][0-9a-f]:/i.test(clean)) return true;  // fe80::/10 link-local

  // IPv4 checks.
  if (/^10\./.test(clean))                                return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(clean))          return true;
  if (/^192\.168\./.test(clean))                          return true;
  if (/^127\./.test(clean))                               return true;
  if (/^169\.254\./.test(clean))                          return true;
  if (/^0\./.test(clean))                                 return true;
  // CGNAT 100.64.0.0/10 (i.e. 100.64.0.0 - 100.127.255.255)
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(clean)) return true;

  return false;
}

/**
 * Extract the customer's real public IP from a request, walking any
 * X-Forwarded-For chain. Returns 'unknown' only when nothing usable
 * is found — every non-empty return is safe to use as a rate-limit key.
 *
 * Chain order per RFC 7239 + de-facto convention:
 *   "client, proxy1, proxy2, proxy3"
 *   ^^^^^^  leftmost is the original client
 *
 * A hostile client could spoof headers by injecting fake earlier hops,
 * but for our use-case (rate-limiting per-IP to protect Google API
 * spend) that's acceptable — the worst a spoofer can do is exempt
 * THEMSELVES from the counter, not attack anyone else.
 *
 * @param {object} req  Express-style request with .headers, .ip, .socket
 * @returns {string}    the resolved IP, or 'unknown'
 */
export function getClientIp(req) {
  // X-Forwarded-For — leftmost non-private wins.
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    const chain = xff.split(',').map(s => s.trim()).filter(Boolean);
    for (const candidate of chain) {
      if (!isPrivateIp(candidate)) return candidate;
    }
    // Chain existed but every entry was private — fall through to defaults.
    // (Shouldn't happen in production; means every hop was internal.)
  }

  // Vercel-specific header (some routes strip X-Forwarded-For but keep this).
  const vercel = req?.headers?.['x-vercel-forwarded-for'];
  if (typeof vercel === 'string' && vercel.length > 0) {
    const chain = vercel.split(',').map(s => s.trim()).filter(Boolean);
    for (const candidate of chain) {
      if (!isPrivateIp(candidate)) return candidate;
    }
  }

  // Real-IP (some proxies collapse the chain into this single header).
  const realIp = req?.headers?.['x-real-ip'];
  if (typeof realIp === 'string' && realIp.length > 0 && !isPrivateIp(realIp)) {
    return realIp;
  }

  // Fallback to Express-parsed IP (uses trust-proxy setting) or raw socket.
  return req?.ip || req?.socket?.remoteAddress || 'unknown';
}

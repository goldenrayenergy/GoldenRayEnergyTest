// ────────────────────────────────────────────────────────────────────────────
// QR-code redirect endpoint — public, no auth.
//
// GET /qr/:slug
//   1. Look up the qr_codes row by slug.
//   2. If inactive or unknown → 302 redirect to "/" with a "qr_expired=1" hint
//      so the frontend can show a soft "campaign ended" banner.
//   3. Log a row in qr_scans (timestamp, parsed device type, IP, referrer).
//   4. 302 redirect to `${destination_path}?utm_source=…&utm_medium=…
//      &utm_campaign=…&qr_scan_id=…`. The frontend reads qr_scan_id from
//      the URL and echoes it back on form submission, linking the scan to
//      the resulting lead.
//
// The redirect URL preserves any existing query string on the destination
// path (e.g. utm overrides) — but normally `destination_path` is just
// '/get-quote' and the UTM params come from the qr_codes row.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();

// Crude device classification from User-Agent. Enough for marketing
// analytics — not security-grade.
function classifyDevice(ua) {
  if (!ua) return 'Other';
  const s = ua.toLowerCase();
  if (s.includes('iphone') || s.includes('ipad') || s.includes('ipod')) return 'iPhone';
  if (s.includes('android'))                                            return 'Android';
  if (s.includes('windows') || s.includes('macintosh') || s.includes('linux')) return 'Desktop';
  return 'Other';
}

router.get('/:slug', async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();

  // Fail-soft: if the DB is unreachable, send the user to the homepage
  // rather than showing a 500. We'd rather lose a scan-log entry than
  // lose the lead.
  if (!supabaseAdmin) return res.redirect(302, '/');

  try {
    const { data: qr, error } = await supabaseAdmin
      .from('qr_codes')
      .select('id, slug, destination_path, utm_source, utm_medium, utm_campaign, is_active')
      .eq('slug', slug)
      .maybeSingle();

    // Unknown or deactivated slug → soft-redirect to home with a hint
    if (error || !qr || !qr.is_active) {
      return res.redirect(302, '/?qr_expired=1');
    }

    // Log the scan (best-effort — failure here must not block the redirect).
    let scanId = null;
    try {
      const ipRaw = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
      const ipAddress = ipRaw && ipRaw !== '::1' ? ipRaw : null;
      const { data: scan } = await supabaseAdmin
        .from('qr_scans')
        .insert({
          qr_code_id:  qr.id,
          user_agent:  req.headers['user-agent']?.slice(0, 500) || null,
          device_type: classifyDevice(req.headers['user-agent']),
          ip_address:  ipAddress,
          referrer:    req.headers.referer?.slice(0, 500) || null,
        })
        .select('id')
        .single();
      scanId = scan?.id || null;
    } catch (e) {
      console.warn('qr scan-log failed (non-fatal):', e.message);
    }

    // Build the destination URL with UTM params + scan-id breadcrumb.
    const params = new URLSearchParams({
      utm_source:   qr.utm_source,
      utm_medium:   qr.utm_medium,
      utm_campaign: qr.utm_campaign,
    });
    if (scanId) params.set('qr_scan_id', scanId);

    const sep = qr.destination_path.includes('?') ? '&' : '?';
    const dest = `${qr.destination_path}${sep}${params.toString()}`;

    return res.redirect(302, dest);
  } catch (e) {
    console.error('qr redirect failed:', e.message);
    return res.redirect(302, '/');
  }
});

export default router;

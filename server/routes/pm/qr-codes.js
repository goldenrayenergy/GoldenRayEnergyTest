// ────────────────────────────────────────────────────────────────────────────
// PM Tool — QR-code admin endpoints (Phase D).
//
//   GET    /api/pm/admin/qr-codes              List all QRs + per-QR stats
//   POST   /api/pm/admin/qr-codes              Create a new QR
//   PATCH  /api/pm/admin/qr-codes/:id          Toggle is_active / edit fields
//   GET    /api/pm/admin/qr-codes/:slug/png    Download QR as PNG (logo overlay)
//   GET    /api/pm/admin/qr-codes/:slug/svg    Download QR as SVG (logo overlay)
//
// PNG/SVG endpoints accept ?baseUrl=https://... so the same backend can serve
// QRs that point at different frontends (Vercel preview now, custom domain
// later). If baseUrl is omitted, falls back to env QR_BASE_URL or the
// X-Forwarded-Host header.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { generateQrPng, generateQrSvg, buildQrUrl } from '../../services/qrGeneratorService.js';

const router = Router();
router.use(authenticate);

// Resolve the public base URL the QR should encode.
function resolveBaseUrl(req) {
  const fromQuery = req.query.baseUrl;
  if (fromQuery) return String(fromQuery);
  if (process.env.QR_BASE_URL) return process.env.QR_BASE_URL;
  // Final fallback — best guess from request headers (works on Vercel + Render)
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host']  || req.headers.host;
  return `${proto}://${host}`;
}

// ── GET /api/pm/admin/qr-codes ─────────────────────────────────────────────
router.get('/', async (_req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const [{ data: codes, error: codesErr }, { data: scans, error: scansErr }] = await Promise.all([
      supabaseAdmin.from('qr_codes').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('qr_scans').select('qr_code_id, lead_enquiry_id'),
    ]);
    if (codesErr)  throw codesErr;
    if (scansErr)  throw scansErr;

    // Aggregate stats per QR code in-memory (lighter than a SQL GROUP BY round-trip)
    const statsByCode = {};
    for (const s of (scans || [])) {
      const k = s.qr_code_id;
      statsByCode[k] ??= { scans: 0, leads: 0 };
      statsByCode[k].scans++;
      if (s.lead_enquiry_id) statsByCode[k].leads++;
    }

    const withStats = (codes || []).map(c => ({
      ...c,
      stats: statsByCode[c.id] || { scans: 0, leads: 0 },
      conversion_pct: statsByCode[c.id]?.scans
        ? +(statsByCode[c.id].leads / statsByCode[c.id].scans * 100).toFixed(1)
        : 0,
    }));

    res.json({ data: withStats });
  } catch (e) {
    console.error('qr-codes list failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/pm/admin/qr-codes ────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const { slug, campaign_name, destination_path, utm_source, utm_medium, utm_campaign, notes } = req.body || {};

    if (!slug || !/^[a-z0-9][a-z0-9-]{0,49}$/.test(slug)) {
      return res.status(400).json({ error: 'slug must be lowercase alphanumeric + hyphens, max 50 chars' });
    }
    if (!campaign_name || !utm_source || !utm_medium || !utm_campaign) {
      return res.status(400).json({ error: 'campaign_name, utm_source, utm_medium and utm_campaign are required' });
    }

    const insert = {
      slug:             slug.toLowerCase(),
      campaign_name:    String(campaign_name).slice(0, 200),
      destination_path: destination_path || '/get-quote',
      utm_source:       String(utm_source).slice(0, 50),
      utm_medium:       String(utm_medium).slice(0, 50),
      utm_campaign:     String(utm_campaign).slice(0, 80),
      notes:            notes ? String(notes).slice(0, 2000) : null,
      created_by:       req.user?.id || null,
    };

    const { data, error } = await supabaseAdmin
      .from('qr_codes')
      .insert(insert)
      .select('*')
      .single();
    if (error) {
      // Friendlier message for duplicate slug
      if (error.code === '23505') return res.status(409).json({ error: `slug "${insert.slug}" already exists` });
      throw error;
    }

    res.status(201).json({ data });
  } catch (e) {
    console.error('qr-codes create failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/pm/admin/qr-codes/:id ───────────────────────────────────────
router.patch('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    // Whitelist patchable fields — slug is intentionally locked once created
    // because changing it breaks printed QRs.
    const ALLOWED = ['campaign_name', 'destination_path', 'utm_source', 'utm_medium', 'utm_campaign', 'is_active', 'notes'];
    const patch = {};
    for (const k of ALLOWED) if (k in (req.body || {})) patch[k] = req.body[k];
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'no patchable fields supplied' });

    const { data, error } = await supabaseAdmin
      .from('qr_codes')
      .update(patch)
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'qr code not found' });

    res.json({ data });
  } catch (e) {
    console.error('qr-codes patch failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// Helper for PNG/SVG endpoints: look up the QR by slug.
async function loadQrBySlug(slug) {
  const { data, error } = await supabaseAdmin
    .from('qr_codes')
    .select('slug')
    .eq('slug', String(slug).toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── GET /api/pm/admin/qr-codes/:slug/png ───────────────────────────────────
router.get('/:slug/png', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const qr = await loadQrBySlug(req.params.slug);
    if (!qr) return res.status(404).json({ error: 'qr code not found' });

    const url   = buildQrUrl(resolveBaseUrl(req), qr.slug);
    const png   = await generateQrPng(url);
    const fname = `goldenray-qr-${qr.slug}.png`;
    res.setHeader('Content-Type',        'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.setHeader('Content-Length',      png.length);
    res.send(png);
  } catch (e) {
    console.error('qr png failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/pm/admin/qr-codes/:slug/svg ───────────────────────────────────
router.get('/:slug/svg', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const qr = await loadQrBySlug(req.params.slug);
    if (!qr) return res.status(404).json({ error: 'qr code not found' });

    const url   = buildQrUrl(resolveBaseUrl(req), qr.slug);
    const svg   = await generateQrSvg(url);
    const fname = `goldenray-qr-${qr.slug}.svg`;
    res.setHeader('Content-Type',        'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(svg);
  } catch (e) {
    console.error('qr svg failed:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;

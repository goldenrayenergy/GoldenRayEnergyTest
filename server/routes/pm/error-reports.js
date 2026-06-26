// ────────────────────────────────────────────────────────────────────────────
// PM Tool — /api/pm/error-reports — the "Report it" backend.
//
//   POST   /            — store a report (deduped by fingerprint → increments)
//   GET    /            — list reports (admin/owner) for the dashboard
//   PATCH  /:id/resolve — close a report (admin/owner)
//   PATCH  /:id/reopen  — re-open a resolved report (admin/owner)
//
// Resilient by design: if the error_reports table doesn't exist yet (migration
// 033 not applied), POST soft-succeeds ({ stored:false }) so a rep clicking
// "Report it" is never blocked. Apply the migration to enable persistence.
// ────────────────────────────────────────────────────────────────────────────
import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { supabaseAdmin as supabaseFromConfig } from '../../config/supabase.js';

// Test seam — same pattern as quotes.js / quote-actions.js
let _supabaseAdmin = supabaseFromConfig;
export function __setSupabaseForTests(client) { _supabaseAdmin = client; }
const sb = () => _supabaseAdmin;

// Dedup-upsert: one row per fingerprint. Repeated reports increment occurrences
// and refresh the latest sample + reopen if it had been resolved. Pure w.r.t the
// injected `client`, so it's unit-testable with a fake supabase.
export async function upsertErrorReport(client, payload, nowIso) {
  const now = nowIso || new Date().toISOString();
  const fingerprint = (payload.fingerprint || payload.code || 'unknown').slice(0, 200);

  const { data: existing, error: selErr } = await client
    .from('error_reports').select('*').eq('fingerprint', fingerprint).maybeSingle();
  if (selErr) throw selErr;

  if (existing) {
    const { data, error } = await client.from('error_reports').update({
      occurrences: (existing.occurrences || 1) + 1,
      last_reported_at: now,
      last_reported_by: payload.userId || null,
      sample_detail: payload.detail ?? existing.sample_detail,
      sample_context: payload.context ?? existing.sample_context,
      title: payload.title || existing.title,
      screen: payload.screen || existing.screen,
      status: 'open',                      // it's happening again → reopen
      resolved_at: null, resolved_by: null,
    }).eq('id', existing.id).select().maybeSingle();
    if (error) throw error;
    return { stored: true, deduped: true, report: data };
  }

  const { data, error } = await client.from('error_reports').insert({
    fingerprint,
    code: payload.code || fingerprint,
    area: payload.area || null,
    owner: payload.owner || null,
    severity: payload.severity || null,
    title: payload.title || null,
    screen: payload.screen || null,
    sample_detail: payload.detail || null,
    sample_context: payload.context || {},
    occurrences: 1,
    status: 'open',
    first_reported_at: now, last_reported_at: now,
    first_reported_by: payload.userId || null,
    last_reported_by: payload.userId || null,
  }).select().maybeSingle();
  if (error) throw error;
  return { stored: true, deduped: false, report: data };
}

const router = Router();
router.use(authenticate);

// POST / — any authenticated user can report. Never blocks the rep.
router.post('/', async (req, res) => {
  if (!sb()) return res.json({ stored: false, reason: 'db_unconfigured' });
  try {
    const result = await upsertErrorReport(sb(), { ...req.body, userId: req.user?.id });
    return res.json(result);
  } catch (e) {
    // Table missing / transient DB error → soft-succeed so the rep isn't blocked.
    console.warn('error-reports POST: store failed:', e.message);
    return res.json({ stored: false, reason: e.message });
  }
});

// GET / — dashboard list (admin / owner). status=open|resolved|all (default open).
router.get('/', authorize('admin', 'sales_mgr', 'proposal_mgr'), async (req, res) => {
  if (!sb()) return res.json({ reports: [] });
  try {
    const status = req.query.status || 'open';
    let q = sb().from('error_reports').select('*')
      .order('occurrences', { ascending: false }).order('last_reported_at', { ascending: false });
    if (status !== 'all') q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return res.json({ reports: data || [] });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// PATCH /:id/resolve — close a report.
router.patch('/:id/resolve', authorize('admin', 'sales_mgr', 'proposal_mgr'), async (req, res) => {
  if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const { data, error } = await sb().from('error_reports').update({
      status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: req.user?.id || null,
    }).eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Report not found.' });
    return res.json({ report: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// PATCH /:id/reopen — re-open a resolved report.
router.patch('/:id/reopen', authorize('admin', 'sales_mgr', 'proposal_mgr'), async (req, res) => {
  if (!sb()) return res.status(503).json({ error: 'Database not configured.' });
  try {
    const { data, error } = await sb().from('error_reports').update({
      status: 'open', resolved_at: null, resolved_by: null,
    }).eq('id', req.params.id).select().maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Report not found.' });
    return res.json({ report: data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;

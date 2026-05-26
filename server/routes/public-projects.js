// ────────────────────────────────────────────────────────────────────────────
// Public project viewer endpoint (B-1).
//
// GET /api/public/p/:share_token   — read-only customer-facing summary.
//
// Security model:
//   - No authentication. The `share_token` in the URL is the only credential.
//   - share_token is a server-generated UUID (DEFAULT uuid_generate_v4()) on
//     every projects_v2 row → unguessable, ~122 bits of entropy.
//   - Path is rate-limited at the network edge in production (Vercel /
//     Cloudflare). No request limit applied here today.
//
// What's returned (intentionally narrow — no PII beyond first name + city,
// no cost/margin internals):
//   - project: code, first name, city, headline system spec, estimated value
//   - phase: derived from lane_status (sales → engineering → … → complete)
//   - lane_summary: per-lane status for the customer timeline UI
//   - quote: latest quote_recommendations row if one exists; null otherwise
//
// Tracking: not yet — view events come in B-1.5 (writes a row to a new
// `project_view_events` table for sales notifications).
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();

// UUID v4 format check — reject anything that isn't a well-formed token early.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function derivePhase(ls) {
  // Each lane's `status` is one of: not_started | in_progress | complete.
  // We mirror the customer journey through 6 high-level phases.
  const done = lane => ls?.[lane]?.status === 'complete';
  if (done('finance') && done('operations')) return 'complete';
  if (done('operations'))                    return 'closing';
  if (done('compliance'))                    return 'install_scheduled';
  if (done('engineering'))                   return 'design_finalised';
  if (done('sales'))                         return 'engineering';
  return 'sales';
}

function summariseLanes(ls) {
  return ['sales', 'engineering', 'compliance', 'operations', 'finance'].map(l => ({
    lane:   l,
    status: ls?.[l]?.status || 'not_started',
  }));
}

router.get('/p/:share_token', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const tok = String(req.params.share_token || '').trim();
    if (!UUID_RE.test(tok)) {
      // Don't leak whether the token format itself is valid — same response as "not found".
      return res.status(404).json({ error: 'Not found' });
    }

    // Pull only customer-facing fields. NO cost_nzd, NO margin, NO internal notes.
    const { data: p, error } = await supabaseAdmin
      .from('projects_v2')
      .select(`
        id, code, address, suburb, city, region, postcode,
        project_type, system_size_kw, battery_kwh, panel_count, system_type,
        estimated_value_nzd,
        lane_status,
        status, commissioned_at, created_at,
        contacts:contact_id ( name, email, phone )
      `)
      .eq('share_token', tok)
      .single();

    if (error || !p) return res.status(404).json({ error: 'Not found' });
    if (p.status === 'cancelled') return res.status(404).json({ error: 'Not found' });

    const fullName = p.contacts?.name || '';
    const firstName = fullName.split(' ').filter(Boolean)[0] || 'there';

    // Latest quote recommendation — often null until the Phase C engine runs.
    const { data: quote } = await supabaseAdmin
      .from('quote_recommendations')
      .select(`
        id, generated_at, recommended_quote, recommendation_rationale,
        quote_a_tier, quote_a_total_price_nzd, quote_a_payback_years, quote_a_25yr_savings_nzd,
        quote_b_tier, quote_b_total_price_nzd, quote_b_payback_years, quote_b_25yr_savings_nzd,
        quote_c_tier, quote_c_total_price_nzd, quote_c_payback_years, quote_c_25yr_savings_nzd
      `)
      .eq('project_id', p.id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    res.json({
      project: {
        code:                 p.code,
        first_name:           firstName,
        city:                 p.city,
        region:               p.region,
        project_type:         p.project_type,
        system_size_kw:       p.system_size_kw,
        battery_kwh:          p.battery_kwh,
        panel_count:          p.panel_count,
        system_type:          p.system_type,
        estimated_value_nzd:  p.estimated_value_nzd,
        commissioned_at:      p.commissioned_at,
        created_at:           p.created_at,
      },
      phase:        derivePhase(p.lane_status || {}),
      lane_summary: summariseLanes(p.lane_status || {}),
      quote:        quote || null,
    });
  } catch (e) {
    console.error('GET /api/public/p/:share_token failed:', e);
    res.status(500).json({ error: e.message });
  }
});

export default router;

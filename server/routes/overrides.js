import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { PROJECT_STAGES, missingRequiredItems } from '../services/projectService.js';

const router = Router();
router.use(authenticate);

// ── List override requests ────────────────────────────────────────────────
// Admins see everything; non-admins see only their own. Filter by ?status=
router.get('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    let q = supabaseAdmin
      .from('override_requests')
      .select(`*,
        project:projects!project_id ( id, code, stage, sub_status, contacts:customer_id ( name ) ),
        proposal:proposals!proposal_id ( id, version, status ),
        requester:users!requested_by ( id, name, email ),
        decider:users!decided_by ( id, name )`)
      .order('created_at', { ascending: false })
      .limit(200);
    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.user?.role !== 'admin') q = q.eq('requested_by', req.user.id);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Create override request ───────────────────────────────────────────────
// Body: { project_id, proposal_id?, action_type, action_payload, reason }
// Auto-approves if requester is admin (admins can override themselves).
router.post('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { project_id, proposal_id, action_type, action_payload, reason } = req.body || {};
    if (!action_type || !['force_advance', 'force_accept', 'backward_move'].includes(action_type)) {
      return res.status(400).json({ error: 'action_type must be force_advance | force_accept | backward_move' });
    }
    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ error: 'A reason is required (minimum 5 characters).' });
    }

    const isAdmin = req.user?.role === 'admin';
    const { data: created, error: insErr } = await supabaseAdmin
      .from('override_requests')
      .insert({
        project_id:    project_id || null,
        proposal_id:   proposal_id || null,
        requested_by:  req.user.id,
        action_type,
        action_payload: action_payload || {},
        reason:        reason.trim(),
        status:        isAdmin ? 'approved' : 'pending', // admins self-approve
        decided_by:    isAdmin ? req.user.id : null,
        decided_at:    isAdmin ? new Date().toISOString() : null,
        decision_reason: isAdmin ? 'Admin self-approved' : null,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    // Activity entry on the project so it shows up in the audit log
    if (project_id) {
      await supabaseAdmin.from('activities').insert({
        type:        'system',
        description: isAdmin
          ? `Admin self-approved ${action_type} override: ${reason.trim()}`
          : `Override request submitted by ${req.user.email}: ${action_type} — ${reason.trim()}`,
        project_id,
        user_id:     req.user.id,
        metadata:    { override_request_id: created.id, action_type, status: created.status },
      });
    }

    // If admin self-approved, execute the action immediately
    if (isAdmin) {
      await executeOverrideAction(created, req.user);
    }

    res.status(201).json(created);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Approve a pending override request (admin only) ───────────────────────
router.post('/:id/approve', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only admins can approve overrides.' });
    const { decision_reason } = req.body || {};
    const { data: r, error } = await supabaseAdmin
      .from('override_requests')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !r) return res.status(404).json({ error: 'Override request not found' });
    if (r.status !== 'pending') return res.status(409).json({ error: `Request is already ${r.status}.` });

    await supabaseAdmin
      .from('override_requests')
      .update({
        status: 'approved',
        decided_by: req.user.id,
        decided_at: new Date().toISOString(),
        decision_reason: (decision_reason || '').trim() || null,
      })
      .eq('id', req.params.id);

    if (r.project_id) {
      await supabaseAdmin.from('activities').insert({
        type:        'system',
        description: `Admin approved override request: ${r.action_type} — ${r.reason}`,
        project_id:  r.project_id,
        user_id:     req.user.id,
        metadata:    { override_request_id: r.id, decision: 'approved' },
      });
    }

    await executeOverrideAction({ ...r, status: 'approved', decided_by: req.user.id }, req.user);

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reject a pending override request (admin only) ────────────────────────
router.post('/:id/reject', async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only admins can reject overrides.' });
    const { decision_reason } = req.body || {};
    const { data: r, error } = await supabaseAdmin
      .from('override_requests')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !r) return res.status(404).json({ error: 'Override request not found' });
    if (r.status !== 'pending') return res.status(409).json({ error: `Request is already ${r.status}.` });

    await supabaseAdmin
      .from('override_requests')
      .update({
        status: 'rejected',
        decided_by: req.user.id,
        decided_at: new Date().toISOString(),
        decision_reason: (decision_reason || '').trim() || null,
      })
      .eq('id', req.params.id);

    if (r.project_id) {
      await supabaseAdmin.from('activities').insert({
        type:        'system',
        description: `Admin rejected override request: ${r.action_type} — reason: ${decision_reason || '(none given)'}`,
        project_id:  r.project_id,
        user_id:     req.user.id,
        metadata:    { override_request_id: r.id, decision: 'rejected' },
      });
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Execute the override action server-side once approved ─────────────────
async function executeOverrideAction(r, user) {
  try {
    if (r.action_type === 'force_advance') {
      // payload: { from_stage, to_stage }
      const toStage = r.action_payload?.to_stage;
      if (!toStage || !PROJECT_STAGES.includes(toStage)) return;
      await supabaseAdmin
        .from('projects')
        .update({ stage: toStage, stage_entered_at: new Date().toISOString() })
        .eq('id', r.project_id);
      await supabaseAdmin.from('activities').insert({
        type:        'system',
        description: `Project stage changed to ${toStage} (override-approved)`,
        project_id:  r.project_id,
        user_id:     user.id,
        metadata:    { override_request_id: r.id, action: 'force_advance', to_stage: toStage },
      });
    } else if (r.action_type === 'force_accept') {
      // payload: { proposal_id }
      const propId = r.proposal_id || r.action_payload?.proposal_id;
      if (!propId) return;
      // Mark proposal accepted, advance project to installation
      await supabaseAdmin.from('proposals').update({ status: 'accepted' }).eq('id', propId);
      const { data: prop } = await supabaseAdmin
        .from('proposals')
        .select('project_id, version')
        .eq('id', propId)
        .single();
      if (prop?.project_id) {
        await supabaseAdmin
          .from('projects')
          .update({ stage: 'installation', stage_entered_at: new Date().toISOString() })
          .eq('id', prop.project_id);
        await supabaseAdmin.from('activities').insert({
          type:        'system',
          description: `Proposal v${prop.version || 1} accepted (override-approved) — project advanced to installation`,
          project_id:  prop.project_id,
          user_id:     user.id,
          metadata:    { override_request_id: r.id, action: 'force_accept', proposal_id: propId },
        });
      }
    } else if (r.action_type === 'backward_move') {
      // payload: { to_stage, reset_progress? }
      const toStage = r.action_payload?.to_stage;
      if (!toStage || !PROJECT_STAGES.includes(toStage)) return;
      const updates = { stage: toStage, stage_entered_at: new Date().toISOString() };
      if (r.action_payload?.reset_progress === true) {
        const { data: cur } = await supabaseAdmin
          .from('projects')
          .select('stage_progress')
          .eq('id', r.project_id)
          .single();
        const next = { ...(cur?.stage_progress || {}) };
        const targetIdx = PROJECT_STAGES.indexOf(toStage);
        const targetAndBeyond = PROJECT_STAGES.slice(targetIdx);
        for (const k of Object.keys(next)) {
          if (targetAndBeyond.includes(k.split('.')[0])) delete next[k];
        }
        updates.stage_progress = next;
      }
      await supabaseAdmin.from('projects').update(updates).eq('id', r.project_id);
      await supabaseAdmin.from('activities').insert({
        type:        'system',
        description: `Project stage changed to ${toStage} (override-approved backward move)`,
        project_id:  r.project_id,
        user_id:     user.id,
        metadata:    { override_request_id: r.id, action: 'backward_move', to_stage: toStage, reset_progress: !!r.action_payload?.reset_progress },
      });
    }
  } catch (e) {
    console.error('executeOverrideAction failed:', e.message);
  }
}

export default router;

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { PROJECT_STAGES, missingRequiredItems } from '../services/projectService.js';

const router = Router();
router.use(authenticate);

// List — supports ?stage=<stage>&owner=<uuid>&search=<q>
router.get('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    let q = supabaseAdmin
      .from('projects')
      .select(`
        id, code, stage, sub_status, customer_id, owner_id,
        address, suburb, city, region, postcode,
        system_size_kw, panels, battery_kwh, system_type, estimated_value,
        stage_entered_at, stage_progress, created_at,
        contacts:customer_id ( id, name, email, phone ),
        users:owner_id       ( id, name, avatar )
      `)
      .order('created_at', { ascending: false })
      .limit(500);

    if (req.query.stage) q = q.eq('stage', req.query.stage);
    if (req.query.owner) q = q.eq('owner_id', req.query.owner);

    const { data, error } = await q;
    if (error) throw error;

    const search = (req.query.search || '').toLowerCase().trim();
    const out = search
      ? data.filter(p =>
          p.code?.toLowerCase().includes(search) ||
          p.address?.toLowerCase().includes(search) ||
          p.contacts?.name?.toLowerCase().includes(search) ||
          p.contacts?.email?.toLowerCase().includes(search))
      : data;
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Detail
router.get('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const { data, error } = await supabaseAdmin
      .from('projects')
      .select(`
        *,
        contacts:customer_id ( id, name, email, phone, location, monthly_bill ),
        users:owner_id       ( id, name, avatar, email )
      `)
      .eq('id', req.params.id)
      .single();
    if (error) throw error;

    // Linked tasks, recent activities, and the original website enquiry (read-only for Enquiry tab)
    const [{ data: tasks }, { data: activities }, enquiryRes] = await Promise.all([
      supabaseAdmin.from('tasks').select('*').eq('project_id', req.params.id).order('due_date', { ascending: true }),
      supabaseAdmin.from('activities').select('*').eq('project_id', req.params.id).order('created_at', { ascending: false }).limit(20),
      data.website_enquiry_id
        ? supabaseAdmin.from('website_enquiries').select('*').eq('id', data.website_enquiry_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    res.json({
      project: data,
      tasks: tasks || [],
      activities: activities || [],
      enquiry: enquiryRes?.data || null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update — supports stage transitions, owner, notes, sub_status, plus
// New-stage qualification fields (quality, call_outcome, call_notes).
// Forward stage moves are gated by required-checklist completion; admin role + backward moves bypass the gate.
router.patch('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const { stage, sub_status, owner_id, notes, quality, call_outcome, call_notes } = req.body;
    const update = {};
    let stageChanged = false;
    let qualityFirstSet = false;

    if (stage !== undefined) {
      if (!PROJECT_STAGES.includes(stage)) {
        return res.status(400).json({ error: `Invalid stage. Must be one of: ${PROJECT_STAGES.join(', ')}` });
      }

      // Load current stage + stage_progress to decide whether to gate
      const { data: current, error: loadErr } = await supabaseAdmin
        .from('projects')
        .select('stage, stage_progress')
        .eq('id', req.params.id)
        .single();
      if (loadErr) throw loadErr;

      const fromIdx = PROJECT_STAGES.indexOf(current.stage);
      const toIdx   = PROJECT_STAGES.indexOf(stage);
      const isForward  = toIdx > fromIdx;
      const isAdmin    = req.user?.role === 'admin';

      if (isForward && !isAdmin) {
        const missing = missingRequiredItems(current.stage, current.stage_progress || {});
        if (missing.length) {
          return res.status(409).json({
            error: `Cannot advance from "${current.stage}" to "${stage}" — ${missing.length} required item(s) incomplete.`,
            missing,
            currentStage: current.stage,
          });
        }
      }

      update.stage = stage;
      update.stage_entered_at = new Date().toISOString();
      stageChanged = true;
    }
    if (sub_status !== undefined) update.sub_status = sub_status;
    if (owner_id   !== undefined) update.owner_id   = owner_id;
    if (notes      !== undefined) update.notes      = notes;

    if (call_outcome !== undefined) update.call_outcome = call_outcome || null;
    if (call_notes   !== undefined) update.call_notes   = call_notes || null;

    if (quality !== undefined) {
      if (quality && !['hot', 'warm', 'cold'].includes(quality)) {
        return res.status(400).json({ error: 'quality must be hot | warm | cold' });
      }
      update.quality = quality || null;

      // Detect "first time setting quality" so we can fire the follow-up sequence
      const { data: existing } = await supabaseAdmin
        .from('projects')
        .select('quality')
        .eq('id', req.params.id)
        .single();
      if (quality && !existing?.quality) {
        qualityFirstSet = true;
        update.qualified_at = new Date().toISOString();
      }
    }

    // Auto-tick the New-stage checklist items when their backing data is filled
    if (owner_id !== undefined || call_outcome !== undefined || quality !== undefined) {
      const { data: existing } = await supabaseAdmin
        .from('projects')
        .select('stage_progress, owner_id, call_outcome, quality')
        .eq('id', req.params.id)
        .single();
      const merged = {
        owner_id:     owner_id     !== undefined ? owner_id     : existing?.owner_id,
        call_outcome: call_outcome !== undefined ? call_outcome : existing?.call_outcome,
        quality:      quality      !== undefined ? quality      : existing?.quality,
      };
      const next = { ...(existing?.stage_progress || {}) };
      next['new.owner']   = !!merged.owner_id;
      next['new.call']    = !!merged.call_outcome;
      next['new.qualify'] = !!merged.quality;
      update.stage_progress = next;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(update)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    // When a lead is first qualified (any quality), auto-create a follow-up
    // sequence: D+3, D+7, D+14 reminders for the owner. Runs regardless of
    // hot/warm/cold rating so cold leads still get a nurture cadence.
    if (qualityFirstSet) {
      const ownerId = data.owner_id || null;
      const customerId = data.customer_id || null;
      const code = data.code;
      const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
      const cadence = [
        { d: 3,  title: `Follow-up #1 — ${code}`,  desc: `First nurture touch (${data.quality} lead). Re-engage with case studies, savings calculator link, or new pricing.` },
        { d: 7,  title: `Follow-up #2 — ${code}`,  desc: `Second nurture touch. Send a tailored proposal preview, or a short video walk-through if the customer is engaging.` },
        { d: 14, title: `Follow-up #3 — ${code}`,  desc: `Final nurture touch in this cadence. Confirm intent — design phase if interested, archive if cold.` },
      ];
      try {
        await supabaseAdmin.from('tasks').insert(cadence.map(c => ({
          title:       c.title,
          description: c.desc,
          assignee_id: ownerId,
          contact_id:  customerId,
          project_id:  data.id,
          due_date:    days(c.d),
          priority:    data.quality === 'hot' ? 'high' : data.quality === 'cold' ? 'low' : 'medium',
          status:      'todo',
          task_type:   'email',
        })));
        await supabaseAdmin.from('activities').insert({
          type:        'system',
          description: `Lead qualified as ${data.quality}. Auto-created 3-step follow-up cadence (D+3, D+7, D+14).`,
          project_id:  data.id,
          contact_id:  customerId,
          user_id:     req.user?.id || null,
          metadata:    { quality: data.quality, cadence_days: [3, 7, 14] },
        });
      } catch (e) {
        console.error('Follow-up cadence creation failed (non-fatal):', e.message);
      }
    }

    // Log the stage change as an activity
    if (stageChanged) {
      const isOverride = req.user?.role === 'admin';
      await supabaseAdmin.from('activities').insert({
        type:        'system',
        description: `Project stage changed to ${stage}${isOverride && req.body.override ? ' (admin override)' : ''}`,
        project_id:  data.id,
        contact_id:  data.customer_id,
        user_id:     req.user?.id || null,
        metadata:    {
          previous_stage: req.body.previous_stage || null,
          new_stage:      stage,
          override:       !!req.body.override,
        },
      });
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Toggle a checklist item's completion state
// Body: { itemId: string, completed: boolean }
router.patch('/:id/checklist', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const { itemId, completed } = req.body;
    if (!itemId || typeof completed !== 'boolean') {
      return res.status(400).json({ error: 'itemId (string) and completed (boolean) are required.' });
    }

    const { data: current, error: loadErr } = await supabaseAdmin
      .from('projects')
      .select('stage_progress')
      .eq('id', req.params.id)
      .single();
    if (loadErr) throw loadErr;

    const next = { ...(current.stage_progress || {}), [itemId]: completed };

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update({ stage_progress: next })
      .eq('id', req.params.id)
      .select('id, stage_progress')
      .single();
    if (error) throw error;

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

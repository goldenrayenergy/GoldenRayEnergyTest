import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { supabaseAdmin } from '../config/supabase.js';
import { PROJECT_STAGES, missingRequiredItems } from '../services/projectService.js';
import { scheduleCustomerCadence, cancelScheduledEmails, sendCourtesyCloseEmail } from '../services/emailService.js';

// ── Stage-entry follow-up templates (auto-created when project enters stage) ──
// Each entry returns an array of task templates. Days are offsets from "now".
const STAGE_ENTRY_FOLLOWUPS = {
  design: (project) => [
    { title: `Schedule site visit — ${project.code}`,        desc: `Book a site visit with ${project.contacts?.name || 'the customer'} to capture roof photos, pitch, orientation, and shading.`, due: 3, priority: 'high',   task_type: 'meeting' },
    { title: `Capture site photos & roof data — ${project.code}`, desc: 'Upload at least 4 site photos. Record roof pitch, orientation, area, structural condition.',                              due: 5, priority: 'medium', task_type: 'survey'  },
    { title: `Run energy simulation — ${project.code}`,      desc: 'Use the bill data + site assessment to model expected production. Required to advance to Selling.',                            due: 7, priority: 'medium', task_type: 'admin'   },
  ],
  selling: (project) => [
    { title: `Send proposal email — ${project.code}`,        desc: 'Email the v1 proposal PDF to the customer (Online + PDF Proposal tab).',                          due: 1, priority: 'high',   task_type: 'email'   },
    { title: `Follow up on proposal — ${project.code}`,      desc: 'Call or email to confirm receipt and answer questions. Capture objections in the notes.',         due: 5, priority: 'medium', task_type: 'call'    },
    { title: `Schedule customer review meeting — ${project.code}`, desc: 'Book a 30-min walkthrough of the proposal. Especially important for commercial deals.',     due: 3, priority: 'medium', task_type: 'meeting' },
  ],
  installation: () => [],  // already handled by /accept (5 starter tasks)
  maintenance: (project) => [
    { title: `6-month performance check — ${project.code}`,  desc: 'Visit, inspect panels + inverter, pull production data, brief the customer.',                     due: 180, priority: 'medium', task_type: 'meeting' },
    { title: `Annual maintenance visit — ${project.code}`,   desc: 'Annual deep-clean and check, performance report to customer.',                                    due: 365, priority: 'medium', task_type: 'meeting' },
    { title: `Set up monitoring app — ${project.code}`,      desc: 'Walk customer through inverter/monitoring app, ensure they see live data.',                       due: 3,   priority: 'low',    task_type: 'call'    },
  ],
  exit: (project) => [
    { title: `Send NPS survey — ${project.code}`,            desc: 'Send the customer-satisfaction survey. 1-question NPS + free-text.',                              due: 1,  priority: 'medium', task_type: 'email' },
    { title: `Document warranty registrations — ${project.code}`, desc: 'Confirm panel + inverter + battery warranties registered with manufacturers; copy to customer.', due: 3,  priority: 'low',    task_type: 'admin' },
    { title: `Ask for referral — ${project.code}`,           desc: 'Reach out to the happy customer for a referral. Optional case-study ask.',                        due: 14, priority: 'low',    task_type: 'call' },
  ],
};

async function createStageEntryFollowups(stage, project, userId) {
  const tpl = STAGE_ENTRY_FOLLOWUPS[stage];
  if (!tpl) return;
  const tasks = tpl(project);
  if (tasks.length === 0) return;
  const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  try {
    await supabaseAdmin.from('tasks').insert(tasks.map(t => ({
      title:       t.title,
      description: t.desc,
      assignee_id: project.owner_id || null,
      contact_id:  project.customer_id || null,
      project_id:  project.id,
      due_date:    days(t.due),
      priority:    t.priority,
      status:      'todo',
      task_type:   t.task_type,
    })));
    await supabaseAdmin.from('activities').insert({
      type:        'system',
      description: `Auto-created ${tasks.length} follow-up task(s) for ${stage} stage`,
      project_id:  project.id,
      contact_id:  project.customer_id,
      user_id:     userId || null,
      metadata:    { stage, task_count: tasks.length },
    });
  } catch (e) {
    console.error('Stage-entry follow-ups failed (non-fatal):', e.message);
  }
}

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
    let isBackward = false;

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
      isBackward       = toIdx < fromIdx;
      const isAdmin    = req.user?.role === 'admin';

      // Forward move: gate by checklist completion (admins bypass).
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

      // Backward move: admin-only. Sales reps can't undo their teammates' work.
      if (isBackward && !isAdmin) {
        return res.status(403).json({
          error: 'Backward stage moves require admin role. Ask an admin to move this project back.',
          fromStage: current.stage,
          toStage: stage,
        });
      }

      // Optional reset_progress flag (admins, backward moves only): clears
      // checklist progress for the target stage and every stage beyond it.
      // Earlier-stage progress is preserved as audit history.
      if (isBackward && req.body.reset_progress === true) {
        const next = { ...(current.stage_progress || {}) };
        const targetAndBeyond = PROJECT_STAGES.slice(toIdx); // includes the target
        for (const key of Object.keys(next)) {
          const stageOfKey = key.split('.')[0];
          if (targetAndBeyond.includes(stageOfKey)) delete next[key];
        }
        update.stage_progress = next;
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
        .select('quality, stage')
        .eq('id', req.params.id)
        .single();
      if (quality && !existing?.quality) {
        qualityFirstSet = true;
        update.qualified_at = new Date().toISOString();
        // NOTE: stage move on quality-save was removed in the gated-checklist
        // refactor. The 3 New-stage checklist items still auto-tick (handled
        // below); the client detects completion and prompts the user with an
        // acknowledgment modal before transitioning.
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

      // Also schedule the 3 customer emails. Resend handles delivery via
      // scheduled_at — no cron worker needed. Non-fatal: failure here doesn't
      // affect the API response or the salesperson's task list.
      // We persist the returned email IDs on the project so we can cancel
      // them via Resend if the project is later marked Lost / Disqualified.
      try {
        const { data: contact } = await supabaseAdmin
          .from('contacts')
          .select('email, name')
          .eq('id', customerId)
          .single();
        if (contact?.email) {
          const cadenceResults = await scheduleCustomerCadence({
            customerEmail: contact.email,
            customerName:  contact.name,
            quality:       data.quality,
            projectCode:   code,
          });
          const ids = (cadenceResults || []).map(r => r.id).filter(Boolean);
          if (ids.length > 0) {
            await supabaseAdmin
              .from('projects')
              .update({ cadence_email_ids: ids })
              .eq('id', data.id);
          }
        } else {
          console.log(`No customer email on contact ${customerId} — skipping email cadence (tasks still created).`);
        }
      } catch (e) {
        console.error('Customer cadence scheduling failed (non-fatal):', e.message);
      }
    }

    // Cancel scheduled cadence emails + delete pending follow-up tasks when
    // a project is marked Lost or Disqualified. Customer should not keep
    // receiving nurture emails after they've explicitly closed the loop.
    if (sub_status === 'lost' || sub_status === 'disqualified') {
      try {
        const { data: full } = await supabaseAdmin
          .from('projects')
          .select('code, customer_id, cadence_email_ids, contacts:customer_id ( name, email )')
          .eq('id', req.params.id)
          .single();
        const ids = full?.cadence_email_ids || [];
        if (ids.length > 0) await cancelScheduledEmails(ids);
        // Drop the saved IDs so we don't try to cancel twice if user toggles
        await supabaseAdmin.from('projects').update({ cadence_email_ids: [] }).eq('id', req.params.id);
        // Delete pending nurture-cadence tasks (the "Follow-up #N — CODE" ones)
        await supabaseAdmin
          .from('tasks')
          .delete()
          .eq('project_id', req.params.id)
          .eq('status', 'todo')
          .like('title', 'Follow-up #%');
        // Send a courtesy "we're closing your enquiry" email
        if (full?.contacts?.email) {
          const reason = sub_status === 'disqualified'
            ? `If your circumstances change, you're welcome to get in touch.`
            : `We hope another solution works out for you — we're here if you'd like to revisit later.`;
          await sendCourtesyCloseEmail({
            customerEmail: full.contacts.email,
            customerName:  full.contacts.name,
            projectCode:   full.code,
            reason,
          });
        }
        await supabaseAdmin.from('activities').insert({
          type:        'system',
          description: `Project marked ${sub_status}. Cancelled ${ids.length} scheduled email(s) + nurture tasks.`,
          project_id:  req.params.id,
          user_id:     req.user?.id || null,
          metadata:    { sub_status, cancelled_count: ids.length },
        });
      } catch (e) {
        console.error('Lost/Disqualified cleanup failed (non-fatal):', e.message);
      }
    }

    // Auto-create stage-entry follow-up tasks. Sensible defaults per stage —
    // see STAGE_ENTRY_FOLLOWUPS at the top of this file.
    if (stageChanged) {
      try {
        const { data: full } = await supabaseAdmin
          .from('projects')
          .select('id, code, owner_id, customer_id, contacts:customer_id ( name )')
          .eq('id', req.params.id)
          .single();
        if (full) {
          await createStageEntryFollowups(update.stage || data.stage, full, req.user?.id);
        }
      } catch (e) {
        console.error('Stage-entry follow-ups failed (non-fatal):', e.message);
      }
    }

    // Log the stage change as an activity. Use update.stage (the value we
    // actually applied) rather than req.body.stage, because auto-trigger
    // moves (e.g. Trigger 1) set update.stage even when the request body
    // didn't include a stage field.
    if (stageChanged) {
      const newStage = update.stage || data.stage;
      const isOverride = req.user?.role === 'admin' && !!req.body.override;
      const triggered = stage === undefined; // body didn't ask for a stage move; an auto-trigger fired
      const resetUsed  = !!update.stage_progress && isBackward && req.body.reset_progress === true;
      const suffix =
        isBackward  ? ` (admin backward move${resetUsed ? ' + progress reset' : ''})` :
        isOverride  ? ' (admin override)' :
        triggered   ? ' (auto-trigger)' : '';
      await supabaseAdmin.from('activities').insert({
        type:        'system',
        description: `Project stage changed to ${newStage}${suffix}`,
        project_id:  data.id,
        contact_id:  data.customer_id,
        user_id:     req.user?.id || null,
        metadata:    {
          previous_stage: req.body.previous_stage || null,
          new_stage:      newStage,
          override:       isOverride,
          auto_trigger:   triggered,
          backward_move:  isBackward,
          reset_progress: resetUsed,
        },
      });
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Mark site visit complete. Once set, future proposals generated for this
// project will be 'final' mode (no preliminary watermark). Toggle off by
// passing { done: false } — only admins should do that, surfaces in audit.
router.patch('/:id/site-visit', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { done = true } = req.body || {};
    const update = done ? { site_visit_done_at: new Date().toISOString() } : { site_visit_done_at: null };
    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(update)
      .eq('id', req.params.id)
      .select('id, code, site_visit_done_at, customer_id')
      .single();
    if (error) throw error;
    await supabaseAdmin.from('activities').insert({
      type:        'system',
      description: done ? `Site visit marked complete — future proposals will be FINAL mode` : `Site visit reverted — future proposals will be PRELIMINARY mode`,
      project_id:  data.id,
      contact_id:  data.customer_id,
      user_id:     req.user?.id || null,
      metadata:    { site_visit_done: done, at: data.site_visit_done_at },
    });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

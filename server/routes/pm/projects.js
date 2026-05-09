// ────────────────────────────────────────────────────────────────────────────
// PM Tool — projects_v2 routes
//
// All endpoints under /api/pm/projects. Reads contacts (read-only) for
// customer linkage. Writes ONLY to projects_v2 + project_assignments. Does
// not touch the legacy `projects` table or any existing portal data.
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';
import {
  LANES,
  getChecklist,
  computeLaneCompletion,
  computeHealth,
  CROSS_LANE_GATES,
  validateTransition,
  checkCrossLaneGate,
  computeReachableState,
  computeAllTaskBlockers,
} from '../../services/pm/laneDefinitions.js';
import { systemIsVppCapable, vppHardwareCatalog } from '../../services/pm/vppLookup.js';

const router = Router();
router.use(authenticate);

// ── Audit event writer ─────────────────────────────────────────────────────
async function writeEvent(req, { project_id, lane, item_key, event_type, payload }) {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from('pm_task_events').insert({
      project_id, lane, item_key, event_type,
      actor_user_id: req?.user?.id || null,
      payload:       payload || {},
      ip_address:    req?.ip || null,
      user_agent:    req?.headers?.['user-agent']?.slice(0, 500) || null,
    });
  } catch (e) {
    console.error('writeEvent failed (non-fatal):', e.message);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function emptyLaneStatus() {
  return Object.fromEntries(LANES.map(l => [l, { status: 'not_started', items: {} }]));
}

function laneStatusFromUpdate(existing, lane, patch) {
  const next = { ...(existing || emptyLaneStatus()) };
  next[lane] = { ...(next[lane] || { status: 'not_started', items: {} }), ...patch };
  return next;
}

// checkCrossLaneGate is now imported from laneDefinitions.js — supports
// per-(task, state) gate keys. Old call sites that pass only (laneStatus,
// lane, item) default to checking the gate at the task's doneState.

// ── GET /api/pm/projects — list ────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    let q = supabaseAdmin
      .from('projects_v2')
      .select(`
        id, code, contact_id, address, suburb, city, region,
        project_type, system_size_kw, battery_kwh, panel_count,
        lane_status, health, status, commissioned_at,
        primary_owner_id, share_token,
        vpp_capable_hardware, vpp_consented, vpp_enrolled,
        created_at, updated_at,
        contacts:contact_id ( id, name, email, phone )
      `)
      .order('created_at', { ascending: false })
      .limit(500);

    if (req.query.status) q = q.eq('status', req.query.status);
    if (req.query.health) q = q.eq('health', req.query.health);
    if (req.query.type)   q = q.eq('project_type', req.query.type);
    if (req.query.owner)  q = q.eq('primary_owner_id', req.query.owner);

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

// ── POST /api/pm/projects — create ─────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const {
      contact_id,
      bill_analysis_id,
      address, suburb, city, region, postcode, gps_lat, gps_lng,
      project_type = 'residential_rooftop',
      system_size_kw, battery_kwh, panel_count, system_type,
      estimated_value_nzd,
      primary_owner_id,
      notes,
    } = req.body;

    const insertRow = {
      contact_id:           contact_id || null,
      bill_analysis_id:     bill_analysis_id || null,
      address, suburb, city, region, postcode,
      gps_lat:              gps_lat || null,
      gps_lng:              gps_lng || null,
      project_type,
      system_size_kw:       system_size_kw || null,
      battery_kwh:          battery_kwh || null,
      panel_count:          panel_count || null,
      system_type:          system_type || 'on-grid',
      estimated_value_nzd:  estimated_value_nzd || null,
      primary_owner_id:     primary_owner_id || req.user?.id || null,
      lane_status:          emptyLaneStatus(),
      health:               'green',
      status:               'active',
      notes:                notes || null,
      created_by:           req.user?.id || null,
    };

    const { data, error } = await supabaseAdmin
      .from('projects_v2')
      .insert(insertRow)
      .select(`
        id, code, contact_id, address, suburb, city, region,
        project_type, system_size_kw, battery_kwh, panel_count,
        lane_status, health, status, share_token, created_at,
        contacts:contact_id ( id, name, email, phone )
      `)
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/pm/projects/:id — detail ──────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const { data: project, error } = await supabaseAdmin
      .from('projects_v2')
      .select(`
        *,
        contacts:contact_id ( id, name, email, phone, street, suburb, city, postcode )
      `)
      .eq('id', req.params.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Project not found' });
      throw error;
    }

    // Fetch related child rows in parallel
    const [{ data: assignments }, { data: artifacts }, { data: payments }, { data: hardware }] = await Promise.all([
      supabaseAdmin.from('project_assignments').select('*').eq('project_id', project.id).is('removed_at', null),
      supabaseAdmin.from('project_artifacts').select('*').eq('project_id', project.id).order('uploaded_at', { ascending: false }),
      supabaseAdmin.from('project_payments').select('*').eq('project_id', project.id).order('expected_at', { ascending: true }),
      supabaseAdmin.from('project_hardware').select('*').eq('project_id', project.id),
    ]);

    const checklist  = getChecklist(project.project_type);
    const completion = computeLaneCompletion(project.project_type, project.lane_status);
    const blockers   = computeAllTaskBlockers(project.project_type, project.lane_status);

    res.json({
      ...project,
      assignments:  assignments || [],
      artifacts:    artifacts || [],
      payments:     payments || [],
      hardware:     hardware || [],
      checklist,
      lane_completion: completion,
      task_blockers:   blockers,   // { lane: { item_key: {current_state, next_state, missing_fields, cross_lane_blockers} } }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/pm/projects/:id — update top-level fields ───────────────────
router.patch('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    // Whitelist of fields the client may patch via this endpoint.
    // Lane updates go through /lanes/:lane (different validation rules).
    const allowed = [
      'address','suburb','city','region','postcode','gps_lat','gps_lng',
      'project_type',
      'system_size_kw','battery_kwh','panel_count','system_type','estimated_value_nzd',
      'primary_owner_id',
      'status','cancel_reason',
      'notes',
      // Asset / VPP fields can be patched here too once the project is post-commission
      'inverter_make','inverter_model','inverter_serial',
      'battery_make','battery_model','battery_serial',
      'panel_make','panel_model',
      'panel_warranty_until','inverter_warranty_until','battery_warranty_until','workmanship_warranty_until',
      'monitoring_provider','monitoring_external_id',
      'vpp_capable_hardware','vpp_consented','vpp_enrolled','vpp_enrolled_at','vpp_aggregator','vpp_paused_until',
    ];

    const patch = {};
    for (const k of allowed) {
      if (k in req.body) patch[k] = req.body[k];
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const { data, error } = await supabaseAdmin
      .from('projects_v2')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/pm/projects/:id/lanes/:lane — toggle items / change lane status
router.patch('/:id/lanes/:lane', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });

    const { id, lane } = req.params;
    if (!LANES.includes(lane)) return res.status(400).json({ error: `Unknown lane: ${lane}` });

    const { item, value, notes, fields, target_state, status, blocked_reason, owner_id } = req.body;

    // Fetch current state
    const { data: current, error: fetchErr } = await supabaseAdmin
      .from('projects_v2')
      .select('id, project_type, lane_status')
      .eq('id', id)
      .single();
    if (fetchErr) {
      if (fetchErr.code === 'PGRST116') return res.status(404).json({ error: 'Project not found' });
      throw fetchErr;
    }

    const checklist = getChecklist(current.project_type);
    let nextLaneState = { ...(current.lane_status?.[lane] || { status: 'not_started', items: {} }) };
    nextLaneState.items = { ...(nextLaneState.items || {}) };
    nextLaneState.item_meta = { ...(nextLaneState.item_meta || {}) };

    // ── Mode 1: item-level update (toggle / fields / state transition / notes) ──
    if (item !== undefined) {
      const def = checklist[lane].find(it => it.key === item);
      if (!def) return res.status(400).json({ error: `Unknown item '${item}' in lane '${lane}'` });

      const meta = { ...(nextLaneState.item_meta[item] || {}) };
      const fromState = meta.state || def.initialState || 'not_started';
      const eventsToWrite = [];

      // Patch structured fields
      if (fields && typeof fields === 'object') {
        meta.fields = { ...(meta.fields || {}), ...fields };
        eventsToWrite.push({ event_type: 'field_edited', payload: { keys: Object.keys(fields) } });
      }

      // Patch notes
      if (notes !== undefined) {
        meta.notes = notes;
        eventsToWrite.push({ event_type: 'field_edited', payload: { keys: ['notes'] } });
      }

      // ── Determine target state ──
      // Three modes (priority order):
      //   target_state: 'X'      → explicit single-hop transition (validate from→to)
      //   auto_advance: true     → walk forward via computeReachableState
      //                            (each hop already validated; skip post-walk validation)
      //   value: true|false      → legacy: jump to doneState or one-before
      let resolvedTarget = undefined;
      let advancedViaAutoWalk = false;
      if (target_state !== undefined && target_state !== fromState) {
        resolvedTarget = target_state;
      } else if (req.body.auto_advance === true) {
        resolvedTarget = computeReachableState(def, fromState, meta.fields || {}, current.lane_status, lane, item);
        advancedViaAutoWalk = true;
      } else if (value === true) {
        resolvedTarget = def.doneState;
      } else if (value === false && nextLaneState.items[item] === true) {
        const stateOrder = def.states || [];
        resolvedTarget = stateOrder[Math.max(0, stateOrder.indexOf(def.doneState) - 1)] || def.initialState;
      }

      if (resolvedTarget !== undefined && resolvedTarget !== fromState) {
        // For explicit target_state and legacy `value` modes, validate the
        // single-hop transition and the cross-lane gate. For auto_advance,
        // computeReachableState already validated each step — skip.
        if (!advancedViaAutoWalk) {
          const v = validateTransition(def, fromState, resolvedTarget, meta.fields || {});
          if (!v.ok) {
            return res.status(409).json({ error: v.error, missing_fields: v.missing_fields });
          }
          const gate = checkCrossLaneGate(current.lane_status, lane, item, resolvedTarget);
          if (!gate.ok) {
            await writeEvent(req, { project_id: id, lane, item_key: item, event_type: 'gate_check_blocked', payload: gate });
            return res.status(409).json({
              error: 'Cross-lane gate not satisfied',
              blockers: gate.blockers,
              target_state: resolvedTarget,
            });
          }
        }

        meta.state = resolvedTarget;
        meta.state_history = [
          ...(meta.state_history || []),
          { from: fromState, to: resolvedTarget, at: new Date().toISOString(), by: req.user?.id || null },
        ];
        eventsToWrite.push({ event_type: 'state_changed', payload: { from: fromState, to: resolvedTarget } });

        if (resolvedTarget === def.doneState) {
          meta.completed_by = req.user?.id || null;
          meta.completed_at = new Date().toISOString();
          eventsToWrite.push({ event_type: 'gate_check_passed', payload: {} });
        }

        // If we're moving OUT of doneState back to an earlier state, that's a
        // reopen — emit a dedicated event so audit/dashboards can surface it.
        if (fromState === def.doneState && resolvedTarget !== def.doneState) {
          eventsToWrite.push({ event_type: 'task_reopened', payload: { from: fromState, to: resolvedTarget } });
          meta.last_reopened_at = new Date().toISOString();
          meta.last_reopened_by = req.user?.id || null;
        }
      }

      // Items[item] mirrors whether we're in doneState
      const isDoneState = meta.state === def.doneState;
      if (!isDoneState && nextLaneState.items[item] === true) {
        meta.last_uncompleted_at = new Date().toISOString();
      }
      nextLaneState.items[item] = !!isDoneState;

      nextLaneState.item_meta[item] = meta;

      // Auto-promote lane status from not_started → in_progress on first activity
      if (nextLaneState.status === 'not_started' && (eventsToWrite.length > 0)) {
        nextLaneState.status = 'in_progress';
        nextLaneState.started_at = new Date().toISOString();
      }

      // Auto-promote lane to 'done' when all gate-keepers complete; auto-demote
      // back to 'in_progress' if a previously-done gate-keeper gets reopened.
      const provisionalLaneStatus = { ...current.lane_status, [lane]: nextLaneState };
      const completion = computeLaneCompletion(current.project_type, provisionalLaneStatus);
      if (completion[lane].complete && nextLaneState.status !== 'done' && nextLaneState.status !== 'blocked') {
        nextLaneState.status = 'done';
        nextLaneState.completed_at = new Date().toISOString();
        eventsToWrite.push({ event_type: 'lane_completed', payload: { lane } });
      } else if (!completion[lane].complete && nextLaneState.status === 'done') {
        nextLaneState.status = 'in_progress';
        delete nextLaneState.completed_at;
        eventsToWrite.push({ event_type: 'lane_reopened', payload: { lane } });
      }

      // Persist events after we've written to DB (below)
      req._pmEventsToWrite = eventsToWrite.map(e => ({ ...e, project_id: id, lane, item_key: item }));
    }

    // Mode 2: change lane status (in_progress / blocked / done)
    if (status !== undefined) {
      const validStatuses = ['not_started','in_progress','blocked','done'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status: ${status}` });
      }

      // To mark done, all gate-keeper items must be checked
      if (status === 'done') {
        const completion = computeLaneCompletion(current.project_type, {
          ...current.lane_status,
          [lane]: nextLaneState,
        });
        if (!completion[lane].complete) {
          return res.status(409).json({
            error: 'Cannot mark lane done — gate-keeper items incomplete',
            done: completion[lane].gate_keepers_done,
            total: completion[lane].gate_keepers_total,
          });
        }
        nextLaneState.completed_at = new Date().toISOString();
      }

      nextLaneState.status = status;
      if (status === 'blocked') nextLaneState.blocked_reason = blocked_reason || nextLaneState.blocked_reason;
      else nextLaneState.blocked_reason = null;
    }

    if (owner_id !== undefined) nextLaneState.owner_id = owner_id;

    const newLaneStatus = laneStatusFromUpdate(current.lane_status, lane, nextLaneState);
    const newHealth     = computeHealth(newLaneStatus);

    const { data, error } = await supabaseAdmin
      .from('projects_v2')
      .update({ lane_status: newLaneStatus, health: newHealth })
      .eq('id', id)
      .select('id, lane_status, health')
      .single();
    if (error) throw error;

    // Persist queued audit events
    const queued = req._pmEventsToWrite || [];
    for (const ev of queued) {
      // Skip duplicate field_edited events that just toggle the same key
      await writeEvent(req, ev);
    }

    const completion = computeLaneCompletion(current.project_type, newLaneStatus);
    res.json({ ...data, lane_completion: completion });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/pm/projects/:id/events — audit log feed ───────────────────────
router.get('/:id/events', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { id } = req.params;
    let q = supabaseAdmin
      .from('pm_task_events')
      .select('*')
      .eq('project_id', id)
      .order('occurred_at', { ascending: false })
      .limit(parseInt(req.query.limit || '200', 10));
    if (req.query.lane)     q = q.eq('lane', req.query.lane);
    if (req.query.item_key) q = q.eq('item_key', req.query.item_key);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/pm/projects/:id/comments — list ───────────────────────────────
router.get('/:id/comments', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { id } = req.params;
    let q = supabaseAdmin
      .from('pm_task_comments')
      .select('*')
      .eq('project_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(500);
    if (req.query.lane)     q = q.eq('lane', req.query.lane);
    if (req.query.item_key) q = q.eq('item_key', req.query.item_key);
    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/pm/projects/:id/comments — add comment ───────────────────────
router.post('/:id/comments', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { id } = req.params;
    const { lane, item_key, body, parent_id, mentions } = req.body;

    if (!lane || !LANES.includes(lane)) return res.status(400).json({ error: 'Invalid lane' });
    if (!item_key)                       return res.status(400).json({ error: 'item_key required' });
    if (!body || !body.trim())           return res.status(400).json({ error: 'body required' });

    const { data, error } = await supabaseAdmin
      .from('pm_task_comments')
      .insert({
        project_id: id,
        lane,
        item_key,
        parent_id:  parent_id || null,
        author_user_id: req.user?.id || null,
        body:       body.trim(),
        mentions:   Array.isArray(mentions) ? mentions : [],
      })
      .select()
      .single();
    if (error) throw error;

    await writeEvent(req, {
      project_id: id, lane, item_key,
      event_type: 'comment_added',
      payload: { comment_id: data.id, body_preview: body.slice(0, 80), mentions: mentions || [] },
    });

    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/pm/projects/:id/comments/:commentId ────────────────────────
router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { id, commentId } = req.params;
    const { error } = await supabaseAdmin
      .from('pm_task_comments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', commentId)
      .eq('project_id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/pm/projects/:id/commission — populate asset fields ──────────
// Called by the CommissioningForm specialized UX. Copies serial numbers,
// warranty windows, monitoring credentials from the commissioning_form
// fields onto the projects_v2 row, computes vpp_capable_hardware via the
// hardware lookup, and sets commissioned_at.
router.post('/:id/commission', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { id } = req.params;
    const f = req.body?.fields || {};

    // Required to commission
    const required = ['inverter_make', 'inverter_model', 'inverter_serial', 'panel_make', 'panel_model', 'commissioned_by'];
    const missing = required.filter(k => !f[k]);
    if (missing.length > 0) {
      return res.status(400).json({ error: 'Required fields missing for commissioning', missing });
    }

    const vppCapable = systemIsVppCapable({
      inverter_make:  f.inverter_make,
      inverter_model: f.inverter_model,
      battery_make:   f.battery_make,
      battery_model:  f.battery_model,
    });

    const patch = {
      inverter_make:               f.inverter_make,
      inverter_model:              f.inverter_model,
      inverter_serial:             f.inverter_serial,
      battery_make:                f.battery_make || null,
      battery_model:               f.battery_model || null,
      battery_serial:              f.battery_serial || null,
      panel_make:                  f.panel_make,
      panel_model:                 f.panel_model,
      panel_warranty_until:        f.panel_warranty_until || null,
      inverter_warranty_until:     f.inverter_warranty_until || null,
      battery_warranty_until:      f.battery_warranty_until || null,
      workmanship_warranty_until:  f.workmanship_warranty_until || null,
      monitoring_provider:         f.monitoring_provider || null,
      monitoring_external_id:      f.monitoring_external_id || null,
      vpp_capable_hardware:        vppCapable,
      vpp_consented:               f.vpp_consented === true,
      commissioned_at:             f.commissioned_at || new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('projects_v2')
      .update(patch)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    await writeEvent(req, {
      project_id: id, lane: 'operations', item_key: 'commissioning_form',
      event_type: 'state_changed',
      payload: { from: 'submitted', to: 'asset_populated', vpp_capable: vppCapable },
    });

    res.json({ project: data, vpp_capable_hardware: vppCapable });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/pm/vpp-catalog — exposes VPP-compatible hardware list ────────
router.get('/_/vpp-catalog', async (_req, res) => {
  res.json(vppHardwareCatalog());
});

// ── DELETE /api/pm/projects/:id — soft cancel (sets status='cancelled') ────
router.delete('/:id', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { reason } = req.body || {};
    const { error } = await supabaseAdmin
      .from('projects_v2')
      .update({ status: 'cancelled', cancel_reason: reason || null })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

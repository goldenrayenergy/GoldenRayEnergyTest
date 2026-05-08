// ────────────────────────────────────────────────────────────────────────────
// PM tool — artifact endpoints (mounted at /api/pm/projects/:id/artifacts)
//
//   POST   /              — upload a file (multipart) for a lane item
//   GET    /              — list artifacts for the project
//   GET    /:artifactId/url — get a signed download URL (1h)
//   DELETE /:artifactId   — soft-delete (file removed from storage too)
//
// Item-level metadata (notes, structured fields) is stored in the project's
// lane_status JSONB under items.{itemKey}.meta. Patched via the existing
// /lanes/:lane endpoint extension (item_meta payload).
// ────────────────────────────────────────────────────────────────────────────

import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../../middleware/auth.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { uploadArtifact, getSignedUrl, deleteArtifact, ensureBucket } from '../../services/pm/storageService.js';
import { LANES } from '../../services/pm/laneDefinitions.js';

const router = Router({ mergeParams: true });
router.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },  // 25 MB / file
});

// Lazy-create the bucket on first request — idempotent.
let bucketReady = false;
async function ensureBucketOnce() {
  if (bucketReady) return;
  try {
    await ensureBucket();
    bucketReady = true;
  } catch (e) {
    console.error('PM bucket setup warning:', e.message);
  }
}

// ── GET /api/pm/projects/:id/artifacts — list ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { id } = req.params;

    let q = supabaseAdmin
      .from('project_artifacts')
      .select('*')
      .eq('project_id', id)
      .order('uploaded_at', { ascending: false });

    if (req.query.lane)         q = q.eq('swim_lane', req.query.lane);
    if (req.query.artifact_type) q = q.eq('artifact_type', req.query.artifact_type);

    const { data, error } = await q;
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/pm/projects/:id/artifacts — upload ───────────────────────────
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded (field name: file)' });

    const { id } = req.params;
    const { swim_lane, artifact_type, item_key, notes } = req.body;

    if (!LANES.includes(swim_lane)) {
      return res.status(400).json({ error: `Invalid swim_lane: ${swim_lane}` });
    }
    if (!artifact_type) {
      return res.status(400).json({ error: 'artifact_type is required' });
    }

    await ensureBucketOnce();

    // Verify project exists
    const { data: project, error: pErr } = await supabaseAdmin
      .from('projects_v2').select('id').eq('id', id).single();
    if (pErr || !project) return res.status(404).json({ error: 'Project not found' });

    const stored = await uploadArtifact({
      projectId: id,
      swimLane:  swim_lane,
      fileName:  req.file.originalname,
      mimeType:  req.file.mimetype,
      buffer:    req.file.buffer,
    });

    const insertRow = {
      project_id:     id,
      swim_lane,
      artifact_type,
      file_url:       stored.path,                // store the storage path; sign on download
      file_size_bytes: req.file.size,
      mime_type:      req.file.mimetype,
      uploaded_by:    req.user?.id || null,
      is_required:    false,
      metadata:       { item_key: item_key || null, notes: notes || null, original_name: req.file.originalname },
    };

    const { data, error } = await supabaseAdmin
      .from('project_artifacts')
      .insert(insertRow)
      .select()
      .single();
    if (error) throw error;

    res.status(201).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/pm/projects/:id/artifacts/:artifactId/url — signed URL ────────
router.get('/:artifactId/url', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { id, artifactId } = req.params;

    const { data, error } = await supabaseAdmin
      .from('project_artifacts')
      .select('id, project_id, file_url, mime_type, metadata')
      .eq('id', artifactId)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Artifact not found' });
    if (data.project_id !== id) return res.status(403).json({ error: 'Project mismatch' });
    if (!data.file_url)        return res.status(404).json({ error: 'No file attached' });

    const url = await getSignedUrl(data.file_url);
    res.json({ url, mime_type: data.mime_type, original_name: data.metadata?.original_name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/pm/projects/:id/artifacts/:artifactId ──────────────────────
router.delete('/:artifactId', async (req, res) => {
  try {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database not configured.' });
    const { id, artifactId } = req.params;

    const { data: art, error: fetchErr } = await supabaseAdmin
      .from('project_artifacts')
      .select('id, project_id, file_url')
      .eq('id', artifactId)
      .single();
    if (fetchErr || !art) return res.status(404).json({ error: 'Artifact not found' });
    if (art.project_id !== id) return res.status(403).json({ error: 'Project mismatch' });

    if (art.file_url) {
      try { await deleteArtifact(art.file_url); }
      catch (e) { console.warn('Storage delete failed (continuing):', e.message); }
    }

    const { error: delErr } = await supabaseAdmin
      .from('project_artifacts')
      .delete()
      .eq('id', artifactId);
    if (delErr) throw delErr;

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;

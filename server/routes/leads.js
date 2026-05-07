import { Router } from 'express';
import Contact from '../models/Contact.js';
import { authenticate } from '../middleware/auth.js';
import { createProjectFromContact } from '../services/projectService.js';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();
router.use(authenticate);

// Promote a qualified lead (contact) to an operational project.
// Called by the "Promote to Project" button on the pipeline page after
// the sales rep has confirmed the customer through the cadence.
// Side effects: creates a project, bumps the contact stage to 'qualified'
// if still early, logs an activity.
router.post('/:id/promote-to-project', async (req, res) => {
  try {
    const result = await createProjectFromContact(req.params.id);
    if (result.alreadyExists) {
      return res.status(409).json({
        error: 'This contact already has a project',
        projectId: result.projectId,
        projectCode: result.projectCode,
      });
    }
    // Move the contact forward in the pipeline if it's still in the early stages
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('stage')
      .eq('id', req.params.id)
      .single();
    if (contact && ['new', 'contacted'].includes(contact.stage)) {
      await supabaseAdmin.from('contacts').update({ stage: 'qualified' }).eq('id', req.params.id);
    }
    res.status(201).json(result.project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/', async (req, res) => {
  try { res.json(await Contact.findAll(req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/stats', async (req, res) => {
  try {
    const [stages, sources, regions] = await Promise.all([
      Contact.getStats(), Contact.getBySource(), Contact.getByRegion()
    ]);
    res.json({ stages, sources, regions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const c = await Contact.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Contact not found' });
    res.json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await Contact.create(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', async (req, res) => {
  try { res.json(await Contact.update(req.params.id, req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await Contact.delete(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

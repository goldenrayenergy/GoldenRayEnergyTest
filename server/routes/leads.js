import { Router } from 'express';
import Contact from '../models/Contact.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

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

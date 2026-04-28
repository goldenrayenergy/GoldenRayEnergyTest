import { Router } from 'express';
import Deal from '../models/Deal.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  try { res.json(await Deal.findAll(req.query)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/pipeline', async (req, res) => {
  try { res.json(await Deal.getPipelineStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/forecast', async (req, res) => {
  try { res.json(await Deal.getForecast()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const d = await Deal.findById(req.params.id);
    if (!d) return res.status(404).json({ error: 'Deal not found' });
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await Deal.create(req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id', async (req, res) => {
  try { res.json(await Deal.update(req.params.id, req.body)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
  try { await Deal.delete(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;

import { Router } from 'express';
import Activity from '../models/Activity.js';
import { authenticate } from '../middleware/auth.js';
const router = Router();
router.use(authenticate);
router.get('/', async (req, res) => { try { res.json(await Activity.findAll(req.query)); } catch(e) { res.status(500).json({error:e.message}); } });
router.post('/', async (req, res) => { try { req.body.user_id = req.user.id; res.status(201).json(await Activity.create(req.body)); } catch(e) { res.status(500).json({error:e.message}); } });
export default router;

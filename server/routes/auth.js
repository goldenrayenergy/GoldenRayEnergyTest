import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import env from '../config/env.js';
import { authenticate } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';

const router = Router();

// Demo users for seeding
const DEMO_USERS = [
  { id: 'a1a1a1a1-0000-0000-0000-000000000001', name: 'Aroha Mitchell', email: 'aroha@goldenray.co.nz', password: 'admin123', role: 'admin' },
  { id: 'a1a1a1a1-0000-0000-0000-000000000002', name: 'Liam Patel', email: 'liam@goldenray.co.nz', password: 'manager123', role: 'sales_mgr' },
  { id: 'a1a1a1a1-0000-0000-0000-000000000003', name: 'Sophie Nguyen', email: 'sophie@goldenray.co.nz', password: 'sales123', role: 'sales_exec' },
  { id: 'a1a1a1a1-0000-0000-0000-000000000004', name: 'Jack Te Awa', email: 'jack@goldenray.co.nz', password: 'proposal123', role: 'proposal_mgr' },
];

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await User.verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name, avatar: user.avatar },
      env.jwt.secret,
      { expiresIn: env.jwt.expiresIn }
    );

    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Debug endpoint to seed demo users
router.post('/seed-demo-users', async (req, res) => {
  try {
    const results = [];
    for (const demoUser of DEMO_USERS) {
      try {
        const passwordHash = await bcrypt.hash(demoUser.password, 10);
        const newUser = await User.create({
          name: demoUser.name,
          email: demoUser.email,
          password: demoUser.password,
          role: demoUser.role,
          avatar: demoUser.name.split(' ').map(w => w[0]).join('')
        });
        results.push({ email: demoUser.email, status: 'created', id: newUser.id });
      } catch (e) {
        results.push({ email: demoUser.email, status: 'error', message: e.message });
      }
    }
    res.json({ message: 'Seed attempt complete', results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/users', authenticate, async (req, res) => {
  try { res.json(await User.findAll()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;

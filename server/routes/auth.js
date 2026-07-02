import { Router } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import env from '../config/env.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    // Reject disabled users at login time. Previously the login flow only
    // checked the password hash, so setting is_active=false in the DB did
    // NOT block sign-in. Now it does.
    if (user.is_active === false) return res.status(401).json({ error: 'Invalid credentials' });

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

// The old POST /seed-demo-users endpoint has been removed. It was a debug
// helper that hard-coded plaintext passwords (admin123, manager123, etc.)
// and inserted them into the users table without any auth check — meaning
// anyone on the internet could POST to /api/auth/seed-demo-users and mint
// four working demo accounts, including admin. Demo/seed data is now
// exclusively handled by server/db/seed-only.js (run manually via
// `npm run seed` in development). See project-demographic-provenance
// memory for the plan to sanitise those seed emails to real addresses.

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

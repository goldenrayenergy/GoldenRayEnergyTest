import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import leadRoutes from './routes/leads.js';
import dealRoutes from './routes/deals.js';
import companyRoutes from './routes/companies.js';
import campaignRoutes from './routes/campaigns.js';
import taskRoutes from './routes/tasks.js';
import activityRoutes from './routes/activities.js';
import reportRoutes from './routes/reports.js';
import proposalRoutes from './routes/proposals.js';
import configRoutes from './routes/config.js';
import quoteRoutes from './routes/quote.js';
import otpRoutes from './routes/otp.js';
import financeRoutes from './routes/finance.js';
import enquiryRoutes from './routes/enquiries.js';
import projectRoutes from './routes/projects.js';

dotenv.config({ path: '../.env' });

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ──
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

// ── Root Endpoint ──
app.get('/', (req, res) => {
  res.json({
    name: '☀️ GoldenRay Energy — Solar CRM API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      leads: '/api/leads',
      deals: '/api/deals',
      companies: '/api/companies',
      campaigns: '/api/campaigns',
      tasks: '/api/tasks',
      activities: '/api/activities',
      reports: '/api/reports',
      proposals: '/api/proposals',
      config: '/api/config'
    },
    timestamp: new Date().toISOString()
  });
});

// ── API Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/proposals', proposalRoutes);
app.use('/api/config', configRoutes);
app.use('/api/quote', quoteRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/projects', projectRoutes);

// ── Health Check ──
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Error Handler ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: { message: err.message || 'Internal server error', ...(process.env.NODE_ENV === 'development' && { stack: err.stack }) }
  });
});

app.listen(PORT, () => console.log(`⚡ GoldenRay API running on port ${PORT}`));
export default app;

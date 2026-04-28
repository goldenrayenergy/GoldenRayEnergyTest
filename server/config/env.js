import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

export default {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT) || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production-min32chars!',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  email: {
    sendgridKey: process.env.SENDGRID_API_KEY,
    from: process.env.EMAIL_FROM || 'hello@goldenrayenergy.co.nz',
    fromName: process.env.EMAIL_FROM_NAME || 'GoldenRay Energy',
  },
  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  solar: {
    costPerKw: 1850, batteryCostPerKwh: 890, taxRate: 15, markup: 12,
    defaultElecRate: 0.32, laborPct: 18, panelWatts: 550, sunHours: 4.5, inverterPct: 14,
    co2Factor: 0.098,
  },
};

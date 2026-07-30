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
    // Refuse to boot in production without a real JWT_SECRET. The dev
    // fallback below was previously the effective secret on any Render
    // deploy that forgot to set the env var — meaning anyone reading this
    // file could forge admin tokens. Never again.
    secret: (() => {
      if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
      if ((process.env.NODE_ENV || 'development') === 'production') {
        throw new Error(
          '[env] JWT_SECRET must be set in production. Refusing to boot. ' +
          'Set JWT_SECRET on Render (32+ random characters) before deploying.'
        );
      }
      return 'dev-secret-change-in-production-min32chars!';
    })(),
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  email: {
    from: process.env.EMAIL_FROM || 'info@goldenrayenergy.nz',
    fromName: process.env.EMAIL_FROM_NAME || 'Goldenray Energy NZ',
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
  googleSolar: {
    // Fail-hard in production if the feature is enabled but no key is set.
    // Better than silently no-op'ing in prod and leaving admin to notice
    // hours later that no roof analyses are landing. Matches the JWT_SECRET
    // pattern above. In dev the key is optional — client.js has a log-only
    // fallback (see services/googleSolar/client.js).
    apiKey: (() => {
      if (process.env.GOOGLE_SOLAR_API_KEY) return process.env.GOOGLE_SOLAR_API_KEY;
      if (process.env.FEATURE_GOOGLE_SOLAR === 'true'
          && (process.env.NODE_ENV || 'development') === 'production') {
        throw new Error(
          '[env] FEATURE_GOOGLE_SOLAR=true in production but GOOGLE_SOLAR_API_KEY is not set. ' +
          'Set GOOGLE_SOLAR_API_KEY on Render before enabling this feature, or set FEATURE_GOOGLE_SOLAR=false.'
        );
      }
      return null;
    })(),
    enabled: process.env.FEATURE_GOOGLE_SOLAR === 'true',
    monthlyQuota: parseInt(process.env.GOOGLE_SOLAR_MONTHLY_QUOTA) || 1000,
    alertAtPct: parseInt(process.env.GOOGLE_SOLAR_ALERT_AT_PCT) || 80,
    adminEmail: process.env.GOOGLE_SOLAR_ADMIN_EMAIL || 'reddy@goldenrayenergy.nz',
  },
};

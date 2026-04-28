import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

// ── Connect to Supabase PostgreSQL via connection pooler ──
// Uses DATABASE_URL from Supabase Dashboard → Settings → Database → Connection string
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },  // Required for Supabase
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => console.log('⚡ Connected to Supabase PostgreSQL'));
pool.on('error', (err) => console.error('❌ Supabase DB error:', err.message));

export const query = (text, params) => pool.query(text, params);
export const getClient = () => pool.connect();
export default pool;

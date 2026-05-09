import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

// ── Connect to Supabase PostgreSQL via connection pooler ──
//
// Mirrors the apply-migration script connection pattern: tries both
// SUPABASE_DATABASE_URL and DATABASE_URL env vars, strips any sslmode
// parameter from the URL (which conflicts with the explicit ssl option
// below and causes "self signed certificate in certificate chain" errors
// in Node), and sets rejectUnauthorized: false (required for Supabase
// pooled connections).
let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || '';
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => console.log('⚡ Connected to Supabase PostgreSQL'));
pool.on('error', (err) => console.error('❌ Supabase DB error:', err.message));

export const query = (text, params) => pool.query(text, params);
export const getClient = () => pool.connect();
export default pool;

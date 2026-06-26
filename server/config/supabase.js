import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve the repo-root .env relative to THIS file, not the process cwd, so env
// loads identically whether started from server/ (prod: node app.js) or from the
// repo root (tests/scripts). dotenv never overrides already-set vars, so on
// Render (env injected directly) this is a harmless no-op.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ── Supabase JS Client ──
// Used for: Realtime subscriptions, Storage (proposal PDFs), and optional Supabase Auth
// For raw SQL queries, use db.js (pg pool) instead

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — Supabase client disabled');
}

// Service role client (server-side only — bypasses RLS)
export const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// Create a client scoped to a user's JWT (for RLS-aware queries)
export function createUserClient(accessToken) {
  return createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export default supabaseAdmin;

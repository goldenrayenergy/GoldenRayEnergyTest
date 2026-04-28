# Supabase Setup Guide for GoldenRay Energy

## Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **New Project**
3. Choose your organization, set a project name (e.g. `goldenray`), database password, and region
4. Wait for the project to finish provisioning (~2 minutes)

## Step 2 — Get your credentials

In the Supabase Dashboard, go to **Project Settings** (gear icon):

| Credential | Where to find it | .env variable |
|---|---|---|
| Project URL | Settings → API → Project URL | `SUPABASE_URL` |
| Anon key | Settings → API → `anon` `public` | `SUPABASE_ANON_KEY` |
| Service role key | Settings → API → `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |
| Database URL | Settings → Database → Connection string → URI (Session pooler) | `DATABASE_URL` |

## Step 3 — Run the schema

Option A — **SQL Editor** (recommended):

1. In Supabase Dashboard, go to **SQL Editor**
2. Click **New query**
3. Copy the entire contents of `server/db/schema.sql` and paste it
4. Click **Run** — all 10 tables, indexes, and triggers will be created

Option B — **Command line** (requires psql):

```bash
psql "postgresql://postgres.YOUR_PROJECT_ID:YOUR_PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres" -f server/db/schema.sql
```

## Step 4 — Seed demo data

1. In SQL Editor, open a new query
2. Paste the contents of `server/db/seed.sql`
3. Click **Run**

**Important:** The seed file has placeholder bcrypt hashes. Generate real ones:

```bash
cd server
node -e "import('bcryptjs').then(b => b.default.hash('admin123', 10).then(h => console.log(h)))"
```

Then update the hashes in the seed SQL before running.

## Step 5 — Configure .env

```bash
cp .env.example .env
```

Edit `.env` and paste your Supabase credentials:

```env
SUPABASE_URL=https://abc123xyz.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJI...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJI...
DATABASE_URL=postgresql://postgres.abc123xyz:YourPassword@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
```

## Step 6 — Create storage bucket (for proposals)

1. In Supabase Dashboard, go to **Storage**
2. Click **New bucket**
3. Name it `proposals`
4. Toggle **Public bucket** on (so PDFs can be shared via URL)

## Step 7 — Enable realtime (optional)

1. Go to **Database → Replication**
2. Under "Source", toggle on the tables you want realtime for:
   - `deals` — live deal pipeline updates
   - `contacts` — contact stage changes
   - `activities` — activity feed
   - `tasks` — task completions

## Step 8 — Run the app

```bash
npm run install:all
npm run dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:5000
- Both connect to your Supabase PostgreSQL instance

## Architecture

```
React Client (5173)
  ├── Axios → Express API (5000) → pg pool → Supabase PostgreSQL
  ├── @supabase/supabase-js → Realtime subscriptions
  └── Vite proxy /api → localhost:5000

Express Server (5000)
  ├── pg pool (DATABASE_URL) → SQL queries → Supabase PostgreSQL
  ├── @supabase/supabase-js (service role) → Storage uploads
  └── JWT auth (local) — not using Supabase Auth
```

The project uses Supabase as a **managed PostgreSQL host** with optional **Realtime** and **Storage**. All auth stays as local JWT — you can migrate to Supabase Auth later if needed.

## Connection modes

| Mode | Port | When to use |
|---|---|---|
| Session pooler | 5432 | Long-lived server (Express on VM/container) |
| Transaction pooler | 6543 | Serverless (Vercel, Netlify functions) |
| Direct connection | 5432 | Migrations, schema changes only |

Use **Session pooler** for this Express server (default in the template).

## Row Level Security (optional)

The project works without RLS since the Express server uses the service role key. To add RLS:

1. Enable RLS on each table in Supabase Dashboard
2. Add policies (e.g. `auth.uid() = assigned_to` for contacts)
3. Use the user-scoped client in routes instead of the admin client

## Troubleshooting

**"connection refused"** — Check your DATABASE_URL includes the correct password and region

**"SSL required"** — The db.js config already includes `ssl: { rejectUnauthorized: false }`

**"permission denied"** — Make sure you're using the service_role key on the server, not the anon key

**"relation does not exist"** — Run schema.sql first via SQL Editor

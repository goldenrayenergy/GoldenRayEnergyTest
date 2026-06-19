// Recursively delete every object in the pm-quotes Storage bucket.
// Pair with flush-quotes.js — DB-side flush leaves storage files orphaned.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const BUCKET = 'pm-quotes';

async function listAll(prefix = '') {
  const out = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    if (!data?.length) break;
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) out.push(full);            // it's a file
      else out.push(...await listAll(full));   // it's a folder
    }
    if (data.length < 1000) break;
    offset += 1000;
  }
  return out;
}

const all = await listAll();
console.log(`Found ${all.length} objects in pm-quotes bucket.`);
if (!all.length) { console.log('Nothing to delete.'); process.exit(0); }

// Delete in batches of 100 (Supabase limit)
let deleted = 0;
for (let i = 0; i < all.length; i += 100) {
  const batch = all.slice(i, i + 100);
  const { error } = await sb.storage.from(BUCKET).remove(batch);
  if (error) { console.error('Batch failed:', error.message); process.exit(1); }
  deleted += batch.length;
}
console.log(`Deleted ${deleted} objects from pm-quotes bucket.`);

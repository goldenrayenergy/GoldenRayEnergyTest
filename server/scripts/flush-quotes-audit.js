// Read-only audit: count what we'd touch if we flush all quotes.
// No writes. Run this first.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const hr = (t) => { console.log(); console.log('━'.repeat(100)); console.log(' ' + t); console.log('━'.repeat(100)); };

hr('Database target');
console.log(`Supabase URL: ${process.env.SUPABASE_URL}`);

// ── 1. quotes + quote_versions ───────────────────────────────────────────
hr('quotes — current contents');
const { data: quotes, error: qErr } = await sb.from('quotes')
  .select('id, quote_ref, status, contact_id, current_version_id, created_at, updated_at')
  .order('created_at', { ascending: true });
if (qErr) { console.error(qErr); process.exit(1); }

console.log(`Total quotes: ${quotes.length}`);
if (quotes.length) {
  const byStatus = {};
  for (const q of quotes) byStatus[q.status || '<null>'] = (byStatus[q.status || '<null>'] || 0) + 1;
  console.log('Breakdown by status:');
  for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s.padEnd(20)} ${n}`);
  console.log();
  console.log('Recent quotes:');
  for (const q of quotes.slice(-15)) {
    console.log(`  ${q.created_at?.slice(0, 19)}  ${(q.quote_ref || '<no-ref>').padEnd(28)}  ${q.status}`);
  }
}

const { count: vCount } = await sb.from('quote_versions')
  .select('*', { count: 'exact', head: true });
console.log();
console.log(`quote_versions rows: ${vCount}`);

// ── 2. Related tables that reference quotes ─────────────────────────────
hr('Related tables');

async function tryCount(table, filterCol = 'quote_id') {
  // tolerate table-not-found by returning null
  try {
    const { count, error } = await sb.from(table)
      .select('*', { count: 'exact', head: true });
    if (error) return null;
    return count;
  } catch {
    return null;
  }
}

const tables = [
  'quote_run_log',         // engine run audit
  'quote_actions',         // quote actions log
  'quote_audit',           // audit log
  'quote_pdf',             // pdf metadata
  'quote_signatures',      // signed quotes
  'quote_views',           // viewer-log
  'magic_links',           // signed-link tokens
  'engagement_events',     // tracking events
];
for (const t of tables) {
  const c = await tryCount(t);
  if (c === null) console.log(`  ${t.padEnd(28)} — (no such table)`);
  else            console.log(`  ${t.padEnd(28)} ${c} rows`);
}

// ── 3. Storage objects (PDFs in quote-pdfs bucket) ──────────────────────
hr('Storage — quote PDFs');
async function listBucketTopLevel(bucket) {
  try {
    const { data, error } = await sb.storage.from(bucket).list('', { limit: 1000 });
    if (error) { console.log(`  ${bucket}: ${error.message}`); return null; }
    return data || [];
  } catch (e) { console.log(`  ${bucket}: ${e.message}`); return null; }
}

for (const bucket of ['quote-pdfs', 'quote_pdfs', 'pm-quote-pdfs', 'proposal-pdfs']) {
  const items = await listBucketTopLevel(bucket);
  if (items) console.log(`  bucket "${bucket}": ${items.length} top-level entries`);
}

// ── 4. What we WILL NOT touch ───────────────────────────────────────────
hr('NOT in flush scope (kept)');
const { count: contacts } = await sb.from('contacts').select('*', { count: 'exact', head: true });
const { count: bills } = await sb.from('bill_analyses').select('*', { count: 'exact', head: true });
const { count: products } = await sb.from('products').select('*', { count: 'exact', head: true });
console.log(`  contacts: ${contacts}`);
console.log(`  bill_analyses: ${bills}`);
console.log(`  products: ${products}`);

console.log();
console.log('━'.repeat(100));
console.log('Audit complete — NO WRITES PERFORMED.');
console.log('━'.repeat(100));

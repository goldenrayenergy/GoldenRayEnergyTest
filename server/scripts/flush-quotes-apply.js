// Flush ALL quotes + quote_versions + quote_run_log from production Supabase.
// User-confirmed via "yes flush all" — running unconditionally.
//
// Order matters because of the circular FK between quotes.current_version_id
// and quote_versions.quote_id. We null out current_version_id first, then
// delete in safe order.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const line = () => console.log('━'.repeat(80));

console.log(`Target: ${process.env.SUPABASE_URL}`);
console.log();

// ── 0. Pre-flush counts ──────────────────────────────────────────────────
async function count(table) {
  const { count } = await sb.from(table).select('*', { count: 'exact', head: true });
  return count;
}
const before = {
  quotes: await count('quotes'),
  quote_versions: await count('quote_versions'),
  quote_run_log: await count('quote_run_log'),
};
console.log('Before:', before);
line();

// ── 1. NULL out quotes.current_version_id to break the circular FK ──────
console.log('Step 1: NULL out quotes.current_version_id…');
// PostgREST DELETE/UPDATE requires a filter — use a sentinel that matches all
// rows. `is.not.null` would miss rows already null; use `id.not.is.null`.
const { error: u1 } = await sb.from('quotes')
  .update({ current_version_id: null })
  .not('id', 'is', null);
if (u1) { console.error('UPDATE failed:', u1.message); process.exit(1); }
console.log('  ✓ current_version_id cleared.');

// ── 2. Delete quote_run_log ─────────────────────────────────────────────
console.log('Step 2: DELETE quote_run_log…');
const { error: d1 } = await sb.from('quote_run_log')
  .delete()
  .not('id', 'is', null);
if (d1) { console.error('DELETE failed:', d1.message); process.exit(1); }
console.log('  ✓ quote_run_log emptied.');

// ── 3. Delete quote_versions ────────────────────────────────────────────
console.log('Step 3: DELETE quote_versions…');
const { error: d2 } = await sb.from('quote_versions')
  .delete()
  .not('id', 'is', null);
if (d2) { console.error('DELETE failed:', d2.message); process.exit(1); }
console.log('  ✓ quote_versions emptied.');

// ── 4. Delete quotes ────────────────────────────────────────────────────
console.log('Step 4: DELETE quotes…');
const { error: d3 } = await sb.from('quotes')
  .delete()
  .not('id', 'is', null);
if (d3) { console.error('DELETE failed:', d3.message); process.exit(1); }
console.log('  ✓ quotes emptied.');

line();

// ── 5. Verify ────────────────────────────────────────────────────────────
const after = {
  quotes: await count('quotes'),
  quote_versions: await count('quote_versions'),
  quote_run_log: await count('quote_run_log'),
};
console.log('After:', after);

const remaining = after.quotes + after.quote_versions + after.quote_run_log;
if (remaining !== 0) {
  console.error(`❌ ${remaining} rows remain — flush incomplete.`);
  process.exit(1);
}

line();
console.log('✅ Flush complete. All quote tables empty.');
console.log();
console.log('Untouched (verify):');
console.log(`  contacts:       ${await count('contacts')}`);
console.log(`  bill_analyses:  ${await count('bill_analyses')}`);
console.log(`  products:       ${await count('products')}`);

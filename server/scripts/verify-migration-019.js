// One-shot probe — checks whether migration 019 tables exist on the
// connected Supabase database. Runs via the same REST client the server
// uses, so it works even when the direct pg connection is DNS-blocked.
//
// Run:  node server/scripts/verify-migration-019.js
//
// Outputs ✅ for each table that responds to a SELECT, ❌ if the table
// doesn't exist or another error occurs. Also probes for the columns
// added to `products` in 019 (supplier_id, wholesale_cost_nzd, etc).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const supa = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const TABLES_019 = [
  'suppliers',
  'product_compatibility',
  'customer_profiles',
  'quote_recommendations',
  'region_defaults',
  'cost_defaults',
];

const NEW_PRODUCT_COLS = ['supplier_id', 'wholesale_cost_nzd', 'margin_target_pct', 'lead_time_days'];

console.log('─── Migration 019 — table probes ───');
let okCount = 0;
let missCount = 0;
for (const t of TABLES_019) {
  const { error, count } = await supa.from(t).select('*', { count: 'exact', head: true });
  if (error) {
    console.log(`❌ ${t.padEnd(26)} → ${error.message}`);
    missCount++;
  } else {
    console.log(`✅ ${t.padEnd(26)} → exists (${count ?? 0} rows)`);
    okCount++;
  }
}

console.log('\n─── Migration 019 — new columns on `products` ───');
const { data: probeRow, error: probeErr } = await supa.from('products').select(NEW_PRODUCT_COLS.join(',')).limit(1);
if (probeErr) {
  // If any column is missing, the whole select fails — try them one at a time
  console.log(`⚠️  Combined probe failed (${probeErr.message}) — testing per-column …`);
  for (const c of NEW_PRODUCT_COLS) {
    const { error } = await supa.from('products').select(c).limit(1);
    if (error) console.log(`❌ products.${c.padEnd(20)} → ${error.message}`);
    else      console.log(`✅ products.${c.padEnd(20)} → exists`);
  }
} else {
  for (const c of NEW_PRODUCT_COLS) {
    console.log(`✅ products.${c.padEnd(20)} → exists`);
  }
}

console.log('\n─── Summary ───');
console.log(`Tables present: ${okCount} / ${TABLES_019.length}`);
console.log(`Tables missing: ${missCount}`);
if (missCount === 0 && !probeErr) {
  console.log('\n✅ Migration 019 appears to be FULLY APPLIED.');
  process.exit(0);
} else {
  console.log('\n❌ Migration 019 is NOT fully applied. Apply via Supabase Studio paste:');
  console.log('   server/db/migrations/019_3quote_foundations.sql');
  process.exit(2);
}

// Diagnose: what do bill_analyses ACTUALLY look like, and why did my earlier
// script come up empty? Dump full rows for the relevant contacts.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

// 1) Find the relevant quote → contact_id mapping
const { data: quotes } = await sb.from('quotes')
  .select('quote_ref, contact_id')
  .in('quote_ref', ['PR-KRISHAN-2026-001', 'PR-YACHAMANENI-2026-001']);
console.log('Quotes + their contact_ids:');
for (const q of quotes) console.log(`  ${q.quote_ref}  contact_id=${q.contact_id}`);

// 2) Total bills in DB
const { count: total } = await sb.from('bill_analyses').select('*', { count: 'exact', head: true });
console.log(`\nTotal bill_analyses in DB: ${total}`);

// 3) Dump ALL columns for one row to see the actual schema
const { data: sample } = await sb.from('bill_analyses').select('*').limit(1);
if (sample?.length) {
  console.log(`\nSchema (columns of one sample row):`);
  console.log('  ' + Object.keys(sample[0]).join(', '));
}

// 4) Bills for the two contacts — pull EVERYTHING
for (const q of quotes) {
  console.log();
  console.log('━'.repeat(110));
  console.log(`  ${q.quote_ref}  (contact_id ${q.contact_id})`);
  console.log('━'.repeat(110));
  const { data: bills, error } = await sb.from('bill_analyses')
    .select('*')
    .eq('contact_id', q.contact_id)
    .order('created_at', { ascending: false });
  if (error) { console.log('  ERROR:', error.message); continue; }
  console.log(`  Found ${bills?.length || 0} bills for this contact.`);
  if (bills?.length) {
    for (const b of bills) {
      console.log(`  ─ bill ${b.id || b.analysis_id} created ${b.created_at}`);
      const keys = Object.keys(b);
      const summary = {};
      for (const k of keys) {
        const v = b[k];
        if (v == null) continue;
        if (typeof v === 'object') summary[k] = JSON.stringify(v).slice(0, 200);
        else summary[k] = String(v).slice(0, 100);
      }
      for (const [k, v] of Object.entries(summary)) console.log(`     ${k.padEnd(30)} ${v}`);
    }
  }
}

// 5) Also: any rows where contact_id is null but might be linked some other way?
console.log();
console.log('━'.repeat(110));
console.log('  Recent bills regardless of contact');
console.log('━'.repeat(110));
const { data: recent } = await sb.from('bill_analyses')
  .select('id, contact_id, created_at')
  .order('created_at', { ascending: false })
  .limit(10);
for (const b of recent || []) {
  console.log(`  ${b.created_at.slice(0,19)}  id=${b.id?.slice(0,8)}  contact_id=${b.contact_id?.slice(0,8) || 'null'}`);
}

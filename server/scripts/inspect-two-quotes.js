// Read-only: dump the 2 fresh quotes' specs side-by-side so we can see
// what's actually stored vs. what the user reports seeing.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const REFS = ['PR-KRISHAN-2026-001', 'PR-YACHAMANENI-2026-001'];
for (const ref of REFS) {
  console.log();
  console.log('═'.repeat(110));
  console.log('  ' + ref);
  console.log('═'.repeat(110));
  const { data: q } = await sb.from('quotes')
    .select('id, status, contact_id, current_version_id, created_at')
    .eq('quote_ref', ref).maybeSingle();
  if (!q) { console.log('  NOT FOUND'); continue; }
  const { data: v } = await sb.from('quote_versions')
    .select('id, version_number, spec, created_at')
    .eq('id', q.current_version_id).maybeSingle();
  if (!v) { console.log('  CURRENT VERSION NOT FOUND'); continue; }

  console.log(`status=${q.status}  version=${v.version_number}`);
  console.log(`top-level spec.system.panel:    ${JSON.stringify(v.spec.system?.panel)}`);
  console.log(`top-level spec.system.inverter: ${JSON.stringify(v.spec.system?.inverter)}`);
  console.log(`top-level spec.system.battery:  ${JSON.stringify(v.spec.system?.battery)}`);

  if (Array.isArray(v.spec.tiers)) {
    console.log(`\nTIERS (${v.spec.tiers.length}):`);
    v.spec.tiers.forEach((t, i) => {
      const sov = t.system_overrides || {};
      console.log(`  Tier ${i}: "${t.label}" ${t.is_recommended ? '★' : ''}`);
      console.log(`    panel:    ${JSON.stringify(sov.panel)}`);
      console.log(`    inverter: ${JSON.stringify(sov.inverter)}`);
      console.log(`    battery:  ${JSON.stringify(sov.battery)}`);
      console.log(`    wattpilot_included: ${sov.wattpilot_included}`);
      console.log(`    pricing.customer_price_inc_gst: ${t.pricing?.customer_price_inc_gst}`);
      console.log(`    pricing.discount: ${JSON.stringify(t.pricing?.discount)}`);
    });
  }

  // What did the bill analysis recommend?
  const { data: bill } = await sb.from('bill_analyses')
    .select('analysis_id, contact_id, system_recommendation, address_prefill, created_at')
    .eq('contact_id', q.contact_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  console.log(`\nbill_analysis system_recommendation: ${JSON.stringify(bill?.system_recommendation)}`);
}

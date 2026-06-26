// Walk the ICP write-through chain for a given contact (by email) and report
// where the data drops out. Useful when "ICP doesn't auto-populate" in the
// new-quote form.
//
// Usage:  node server/scripts/diagnose-icp-prefill.js <email>
//         node server/scripts/diagnose-icp-prefill.js saikrishna@gmail.com
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const email = process.argv[2];
if (!email) { console.log('Usage: node diagnose-icp-prefill.js <email>'); process.exit(0); }

console.log(`\n━━━ Diagnosing ICP prefill chain for ${email} ━━━\n`);

// 1. Contact
const { data: contacts, error: contactsErr } = await sb.from('contacts')
  .select('id, name, email, street, suburb, city, postcode, icp_number, created_at')
  .ilike('email', email).order('created_at', { ascending: false });
if (contactsErr) { console.error('Lookup error:', contactsErr.message); process.exit(1); }
console.log(`Found ${contacts?.length || 0} contacts with this email:\n`);
for (const c of contacts || []) {
  console.log(`  [${c.id.slice(0,8)}…]  ${c.name}`);
  console.log(`     icp_number:  ${c.icp_number || '(null)'}`);
  console.log(`     address:     ${[c.street, c.suburb, c.city, c.postcode].filter(Boolean).join(', ') || '(empty)'}`);
  console.log(`     created_at:  ${c.created_at}\n`);
}

if (!contacts?.length) { console.log('No contact — nothing to diagnose.'); process.exit(0); }

const contact = contacts[0];

// 2. bill_analyses for this contact
const { data: analyses } = await sb.from('bill_analyses')
  .select('id, contact_id, icp_number, postcode, region, status, recommended_system_kw, created_at')
  .eq('contact_id', contact.id).order('created_at', { ascending: false });

console.log(`bill_analyses for contact ${contact.id.slice(0,8)}…: ${analyses?.length || 0}`);
for (const a of analyses || []) {
  console.log(`  [${a.id.slice(0,8)}…]  ${a.created_at}  status=${a.status}`);
  console.log(`     icp_number:           ${a.icp_number || '(null)'}`);
  console.log(`     postcode:             ${a.postcode || '(null)'}`);
  console.log(`     region:               ${a.region || '(null)'}`);
  console.log(`     recommended_system:   ${a.recommended_system_kw || '(null)'} kW\n`);
}

if (!analyses?.length) { console.log('No analyses — cannot prefill.'); process.exit(0); }

const latest = analyses[0];

// 3. bill_uploads (source of ICP)
const { data: uploads } = await sb.from('bill_uploads')
  .select('id, analysis_id, file_name, icp_number, service_address, retailer')
  .eq('analysis_id', latest.id);

console.log(`bill_uploads for analysis ${latest.id.slice(0,8)}…: ${uploads?.length || 0}`);
for (const u of uploads || []) {
  console.log(`  [${u.id.slice(0,8)}…]  ${u.file_name}  retailer=${u.retailer || '(null)'}`);
  console.log(`     icp_number:       ${u.icp_number || '(null)'}`);
  console.log(`     service_address:  ${u.service_address || '(null)'}\n`);
}

// 4. What latestBillAnalysis API would return
console.log(`━━━ What /pm/contacts/${contact.id}/latest-bill-analysis would return ━━━\n`);
const REGION_MAP = {
  auckland: 'auckland_vector', wellington: 'wellington', canterbury: 'canterbury',
  // (abbreviated map — see contacts.js for full)
};
const engineRegion = latest.region ? REGION_MAP[latest.region.toLowerCase()] || null : null;
console.log(`  address_prefill.icp_number:   ${latest.icp_number || '(null)'}`);
console.log(`  address_prefill.postcode:     ${latest.postcode || '(null)'}`);
console.log(`  address_prefill.region:       ${engineRegion}`);
console.log(`  system_recommendation.kW:     ${latest.recommended_system_kw || '(null)'}\n`);

// 5. Diagnosis
console.log(`━━━ Diagnosis ━━━\n`);
const hasIcpAnywhere = (uploads || []).some(u => u.icp_number) || latest.icp_number || contact.icp_number;
if (!hasIcpAnywhere) {
  console.log(`  ✗ NO ICP anywhere in the chain — parser didn't extract it from any bill.`);
  console.log(`     • Either the bill PDF doesn't have an ICP line, or the parser missed it.`);
  console.log(`     • Solution: rep types ICP manually in the Customer tab.`);
} else if ((uploads || []).some(u => u.icp_number) && !latest.icp_number) {
  console.log(`  ✗ bill_uploads HAS an ICP but bill_analyses does NOT — buildAnalysisRow didn't write through.`);
  console.log(`     • This analysis was created BEFORE the Bug #6 fix landed.`);
  console.log(`     • Re-upload the bills to trigger a fresh analysis with ICP carried forward.`);
} else if (latest.icp_number && !contact.icp_number) {
  console.log(`  ✗ bill_analyses HAS an ICP but contact does NOT — writeAddressThroughToContact didn't write through.`);
  console.log(`     • The contact had a non-placeholder existing value, OR contact was created before the fix.`);
  console.log(`     • Solution: re-upload bills, OR manually patch contacts.icp_number from the analysis.`);
} else if (contact.icp_number) {
  console.log(`  ✓ ICP present on contact (${contact.icp_number}) — should auto-populate in the form.`);
  console.log(`     • If form is still empty, check QuoteNewPage's spread (likely a hard browser reload needed).`);
}

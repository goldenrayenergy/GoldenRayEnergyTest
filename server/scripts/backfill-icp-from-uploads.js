// One-off backfill: when bill_uploads has an ICP / service_address but the
// parent bill_analyses row + linked contact don't, propagate them now.
//
// Safe to re-run — only fills NULLs, never overwrites existing values.
// Mirrors Bug #6's runtime write-through (pickDominantIcp + writeAddressThroughToContact).
//
// Usage:  node server/scripts/backfill-icp-from-uploads.js
//         node server/scripts/backfill-icp-from-uploads.js --dry-run
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { splitNzAddress } from '../routes/billAnalysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const dryRun = process.argv.includes('--dry-run');
console.log(`Backfill ICP + service_address from bill_uploads → bill_analyses + contacts`);
console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'APPLY'}\n`);

function isPlaceholderText(s) {
  if (!s) return true;
  const t = String(s).trim();
  if (!t) return true;
  if (/^(unknown|n\/?a|null|none|-+|website enquiry)$/i.test(t)) return true;
  if (/^[A-Z]{2,4}-\d{4}/.test(t)) return true;
  return false;
}

function pickDominantIcp(uploads) {
  const counts = new Map();
  for (const u of uploads || []) {
    const icp = (u?.icp_number || '').trim();
    if (!icp) continue;
    counts.set(icp, (counts.get(icp) || 0) + 1);
  }
  if (!counts.size) return null;
  let best = null, bestN = -1;
  for (const [icp, n] of counts) if (n > bestN) { best = icp; bestN = n; }
  return best;
}

// 1. Find every bill_analyses row missing icp_number that has uploads with one
const { data: analyses, error: aErr } = await sb.from('bill_analyses')
  .select('id, contact_id, icp_number, postcode')
  .is('icp_number', null);
if (aErr) { console.error('Lookup failed:', aErr.message); process.exit(1); }

console.log(`Found ${analyses?.length || 0} bill_analyses rows with null icp_number\n`);

let analysesUpdated = 0;
let contactsUpdated = 0;

for (const a of analyses || []) {
  const { data: uploads } = await sb.from('bill_uploads')
    .select('icp_number, service_address')
    .eq('analysis_id', a.id);

  const icp = pickDominantIcp(uploads);
  const firstAddr = (uploads || []).find(u => u.service_address)?.service_address || null;

  if (!icp && !firstAddr) continue;       // nothing to backfill

  // Update bill_analyses
  const anaUpdates = {};
  if (icp) anaUpdates.icp_number = icp;
  // Postcode — try the bill's service_address if analysis postcode is null
  if (!a.postcode && firstAddr) {
    const split = splitNzAddress(firstAddr);
    if (split.postcode) anaUpdates.postcode = split.postcode;
  }
  if (Object.keys(anaUpdates).length > 0) {
    console.log(`  bill_analyses ${a.id.slice(0,8)}…  ← ${JSON.stringify(anaUpdates)}`);
    if (!dryRun) {
      const { error } = await sb.from('bill_analyses').update(anaUpdates).eq('id', a.id);
      if (error) console.error(`    ✗ ${error.message}`);
      else analysesUpdated++;
    } else analysesUpdated++;
  }

  // Update contact (placeholder-only guard, mirrors runtime writeAddressThroughToContact)
  if (a.contact_id) {
    const { data: contact } = await sb.from('contacts')
      .select('id, name, street, suburb, city, postcode, icp_number')
      .eq('id', a.contact_id).maybeSingle();
    if (contact) {
      const cUpdates = {};
      if (icp && isPlaceholderText(contact.icp_number)) cUpdates.icp_number = icp;
      if (firstAddr) {
        const split = splitNzAddress(firstAddr);
        if (split.street   && isPlaceholderText(contact.street))   cUpdates.street   = split.street;
        if (split.suburb   && isPlaceholderText(contact.suburb))   cUpdates.suburb   = split.suburb;
        if (split.city     && isPlaceholderText(contact.city))     cUpdates.city     = split.city;
        if (split.postcode && isPlaceholderText(contact.postcode)) cUpdates.postcode = split.postcode;
      }
      if (Object.keys(cUpdates).length > 0) {
        console.log(`  contact       ${contact.id.slice(0,8)}…  ← ${JSON.stringify(cUpdates)}`);
        if (!dryRun) {
          const { error } = await sb.from('contacts').update(cUpdates).eq('id', contact.id);
          if (error) console.error(`    ✗ ${error.message}`);
          else contactsUpdated++;
        } else contactsUpdated++;
      }
    }
  }
}

console.log(`\n━━━ Summary ━━━`);
console.log(`  bill_analyses updated: ${analysesUpdated}`);
console.log(`  contacts updated:      ${contactsUpdated}`);
if (dryRun) console.log(`  (DRY RUN — no writes were made)`);

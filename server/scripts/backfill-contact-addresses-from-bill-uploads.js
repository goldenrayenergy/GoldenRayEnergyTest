// ────────────────────────────────────────────────────────────────────────────
// Root-cause backfill: populate contacts.street/suburb/city/postcode for any
// contact whose bill_uploads carry a service_address that was extracted by
// the OCR but never written back (because the bills were parsed BEFORE the
// writeAddressThroughToContact path was deployed).
//
// This is NOT a temporary patch — it re-runs the existing extraction logic
// against existing data. Bills uploaded going forward already use the same
// path via the live POST /bill-analysis route. This script just backfills
// the contacts that pre-date that change.
//
// Idempotent: only writes fields that are currently NULL on the contact.
// Re-running is safe; rep-entered values are never overwritten.
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Same NZ_STREET_TYPES / NZ_CITIES / splitNzAddress as billAnalysis.js. Kept
// in sync via copy; production code uses the same logic. (We could import
// from billAnalysis.js but that pulls in the whole Express route; cleaner to
// duplicate the pure function.)
const NZ_STREET_TYPES = new Set([
  'STREET','ST','ROAD','RD','AVENUE','AVE','LANE','LN','DRIVE','DR',
  'CRESCENT','CRES','CR','PLACE','PL','WAY','COURT','CT','TERRACE','TCE',
  'BOULEVARD','BLVD','CLOSE','CL','GROVE','GR','PARK','SQUARE','SQ',
  'GARDENS','GDNS','MEWS','PARADE','PDE','PROMENADE','QUAY','RISE','HEIGHTS','HTS',
  'PARKWAY','PKWY','CIRCLE','CIR','LOOP','TRAIL','HIGHWAY','HWY',
]);
const NZ_CITIES = new Set([
  'AUCKLAND','WELLINGTON','CHRISTCHURCH','HAMILTON','TAURANGA','DUNEDIN',
  'NAPIER','PALMERSTON NORTH','NELSON','ROTORUA','NEW PLYMOUTH','WHANGAREI',
  'INVERCARGILL','WANGANUI','GISBORNE','TIMARU','HASTINGS','BLENHEIM',
  'MASTERTON','LEVIN','TAUPO','PUKEKOHE','HAVELOCK NORTH','UPPER HUTT',
  'LOWER HUTT','PORIRUA','PAPAKURA','MANUKAU','NORTH SHORE','WAITAKERE',
  'QUEENSTOWN','WANAKA','OAMARU','ASHBURTON',
]);
function splitNzAddress(addr) {
  if (!addr || typeof addr !== 'string') return {};
  let cleaned = addr.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/\b(NEW ZEALAND|AOTEAROA NEW ZEALAND|AOTEAROA|NZ)\b\.?\s*$/i, '').trim();
  let postcode = null;
  const pcMatch = cleaned.match(/\b(\d{4})\s*$/);
  let body = cleaned;
  if (pcMatch) { postcode = pcMatch[1]; body = body.slice(0, pcMatch.index).trim(); }
  body = body.replace(/\b(NEW ZEALAND|AOTEAROA NEW ZEALAND|AOTEAROA|NZ)\b\.?\s*$/i, '').trim();
  if (body.includes(',')) {
    const parts = body.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) return { street: parts[0], suburb: parts[1], city: parts[2], postcode };
    if (parts.length === 2) return { street: parts[0], suburb: null, city: parts[1], postcode };
    if (parts.length === 1) return { street: parts[0], suburb: null, city: null, postcode };
  }
  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    let streetTypeIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (NZ_STREET_TYPES.has(tokens[i].toUpperCase().replace(/[.,]/g, ''))) streetTypeIdx = i;
    }
    if (streetTypeIdx > 0 && streetTypeIdx < tokens.length - 1) {
      const street = tokens.slice(0, streetTypeIdx + 1).join(' ');
      const rest   = tokens.slice(streetTypeIdx + 1);
      let city = null, suburb = null;
      if (rest.length >= 2 && NZ_CITIES.has(rest.slice(-2).join(' ').toUpperCase())) {
        city = rest.slice(-2).join(' '); suburb = rest.slice(0, -2).join(' ') || null;
      } else if (rest.length >= 1 && NZ_CITIES.has(rest[rest.length - 1].toUpperCase())) {
        city = rest[rest.length - 1]; suburb = rest.slice(0, -1).join(' ') || null;
      } else {
        city = rest[rest.length - 1] || null; suburb = rest.slice(0, -1).join(' ') || null;
      }
      return { street, suburb: suburb || null, city: city || null, postcode };
    }
  }
  return { street: body, suburb: null, city: null, postcode };
}

// ── Build a map: contact_id → best service_address (any non-null) ──────────
console.log('Loading bill_uploads with service_address...');
const { data: uploads } = await supabase
  .from('bill_uploads')
  .select('analysis_id, service_address, created_at')
  .not('service_address', 'is', null)
  .order('created_at', { ascending: false });
console.log(`  Found ${uploads.length} uploads with service_address.`);

console.log('Mapping analysis_id → contact_id...');
const analysisIds = [...new Set(uploads.map(u => u.analysis_id).filter(Boolean))];
const { data: analyses } = await supabase
  .from('bill_analyses')
  .select('id, contact_id')
  .in('id', analysisIds);
const analysisToContact = Object.fromEntries(analyses.map(a => [a.id, a.contact_id]));

// For each contact, take the first (most recent) service_address
const contactToAddress = new Map();
for (const u of uploads) {
  const cid = analysisToContact[u.analysis_id];
  if (!cid) continue;
  if (!contactToAddress.has(cid)) contactToAddress.set(cid, u.service_address);
}
console.log(`  Mapped to ${contactToAddress.size} distinct contacts.\n`);

// ── Walk contacts, split address, update NULL fields only ──────────────────
let updated = 0, skipped = 0, errors = 0;
for (const [contactId, serviceAddress] of contactToAddress.entries()) {
  const { data: c, error: getErr } = await supabase
    .from('contacts')
    .select('id, name, street, suburb, city, postcode')
    .eq('id', contactId)
    .maybeSingle();
  if (getErr || !c) { errors++; continue; }

  const split = splitNzAddress(serviceAddress);
  const updates = {};
  if (split.street   && !c.street)   updates.street   = split.street;
  if (split.suburb   && !c.suburb)   updates.suburb   = split.suburb;
  if (split.city     && !c.city)     updates.city     = split.city;
  if (split.postcode && !c.postcode) updates.postcode = split.postcode;

  if (Object.keys(updates).length === 0) { skipped++; continue; }

  const { error: upErr } = await supabase
    .from('contacts')
    .update(updates)
    .eq('id', contactId);
  if (upErr) {
    console.log(`  ❌ ${c.name}  (${contactId}): ${upErr.message}`);
    errors++;
    continue;
  }
  const summary = Object.entries(updates).map(([k, v]) => `${k}="${v}"`).join(' · ');
  console.log(`  ✓ ${(c.name || '(no name)').padEnd(30)}  ${summary}`);
  updated++;
}

console.log(`\n✅ Backfill complete.`);
console.log(`   Updated: ${updated} contacts`);
console.log(`   Already populated: ${skipped} contacts`);
console.log(`   Errors:  ${errors}`);

// Idempotent: add the GEN-BOS-CABLE-AC per-metre row to production Supabase
// so the bomBuilder's `ac_cable_per_metre` role matches a real product.
//
// Safety:
//   • dry-run by default; pass --apply to commit
//   • skips insert if the SKU already exists
//   • verifies after insert
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const APPLY = process.argv.includes('--apply');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

console.log(`Mode: ${APPLY ? '🔧 APPLY (live write)' : '👀 DRY-RUN (no writes)'}`);

const ROW = {
  sku: 'GEN-BOS-CABLE-AC',
  brand: 'Generic',
  name: 'AC Cable 6mm² single-phase (per metre)',
  category: 'Balance of System',
  subcategory: 'Cabling',
  cost_nzd: 18.00,
  default_margin_pct: 30,
  is_active: true,
  specs: {
    role: 'ac_cable_per_metre',
    unit: 'metre',
    cross_section_mm2: 6,
    phase: 1,
    notes: 'AC cable inverter → switchboard, sold per metre. Price source: placeholder $18/m (legacy JS catalogue) — confirm with supplier.',
  },
};

console.log();
console.log('Proposed row:');
console.log(JSON.stringify(ROW, null, 2));

// ── 1. Check if SKU exists ────────────────────────────────────────────────
const { data: existing } = await sb.from('products')
  .select('id, sku, cost_nzd, is_active')
  .eq('sku', ROW.sku);

if (existing?.length) {
  console.log();
  console.log(`✓ Row already exists (id=${existing[0].id}, active=${existing[0].is_active}, cost=$${existing[0].cost_nzd}) — nothing to do.`);
  process.exit(0);
}

if (!APPLY) {
  console.log();
  console.log('Dry-run complete. Re-run with --apply to commit.');
  process.exit(0);
}

// ── 2. Insert ─────────────────────────────────────────────────────────────
console.log();
console.log('Inserting…');
const { data: inserted, error } = await sb.from('products')
  .insert([ROW])
  .select('id, sku, name, cost_nzd, is_active')
  .single();
if (error) { console.error(`❌ INSERT failed: ${error.message}`); process.exit(1); }

console.log(`✓ Inserted: id=${inserted.id}  sku=${inserted.sku}  cost=$${inserted.cost_nzd}`);

// ── 3. Verify via the bomBuilder role lookup ──────────────────────────────
const { loadCatalogueFromDb } = await import('../services/pm/proposalEngine/catalogue/dbLoader.js');
const { findBosByRole } = await import('../services/pm/proposalEngine/catalogue/bosRoles.js');
const cat = await loadCatalogueFromDb(sb);
const match = findBosByRole(cat, 'ac_cable_per_metre');
console.log();
console.log(`Role 'ac_cable_per_metre' now matches: ${match ? `✓ ${match.sku} — ${match.name}` : '❌ STILL NO MATCH (check regex)'}`);

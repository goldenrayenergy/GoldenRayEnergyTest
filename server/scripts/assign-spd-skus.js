// One-off, idempotent: assign GEN-BOS-SPD-AC and GEN-BOS-SPD-DC to the
// 2 null-SKU SPD rows in production so the ac_spd / dc_spd BoS roles match.
//
// Safety:
//   • dry-run by default; pass --apply to commit
//   • verifies target SKUs aren't already taken before UPDATE
//   • matches rows by name pattern + null SKU only (won't touch others)
//   • prints a before / after diff
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
console.log();

// ── 1. Confirm target SKUs aren't taken ──────────────────────────────────
const candidates = ['GEN-BOS-SPD-AC', 'GEN-BOS-SPD-DC'];
const { data: existing } = await sb.from('products')
  .select('id, sku, name')
  .in('sku', candidates);
if (existing?.length) {
  console.error('❌ Target SKU(s) already taken — aborting:');
  for (const r of existing) console.error(`  ${r.sku} → ${r.name}`);
  process.exit(1);
}
console.log(`✓ Target SKUs ${candidates.join(', ')} are free.`);

// ── 2. Find candidate rows by name ────────────────────────────────────────
console.log();
console.log('Locating candidate rows…');
const { data: acRows } = await sb.from('products')
  .select('id, sku, name, category, cost_nzd')
  .ilike('name', '%Type 2 Residential SPD%')
  .eq('is_active', true)
  .is('sku', null);
const { data: dcRows } = await sb.from('products')
  .select('id, sku, name, category, cost_nzd')
  .ilike('name', '%Commercial SPD AC/DC%')
  .eq('is_active', true)
  .is('sku', null);

console.log(`AC SPD candidates: ${acRows.length}`);
for (const r of acRows) console.log(`  id=${r.id}  $${r.cost_nzd}  ${r.name}`);
console.log(`DC SPD candidates: ${dcRows.length}`);
for (const r of dcRows) console.log(`  id=${r.id}  $${r.cost_nzd}  ${r.name}`);

if (acRows.length !== 1 || dcRows.length !== 1) {
  console.error('❌ Expected exactly 1 candidate per role — aborting.');
  process.exit(1);
}

const acRow = acRows[0];
const dcRow = dcRows[0];

console.log();
console.log('Plan:');
console.log(`  ${acRow.id} → SKU = GEN-BOS-SPD-AC  (${acRow.name})`);
console.log(`  ${dcRow.id} → SKU = GEN-BOS-SPD-DC  (${dcRow.name})`);

if (!APPLY) {
  console.log();
  console.log('Dry-run complete. Re-run with --apply to commit.');
  process.exit(0);
}

// ── 3. Apply UPDATE by ID ────────────────────────────────────────────────
console.log();
console.log('Applying updates…');
const { error: e1 } = await sb.from('products')
  .update({ sku: 'GEN-BOS-SPD-AC' })
  .eq('id', acRow.id);
if (e1) { console.error(`❌ AC UPDATE failed: ${e1.message}`); process.exit(1); }

const { error: e2 } = await sb.from('products')
  .update({ sku: 'GEN-BOS-SPD-DC' })
  .eq('id', dcRow.id);
if (e2) { console.error(`❌ DC UPDATE failed: ${e2.message}`); process.exit(1); }

console.log('✓ Both updates committed.');

// ── 4. Verify ────────────────────────────────────────────────────────────
console.log();
console.log('Verification:');
const { data: verify } = await sb.from('products')
  .select('id, sku, name')
  .in('id', [acRow.id, dcRow.id]);
for (const r of verify) console.log(`  ${r.id}  sku=${r.sku}  — ${r.name}`);

// Pull every BMS controller row + dump quote PR-KRISHAN-2026-003 spec/version
// so we can see what the engine sees end-to-end.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

// ── 1. Every BMS-controller-bucket row ────────────────────────────────────
console.log('━'.repeat(120));
console.log('BMS CONTROLLER bucket — Supabase rows');
console.log('━'.repeat(120));
const { data: bms } = await sb.from('products')
  .select('sku, brand, name, category, is_active, specs')
  .in('category', ['BYD- BMS', 'Battery Accessories'])
  .order('sku');
for (const r of bms || []) {
  const s = r.specs || {};
  console.log([
    String(r.sku || '<null>').padEnd(22),
    String(r.brand || '').padEnd(10),
    String(r.category).padEnd(20),
    `for_battery_series="${s.for_battery_series || s.series || ''}"`,
    r.is_active ? 'Y' : 'N',
    '— ' + String(r.name || '').slice(0, 60),
  ].join(' | '));
}

// ── 2. Quote + version + engine result for PR-KRISHAN-2026-003 ────────────
console.log();
console.log('━'.repeat(120));
console.log('QUOTE PR-KRISHAN-2026-003');
console.log('━'.repeat(120));
const { data: q } = await sb.from('quotes')
  .select('*')
  .eq('quote_ref', 'PR-KRISHAN-2026-003')
  .maybeSingle();
if (!q) {
  console.log('Quote not found.');
  process.exit(1);
}
console.log(`id: ${q.id}`);
console.log(`status: ${q.status}`);
console.log(`current_version_id: ${q.current_version_id}`);
console.log(`updated_at: ${q.updated_at}`);

// Try both column names — schema may vary
const { data: versions, error: vErr } = await sb.from('quote_versions')
  .select('*')
  .eq('quote_id', q.id)
  .order('version_number', { ascending: true });
if (vErr) console.log(`quote_versions query error: ${vErr.message}`);
console.log(`\nVERSIONS by quote_id: ${versions?.length || 0}`);

let versionsToUse = versions;
if (!versions?.length) {
  const { data: byId } = await sb.from('quote_versions')
    .select('*').eq('id', q.current_version_id);
  console.log(`VERSIONS by current_version_id: ${byId?.length || 0}`);
  versionsToUse = byId;
}
for (const v of versionsToUse || []) {
  const sys = v.spec?.system || {};
  console.log(`\n  v${v.version_number} (id=${v.id}) created=${v.created_at}`);
  console.log(`    spec.system.panel:    sku=${sys.panel?.sku}  count=${sys.panel?.count}`);
  console.log(`    spec.system.inverter: sku=${sys.inverter?.sku}`);
  console.log(`    spec.system.battery:  sku=${sys.battery?.sku}  modules=${sys.battery?.module_count}`);
  console.log(`    spec.system.smart_meter: sku=${sys.smart_meter?.sku}  phase=${sys.smart_meter?.phase}`);
  console.log(`    evaluated_at: ${v.evaluated_at}`);

  const ev = v.evaluated || {};
  if (ev.bom) {
    console.log(`    evaluated.bom items (${ev.bom.length}):`);
    for (const item of ev.bom) {
      console.log(`        ${String(item.sku || '?').padEnd(22)} × ${String(item.qty).padStart(4)}  ${item.reason || ''}`);
    }
  }
  if (ev.cost?.totals) {
    console.log(`    evaluated.cost.totals.total_list_inc_gst: ${ev.cost.totals.total_list_inc_gst}`);
  }
}

// ── 3. What engine WOULD do today against this spec (fresh re-run) ────────
console.log();
console.log('━'.repeat(120));
console.log('FRESH ENGINE RUN against latest version spec');
console.log('━'.repeat(120));
if (!versionsToUse?.length) {
  console.log('No version found — cannot run engine.'); process.exit(0);
}
const latest = versionsToUse[versionsToUse.length - 1];
const { loadCatalogueFromDb } = await import('../services/pm/proposalEngine/catalogue/dbLoader.js');
const { runEngine } = await import('../services/pm/proposalEngine/index.js');
const catalogue = await loadCatalogueFromDb(sb);
const result = await runEngine(latest.spec, { catalogue });
console.log(`engine.ok=${result.ok}  multi_tier=${result.is_multi_tier}`);
if (result.bom) {
  console.log('Fresh BoM items:');
  for (const item of result.bom) {
    console.log(`  ${String(item.sku || '?').padEnd(22)} × ${String(item.qty).padStart(4)}  ${item.reason || ''}`);
  }
}
if (result.cost?.totals) {
  console.log(`Fresh cost total_list_inc_gst: ${result.cost.totals.total_list_inc_gst}`);
}

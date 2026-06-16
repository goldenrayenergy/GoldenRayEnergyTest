// Show the full tiers array + every override on Krishan v6 so we can see where
// the System tab's "24 panels" change went (or didn't go).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } });

const QUOTE = 'PR-KRISHAN-2026-003';
const { data: q } = await sb.from('quotes').select('*').eq('quote_ref', QUOTE).maybeSingle();

const { data: v6 } = await sb.from('quote_versions')
  .select('*').eq('id', q.current_version_id).maybeSingle();

console.log('━'.repeat(120));
console.log(`${QUOTE}  v${v6.version_number}  id=${v6.id}`);
console.log('━'.repeat(120));
console.log(`Top-level spec.system.panel.count = ${v6.spec?.system?.panel?.count}`);
console.log(`spec.is_multi_tier = ${v6.spec?.is_multi_tier}`);
console.log(`spec.tiers?.length = ${v6.spec?.tiers?.length}`);
console.log();

if (Array.isArray(v6.spec?.tiers)) {
  v6.spec.tiers.forEach((t, i) => {
    console.log(`── Tier ${i} (${t.label || '?'}) ${t.is_recommended ? '★' : ''} ──`);
    console.log(`   system_overrides: ${JSON.stringify(t.system_overrides, null, 2).replace(/\n/g, '\n   ')}`);
    console.log(`   pricing: ${JSON.stringify(t.pricing)}`);
    console.log(`   cost_overrides: ${JSON.stringify(t.cost_overrides)}`);
    console.log();
  });
}

console.log('── Full spec.system ──');
console.log(JSON.stringify(v6.spec?.system, null, 2));

console.log();
console.log('── evaluated keys (top-level) ──');
console.log(Object.keys(v6.evaluated || {}));
if (v6.evaluated?.tiers) {
  console.log(`evaluated.tiers count = ${v6.evaluated.tiers.length}`);
  v6.evaluated.tiers.forEach((t, i) => {
    console.log(`   tier[${i}] label=${t.label}`);
    console.log(`     bom panel line: ${JSON.stringify(t.bom?.find(b => b.group === 'hardware' && /pnl|panel/i.test(b.reason || '')))}`);
    console.log(`     bom bms line:   ${JSON.stringify(t.bom?.find(b => /BAC|BMS/i.test(b.sku || '') || /BMS/i.test(b.reason || '')))}`);
  });
}

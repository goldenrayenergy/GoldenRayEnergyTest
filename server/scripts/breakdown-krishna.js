// Full cost-section breakdown for PR-KRISHNA-2026-001.
// What did the engine charge for each line, what's the markup, what's the
// real cash split between you and your suppliers.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { runEngine } from '../services/pm/proposalEngine/index.js';
import { getCachedCatalogue } from '../services/pm/proposalEngine/catalogue/cachedDbLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: quote } = await sb.from('quotes')
  .select('id, current_version_id').eq('quote_ref', 'PR-KRISHNA-2026-001').maybeSingle();
const { data: version } = await sb.from('quote_versions')
  .select('spec').eq('id', quote.current_version_id).maybeSingle();

const catalogue = await getCachedCatalogue(sb);
const engine = await runEngine(version.spec, { catalogue });

// Single-tier (Stage 2) — pull the cost block directly.
const c = engine.is_multi_tier
  ? engine.tiers.find(t => t.is_recommended)?.cost
  : engine.cost;
const t = c.totals;
const s = c.sections;
const GST = 1.15;
const $ = n => '$' + Math.round(n).toLocaleString('en-NZ').padStart(8);

console.log('━'.repeat(70));
console.log('  PR-KRISHNA-2026-001 — full cost breakdown');
console.log('━'.repeat(70));

console.log('\n  PER SECTION (all ex-GST)');
console.log('  ─────────────────────────────────────────────────────');
console.log('  Section         What you pay   What you sell   Margin $');
console.log('  ─────────────────────────────────────────────────────');
for (const [name, sec] of Object.entries(s)) {
  console.log(`  ${name.padEnd(15)}  ${$( sec.cost)}    ${$( sec.sell_ex_gst)}    ${$( sec.margin_dollar)}`);
}
const totalCost = Object.values(s).reduce((sum, sec) => sum + sec.cost, 0);
const totalSell = Object.values(s).reduce((sum, sec) => sum + sec.sell_ex_gst, 0);
console.log('  ─────────────────────────────────────────────────────');
console.log(`  TOTAL            ${$( totalCost)}    ${$( totalSell)}    ${$( totalSell - totalCost)}`);

console.log('\n  PRICE / GST / PROFIT FLOW');
console.log('  ─────────────────────────────────────────────────────');
console.log(`  Engine list price (what you'd charge with no discount)`);
console.log(`     Ex GST            ${$( t.total_list_ex_gst)}`);
console.log(`     Inc GST           ${$( t.total_list_inc_gst)}`);
console.log();
console.log(`  Discount applied`);
console.log(`     Ex GST            −${$( t.discount_applied_ex_gst)}`);
console.log(`     Inc GST           −${$( t.discount_applied_inc_gst)}`);
console.log();
console.log(`  CUSTOMER PAYS YOU (inc GST → into your bank)`);
console.log(`                       ${$( t.customer_total_inc_gst)}  ← cash IN`);
console.log();
console.log(`  Of that, GST you collected (passes through to IRD)`);
console.log(`                       ${$( t.gst_on_customer_total)}`);
console.log();
console.log(`  Your revenue (ex GST)`);
console.log(`                       ${$( t.customer_total_ex_gst)}`);
console.log();
console.log(`  Suppliers / labour / compliance — what you pay out`);
console.log(`     Ex GST            ${$( t.total_cost_ex_gst)}  ← cash OUT (true cost)`);
console.log();
console.log(`  ┌─ PROFIT IN YOUR POCKET ───────────────────────────┐`);
console.log(`  │  Ex GST            ${$( t.profit_ex_gst)}                          │`);
console.log(`  │  Margin %          ${t.project_margin_pct.toFixed(1).padStart(8)}%                          │`);
console.log(`  │  Status            ${(c.margin_floor_status || '—').padEnd(8)}                          │`);
console.log(`  └────────────────────────────────────────────────────┘`);

console.log('\n  BAR — CUSTOMER\'S $' + Math.round(t.customer_total_inc_gst).toLocaleString('en-NZ'));
const totalIn = t.customer_total_inc_gst;
const bar = (label, amount, w = 40) => {
  const pct = amount / totalIn;
  const fill = '█'.repeat(Math.max(1, Math.round(pct * w)));
  console.log(`  ${label.padEnd(22)} ${fill}  ${$( amount)}  (${(pct * 100).toFixed(1)}%)`);
};
bar('Suppliers (your cost)', t.total_cost_ex_gst);
bar('Profit (yours)', t.profit_ex_gst);
bar('GST → IRD', t.gst_on_customer_total);

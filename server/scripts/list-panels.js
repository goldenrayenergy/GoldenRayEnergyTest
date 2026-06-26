import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// First show all categories so we know what to filter on
const { data: cats } = await sb.from('products').select('category').limit(500);
const setC = new Set();
for (const p of cats || []) setC.add(p.category);
console.log('All categories in catalogue:');
for (const c of [...setC].sort()) console.log('  ', c);
console.log();

const { data } = await sb.from('products')
  .select('sku, brand, name, category, specs, is_active, marketing_claims')
  .or('sku.ilike.%PNL%,category.ilike.%anel%,category.ilike.%odule%,name.ilike.%anel%')
  .order('brand').order('sku');

console.log(`Found ${data?.length || 0} panel products\n`);
for (const p of data || []) {
  const s = p.specs || {};
  const hasClaims = p.marketing_claims && Object.keys(p.marketing_claims).length > 0;
  console.log(`  ${(p.sku || '<null>').padEnd(22)}  ${(p.brand || '').padEnd(14)} ${p.is_active ? '✓active' : '  inactive'}  ${hasClaims ? '★claims' : '       '}  ${(p.name || '').slice(0, 50)}`);
  if (s.watts || s.peak_efficiency_pct) {
    console.log(`                              ${s.watts || '?'}W · ${s.peak_efficiency_pct ?? '?'}% eff · cell=${s.cell_type || '?'}`);
  }
}

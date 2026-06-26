// Audit all products with marketing_claims and show a compact one-liner per
// brand-group so we can see what we've got vs gaps.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: products } = await sb.from('products')
  .select('sku, brand, name, category, marketing_claims, is_active')
  .eq('is_active', true)
  .order('category').order('brand').order('sku');

// Bucket by category
const byCat = new Map();
for (const p of products || []) {
  const cat = p.category || 'uncategorised';
  if (!byCat.has(cat)) byCat.set(cat, []);
  byCat.get(cat).push(p);
}

console.log('\n═'.repeat(100));
console.log(' Marketing-claims audit — active products only');
console.log('═'.repeat(100));

let totalWithClaims = 0;
let totalActive = 0;
for (const [cat, list] of [...byCat.entries()].sort()) {
  const withClaims = list.filter(p => p.marketing_claims && Object.keys(p.marketing_claims).length > 0);
  totalWithClaims += withClaims.length;
  totalActive += list.length;
  const indicator = withClaims.length === 0 ? '✗' :
                    withClaims.length === list.length ? '✓' : '⚠';
  console.log(`\n${indicator}  ${cat.padEnd(35)}  ${withClaims.length}/${list.length} have claims`);
  for (const p of list) {
    const has = p.marketing_claims && Object.keys(p.marketing_claims).length > 0;
    const headline = has ? (p.marketing_claims.headline || '(no headline)').slice(0, 65) : '— no claims';
    console.log(`     ${has ? '★' : ' '}  ${(p.sku || '<null>').padEnd(22)} ${(p.brand || '').padEnd(13)} ${headline}`);
  }
}

console.log('\n' + '═'.repeat(100));
console.log(` TOTAL: ${totalWithClaims}/${totalActive} active products have marketing claims (${Math.round(totalWithClaims/totalActive*100)}%)`);
console.log('═'.repeat(100));

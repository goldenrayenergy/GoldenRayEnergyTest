import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data } = await sb.from('products')
  .select('sku, brand, name, marketing_claims')
  .eq('sku', 'FRN-BAT-315-RSV').maybeSingle();

console.log(`\nProduct: ${data?.sku || 'not found'}`);
console.log(`Brand:   ${data?.brand}`);
console.log(`Name:    ${data?.name}\n`);
console.log('Marketing claims (live in DB):');
console.log(JSON.stringify(data?.marketing_claims, null, 2));

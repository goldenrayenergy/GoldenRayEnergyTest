import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data } = await sb.from('contacts')
  .select('id, name, email, icp_number, street, suburb, city, postcode, created_at')
  .ilike('name', '%krishna%')
  .order('created_at', { ascending: false })
  .limit(5);

for (const c of data || []) {
  console.log(`\n[${c.id.slice(0,8)}] ${c.name}`);
  console.log(`  email: ${c.email || '(null)'}`);
  console.log(`  icp:   ${c.icp_number || '(null)'}`);
  console.log(`  addr:  ${[c.street, c.suburb, c.city, c.postcode].filter(Boolean).join(', ') || '(empty)'}`);
  console.log(`  created: ${c.created_at}`);
}

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data } = await sb.from('quotes')
  .select('quote_ref, status, stage, current_version_number, updated_at')
  .order('updated_at', { ascending: false }).limit(5);
for (const q of data || []) {
  console.log(`${q.updated_at?.slice(0,19)}  ${q.quote_ref?.padEnd(28)}  v${q.current_version_number}  ${q.status}  ${q.stage || ''}`);
}

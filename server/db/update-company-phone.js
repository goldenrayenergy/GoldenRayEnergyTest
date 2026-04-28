import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: row, error: readErr } = await sb.from('system_config').select('value').eq('key', 'company_info').single();
if (readErr) { console.error('read failed:', readErr.message); process.exit(1); }

const updated = { ...row.value, phone: '+64 21 839 356' };
const { error: writeErr } = await sb.from('system_config').update({ value: updated }).eq('key', 'company_info');
if (writeErr) { console.error('write failed:', writeErr.message); process.exit(1); }

console.log('✅ system_config.company_info.phone updated to +64 21 839 356');
console.log('   full row:', updated);

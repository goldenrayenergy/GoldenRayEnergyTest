import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const eq = l.indexOf('=');
      const k = l.slice(0, eq).trim();
      let v = l.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [k, v];
    })
);

const url = env.SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.SUPABASE_ANON_KEY;

console.log('URL:', url);
console.log('Service key length:', serviceKey?.length || 0);
console.log('Anon key length:', anonKey?.length || 0);

// REST root — verifies URL + service key are valid
const root = await fetch(`${url}/rest/v1/`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
console.log('REST root HTTP status:', root.status, root.status === 200 ? 'OK' : '');

// Probe contacts table — will 404/relation-not-exist if schema not applied
const probe = await fetch(`${url}/rest/v1/contacts?select=id&limit=1`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
});
console.log('contacts probe HTTP status:', probe.status);
const body = await probe.text();
console.log('contacts probe body:', body.slice(0, 300));

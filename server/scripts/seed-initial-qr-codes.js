// Seed the 3 initial QR codes:
//   - card        — business cards
//   - show-akl    — Auckland Home Show banner
//   - flyer-mtr   — Mt Roskill flyer drop
// Idempotent — re-running just skips ones that already exist (ON CONFLICT).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const YEAR = new Date().getFullYear();

const seeds = [
  {
    slug:         'card',
    campaign_name: 'Business cards · networking & in-person meetings',
    utm_source:   'card',
    utm_medium:   'print',
    utm_campaign: `cards-${YEAR}`,
    notes:        'Initial print run. Hand out at meetings, events, and post-call follow-ups.',
  },
  {
    slug:         'show-akl',
    campaign_name: 'Auckland Home Show booth signage',
    utm_source:   'show',
    utm_medium:   'event',
    utm_campaign: `akl-home-${YEAR}`,
    notes:        'Trade-show banner (3ft × 6ft). Use SVG for printing.',
  },
  {
    slug:         'flyer-mtr',
    campaign_name: 'Mt Roskill door-drop flyer',
    utm_source:   'flyer',
    utm_medium:   'print',
    utm_campaign: `flyer-mtroskill-${String(new Date().toLocaleString('en-NZ',{month:'short'}).toLowerCase())}${String(YEAR).slice(-2)}`,
    notes:        'First targeted door-drop in Mt Roskill (~500 homes).',
  },
];

try {
  for (const s of seeds) {
    const r = await client.query(
      `INSERT INTO qr_codes (slug, campaign_name, destination_path, utm_source, utm_medium, utm_campaign, notes)
         VALUES ($1, $2, '/get-quote', $3, $4, $5, $6)
       ON CONFLICT (slug) DO NOTHING
       RETURNING slug`,
      [s.slug, s.campaign_name, s.utm_source, s.utm_medium, s.utm_campaign, s.notes]
    );
    if (r.rowCount > 0) console.log(`✅ Seeded QR: /qr/${s.slug}  (${s.campaign_name})`);
    else                console.log(`⏭  Skipped existing: /qr/${s.slug}`);
  }
} catch (e) {
  console.error('Seed failed:', e.message);
  process.exit(1);
}

await client.end();
console.log('\nDone. Open /pm/admin/qr-codes to view + download PNG/SVG.');

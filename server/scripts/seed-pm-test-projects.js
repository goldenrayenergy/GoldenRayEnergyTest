// ────────────────────────────────────────────────────────────────────────────
// Seed three test projects into projects_v2 with varied lane states so you
// can visually inspect the swim-lane UI without manually clicking through
// every checklist.
//
//   Smith family       — residential rooftop, fresh lead (Sales just kicked off)
//   Patel commercial   — commercial install, mid-Engineering (survey done, design in progress)
//   Whangarei battery  — battery add-on, contract signed, materials being ordered
//
// Idempotent: skips insert if a project with the same notes marker exists.
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('Missing SUPABASE_DATABASE_URL / DATABASE_URL'); process.exit(1); }
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const SEED_MARKER = '[PM_TEST_SEED]';

const fixtures = [
  {
    label: 'Smith family — fresh lead',
    project_type: 'residential_rooftop',
    address: '12 Beach Road',
    suburb: 'Browns Bay',
    city: 'Auckland',
    region: 'auckland',
    postcode: '0630',
    system_size_kw: 6.6,
    battery_kwh: null,
    panel_count: 16,
    estimated_value_nzd: 14500,
    lane_status: {
      sales:       { status: 'in_progress', items: { qualification_call: true, customer_profile: true } },
      engineering: { status: 'not_started', items: {} },
      compliance:  { status: 'not_started', items: {} },
      operations:  { status: 'not_started', items: {} },
      finance:     { status: 'not_started', items: {} },
    },
    notes: `${SEED_MARKER} Hot lead, partner is keen, two kids, considering EV in 2027.`,
  },
  {
    label: 'Patel commercial — mid-engineering',
    project_type: 'commercial',
    address: '88 Industrial Drive',
    suburb: 'Penrose',
    city: 'Auckland',
    region: 'auckland',
    postcode: '1061',
    system_size_kw: 49.5,
    battery_kwh: 30,
    panel_count: 110,
    estimated_value_nzd: 132000,
    lane_status: {
      sales:       { status: 'in_progress', items: { qualification_call: true, customer_profile: true, proposal_initial: true } },
      engineering: { status: 'in_progress', items: { site_survey: true, switchboard_upgrade: false, structural_signoff: true } },
      compliance:  { status: 'not_started', items: {} },
      operations:  { status: 'not_started', items: {} },
      finance:     { status: 'in_progress', items: { finance_method: true } },
    },
    notes: `${SEED_MARKER} Manufacturing premises, owner wants payback in 5y. Roof load OK per structural report.`,
  },
  {
    label: 'Whangarei battery add-on — installing',
    project_type: 'battery_addon',
    address: '5 Coastal View',
    suburb: 'One Tree Point',
    city: 'Whangarei',
    region: 'northland',
    postcode: '0118',
    system_size_kw: null,
    battery_kwh: 13.5,
    panel_count: null,
    estimated_value_nzd: 18500,
    lane_status: {
      sales: {
        status: 'done',
        items: {
          qualification_call: true, customer_profile: true,
          proposal_initial: true, proposal_final: true,
          customer_accepted: true, contract_signed: true,
        },
        completed_at: new Date(Date.now() - 14*86400000).toISOString(),
      },
      engineering: {
        status: 'done',
        items: {
          site_survey: true, system_design: true, sld: true, simulation: true, bom_locked: true,
          existing_system_audit: true,
        },
        completed_at: new Date(Date.now() - 12*86400000).toISOString(),
      },
      compliance: {
        status: 'in_progress',
        items: { distributor_app: true, distributor_approved: true, meter_reconfig: true, coc_issued: false, distributor_inspect: false },
      },
      operations: {
        status: 'in_progress',
        items: { materials_ordered: true, materials_received: true, install_scheduled: true, install_complete: false },
      },
      finance: {
        status: 'in_progress',
        items: { finance_method: true, deposit_paid: true, progress_paid: false, final_paid: false, tax_invoice: false },
      },
    },
    notes: `${SEED_MARKER} Adding Sungrow SBR096 to existing 6.6 kW Sungrow inverter system. Install Friday.`,
  },
];

async function alreadySeeded() {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS c FROM projects_v2 WHERE notes LIKE $1`,
    [`${SEED_MARKER}%`]
  );
  return rows[0].c;
}

async function insertOne(fix) {
  const { rows } = await client.query(
    `INSERT INTO projects_v2 (
       project_type, address, suburb, city, region, postcode,
       system_size_kw, battery_kwh, panel_count, estimated_value_nzd,
       lane_status, status, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
     RETURNING id, code`,
    [
      fix.project_type, fix.address, fix.suburb, fix.city, fix.region, fix.postcode,
      fix.system_size_kw, fix.battery_kwh, fix.panel_count, fix.estimated_value_nzd,
      JSON.stringify(fix.lane_status), 'active', fix.notes,
    ]
  );
  return rows[0];
}

try {
  const existing = await alreadySeeded();
  if (existing > 0) {
    console.log(`⚠  Found ${existing} existing seed project(s). Skipping insert.`);
    console.log(`   To reset: DELETE FROM projects_v2 WHERE notes LIKE '${SEED_MARKER}%';`);
  } else {
    for (const fix of fixtures) {
      const r = await insertOne(fix);
      console.log(`✅ Created ${r.code}: ${fix.label}`);
    }
    console.log(`\n${fixtures.length} test projects inserted.`);
    console.log(`Open http://localhost:5173/pm to view.`);
  }
} catch (e) {
  console.error('❌ Seed failed:', e.message);
  process.exit(1);
}

await client.end();

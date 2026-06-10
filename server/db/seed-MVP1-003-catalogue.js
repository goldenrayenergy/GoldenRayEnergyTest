// ────────────────────────────────────────────────────────────────────────────
// MVP1_003 seed — populates labour_rate_card + compliance_rate_card.
//
// PIVOTED scope:
//   • hardware_catalog + bos_catalog dropped — engine reads from `products`
//     table via catalogue/dbLoader.js (with field aliasing).
//   • This seed only covers Section B (Labour) and Section C (Compliance) —
//     neither lives in products.
//
// Margin policy (locked):
//   • 30% on every labour + compliance row at seed time.
//     Overrides the 2026-06-05 0%-margin-on-labour rule per
//     Goldenray_Final_Detailed_Quotation sheet.
//
// Cost policy:
//   • Labour preserves current labourRateCard.js values (tier $2.5k/$4k/$5.5k,
//     supervisor $650, travel $350, logistics $650, battery premium $1500,
//     parallel premium $400, site survey $150).
//   • Compliance uses ORIGINAL SHEET values: System Design $200 (vs $400 in
//     code), Commissioning $200 (vs $500 in code), plus ESC $120 added.
//
// Idempotent — re-runnable. Upserts by SKU.
//
// Run: node server/db/seed-MVP1-003-catalogue.js
// ────────────────────────────────────────────────────────────────────────────

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';

import {
  INSTALLATION_LABOUR, BATTERY_INSTALL_PREMIUM,
  SUPERVISOR, TRAVEL, LOGISTICS, SITE_SURVEY_FEE,
} from '../services/pm/proposalEngine/data/labourRateCard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

let url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('Missing SUPABASE_DATABASE_URL / DATABASE_URL'); process.exit(1); }
url = url.replace(/[?&]sslmode=[^&]*/gi, '').replace(/[?&]$/, '');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

// ── Labour rate card ──────────────────────────────────────────────────────
const LABOUR_ROWS = [
  // Installation labour — tier-based
  {
    sku: INSTALLATION_LABOUR.small.sku, category: 'install',
    name: INSTALLATION_LABOUR.small.name,
    cost_nzd: INSTALLATION_LABOUR.small.cost_nzd, margin_pct: 30,
    applies_to_kw_min: 0, applies_to_kw_max: 8,
    default_qty: 1,
  },
  {
    sku: INSTALLATION_LABOUR.medium.sku, category: 'install',
    name: INSTALLATION_LABOUR.medium.name,
    cost_nzd: INSTALLATION_LABOUR.medium.cost_nzd, margin_pct: 30,
    applies_to_kw_min: 8, applies_to_kw_max: 12,
    default_qty: 1,
  },
  {
    sku: INSTALLATION_LABOUR.large.sku, category: 'install',
    name: INSTALLATION_LABOUR.large.name,
    cost_nzd: INSTALLATION_LABOUR.large.cost_nzd, margin_pct: 30,
    applies_to_kw_min: 12, applies_to_kw_max: 999,
    default_qty: 1,
  },
  // Battery install premium
  {
    sku: BATTERY_INSTALL_PREMIUM.sku, category: 'battery_install',
    name: BATTERY_INSTALL_PREMIUM.name,
    cost_nzd: BATTERY_INSTALL_PREMIUM.cost_nzd, margin_pct: 30,
    applies_when: { has_battery: true },
    default_qty: 1,
  },
  // Supervisor / Travel / Logistics (per-job flat)
  { sku: SUPERVISOR.sku, category: 'supervisor', name: SUPERVISOR.name,
    cost_nzd: SUPERVISOR.cost_nzd, margin_pct: 30, default_qty: 1 },
  { sku: TRAVEL.sku, category: 'travel', name: TRAVEL.name,
    cost_nzd: TRAVEL.cost_nzd, margin_pct: 30, default_qty: 1 },
  { sku: LOGISTICS.sku, category: 'logistics', name: LOGISTICS.name,
    cost_nzd: LOGISTICS.cost_nzd, margin_pct: 30, default_qty: 1 },
  // Parallel topology premium (currently inlined in costEngine.js)
  {
    sku: 'LAB-INSTALL-PARALLEL', category: 'premium',
    name: 'Parallel-string topology install premium (combiner wiring + string termination)',
    cost_nzd: 400, margin_pct: 30,
    applies_when: { topology: 'parallel' },
    default_qty: 1,
  },
  // Site survey fee (refundable on install)
  { sku: SITE_SURVEY_FEE.sku, category: 'other', name: SITE_SURVEY_FEE.name,
    cost_nzd: SITE_SURVEY_FEE.cost_nzd, margin_pct: 30, default_qty: 1 },
];

// ── Compliance rate card ──────────────────────────────────────────────────
// Original sheet costs (Design $200, Commissioning $200) + ESC $120 (new).
const COMPLIANCE_ROWS = [
  { sku: 'CMP-DESIGN',         category: 'design',
    name: 'System design & engineering',
    cost_nzd: 200, margin_pct: 30, default_qty: 1 },
  { sku: 'CMP-INSPECTION',     category: 'inspection',
    name: 'Independent electrical inspection + Record of Inspection (ROI)',
    cost_nzd: 500, margin_pct: 30, default_qty: 1 },
  { sku: 'CMP-COMMISSIONING',  category: 'commissioning',
    name: 'System commissioning + Solar.web setup + customer training',
    cost_nzd: 200, margin_pct: 30, default_qty: 1 },
  { sku: 'CMP-DG-APPLICATION', category: 'grid_app',
    name: 'Distributed Generation (DG) application to network operator',
    cost_nzd: 250, margin_pct: 30, default_qty: 1 },
  { sku: 'CMP-COC',            category: 'certificate',
    name: 'Certificate of Compliance (CoC) issued by Licensed Electrical Worker',
    cost_nzd: 150, margin_pct: 30, default_qty: 1 },
  { sku: 'CMP-ESC',            category: 'certificate',
    name: 'Electrical Safety Certificate (ESC)',
    cost_nzd: 120, margin_pct: 30, default_qty: 1 },
];

// ── Upsert helpers ────────────────────────────────────────────────────────
async function upsertLabour(rows) {
  let inserted = 0, updated = 0;
  for (const r of rows) {
    const result = await client.query(`
      INSERT INTO labour_rate_card (
        sku, category, name, cost_nzd, margin_pct,
        applies_to_kw_min, applies_to_kw_max, applies_when, default_qty, active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
      ON CONFLICT (sku) DO UPDATE SET
        category           = EXCLUDED.category,
        name               = EXCLUDED.name,
        cost_nzd           = EXCLUDED.cost_nzd,
        margin_pct         = EXCLUDED.margin_pct,
        applies_to_kw_min  = EXCLUDED.applies_to_kw_min,
        applies_to_kw_max  = EXCLUDED.applies_to_kw_max,
        applies_when       = EXCLUDED.applies_when,
        default_qty        = EXCLUDED.default_qty,
        updated_at         = NOW()
      RETURNING (xmax = 0) AS inserted
    `, [r.sku, r.category, r.name, r.cost_nzd, r.margin_pct,
        r.applies_to_kw_min || null, r.applies_to_kw_max || null,
        r.applies_when ? JSON.stringify(r.applies_when) : null,
        r.default_qty || 1]);
    if (result.rows[0].inserted) inserted++; else updated++;
  }
  return { inserted, updated };
}

async function upsertCompliance(rows) {
  let inserted = 0, updated = 0;
  for (const r of rows) {
    const result = await client.query(`
      INSERT INTO compliance_rate_card (sku, category, name, cost_nzd, margin_pct, default_qty, active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      ON CONFLICT (sku) DO UPDATE SET
        category    = EXCLUDED.category,
        name        = EXCLUDED.name,
        cost_nzd    = EXCLUDED.cost_nzd,
        margin_pct  = EXCLUDED.margin_pct,
        default_qty = EXCLUDED.default_qty,
        updated_at  = NOW()
      RETURNING (xmax = 0) AS inserted
    `, [r.sku, r.category, r.name, r.cost_nzd, r.margin_pct, r.default_qty || 1]);
    if (result.rows[0].inserted) inserted++; else updated++;
  }
  return { inserted, updated };
}

// ── Run ───────────────────────────────────────────────────────────────────
console.log('━'.repeat(80));
console.log('  Seeding MVP1_003 — labour + compliance rate cards');
console.log('━'.repeat(80));

try {
  await client.query('BEGIN');

  console.log(`\n• Labour (${LABOUR_ROWS.length} rows @ 30% margin)…`);
  const lab = await upsertLabour(LABOUR_ROWS);
  console.log(`  ✓ ${lab.inserted} inserted, ${lab.updated} updated`);

  console.log(`\n• Compliance (${COMPLIANCE_ROWS.length} rows @ 30% margin, sheet costs)…`);
  const cmp = await upsertCompliance(COMPLIANCE_ROWS);
  console.log(`  ✓ ${cmp.inserted} inserted, ${cmp.updated} updated`);

  await client.query('COMMIT');
  console.log('\n✅ Seed complete.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('\n❌ Seed failed, rolled back:', e.message);
  console.error(e.stack);
  process.exit(1);
}

// Verification
console.log('\nVerification:');
for (const tab of ['labour_rate_card', 'compliance_rate_card']) {
  const r = await client.query(`SELECT COUNT(*) AS c FROM ${tab} WHERE active = TRUE`);
  console.log(`  ${tab}: ${r.rows[0].c} active rows`);
}

await client.end();
console.log('\n✅ Done.');

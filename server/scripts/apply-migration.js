// Apply a single migration .sql file directly via DATABASE_URL.
//
// USAGE:
//   node server/scripts/apply-migration.js server/db/migrations/028_battery_systems_and_compat.sql

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const file = process.argv[2];
if (!file) {
  console.error('Usage: node apply-migration.js <path-to-migration.sql>');
  process.exit(1);
}
const sqlPath = path.resolve(process.cwd(), file);
if (!fs.existsSync(sqlPath)) {
  console.error(`Migration file not found: ${sqlPath}`);
  process.exit(1);
}
const sql = fs.readFileSync(sqlPath, 'utf-8');

const connStr = (process.env.DATABASE_URL || '').replace(/['"]/g, '');
if (!connStr) {
  console.error('DATABASE_URL not set in .env');
  process.exit(1);
}

console.log(`Applying migration: ${path.basename(sqlPath)}`);
// Strip ?sslmode=... since we set ssl explicitly below
const cleanConn = connStr.replace(/[?&]sslmode=[^&]*/g, '');
const client = new pg.Client({
  connectionString: cleanConn,
  ssl: { rejectUnauthorized: false },
});
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(sql);
  await client.query('COMMIT');
  console.log('✓ Migration applied successfully');
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('✗ Migration failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}

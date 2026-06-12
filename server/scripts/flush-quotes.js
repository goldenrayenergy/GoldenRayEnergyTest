// Delete ALL quotes + dependent rows in a single transaction.
// Usage: node server/scripts/flush-quotes.js

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const conn = (process.env.DATABASE_URL || '').replace(/['"]/g, '').replace(/[?&]sslmode=[^&]*/g, '');
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  await client.query('BEGIN');

  // Discover every table with a quote_id FK so we don't leave orphans.
  const { rows: fkRefs } = await client.query(`
    SELECT tc.table_name AS child_table
    FROM information_schema.referential_constraints rc
    JOIN information_schema.key_column_usage kcu
      ON rc.constraint_name = kcu.constraint_name
    JOIN information_schema.table_constraints tc
      ON rc.constraint_name = tc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_name = ccu.constraint_name
    WHERE ccu.table_name = 'quotes' AND tc.constraint_type = 'FOREIGN KEY'
    GROUP BY tc.table_name;
  `);
  console.log('Tables with quote_id FK to quotes:', fkRefs.map(r => r.child_table));

  // Null-out quotes.current_version_id first so quote_versions can be deleted
  // without violating the FK from quotes → quote_versions.
  await client.query(`UPDATE quotes SET current_version_id = NULL`);

  let totalDeleted = 0;
  for (const { child_table } of fkRefs) {
    const { rowCount } = await client.query(`DELETE FROM ${child_table}`);
    console.log(`  Deleted ${rowCount} from ${child_table}`);
    totalDeleted += rowCount;
  }

  const { rowCount: qDeleted } = await client.query(`DELETE FROM quotes`);
  console.log(`  Deleted ${qDeleted} from quotes`);
  totalDeleted += qDeleted;

  await client.query('COMMIT');
  console.log(`\n✅ Committed. Total rows deleted: ${totalDeleted}.`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('❌ Rolled back:', e.message);
  process.exit(1);
} finally {
  await client.end();
}

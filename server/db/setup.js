import fs from 'fs';
import path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load from parent .env (project root)
dotenv.config({ path: path.join(__dirname, '../../.env') });

const DATABASE_URL = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in .env');
  console.error('Available env vars:', {
    SUPABASE_DATABASE_URL: !!process.env.SUPABASE_DATABASE_URL,
    DATABASE_URL: !!process.env.DATABASE_URL
  });
  process.exit(1);
}

const client = new pg.Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setupDatabase() {
  try {
    await client.connect();
    console.log('✅ Connected to Supabase database');

    // Read and execute schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    
    console.log('🔨 Creating tables...');
    await client.query(schema);
    console.log('✅ Tables created successfully');

    // Read and execute seed.sql
    const seedPath = path.join(__dirname, 'seed.sql');
    const seed = fs.readFileSync(seedPath, 'utf-8');
    
    console.log('🌱 Seeding demo data...');
    await client.query(seed);
    console.log('✅ Demo data seeded successfully');

    console.log('\n✨ Database setup complete! You can now log in with:');
    console.log('  Email: liam@goldenray.co.nz');
    console.log('  Password: manager123');

    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Setup failed:', error?.message || error);
    if (error?.code) console.error('Error code:', error.code);
    if (error?.detail) console.error('Detail:', error.detail);
    await client.end();
    process.exit(1);
  }
}

setupDatabase();

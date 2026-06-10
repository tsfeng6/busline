import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pkg from 'pg';
import * as schema from './schema';
import dotenv from 'dotenv';
dotenv.config({ override: true });

const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

export async function runMigration() {
  if (process.env.DATABASE_URL) {
    console.log('Running database migrations...');
    await migrate(db, { migrationsFolder: 'drizzle' });
    console.log('Migrations completed.');
  }
}


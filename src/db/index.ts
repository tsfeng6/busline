import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
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
    try {
      await migrate(db, { migrationsFolder: 'drizzle' });
      console.log('Drizzle migrations completed.');
    } catch (migErr: any) {
      console.warn('Drizzle migration standard flow skipped or failed:', migErr.message);
    }

    try {
      console.log('Running database schema self-healing checks...');
      await db.execute(sql`
        ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "data_source_text" text;
        ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "data_source_image" text;
        ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "reject_reason" text;
      `);
      console.log('Database self-healing checks completed successfully.');
    } catch (sqlErr: any) {
      console.error('Database self-healing columns setup failed:', sqlErr.message);
    }
  }
}


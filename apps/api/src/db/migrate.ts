import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { env } from '../config/env.js';

if (env.NODE_ENV === 'production') {
  throw new Error(
    'The migration command is disabled in production. Use the reviewed release procedure.',
  );
}

const pool = new Pool({
  connectionString: env.DATABASE_MIGRATION_URL,
  max: 2,
  connectionTimeoutMillis: 15_000,
  application_name: 'streak-migrations',
});

try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: './drizzle' });
} finally {
  await pool.end();
}

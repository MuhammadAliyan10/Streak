import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env.js';
import * as schema from './schema/auth-schema.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  application_name: 'streak-api',
});

export const db = drizzle({ client: pool, schema });

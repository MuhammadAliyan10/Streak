import { Pool } from 'pg';
import { createOwnerHandler } from './owner-handler.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Neon did not inject DATABASE_URL for this Function.');

const pool = new Pool({
  connectionString: databaseUrl,
  max: 5,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 10_000,
  query_timeout: 12_000,
  application_name: 'streak-neon-function',
});

export default { fetch: createOwnerHandler(pool) };

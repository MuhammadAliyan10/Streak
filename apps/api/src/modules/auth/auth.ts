import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { expo } from '@better-auth/expo';
import { db } from '../../db/client.js';
import * as schema from '../../db/schema/auth-schema.js';
import { env, trustedOrigins } from '../../config/env.js';

export const auth = betterAuth({
  appName: 'Streak',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true },
  plugins: [expo()],
});

import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url(),
  DATABASE_MIGRATION_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  MOBILE_ORIGIN: z
    .string()
    .url()
    .or(z.string().regex(/^streak:\/\/$/)),
  DEV_TRUSTED_ORIGINS: z.string().default('exp://**,exp://192.168.*.*:*/**,http://localhost:8081'),
});

export const env = envSchema.parse(process.env);
export const trustedOrigins = [
  env.MOBILE_ORIGIN,
  ...(env.NODE_ENV === 'development'
    ? env.DEV_TRUSTED_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : []),
];

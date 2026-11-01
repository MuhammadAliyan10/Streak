import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  createHash,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';

const passwordParameters = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const sessionLifetimeDays = 30;
const emailSchema = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(12).max(128);
const registerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(100),
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();
const loginSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();
const sessionTokenSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const dummySalt = Buffer.from('streak-login-timing-salt-v1');
const dummyHash = Buffer.alloc(64, 0x42);

function derivePassword(password: string, salt: Buffer, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, length, passwordParameters, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

type UserProfile = { id: string; fullName: string; email: string };
type SessionResponse = { token: string; expiresAt: string; user: UserProfile };
type IsOwnerAuthorized = (request: Request) => Promise<boolean>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function sessionToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  return sessionTokenSchema.safeParse(token).success ? token : null;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > 16_384) throw new Error('body_too_large');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('invalid_json');
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derivePassword(password, salt, 64);
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, n, r, p, saltText, hashText, extra] = encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    n !== '32768' ||
    r !== '8' ||
    p !== '1' ||
    !saltText ||
    !hashText ||
    extra
  ) {
    return false;
  }
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await derivePassword(password, salt, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function issueSession(client: PoolClient, user: UserProfile): Promise<SessionResponse> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const { rows } = await client.query<{ expires_at: Date }>(
    `INSERT INTO private.sessions (id, user_id, token_hash, expires_at)
     VALUES ($1::uuid, $2::uuid, $3, now() + ($4::int * interval '1 day'))
     RETURNING expires_at`,
    [randomUUID(), user.id, tokenHash, sessionLifetimeDays],
  );
  return { token, expiresAt: rows[0]!.expires_at.toISOString(), user };
}

async function findSession(pool: Pool, request: Request): Promise<UserProfile | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const { rows } = await pool.query<UserProfile>(
    `SELECT u.id::text, u.full_name AS "fullName", u.email
       FROM private.sessions s
       JOIN private.users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashSessionToken(token)],
  );
  return rows[0] ?? null;
}

async function blocked(pool: Pool, email: string): Promise<boolean> {
  const { rows } = await pool.query<{ blocked: boolean }>(
    `SELECT COALESCE(blocked_until > now(), false) AS blocked
       FROM private.auth_login_attempts WHERE email = $1`,
    [email],
  );
  return rows[0]?.blocked ?? false;
}

async function recordFailedLogin(pool: Pool, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO private.auth_login_attempts (email, window_started_at, failed_attempts, blocked_until)
     VALUES ($1, now(), 1, NULL)
     ON CONFLICT (email) DO UPDATE SET
       failed_attempts = CASE WHEN private.auth_login_attempts.window_started_at < now() - interval '15 minutes'
         THEN 1 ELSE private.auth_login_attempts.failed_attempts + 1 END,
       window_started_at = CASE WHEN private.auth_login_attempts.window_started_at < now() - interval '15 minutes'
         THEN now() ELSE private.auth_login_attempts.window_started_at END,
       blocked_until = CASE WHEN (CASE WHEN private.auth_login_attempts.window_started_at < now() - interval '15 minutes'
         THEN 1 ELSE private.auth_login_attempts.failed_attempts + 1 END) >= 5
         THEN now() + interval '15 minutes' ELSE NULL END`,
    [email],
  );
}

export function createAuthHandler(pool: Pool, isOwnerAuthorized: IsOwnerAuthorized) {
  return async (request: Request): Promise<Response | null> => {
    const path = new URL(request.url).pathname.replace(/\/$/, '');

    if (request.method === 'POST' && path === '/v1/auth/register') {
      try {
        if (!(await isOwnerAuthorized(request)))
          return json({ error: 'owner_setup_required' }, 401);
        const parsed = registerSchema.safeParse(await readJson(request));
        if (!parsed.success) return json({ error: 'invalid_registration' }, 400);
        const passwordHash = await hashPassword(parsed.data.password);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const owner = await client.query<{ token_hash: string }>(
            'SELECT token_hash FROM private.owner_access WHERE singleton_id = 1 FOR UPDATE',
          );
          const bearer = request.headers.get('authorization')?.slice(7) ?? '';
          if (!owner.rows[0] || !bearer) {
            await client.query('ROLLBACK');
            return json({ error: 'owner_setup_required' }, 401);
          }
          const digest = createHash('sha256').update(bearer, 'utf8').digest('hex');
          const expected = Buffer.from(owner.rows[0].token_hash, 'hex');
          const actual = Buffer.from(digest, 'hex');
          if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
            await client.query('ROLLBACK');
            return json({ error: 'owner_setup_required' }, 401);
          }
          const exists = await client.query('SELECT 1 FROM private.users WHERE owner_slot = 1');
          if (exists.rowCount) {
            await client.query('ROLLBACK');
            return json({ error: 'owner_already_registered' }, 409);
          }
          const user = await client.query<UserProfile>(
            `INSERT INTO private.users (id, owner_slot, full_name, email, password_hash)
             VALUES ($1::uuid, 1, $2, $3, $4)
             RETURNING id::text, full_name AS "fullName", email`,
            [randomUUID(), parsed.data.fullName, parsed.data.email, passwordHash],
          );
          const session = await issueSession(client, user.rows[0]!);
          await client.query('COMMIT');
          return json(session, 201);
        } catch (error) {
          await client.query('ROLLBACK');
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === '23505'
          ) {
            return json({ error: 'owner_already_registered' }, 409);
          }
          return json({ error: 'service_unavailable' }, 503);
        } finally {
          client.release();
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'invalid_json')
          return json({ error: 'invalid_json' }, 400);
        if (error instanceof Error && error.message === 'body_too_large')
          return json({ error: 'request_too_large' }, 413);
        return json({ error: 'service_unavailable' }, 503);
      }
    }

    if (request.method === 'POST' && path === '/v1/auth/login') {
      try {
        const parsed = loginSchema.safeParse(await readJson(request));
        if (!parsed.success) return json({ error: 'invalid_login' }, 400);
        if (await blocked(pool, parsed.data.email)) return json({ error: 'login_throttled' }, 429);
        const { rows } = await pool.query<UserProfile & { password_hash: string }>(
          `SELECT id::text, full_name AS "fullName", email, password_hash
             FROM private.users WHERE email = $1`,
          [parsed.data.email],
        );
        const row = rows[0];
        const valid = row
          ? await verifyPassword(parsed.data.password, row.password_hash)
          : await verifyPassword(
              parsed.data.password,
              `scrypt$32768$8$1$${dummySalt.toString('base64url')}$${dummyHash.toString('base64url')}`,
            );
        if (!row || !valid) {
          await recordFailedLogin(pool, parsed.data.email);
          return json({ error: 'invalid_credentials' }, 401);
        }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('DELETE FROM private.auth_login_attempts WHERE email = $1', [
            parsed.data.email,
          ]);
          const session = await issueSession(client, {
            id: row.id,
            fullName: row.fullName,
            email: row.email,
          });
          await client.query('COMMIT');
          return json(session);
        } catch {
          await client.query('ROLLBACK');
          return json({ error: 'service_unavailable' }, 503);
        } finally {
          client.release();
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'invalid_json')
          return json({ error: 'invalid_json' }, 400);
        if (error instanceof Error && error.message === 'body_too_large')
          return json({ error: 'request_too_large' }, 413);
        return json({ error: 'service_unavailable' }, 503);
      }
    }

    if (request.method === 'GET' && path === '/v1/auth/session') {
      try {
        const user = await findSession(pool, request);
        return user ? json({ user }) : json({ error: 'session_invalid' }, 401);
      } catch {
        return json({ error: 'service_unavailable' }, 503);
      }
    }

    if (request.method === 'POST' && path === '/v1/auth/logout') {
      try {
        const token = sessionToken(request);
        if (!token) return json({ error: 'session_invalid' }, 401);
        const result = await pool.query(
          `UPDATE private.sessions SET revoked_at = now()
            WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
          [hashSessionToken(token)],
        );
        return result.rowCount ? json({ revoked: true }) : json({ error: 'session_invalid' }, 401);
      } catch {
        return json({ error: 'service_unavailable' }, 503);
      }
    }
    return null;
  };
}

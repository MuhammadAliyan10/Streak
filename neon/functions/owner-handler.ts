import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { createAuthHandler } from './auth-handler.ts';

const tokenSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const operationSchema = z
  .object({
    id: z.string().uuid(),
    entity: z.string().min(1).max(64),
    payload: z.record(z.string(), z.unknown()),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const syncBodySchema = z.object({ operations: z.array(operationSchema).min(1).max(50) }).strict();
const rotateBodySchema = z.object({ nextToken: tokenSchema }).strict();
const cursorSchema = z
  .object({
    receivedAt: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
  })
  .strict();

export function digestOwnerToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function tokenMatchesDigest(token: string, digest: string): boolean {
  if (!tokenSchema.safeParse(token).success || !/^[a-f0-9]{64}$/i.test(digest)) return false;
  const actual = Buffer.from(digestOwnerToken(token), 'hex');
  const expected = Buffer.from(digest, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseSyncRequest(value: unknown) {
  return syncBodySchema.safeParse(value);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  return token.length <= 128 ? token : null;
}

export async function isOwnerTokenAuthorized(request: Request, pool: Pool): Promise<boolean> {
  const token = bearerToken(request);
  if (!token || !tokenSchema.safeParse(token).success) return false;
  const { rows } = await pool.query<{ token_hash: string }>(
    'SELECT token_hash FROM private.owner_access WHERE singleton_id = 1',
  );
  const digest = rows[0]?.token_hash;
  return typeof digest === 'string' && tokenMatchesDigest(token, digest);
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > 128_000) throw new Error('body_too_large');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('invalid_json');
  }
}

async function syncOperations(
  client: PoolClient,
  operations: z.infer<typeof syncBodySchema>['operations'],
) {
  const savedIds: string[] = [];
  for (const operation of operations) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO app.sync_events (id, entity, payload, created_at)
       VALUES ($1::uuid, $2, $3::jsonb, $4::timestamptz)
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [operation.id, operation.entity, JSON.stringify(operation.payload), operation.createdAt],
    );
    if (result.rows[0]) savedIds.push(result.rows[0].id);
  }
  return savedIds;
}

export function createOwnerHandler(pool: Pool) {
  const authHandler = createAuthHandler(pool);
  return async function fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/\/$/, '') || '/';

    const authResponse = await authHandler(request);
    if (authResponse) return authResponse;

    if (request.method === 'GET' && path === '/health') return json({ status: 'ok' });
    if (request.method === 'POST' && path === '/v1/owner/verify') {
      try {
        return (await isOwnerTokenAuthorized(request, pool))
          ? json({ verified: true })
          : json({ error: 'owner_token_invalid' }, 401);
      } catch {
        return json({ error: 'service_unavailable' }, 503);
      }
    }

    if (request.method === 'POST' && path === '/v1/owner/rotate') {
      try {
        if (!(await isOwnerTokenAuthorized(request, pool)))
          return json({ error: 'owner_token_invalid' }, 401);
        const parsed = rotateBodySchema.safeParse(await readJson(request));
        if (!parsed.success) return json({ error: 'invalid_rotation_request' }, 400);
        const currentToken = bearerToken(request);
        if (!currentToken) return json({ error: 'owner_token_invalid' }, 401);
        const update = await pool.query(
          `UPDATE private.owner_access
             SET token_hash = $1, rotated_at = now()
           WHERE singleton_id = 1 AND token_hash = $2
           RETURNING singleton_id`,
          [digestOwnerToken(parsed.data.nextToken), digestOwnerToken(currentToken)],
        );
        if (update.rowCount !== 1) return json({ error: 'owner_token_invalid' }, 401);
        return json({ rotated: true });
      } catch (error) {
        if (error instanceof Error && error.message === 'body_too_large') {
          return json({ error: 'request_too_large' }, 413);
        }
        if (error instanceof Error && error.message === 'invalid_json') {
          return json({ error: 'invalid_json' }, 400);
        }
        return json({ error: 'service_unavailable' }, 503);
      }
    }

    if (request.method === 'GET' && path === '/v1/sync') {
      try {
        if (!(await isOwnerTokenAuthorized(request, pool)))
          return json({ error: 'owner_token_invalid' }, 401);
        const url = new URL(request.url);
        const hasTimestamp = url.searchParams.has('afterReceivedAt');
        const hasId = url.searchParams.has('afterId');
        if (hasTimestamp !== hasId) return json({ error: 'invalid_sync_cursor' }, 400);
        let cursor: z.infer<typeof cursorSchema> | null = null;
        if (hasTimestamp && hasId) {
          const parsedCursor = cursorSchema.safeParse({
            receivedAt: url.searchParams.get('afterReceivedAt'),
            id: url.searchParams.get('afterId'),
          });
          if (!parsedCursor.success) return json({ error: 'invalid_sync_cursor' }, 400);
          cursor = parsedCursor.data;
        }
        const { rows } = await pool.query<{
          id: string;
          entity: string;
          payload: Record<string, unknown>;
          createdAt: Date;
          receivedAt: Date;
        }>(
          `SELECT id::text, entity, payload, created_at AS "createdAt", received_at AS "receivedAt"
             FROM app.sync_events
            WHERE ($1::timestamptz IS NULL OR (received_at, id) > ($1::timestamptz, $2::uuid))
            ORDER BY received_at, id
            LIMIT 100`,
          [cursor?.receivedAt ?? null, cursor?.id ?? null],
        );
        const last = rows.at(-1);
        const nextCursor = last ? { receivedAt: last.receivedAt.toISOString(), id: last.id } : null;
        return json({
          operations: rows.map((row) => ({
            id: row.id,
            entity: row.entity,
            payload: row.payload,
            createdAt: row.createdAt.toISOString(),
          })),
          cursor: nextCursor,
          hasMore: rows.length === 100,
        });
      } catch {
        return json({ error: 'service_unavailable' }, 503);
      }
    }

    if (request.method === 'POST' && path === '/v1/sync') {
      try {
        if (!(await isOwnerTokenAuthorized(request, pool)))
          return json({ error: 'owner_token_invalid' }, 401);
        const parsed = parseSyncRequest(await readJson(request));
        if (!parsed.success) return json({ error: 'invalid_sync_request' }, 400);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const insertedIds = await syncOperations(client, parsed.data.operations);
          await client.query('COMMIT');
          return json({
            accepted: parsed.data.operations.map(({ id }) => id),
            inserted: insertedIds.length,
          });
        } catch {
          await client.query('ROLLBACK');
          return json({ error: 'service_unavailable' }, 503);
        } finally {
          client.release();
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'body_too_large') {
          return json({ error: 'request_too_large' }, 413);
        }
        if (error instanceof Error && error.message === 'invalid_json') {
          return json({ error: 'invalid_json' }, 400);
        }
        return json({ error: 'service_unavailable' }, 503);
      }
    }

    return json({ error: 'not_found' }, 404);
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import {
  createOwnerHandler,
  digestOwnerToken,
  parseSyncRequest,
  tokenMatchesDigest,
} from './owner-handler.ts';

const ownerToken = 'a'.repeat(43);

test('owner tokens use SHA-256 digests and reject wrong or malformed values', () => {
  const digest = digestOwnerToken(ownerToken);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(tokenMatchesDigest(ownerToken, digest), true);
  assert.equal(tokenMatchesDigest(`${ownerToken}b`, digest), false);
  assert.equal(tokenMatchesDigest('123456', digest), false);
  assert.equal(tokenMatchesDigest(ownerToken, 'not-a-digest'), false);
});

test('sync payload validation requires typed, bounded operations', () => {
  const operation = {
    id: 'd9428888-122b-4c2e-8b9b-99b5a7d8f63e',
    entity: 'personal-setting',
    payload: { theme: 'light' },
    createdAt: '2026-10-30T12:00:00.000Z',
  };
  assert.equal(parseSyncRequest({ operations: [operation] }).success, true);
  assert.equal(parseSyncRequest({ operations: [{ ...operation, id: 'bad' }] }).success, false);
  assert.equal(
    parseSyncRequest({ operations: Array.from({ length: 51 }, () => operation) }).success,
    false,
  );
});

test('private routes reject requests without a bearer token before connecting to Postgres', async () => {
  const pool = new Pool({
    connectionString: 'postgres://test:test@127.0.0.1:1/test',
    connectionTimeoutMillis: 50,
  });
  try {
    const handle = createOwnerHandler(pool);
    const response = await handle(
      new Request('https://function.invalid/v1/sync', { method: 'GET' }),
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'owner_token_invalid' });
  } finally {
    await pool.end();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import {
  createAuthHandler,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from './auth-handler.ts';

test('passwords are stored using salted scrypt and can be verified', async () => {
  const first = await hashPassword('correct horse battery staple');
  const second = await hashPassword('correct horse battery staple');
  assert.match(first, /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('correct horse battery staple', first), true);
  assert.equal(await verifyPassword('incorrect password', first), false);
  assert.equal(await verifyPassword('anything', 'not-a-password-hash'), false);
});

test('session verifier hashes are fixed-length SHA-256 digests', () => {
  assert.match(hashSessionToken('random-session-token'), /^[a-f0-9]{64}$/);
});

test('first account registration works without an owner token', async () => {
  const client = {
    async query(sql: string, values: unknown[] = []) {
      if (sql.includes('SELECT 1 FROM private.users')) return { rows: [], rowCount: 0 };
      if (sql.includes('INSERT INTO private.users'))
        return {
          rows: [{ id: values[0], fullName: values[1], email: values[2] }],
          rowCount: 1,
        };
      if (sql.includes('INSERT INTO private.sessions'))
        return { rows: [{ expires_at: new Date('2026-12-01T00:00:00.000Z') }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const handle = createAuthHandler(pool);
  const response = await handle(
    new Request('https://function.invalid/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Test Owner',
        email: 'test@example.com',
        password: 'long enough password',
      }),
    }),
  );
  assert.equal(response?.status, 201);
  const body = (await response?.json()) as { token: string; user: { email: string } };
  assert.equal(body.user.email, 'test@example.com');
  assert.ok(body.token.length >= 43);
});

test('only one account can be registered', async () => {
  const client = {
    async query(sql: string) {
      if (sql.includes('SELECT 1 FROM private.users'))
        return { rows: [{ '?column?': 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release() {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const handle = createAuthHandler(pool);
  const response = await handle(
    new Request('https://function.invalid/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Next Owner',
        email: 'next@example.com',
        password: 'long enough password',
      }),
    }),
  );
  assert.equal(response?.status, 409);
  assert.deepEqual(await response?.json(), { error: 'owner_already_registered' });
});

test('invalid JSON is reported safely for login', async () => {
  const pool = new Pool({ connectionString: 'postgres://test:test@127.0.0.1:1/test' });
  try {
    const handle = createAuthHandler(pool);
    const response = await handle(
      new Request('https://function.invalid/v1/auth/login', { method: 'POST', body: '{' }),
    );
    assert.equal(response?.status, 400);
    assert.deepEqual(await response?.json(), { error: 'invalid_json' });
  } finally {
    await pool.end();
  }
});

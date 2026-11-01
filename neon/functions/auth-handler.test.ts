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

test('registration rejects requests without owner authorization before database access', async () => {
  const pool = new Pool({
    connectionString: 'postgres://test:test@127.0.0.1:1/test',
    connectionTimeoutMillis: 50,
  });
  try {
    const handle = createAuthHandler(pool, async () => false);
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
    assert.equal(response?.status, 401);
    assert.deepEqual(await response?.json(), { error: 'owner_setup_required' });
  } finally {
    await pool.end();
  }
});

test('invalid JSON is reported safely for login', async () => {
  const pool = new Pool({ connectionString: 'postgres://test:test@127.0.0.1:1/test' });
  try {
    const handle = createAuthHandler(pool, async () => false);
    const response = await handle(
      new Request('https://function.invalid/v1/auth/login', { method: 'POST', body: '{' }),
    );
    assert.equal(response?.status, 400);
    assert.deepEqual(await response?.json(), { error: 'invalid_json' });
  } finally {
    await pool.end();
  }
});

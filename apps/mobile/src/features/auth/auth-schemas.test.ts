import assert from 'node:assert/strict';
import test from 'node:test';
import { signInSchema, signUpSchema } from './auth-schemas.ts';

test('signup validates name, normalized email shape, password bounds, and matching confirmation', () => {
  const valid = {
    fullName: '  Aliyan  ',
    email: ' user@example.com ',
    password: 'correct horse battery staple',
    confirmPassword: 'correct horse battery staple',
  };
  assert.equal(signUpSchema.safeParse(valid).success, true);
  assert.equal(signUpSchema.safeParse({ ...valid, fullName: ' ' }).success, false);
  assert.equal(signUpSchema.safeParse({ ...valid, email: 'invalid' }).success, false);
  assert.equal(
    signUpSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' }).success,
    false,
  );
  assert.equal(
    signUpSchema.safeParse({ ...valid, confirmPassword: 'different password' }).success,
    false,
  );
});

test('signin rejects malformed email and out-of-range passwords', () => {
  assert.equal(
    signInSchema.safeParse({ email: 'user@example.com', password: 'long enough password' }).success,
    true,
  );
  assert.equal(
    signInSchema.safeParse({ email: 'bad', password: 'long enough password' }).success,
    false,
  );
  assert.equal(
    signInSchema.safeParse({ email: 'user@example.com', password: 'short' }).success,
    false,
  );
});

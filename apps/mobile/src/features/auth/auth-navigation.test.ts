import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessGuestRoutes, canAccessPrivateRoutes } from './auth-navigation.ts';

test('route access stays closed while session restoration is pending', () => {
  assert.equal(canAccessPrivateRoutes('loading'), false);
  assert.equal(canAccessGuestRoutes('loading'), false);
});

test('confirmed signed-out and authenticated states receive only their route groups', () => {
  assert.equal(canAccessGuestRoutes('signed-out'), true);
  assert.equal(canAccessPrivateRoutes('signed-out'), false);
  assert.equal(canAccessPrivateRoutes('authenticated'), true);
  assert.equal(canAccessGuestRoutes('authenticated'), false);
});

test('a cached offline session permits local routes but is not remotely authenticated', () => {
  assert.equal(canAccessPrivateRoutes('offline-authenticated'), true);
  assert.equal(canAccessGuestRoutes('offline-authenticated'), false);
  assert.equal(canAccessPrivateRoutes('offline'), false);
  assert.equal(canAccessGuestRoutes('offline'), true);
});

import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';
import type { SyncCursor, SyncOperation } from '../../services/local-database';

const TOKEN_KEY = 'streak.private-owner-token.v1';
const REQUEST_TIMEOUT_MS = 10_000;

export type OwnerErrorCode =
  'configuration' | 'unauthorized' | 'network' | 'timeout' | 'server' | 'storage';

export class OwnerServiceError extends Error {
  constructor(
    readonly code: OwnerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OwnerServiceError';
  }
}

const verifyResponseSchema = z.object({ verified: z.literal(true) });
const rotateResponseSchema = z.object({ rotated: z.literal(true) });
const syncResponseSchema = z.object({
  accepted: z.array(z.string().uuid()),
  inserted: z.number().int().nonnegative(),
});
const syncPullResponseSchema = z.object({
  operations: z.array(
    z.object({
      id: z.string().uuid(),
      entity: z.string(),
      payload: z.record(z.string(), z.unknown()),
      createdAt: z.string().datetime({ offset: true }),
    }),
  ),
  cursor: z
    .object({ receivedAt: z.string().datetime({ offset: true }), id: z.string().uuid() })
    .nullable(),
  hasMore: z.boolean(),
});

function endpoint(path: string): string {
  const configuredUrl = process.env.EXPO_PUBLIC_NEON_FUNCTIONS_URL?.trim();
  if (!configuredUrl) {
    throw new OwnerServiceError(
      'configuration',
      'Set EXPO_PUBLIC_NEON_FUNCTIONS_URL to the deployed Neon Function URL.',
    );
  }
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== 'https:') throw new Error('https_required');
    return `${url.toString().replace(/\/$/, '')}${path}`;
  } catch {
    throw new OwnerServiceError(
      'configuration',
      'The Neon Function URL must be a valid HTTPS URL.',
    );
  }
}

async function request<T>(
  path: string,
  responseSchema: z.ZodType<T>,
  options: { token?: string; method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint(path), {
      method: options.method ?? 'POST',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
    if (response.status === 401)
      throw new OwnerServiceError('unauthorized', 'That owner token is not valid.');
    if (!response.ok) {
      if (response.status === 503)
        throw new OwnerServiceError(
          'server',
          'Neon is temporarily unavailable. Try again shortly.',
        );
      if (response.status === 413)
        throw new OwnerServiceError('server', 'The sync batch is too large.');
      throw new OwnerServiceError('server', 'The request could not be completed. Try again.');
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new OwnerServiceError('server', 'Neon returned an invalid response.');
    }
    const parsed = responseSchema.safeParse(body);
    if (!parsed.success)
      throw new OwnerServiceError('server', 'Neon returned an unexpected response.');
    return parsed.data;
  } catch (error) {
    if (error instanceof OwnerServiceError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new OwnerServiceError(
        'timeout',
        'The request timed out. Check your connection and try again.',
      );
    }
    throw new OwnerServiceError(
      'network',
      'Could not reach Neon. Check your internet connection and try again.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function getOwnerToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    throw new OwnerServiceError('storage', 'Secure storage is unavailable on this device.');
  }
}

export async function verifyAndStoreOwnerToken(token: string): Promise<void> {
  await request('/v1/owner/verify', verifyResponseSchema, { token });
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token, secureStoreOptions);
  } catch {
    throw new OwnerServiceError(
      'storage',
      'The token was verified but could not be saved securely. Enter it again after checking device storage.',
    );
  }
}

export async function verifyStoredOwnerToken(): Promise<void> {
  const token = await getOwnerToken();
  if (!token)
    throw new OwnerServiceError('unauthorized', 'Owner access has not been set up on this device.');
  await request('/v1/owner/verify', verifyResponseSchema, { token });
}

export async function rotateOwnerToken(nextToken: string): Promise<void> {
  const currentToken = await getOwnerToken();
  if (!currentToken)
    throw new OwnerServiceError('unauthorized', 'Enter your current owner token to reconnect.');
  await request('/v1/owner/rotate', rotateResponseSchema, {
    token: currentToken,
    body: { nextToken },
  });
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, nextToken, secureStoreOptions);
  } catch {
    throw new OwnerServiceError(
      'storage',
      'The token changed on Neon, but SecureStore could not save it. Re-enter the new token on the setup screen.',
    );
  }
}

export async function disconnectOwner(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    throw new OwnerServiceError(
      'storage',
      'Owner access could not be removed from secure storage.',
    );
  }
}

export async function uploadOperations(operations: readonly SyncOperation[]): Promise<string[]> {
  const token = await getOwnerToken();
  if (!token)
    throw new OwnerServiceError('unauthorized', 'Owner access has not been set up on this device.');
  const result = await request('/v1/sync', syncResponseSchema, {
    token,
    body: { operations },
  });
  return result.accepted;
}

export async function downloadOperations(cursor: SyncCursor | null): Promise<{
  operations: SyncOperation[];
  cursor: SyncCursor | null;
  hasMore: boolean;
}> {
  const token = await getOwnerToken();
  if (!token)
    throw new OwnerServiceError('unauthorized', 'Owner access has not been set up on this device.');
  const query = cursor
    ? `?afterReceivedAt=${encodeURIComponent(cursor.receivedAt)}&afterId=${encodeURIComponent(cursor.id)}`
    : '';
  return request(`/v1/sync${query}`, syncPullResponseSchema, { token, method: 'GET' });
}

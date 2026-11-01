import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

const SESSION_KEY = 'streak.auth-session.v1';
const CACHED_USER_KEY = 'streak.auth-user.v1';
const PENDING_REVOKE_KEY = 'streak.auth-revoke-pending.v1';
const userSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string().email(),
});
const sessionSchema = z.object({
  token: z.string().min(43),
  expiresAt: z.string().datetime({ offset: true }),
  user: userSchema,
});
const userResponseSchema = z.object({ user: userSchema });
const logoutSchema = z.object({ revoked: z.literal(true) });
export type AuthUser = z.infer<typeof userSchema>;

export class AuthServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

function url(path: string): string {
  const raw = process.env.EXPO_PUBLIC_NEON_FUNCTIONS_URL?.trim();
  if (!raw) throw new AuthServiceError('configuration', 'The Neon Function URL is not configured.');
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') throw new Error();
    return `${parsed.toString().replace(/\/$/, '')}${path}`;
  } catch {
    throw new AuthServiceError('configuration', 'The Neon Function URL must use HTTPS.');
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: { token?: string; body?: unknown; method?: 'GET' | 'POST' } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url(path), {
      method: options.method ?? 'POST',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const errorPayload = z.object({ error: z.string() }).safeParse(payload);
      const code = errorPayload.success ? errorPayload.data.error : 'service_unavailable';
      const messages: Record<string, string> = {
        owner_already_registered: 'An account already exists. Sign in instead.',
        invalid_credentials: 'Email or password is incorrect.',
        login_throttled: 'Too many failed attempts. Try again in 15 minutes.',
        session_invalid: 'Your session has expired. Sign in again.',
        invalid_registration: 'Check the form fields and try again.',
        invalid_login: 'Enter a valid email and password.',
      };
      throw new AuthServiceError(
        code,
        messages[code] ??
          (response.status >= 500
            ? 'Neon is unavailable right now. Try again shortly.'
            : 'The request could not be completed.'),
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success)
      throw new AuthServiceError('response', 'Neon returned an unexpected response.');
    return parsed.data;
  } catch (error) {
    if (error instanceof AuthServiceError) throw error;
    if (error instanceof Error && error.name === 'AbortError')
      throw new AuthServiceError('timeout', 'The request timed out. Check your connection.');
    throw new AuthServiceError('network', 'Could not reach Neon. Check your connection.');
  } finally {
    clearTimeout(timeout);
  }
}

const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
async function storeSession(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(SESSION_KEY, token, secureOptions);
  } catch {
    throw new AuthServiceError('storage', 'Secure session storage is unavailable.');
  }
}
async function storeCachedUser(user: AuthUser): Promise<void> {
  await SecureStore.setItemAsync(CACHED_USER_KEY, JSON.stringify(user), secureOptions);
}
async function getCachedUser(): Promise<AuthUser | null> {
  try {
    const stored = await SecureStore.getItemAsync(CACHED_USER_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    const result = userSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
async function clearLocalSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_KEY),
    SecureStore.deleteItemAsync(CACHED_USER_KEY),
  ]);
}
async function establish(response: z.infer<typeof sessionSchema>): Promise<AuthUser> {
  await storeSession(response.token);
  try {
    const user = (
      await request('/v1/auth/session', userResponseSchema, {
        method: 'GET',
        token: response.token,
      })
    ).user;
    await storeCachedUser(user).catch(() => undefined);
    return user;
  } catch (error) {
    await clearLocalSession().catch(() => undefined);
    throw error;
  }
}

export async function signUp(input: {
  fullName: string;
  email: string;
  password: string;
}): Promise<AuthUser> {
  const response = await request('/v1/auth/register', sessionSchema, { body: input });
  return establish(response);
}
export async function signIn(input: { email: string; password: string }): Promise<AuthUser> {
  const response = await request('/v1/auth/login', sessionSchema, { body: input });
  return establish(response);
}
export async function getSavedSessionToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SESSION_KEY);
  } catch {
    throw new AuthServiceError('storage', 'Secure session storage is unavailable.');
  }
}
export type SessionRestoreResult = { user: AuthUser | null; remotelyVerified: boolean };

export async function restoreSession(): Promise<SessionRestoreResult> {
  const pending = await SecureStore.getItemAsync(PENDING_REVOKE_KEY);
  if (pending) {
    try {
      await request('/v1/auth/logout', logoutSchema, { token: pending });
      await SecureStore.deleteItemAsync(PENDING_REVOKE_KEY);
    } catch (error) {
      if (error instanceof AuthServiceError && error.code === 'session_invalid')
        await SecureStore.deleteItemAsync(PENDING_REVOKE_KEY);
    }
  }
  const token = await getSavedSessionToken();
  if (!token) {
    await SecureStore.deleteItemAsync(CACHED_USER_KEY).catch(() => undefined);
    return { user: null, remotelyVerified: false };
  }
  try {
    const user = (await request('/v1/auth/session', userResponseSchema, { method: 'GET', token }))
      .user;
    await storeCachedUser(user).catch(() => undefined);
    return { user, remotelyVerified: true };
  } catch (error) {
    if (error instanceof AuthServiceError && error.code === 'session_invalid') {
      await clearLocalSession();
      return { user: null, remotelyVerified: false };
    }
    const cached = await getCachedUser();
    if (cached) return { user: cached, remotelyVerified: false };
    throw error;
  }
}
export async function signOut(): Promise<{ serverRevoked: boolean }> {
  const token = await getSavedSessionToken();
  if (!token) {
    await SecureStore.deleteItemAsync(CACHED_USER_KEY);
    return { serverRevoked: true };
  }
  let serverRevoked = false;
  try {
    await request('/v1/auth/logout', logoutSchema, { token });
    serverRevoked = true;
  } catch (error) {
    if (error instanceof AuthServiceError && error.code === 'session_invalid') serverRevoked = true;
    else
      await SecureStore.setItemAsync(PENDING_REVOKE_KEY, token, secureOptions).catch(
        () => undefined,
      );
  } finally {
    await clearLocalSession();
  }
  return { serverRevoked };
}

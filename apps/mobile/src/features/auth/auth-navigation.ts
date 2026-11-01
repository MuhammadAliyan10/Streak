export type AuthStatus =
  'loading' | 'signed-out' | 'authenticated' | 'offline' | 'offline-authenticated';

export function canAccessPrivateRoutes(status: AuthStatus): boolean {
  return status === 'authenticated' || status === 'offline-authenticated';
}

export function canAccessGuestRoutes(status: AuthStatus): boolean {
  return status === 'signed-out' || status === 'offline';
}

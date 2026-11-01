import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';
import {
  AuthServiceError,
  restoreSession,
  signIn as signInRequest,
  signOut as signOutRequest,
  signUp as signUpRequest,
  type AuthUser,
} from './auth-service';
import { type AuthStatus } from './auth-navigation';

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  retry: () => Promise<void>;
  signIn: (input: { email: string; password: string }) => Promise<AuthUser>;
  signUp: (input: { fullName: string; email: string; password: string }) => Promise<AuthUser>;
  signOut: () => Promise<boolean>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const retry = useCallback(async (preserveStatus = false) => {
    if (!preserveStatus) setStatus('loading');
    setError(null);
    try {
      const restored = await restoreSession();
      setUser(restored.user);
      setStatus(
        restored.user
          ? restored.remotelyVerified
            ? 'authenticated'
            : 'offline-authenticated'
          : 'signed-out',
      );
    } catch (cause) {
      setUser(null);
      setStatus('offline');
      setError(
        cause instanceof AuthServiceError ? cause.message : 'Could not verify your session.',
      );
    }
  }, []);
  useEffect(() => {
    void retry();
  }, [retry]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void retry(true);
    });
    return () => subscription.remove();
  }, [retry]);

  const signIn = useCallback(async (input: { email: string; password: string }) => {
    const result = await signInRequest(input);
    setUser(result);
    setStatus('authenticated');
    setError(null);
    return result;
  }, []);
  const signUp = useCallback(
    async (input: { fullName: string; email: string; password: string }) => {
      const result = await signUpRequest(input);
      setUser(result);
      setStatus('authenticated');
      setError(null);
      return result;
    },
    [],
  );
  const signOut = useCallback(async () => {
    const result = await signOutRequest();
    await queryClient.cancelQueries();
    queryClient.clear();
    setUser(null);
    setStatus('signed-out');
    setError(
      result.serverRevoked
        ? null
        : 'Signed out on this device. Server revocation is pending until you reconnect.',
    );
    return result.serverRevoked;
  }, [queryClient]);

  const value = useMemo(
    () => ({
      status,
      user,
      error,
      retry,
      signIn,
      signUp,
      signOut,
    }),
    [status, user, error, retry, signIn, signUp, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}

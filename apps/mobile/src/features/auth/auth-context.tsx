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
import { getOwnerToken } from '../owner/owner-service';
import {
  AuthServiceError,
  restoreSession,
  signIn as signInRequest,
  signOut as signOutRequest,
  signUp as signUpRequest,
  type AuthUser,
} from './auth-service';

type AuthStatus = 'loading' | 'signed-out' | 'authenticated' | 'offline';
type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  ownerTokenAvailable: boolean;
  error: string | null;
  retry: () => Promise<void>;
  refreshOwnerSetup: () => Promise<void>;
  signIn: (input: { email: string; password: string }) => Promise<AuthUser>;
  signUp: (input: { fullName: string; email: string; password: string }) => Promise<AuthUser>;
  signOut: () => Promise<boolean>;
};
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ownerTokenAvailable, setOwnerTokenAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const ownerToken = await getOwnerToken();
      setOwnerTokenAvailable(!!ownerToken);
      const restored = await restoreSession();
      setUser(restored);
      setStatus(restored ? 'authenticated' : 'signed-out');
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

  const refreshOwnerSetup = useCallback(async () => {
    setOwnerTokenAvailable(!!(await getOwnerToken()));
  }, []);

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
      ownerTokenAvailable,
      error,
      retry,
      refreshOwnerSetup,
      signIn,
      signUp,
      signOut,
    }),
    [status, user, ownerTokenAvailable, error, retry, refreshOwnerSetup, signIn, signUp, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}

import { QueryClient } from '@tanstack/react-query';

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('status' in error && typeof error.status === 'number') return error.status;
  if ('statusCode' in error && typeof error.statusCode === 'number') return error.statusCode;
  return undefined;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          const status = getHttpStatus(error);
          if (status !== undefined && status >= 400 && status < 500) return false;
          return failureCount < 1;
        },
        refetchOnWindowFocus: false,
      },
      mutations: { retry: 0 },
    },
  });
}

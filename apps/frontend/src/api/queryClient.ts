import { createTuyau } from '@tuyau/core/client';
import { createTuyauReactQueryClient } from '@tuyau/react-query';
import { QueryClient } from '@tanstack/react-query';
import type { RequestArgs } from '@tuyau/core/types';
import { registry } from '@capacitylens/backend/registry';
import { fetchApi } from '@/data/requestTimeout';

/** Identifies the user and read projection that owns a cached API result. */
export interface ApiQueryScope {
  userId: string | null;
  companyId: string | null;
  masqueradeGeneration: number;
}

/** The shared cache used by the application and its API query hooks. */
export const queryClient = new QueryClient();

/** Absolute base URL for Tuyau so slash-free routes stay rooted at the site origin. */
const API_CLIENT_BASE = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;

/**
 * A request's own fetchApi deadline. Ky hands an option it does not know to the fetch function,
 * which is how this reaches the client's fetch hook.
 */
interface ApiTimeoutInit extends RequestInit {
  apiTimeoutMs?: number | null;
}

/** The typed product API transport. Keep session, timeout, and masquerade handling at the existing fetch boundary. */
export const client = createTuyau({
  baseUrl: API_CLIENT_BASE,
  registry,
  credentials: 'include',
  retry: 0,
  timeout: false,
  // Tuyau carries cancellation on a Request; fetchApi composes its timeout from init.signal.
  fetch: (input, init) => {
    const { apiTimeoutMs, ...requestInit } = (init ?? {}) as ApiTimeoutInit;
    return fetchApi(
      input,
      {
        ...requestInit,
        signal: requestInit.signal ?? (input instanceof Request ? input.signal : null),
      },
      apiTimeoutMs,
    );
  },
});

/** Typed route queries and mutation options generated from the backend registry. */
export const api = createTuyauReactQueryClient({ client });

/** The generated backend route registry, keyed by route name. */
export type ProductRoutes = typeof registry.routes;

/**
 * Make a named request through the client and return the raw response, so the caller keeps its
 * own status and body handling. `timeoutMs` replaces the interactive deadline; null disables it.
 *
 * @throws The native fetch or abort failure when no response arrives.
 */
export async function requestApiResponse<Name extends keyof ProductRoutes>(
  name: Name,
  args: RequestArgs<ProductRoutes[Name]>,
  timeoutMs?: number | null,
): Promise<Response> {
  let received: Response | undefined;
  const [, error] = await client
    .request(name, {
      ...args,
      throwHttpErrors: false,
      hooks: {
        afterResponse: [
          (_request, _options, response) => {
            // Ky cancels the copy it hands this hook once the hook returns, so keep a copy of it.
            received = response.clone();
          },
        ],
      },
      ...(timeoutMs === undefined ? {} : { apiTimeoutMs: timeoutMs }),
    })
    .safe();
  // The client's own body decoding can fail on an unreadable body; the caller reads it instead.
  if (received) return received;
  if (error?.kind === 'network') throw error.cause;
  throw error ?? new Error(`No response for ${String(name)}`);
}

/** Prefix a Tuyau route key with the identity scope that is allowed to observe its result. */
export function buildScopeQueryKey<const T extends readonly unknown[]>(
  scope: ApiQueryScope,
  routeKey: T,
) {
  return [
    'capacitylens',
    scope.userId,
    scope.companyId,
    scope.masqueradeGeneration,
    ...routeKey,
  ] as const;
}

/** Remove every cached result before a different user or company projection can render. */
export function clearQueryCacheForScopeChange(
  cache: QueryClient,
  previous: ApiQueryScope,
  next: ApiQueryScope,
): boolean {
  if (
    previous.userId === next.userId &&
    previous.companyId === next.companyId &&
    previous.masqueradeGeneration === next.masqueradeGeneration
  ) {
    return false;
  }
  cache.clear();
  return true;
}

/** Route keys of the reads that show rows hidden from the planning cache (archived rows). */
const INACTIVE_READ_ROUTES = ['archive-recovery', 'inactive-company-data'] as const;

/** Mark every inactive-row read stale after a lifecycle change so mounted readers refetch. */
export function invalidateInactiveReads(cache: QueryClient): Promise<void> {
  // The route key follows the four scope segments of buildScopeQueryKey.
  return cache.invalidateQueries({
    predicate: ({ queryKey }) => (INACTIVE_READ_ROUTES as readonly unknown[]).includes(queryKey[4]),
  });
}

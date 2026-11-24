import { createTuyau } from '@tuyau/core/client';
import { createTuyauReactQueryClient } from '@tuyau/react-query';
import { QueryClient } from '@tanstack/react-query';
import type { RequestArgs } from '@tuyau/core/types';
import { registry } from '@capacitylens/backend/registry';
import type { Route } from '@capacitylens/backend/registry';
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

/** The typed product API transport. Keep session, timeout, and masquerade handling at the existing fetch boundary. */
export const client = createTuyau({
  baseUrl: API_CLIENT_BASE,
  registry,
  credentials: 'include',
  retry: 0,
  timeout: false,
  // Tuyau carries cancellation on a Request; fetchApi composes its timeout from init.signal.
  fetch: (input, init) =>
    fetchApi(input, {
      ...init,
      signal: init?.signal ?? (input instanceof Request ? input.signal : null),
    }),
});

/** Typed route queries and mutation options generated from the backend registry. */
export const api = createTuyauReactQueryClient({ client });

/** The generated backend route registry, keyed by route name. */
export type ProductRoutes = typeof registry.routes;

/** Build a product API URL from a route name and its generated path/query arguments. */
export function buildApiRouteUrl<Name extends keyof ProductRoutes>(
  name: Name,
  args: Omit<RequestArgs<ProductRoutes[Name]>, 'body'>,
): string {
  // The URL never depends on the body, so callers send the body separately.
  return client.getRoute(name, args as RequestArgs<ProductRoutes[Name]>).url;
}

/** Serialize a request body checked against the route's generated validator input. */
export function buildJsonBody<Name extends keyof ProductRoutes>(
  _name: Name,
  body: Route.Body<Name>,
): string {
  return JSON.stringify(body);
}

type QueryReadRoute = 'api.company_state.show' | 'api.admission_requests.index';

/** Build query-bearing read URLs with generated inputs; Tuyau getRoute omits query arguments. */
export function buildApiReadRouteUrl<Name extends QueryReadRoute>(
  name: Name,
  args: RequestArgs<ProductRoutes[Name]>,
): string;
export function buildApiReadRouteUrl(
  name: QueryReadRoute,
  args: { query?: ProductRoutes[QueryReadRoute]['types']['query'] },
): string {
  return client.urlFor.get(name, undefined, args.query === undefined ? {} : { qs: args.query }).url;
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
export const INACTIVE_READ_ROUTES = ['archive-recovery', 'inactive-company-data'] as const;

/** Mark every inactive-row read stale after a lifecycle change so mounted readers refetch. */
export function invalidateInactiveReads(cache: QueryClient): Promise<void> {
  // The route key follows the four scope segments of buildScopeQueryKey.
  return cache.invalidateQueries({
    predicate: ({ queryKey }) => (INACTIVE_READ_ROUTES as readonly unknown[]).includes(queryKey[4]),
  });
}

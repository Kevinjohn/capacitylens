import { createTuyau } from "@tuyau/core/client";
import { createTuyauReactQueryClient } from "@tuyau/react-query";
import { QueryClient } from "@tanstack/react-query";
import type { RequestArgs } from "@tuyau/core/types";
import { registry } from "@capacitylens/backend/registry";
import { API_BASE } from "@/data/apiConfig";
import { apiFetch } from "@/data/requestTimeout";

/** Identifies the principal and read projection that owns a cached API result. */
export interface ApiQueryScope {
  principalId: string | null;
  accountId: string | null;
  masqueradeGeneration: number;
}

/** The shared cache used by the application and its API query hooks. */
export const queryClient = new QueryClient();

/** The typed product API transport. Keep session, timeout, and masquerade handling at the existing fetch boundary. */
export const client = createTuyau({
  baseUrl: API_BASE,
  registry,
  credentials: "include",
  retry: 0,
  timeout: false,
  fetch: (input, init) => apiFetch(input, init),
});

/** Typed route queries and mutation options generated from the backend registry. */
export const api = createTuyauReactQueryClient({ client });

type ProductRoutes = typeof registry.routes;

/** Build a product API URL from a route name and its generated path/query arguments. */
export function apiRouteUrl<Name extends keyof ProductRoutes>(
  name: Name,
  args: RequestArgs<ProductRoutes[Name]>,
): string {
  return `${API_BASE}${client.getRoute(name, args).url}`;
}

/** Prefix a Tuyau route key with the identity scope that is allowed to observe its result. */
export function scopeQueryKey<const T extends readonly unknown[]>(scope: ApiQueryScope, routeKey: T) {
  return ["capacitylens", scope.principalId, scope.accountId, scope.masqueradeGeneration, ...routeKey] as const;
}

/** Remove every cached result before a different principal or account projection can render. */
export function clearQueryCacheForScopeChange(
  cache: QueryClient,
  previous: ApiQueryScope,
  next: ApiQueryScope,
): boolean {
  if (
    previous.principalId === next.principalId &&
    previous.accountId === next.accountId &&
    previous.masqueradeGeneration === next.masqueradeGeneration
  ) {
    return false;
  }
  cache.clear();
  return true;
}

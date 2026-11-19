import { apiFetch } from '@/data/requestTimeout';
import { apiRouteUrl } from '@/api/queryClient';

/**
 * Session and company-directory requests. Their typed readers are `fetchAuthStatus` and
 * `useCompanySummaries`; screens use those, never these responses.
 */
export const sessionRequests = {
  me(signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.auth.me', {}), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },

  listCompanies(signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.companies.index', {}), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },
};

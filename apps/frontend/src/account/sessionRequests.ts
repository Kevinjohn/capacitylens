import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl } from '@/api/queryClient';

/**
 * Session and company-directory requests. Their typed readers are `fetchAuthStatus` and
 * `useCompanySummaries`; screens use those, never these responses.
 */
export const sessionRequests = {
  me(signal?: AbortSignal): Promise<Response> {
    return fetchApi(buildApiRouteUrl('api.session.show', {}), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },

  listCompanies(signal?: AbortSignal): Promise<Response> {
    return fetchApi(buildApiRouteUrl('api.companies.index', {}), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },
};

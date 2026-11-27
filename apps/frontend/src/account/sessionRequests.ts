import { requestApiResponse } from '@/api/queryClient'

/**
 * Session and company-directory requests. Their typed readers are `fetchAuthStatus` and
 * `useCompanySummaries`; screens use those, never these responses.
 */
export const sessionRequests = {
  me(signal?: AbortSignal): Promise<Response> {
    return requestApiResponse('api.session.show', signal ? { signal } : {})
  },

  listCompanies(signal?: AbortSignal): Promise<Response> {
    return requestApiResponse('api.companies.index', signal ? { signal } : {})
  },
}

import type { Route } from '@capacitylens/backend/registry'
import { requestApiResponse } from '@/api/queryClient'

/**
 * View-as-member requests. Their typed reader is `masqueradeApi`; screens use it, never these
 * responses.
 */
export const masqueradeRequests = {
  startMasquerade(companyId: string, body: Route.Body<'api.masquerade.store'>): Promise<Response> {
    return requestApiResponse('api.masquerade.store', { params: { companyId }, body })
  },

  masqueradeStatus(companyId?: string): Promise<Response> {
    return requestApiResponse('api.masquerade.show', companyId ? { query: { companyId } } : {})
  },

  endMasquerade(body: Route.Body<'api.masquerade.destroy'>): Promise<Response> {
    return requestApiResponse('api.masquerade.destroy', { body })
  },
}

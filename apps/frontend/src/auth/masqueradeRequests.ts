import { requestApiResponse } from '@/api/queryClient'
import type {
  EndMasqueradePayload,
  StartMasqueradePayload,
} from '@capacitylens/shared/domain/masquerade'

/**
 * View-as-member requests. Their typed reader is `masqueradeApi`; screens use it, never these
 * responses.
 */
export const masqueradeRequests = {
  startMasquerade(companyId: string, body: StartMasqueradePayload): Promise<Response> {
    return requestApiResponse('api.masquerade.store', { params: { companyId }, body })
  },

  masqueradeStatus(companyId?: string): Promise<Response> {
    return requestApiResponse('api.masquerade.show', companyId ? { query: { companyId } } : {})
  },

  endMasquerade(body: EndMasqueradePayload): Promise<Response> {
    return requestApiResponse('api.masquerade.destroy', { body })
  },
}

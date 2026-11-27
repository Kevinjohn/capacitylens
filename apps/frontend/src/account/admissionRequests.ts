import { requestApiResponse } from '@/api/queryClient'

/** The admission records an Owner or Admin can act on; approved people are managed as members. */
export type AdmissionStatus = 'pending' | 'rejected' | 'revoked'

const DECISION_ROUTES = {
  approve: 'api.admission_approvals.store',
  reject: 'api.admission_rejections.store',
  revoke: 'api.admission_revocations.store',
} as const

/**
 * Admission requests. Their typed reader is `teamAccessApi`; screens use it, never these
 * responses.
 */
export const admissionRequests = {
  listAdmissionRequests(
    status: AdmissionStatus,
    cursor: string | null,
    signal?: AbortSignal
  ): Promise<Response> {
    return requestApiResponse('api.admission_requests.index', {
      query: { status, ...(cursor ? { cursor } : {}) },
      ...(signal ? { signal } : {}),
    })
  },

  decideAdmission(userId: string, decision: 'approve' | 'reject' | 'revoke'): Promise<Response> {
    return requestApiResponse(DECISION_ROUTES[decision], { params: { userId } })
  },
}

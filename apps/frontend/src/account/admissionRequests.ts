import { apiFetch } from '@/data/requestTimeout';
import { apiRouteUrl, apiReadRouteUrl } from '@/api/queryClient';

/** The admission records an Owner or Admin can act on; approved people are managed as members. */
export type AdmissionStatus = 'pending' | 'rejected' | 'revoked';

/**
 * Admission requests. Their typed reader is `teamAccessClient`; screens use it, never these
 * responses.
 */
export const admissionRequests = {
  listAdmissionRequests(
    status: AdmissionStatus,
    cursor: string | null,
    signal?: AbortSignal,
  ): Promise<Response> {
    return apiFetch(
      apiReadRouteUrl('api.admission.index', { query: { status, ...(cursor ? { cursor } : {}) } }),
      {
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  },

  decideAdmission(userId: string, decision: 'approve' | 'reject' | 'revoke'): Promise<Response> {
    return apiFetch(apiRouteUrl(`api.admission.${decision}`, { params: { userId } }), {
      method: 'POST',
      credentials: 'include',
    });
  },
};

import { apiFetch } from '@/data/requestTimeout';
import { apiRouteUrl } from '@/api/queryClient';
import type {
  EndMasqueradePayload,
  StartMasqueradePayload,
} from '@capacitylens/shared/domain/masquerade';

/**
 * View-as-member requests. Their typed reader is `masqueradeApi`; screens use it, never these
 * responses.
 */
export const masqueradeRequests = {
  startMasquerade(companyId: string, body: StartMasqueradePayload): Promise<Response> {
    return apiFetch(apiRouteUrl('api.masquerade.start', { params: { companyId } }), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  masqueradeStatus(companyId?: string): Promise<Response> {
    const route = apiRouteUrl('api.masquerade.status', {});
    const url = companyId
      ? `${route}${route.includes('?') ? '&' : '?'}companyId=${encodeURIComponent(companyId)}`
      : route;
    return apiFetch(url, { credentials: 'include' });
  },

  endMasquerade(body: EndMasqueradePayload): Promise<Response> {
    return apiFetch(apiRouteUrl('api.masquerade.end', {}), {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
};

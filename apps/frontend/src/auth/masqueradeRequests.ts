import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
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
    return fetchApi(buildApiRouteUrl('api.masquerade.store', { params: { companyId } }), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: buildJsonBody('api.masquerade.store', body),
    });
  },

  masqueradeStatus(companyId?: string): Promise<Response> {
    const route = buildApiRouteUrl('api.masquerade.show', {});
    const url = companyId
      ? `${route}${route.includes('?') ? '&' : '?'}companyId=${encodeURIComponent(companyId)}`
      : route;
    return fetchApi(url, { credentials: 'include' });
  },

  endMasquerade(body: EndMasqueradePayload): Promise<Response> {
    return fetchApi(buildApiRouteUrl('api.masquerade.destroy', {}), {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: buildJsonBody('api.masquerade.destroy', body),
    });
  },
};

import { apiRouteUrl } from '@/api/queryClient';
import { apiFetch } from '@/data/requestTimeout';

/** Company-scoped onboarding dismissal requests. */
export const gettingStartedClient = {
  read(accountId: string, signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.getting-started.show', { params: { accountId } }), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },

  dismiss(accountId: string): Promise<Response> {
    return apiFetch(apiRouteUrl('api.getting-started.update', { params: { accountId } }), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dismissed: true }),
    });
  },
};

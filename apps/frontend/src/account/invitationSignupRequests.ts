import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
import type { InvitationSignupBody } from './accountRequestTypes';

/**
 * Signed-out invitation requests. Their typed reader is `invitationSignupApi`; screens use it,
 * never these responses.
 */
export const invitationSignupRequests = {
  previewInvitation(token: string): Promise<Response> {
    return fetchApi(buildApiRouteUrl('api.invitation_links.show', { params: { token } }), {
      credentials: 'include',
    });
  },

  signupWithInvitation(token: string, body: InvitationSignupBody): Promise<Response> {
    return fetchApi(buildApiRouteUrl('api.invitation_acceptances.store', { params: { token } }), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: buildJsonBody('api.invitation_acceptances.store', body),
    });
  },
};

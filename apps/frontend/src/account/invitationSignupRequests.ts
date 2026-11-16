import { apiFetch } from '@/data/requestTimeout';
import { apiRouteUrl } from '@/api/queryClient';
import type { InvitationSignupBody } from './accountRequestTypes';

/**
 * Signed-out invitation requests. Their typed reader is `invitationSignupClient`; screens use it,
 * never these responses.
 */
export const invitationSignupRequests = {
  previewInvitation(token: string): Promise<Response> {
    return apiFetch(apiRouteUrl('api.invites.preview', { params: { token } }), {
      credentials: 'include',
    });
  },

  signupWithInvitation(token: string, body: InvitationSignupBody): Promise<Response> {
    return apiFetch(apiRouteUrl('api.invites.sign-up', { params: { token } }), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
};

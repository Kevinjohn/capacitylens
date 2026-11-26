import { requestApiResponse } from '@/api/queryClient';
import type { InvitationSignUpBody } from './accountRequestTypes';

/**
 * Signed-out invitation requests. Their typed reader is `invitationSignUpApi`; screens use it,
 * never these responses.
 */
export const invitationSignUpRequests = {
  previewInvitation(token: string): Promise<Response> {
    return requestApiResponse('api.invitation_links.show', { params: { token } });
  },

  signUpWithInvitation(token: string, body: InvitationSignUpBody): Promise<Response> {
    return requestApiResponse('api.invitation_acceptances.store', { params: { token }, body });
  },
};

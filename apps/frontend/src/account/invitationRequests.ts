import { requestApiResponse } from '@/api/queryClient';
import type { CreateInvitationBody } from './accountRequestTypes';

/**
 * Invitation administration requests. Their typed reader is `teamAccessApi`; screens use it,
 * never these responses.
 */
export const invitationRequests = {
  listInvitations(companyId: string, signal?: AbortSignal): Promise<Response> {
    return requestApiResponse('api.invitations.index', {
      params: { companyId },
      ...(signal ? { signal } : {}),
    });
  },

  createInvitation(body: CreateInvitationBody): Promise<Response> {
    return requestApiResponse('api.invitations.store', { body });
  },

  revokeInvitation(companyId: string, invitationId: string): Promise<Response> {
    return requestApiResponse('api.invitations.destroy', {
      params: { companyId, id: invitationId },
    });
  },

  /** Sends a fresh link for a pending invitation; the earlier link stops working. */
  resendInvitation(companyId: string, invitationId: string): Promise<Response> {
    return requestApiResponse('api.invitation_deliveries.store', {
      params: { companyId, id: invitationId },
    });
  },
};

import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
import type { CreateInvitationBody } from './accountRequestTypes';
import { buildJsonRequestInit } from './memberRequests';

/**
 * Invitation administration requests. Their typed reader is `teamAccessApi`; screens use it,
 * never these responses.
 */
export const invitationRequests = {
  listInvitations(companyId: string, signal?: AbortSignal): Promise<Response> {
    return fetchApi(buildApiRouteUrl('api.invitations.index', { params: { companyId } }), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },

  createInvitation(body: CreateInvitationBody): Promise<Response> {
    return fetchApi(
      buildApiRouteUrl('api.invitations.store', {}),
      buildJsonRequestInit('POST', buildJsonBody('api.invitations.store', body)),
    );
  },

  revokeInvitation(companyId: string, invitationId: string): Promise<Response> {
    return fetchApi(
      buildApiRouteUrl('api.invitations.destroy', { params: { companyId, id: invitationId } }),
      { method: 'DELETE', credentials: 'include' },
    );
  },

  /** Sends a fresh link for a pending invitation; the earlier link stops working. */
  resendInvitation(companyId: string, invitationId: string): Promise<Response> {
    return fetchApi(
      buildApiRouteUrl('api.invitation_deliveries.store', {
        params: { companyId, id: invitationId },
      }),
      {
        method: 'POST',
        credentials: 'include',
      },
    );
  },
};

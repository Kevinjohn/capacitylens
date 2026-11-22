import { getMasqueradeToken } from '@/api/masqueradeToken';
import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
import type { BrowserAccountOperation } from './accountOperations';
import { buildPayloadOperationKey } from './operationOutcome';
import type { CreateInvitationBody } from './accountRequestTypes';
import {
  runOperation,
  buildOperationRequestInit,
  buildJsonOperationRequestInit,
} from './operationRequest';

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

  async createInvitation(
    body: CreateInvitationBody,
    operation?: BrowserAccountOperation,
  ): Promise<Response> {
    const capturedContext = getMasqueradeToken();
    const payload = { ...body };
    const companyId = payload.companyId;
    const operationKey = await buildPayloadOperationKey(`invitation-create:${companyId}`, payload);
    if (getMasqueradeToken() !== capturedContext) {
      return Response.json(
        {
          error: 'The action context changed. Review the invitation before trying again.',
          code: 'MASQUERADE_CONTEXT_CHANGED',
        },
        { status: 409 },
      );
    }
    return runOperation({
      operationKey,
      explicit: operation,
      request: (resolved) =>
        fetchApi(
          buildApiRouteUrl('api.invitations.store', {}),
          buildJsonOperationRequestInit(
            'POST',
            buildJsonBody('api.invitations.store', payload),
            resolved,
          ),
        ),
    });
  },

  revokeInvitation(
    companyId: string,
    invitationId: string,
    operation?: BrowserAccountOperation,
  ): Promise<Response> {
    return runOperation({
      operationKey: `invitation-revoke:${companyId}:${invitationId}`,
      explicit: operation,
      request: (resolved) =>
        fetchApi(
          buildApiRouteUrl('api.invitations.destroy', {
            params: { companyId, id: invitationId },
          }),
          buildOperationRequestInit({ method: 'DELETE', credentials: 'include' }, resolved),
        ),
    });
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

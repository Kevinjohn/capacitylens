import { getMasqueradeContextToken } from '@/api/masqueradeContext';
import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
import type { BrowserAccountCommand } from './accountCommands';
import { buildPayloadOperationKey } from './commandOutcome';
import type { CreateInvitationBody } from './accountRequestTypes';
import { runCommand, buildCommandRequestInit, buildJsonCommandRequestInit } from './commandRequest';

/**
 * Invitation administration requests. Their typed reader is `teamAccessClient`; screens use it,
 * never these responses.
 */
export const invitationRequests = {
  listInvitations(companyId: string, signal?: AbortSignal): Promise<Response> {
    return fetchApi(buildApiRouteUrl('api.invites.index', { params: { companyId } }), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },

  async createInvitation(
    body: CreateInvitationBody,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    const capturedContext = getMasqueradeContextToken();
    const payload = { ...body };
    const companyId = payload.companyId;
    const operationKey = await buildPayloadOperationKey(`invitation-create:${companyId}`, payload);
    if (getMasqueradeContextToken() !== capturedContext) {
      return Response.json(
        {
          error: 'The action context changed. Review the invitation before trying again.',
          code: 'MASQUERADE_CONTEXT_CHANGED',
        },
        { status: 409 },
      );
    }
    return runCommand({
      operationKey,
      explicit: command,
      request: (resolved) =>
        fetchApi(
          buildApiRouteUrl('api.invites.create', {}),
          buildJsonCommandRequestInit(
            'POST',
            buildJsonBody('api.invites.create', payload),
            resolved,
          ),
        ),
    });
  },

  revokeInvitation(
    companyId: string,
    invitationId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand({
      operationKey: `invitation-revoke:${companyId}:${invitationId}`,
      explicit: command,
      request: (resolved) =>
        fetchApi(
          buildApiRouteUrl('api.invites.revoke', {
            params: { companyId, id: invitationId },
          }),
          buildCommandRequestInit({ method: 'DELETE', credentials: 'include' }, resolved),
        ),
    });
  },

  /** Sends a fresh link for a pending invitation; the earlier link stops working. */
  resendInvitation(companyId: string, invitationId: string): Promise<Response> {
    return fetchApi(
      buildApiRouteUrl('api.invites.resend', { params: { companyId, id: invitationId } }),
      {
        method: 'POST',
        credentials: 'include',
      },
    );
  },
};

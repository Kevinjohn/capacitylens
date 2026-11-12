import { getMasqueradeContextToken } from '@/auth/masqueradeContext';
import { apiFetch } from '@/data/requestTimeout';
import type { BrowserAccountCommand } from './accountCommands';
import type { MembershipStatus, Role } from '@capacitylens/shared/account/types';
import type {
  EndMasqueradePayload,
  StartMasqueradePayload,
} from '@capacitylens/shared/domain/masquerade';
import { buildPayloadOperationKey } from './commandOutcome';
import type { CreateInvitationBody, InvitationSignupBody } from './accountRequestTypes';
import { runCommand, buildCommandRequestInit, buildJsonCommandRequestInit } from './commandRequest';
import {
  clearMemberResourceLink,
  resourceAvatarsUrl,
  setMemberResourceLink,
} from './memberResourceClient';
import { apiRouteUrl, apiReadRouteUrl } from '@/api/queryClient';

/** The admission records an Owner or Admin can act on; approved people are managed as members. */
export type AdmissionStatus = 'pending' | 'rejected' | 'revoked';

interface ChangeMemberRoleInput {
  companyId: string;
  principalId: string;
  role: Role;
  command?: BrowserAccountCommand | undefined;
}

interface TransferOwnershipInput {
  companyId: string;
  targetPrincipalId: string;
  confirmationId: string;
  command?: BrowserAccountCommand | undefined;
}

interface ChangeMemberStatusInput {
  companyId: string;
  principalId: string;
  status: MembershipStatus;
  command?: BrowserAccountCommand | undefined;
}

export {
  type BrowserAccountCommand,
  createBrowserAccountCommand,
  clearStoredAccountCommands,
  bindStoredAccountCommandsToIdentity,
} from './accountCommands';
export {
  hasUnknownAccountCommandOutcome,
  readUnknownAccountCommandOutcome,
} from './commandOutcome';

type SetMemberSignInTrackingOptions = { companyId: string; enabled: boolean };
/** Provides typed request methods for account and membership endpoints. */
export const accountClient = {
  me(signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.auth.me', {}), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },
  listCompanies(signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.accounts.index', {}), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },
  diagnostics(signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.diagnostics', {}), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },

  /** Add the small example company to an empty company. Not idempotent: a second call is refused. */
  addExampleData(companyId: string): Promise<Response> {
    return apiFetch(apiRouteUrl('api.example-data', { params: { accountId: companyId } }), {
      method: 'POST',
      credentials: 'include',
    });
  },

  listMembers(companyId: string, signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.members.index', { params: { accountId: companyId } }), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },

  listResourceAvatars: (companyId: string) =>
    apiFetch(resourceAvatarsUrl(companyId), { credentials: 'include' }),
  setMemberResourceLink,
  clearMemberResourceLink,

  setMemberSignInTracking({
    companyId,
    enabled,
  }: SetMemberSignInTrackingOptions): Promise<Response> {
    return apiFetch(apiRouteUrl('api.members.tracking', { params: { accountId: companyId } }), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
  },

  listInvitations(companyId: string, signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.invites.index', { params: { accountId: companyId } }), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },

  startMasquerade(companyId: string, body: StartMasqueradePayload): Promise<Response> {
    return apiFetch(apiRouteUrl('api.masquerade.start', { params: { accountId: companyId } }), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  masqueradeStatus(companyId?: string): Promise<Response> {
    const route = apiRouteUrl('api.masquerade.status', {});
    const url = companyId
      ? `${route}${route.includes('?') ? '&' : '?'}accountId=${encodeURIComponent(companyId)}`
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

  changeMemberRole({
    companyId,
    principalId,
    role,
    command,
  }: ChangeMemberRoleInput): Promise<Response> {
    return runCommand({
      operationKey: `member-role:${companyId}:${principalId}:${role}`,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          apiRouteUrl('api.members.role', {
            params: { accountId: companyId, userId: principalId },
          }),
          buildJsonCommandRequestInit('PATCH', { role }, resolved),
        ),
    });
  },

  changeMemberStatus({
    companyId,
    principalId,
    status,
    command,
  }: ChangeMemberStatusInput): Promise<Response> {
    return runCommand({
      operationKey: `member-status:${companyId}:${principalId}:${status}`,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          apiRouteUrl('api.members.status', {
            params: { accountId: companyId, userId: principalId },
          }),
          buildJsonCommandRequestInit('PATCH', { status }, resolved),
        ),
    });
  },

  transferOwnership({
    companyId,
    targetPrincipalId,
    confirmationId,
    command,
  }: TransferOwnershipInput): Promise<Response> {
    return runCommand({
      operationKey: `ownership-transfer:${companyId}:${targetPrincipalId}`,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          apiRouteUrl('api.ownership.transfer', { params: { accountId: companyId } }),
          buildJsonCommandRequestInit(
            'POST',
            { toUserId: targetPrincipalId, confirmationId },
            resolved,
          ),
        ),
    });
  },

  async createInvitation(
    body: CreateInvitationBody,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    const capturedContext = getMasqueradeContextToken();
    const payload = { ...body };
    const accountId = payload.accountId;
    const operationKey = await buildPayloadOperationKey(`invitation-create:${accountId}`, payload);
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
        apiFetch(
          apiRouteUrl('api.invites.create', {}),
          buildJsonCommandRequestInit('POST', payload, resolved),
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
        apiFetch(
          apiRouteUrl('api.invites.revoke', {
            params: { accountId: companyId, id: invitationId },
          }),
          buildCommandRequestInit({ method: 'DELETE', credentials: 'include' }, resolved),
        ),
    });
  },

  /** Sends a fresh link for a pending invitation; the earlier link stops working. */
  resendInvitation(companyId: string, invitationId: string): Promise<Response> {
    return apiFetch(
      apiRouteUrl('api.invites.resend', { params: { accountId: companyId, id: invitationId } }),
      {
        method: 'POST',
        credentials: 'include',
      },
    );
  },

  listAdmissionRequests(
    status: AdmissionStatus,
    cursor: string | null,
    signal?: AbortSignal,
  ): Promise<Response> {
    return apiFetch(
      apiReadRouteUrl('api.admission.index', { query: { status, ...(cursor ? { cursor } : {}) } }),
      {
        credentials: 'include',
        ...(signal ? { signal } : {}),
      },
    );
  },

  decideAdmission(userId: string, decision: 'approve' | 'reject' | 'revoke'): Promise<Response> {
    return apiFetch(apiRouteUrl(`api.admission.${decision}`, { params: { userId } }), {
      method: 'POST',
      credentials: 'include',
    });
  },

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

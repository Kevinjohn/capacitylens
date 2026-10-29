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
  workspaceId: string;
  principalId: string;
  role: Role;
  command?: BrowserAccountCommand | undefined;
}

interface TransferOwnershipInput {
  workspaceId: string;
  targetPrincipalId: string;
  proofId: string;
  command?: BrowserAccountCommand | undefined;
}

interface ChangeMemberStatusInput {
  workspaceId: string;
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

type SetMemberSignInTrackingOptions = { workspaceId: string; enabled: boolean };
/** Provides typed request methods for account and membership endpoints. */
export const accountClient = {
  me(signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.auth.me', {}), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },
  listWorkspaces(signal?: AbortSignal): Promise<Response> {
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
  addExampleData(workspaceId: string): Promise<Response> {
    return apiFetch(apiRouteUrl('api.example-data', { params: { accountId: workspaceId } }), {
      method: 'POST',
      credentials: 'include',
    });
  },

  listMembers(workspaceId: string, signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.members.index', { params: { accountId: workspaceId } }), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },

  listResourceAvatars: (workspaceId: string) =>
    apiFetch(resourceAvatarsUrl(workspaceId), { credentials: 'include' }),
  setMemberResourceLink,
  clearMemberResourceLink,

  setMemberSignInTracking({
    workspaceId,
    enabled,
  }: SetMemberSignInTrackingOptions): Promise<Response> {
    return apiFetch(apiRouteUrl('api.members.tracking', { params: { accountId: workspaceId } }), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
  },

  listInvitations(workspaceId: string, signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.invites.index', { params: { accountId: workspaceId } }), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },

  startMasquerade(workspaceId: string, body: StartMasqueradePayload): Promise<Response> {
    return apiFetch(apiRouteUrl('api.masquerade.start', { params: { accountId: workspaceId } }), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  masqueradeStatus(workspaceId?: string): Promise<Response> {
    const route = apiRouteUrl('api.masquerade.status', {});
    const url = workspaceId
      ? `${route}${route.includes('?') ? '&' : '?'}accountId=${encodeURIComponent(workspaceId)}`
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
    workspaceId,
    principalId,
    role,
    command,
  }: ChangeMemberRoleInput): Promise<Response> {
    return runCommand({
      operationKey: `member-role:${workspaceId}:${principalId}:${role}`,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          apiRouteUrl('api.members.role', {
            params: { accountId: workspaceId, userId: principalId },
          }),
          buildJsonCommandRequestInit('PATCH', { role }, resolved),
        ),
    });
  },

  changeMemberStatus({
    workspaceId,
    principalId,
    status,
    command,
  }: ChangeMemberStatusInput): Promise<Response> {
    return runCommand({
      operationKey: `member-status:${workspaceId}:${principalId}:${status}`,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          apiRouteUrl('api.members.status', {
            params: { accountId: workspaceId, userId: principalId },
          }),
          buildJsonCommandRequestInit('PATCH', { status }, resolved),
        ),
    });
  },

  enableMemberAccess(
    workspaceId: string,
    principalId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand({
      operationKey: `member-enable-access:${workspaceId}:${principalId}`,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          apiRouteUrl('api.members.enable-access', {
            params: { accountId: workspaceId, userId: principalId },
          }),
          buildJsonCommandRequestInit('POST', {}, resolved),
        ),
    });
  },

  removeMember(
    workspaceId: string,
    principalId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand({
      operationKey: `member-remove:${workspaceId}:${principalId}`,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          apiRouteUrl('api.members.remove', {
            params: { accountId: workspaceId, userId: principalId },
          }),
          buildCommandRequestInit({ method: 'DELETE', credentials: 'include' }, resolved),
        ),
    });
  },

  transferOwnership({
    workspaceId,
    targetPrincipalId,
    proofId,
    command,
  }: TransferOwnershipInput): Promise<Response> {
    return runCommand({
      operationKey: `ownership-transfer:${workspaceId}:${targetPrincipalId}`,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          apiRouteUrl('api.ownership.transfer', { params: { accountId: workspaceId } }),
          buildJsonCommandRequestInit('POST', { toUserId: targetPrincipalId, proofId }, resolved),
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
    workspaceId: string,
    invitationId: string,
    command?: BrowserAccountCommand,
  ): Promise<Response> {
    return runCommand({
      operationKey: `invitation-revoke:${workspaceId}:${invitationId}`,
      explicit: command,
      request: (resolved) =>
        apiFetch(
          apiRouteUrl('api.invites.revoke', {
            params: { accountId: workspaceId, id: invitationId },
          }),
          buildCommandRequestInit({ method: 'DELETE', credentials: 'include' }, resolved),
        ),
    });
  },

  /** Sends a fresh link for a pending invitation; the earlier link stops working. */
  resendInvitation(workspaceId: string, invitationId: string): Promise<Response> {
    return apiFetch(
      apiRouteUrl('api.invites.resend', { params: { accountId: workspaceId, id: invitationId } }),
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

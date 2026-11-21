import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
import type { MembershipStatus, Role } from '@capacitylens/shared/account/types';
import type { BrowserAccountCommand } from './accountCommands';
import { runCommand, buildJsonCommandRequestInit } from './commandRequest';
import { clearMemberResourceLink, setMemberResourceLink } from './memberResourceApi';

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

type SetMemberSignInTrackingOptions = { companyId: string; enabled: boolean };

/**
 * Member and ownership requests. Their typed readers are `teamAccessApi` and
 * `ownershipTransferAccess`; screens use those, never these responses.
 */
export const memberRequests = {
  listMembers(companyId: string, signal?: AbortSignal): Promise<Response> {
    return fetchApi(buildApiRouteUrl('api.members.index', { params: { companyId } }), {
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  },

  setMemberResourceLink,

  clearMemberResourceLink,

  setMemberSignInTracking({
    companyId,
    enabled,
  }: SetMemberSignInTrackingOptions): Promise<Response> {
    return fetchApi(buildApiRouteUrl('api.members.tracking', { params: { companyId } }), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: buildJsonBody('api.members.tracking', { enabled }),
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
        fetchApi(
          buildApiRouteUrl('api.members.role', {
            params: { companyId, userId: principalId },
          }),
          buildJsonCommandRequestInit(
            'PATCH',
            buildJsonBody('api.members.role', { role }),
            resolved,
          ),
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
        fetchApi(
          buildApiRouteUrl('api.members.status', {
            params: { companyId, userId: principalId },
          }),
          buildJsonCommandRequestInit(
            'PATCH',
            buildJsonBody('api.members.status', { status }),
            resolved,
          ),
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
        fetchApi(
          buildApiRouteUrl('api.ownership.transfer', { params: { companyId } }),
          buildJsonCommandRequestInit(
            'POST',
            buildJsonBody('api.ownership.transfer', {
              toUserId: targetPrincipalId,
              confirmationId,
            }),
            resolved,
          ),
        ),
    });
  },
};

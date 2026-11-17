import { apiFetch } from '@/data/requestTimeout';
import { apiRouteUrl } from '@/api/queryClient';
import type { MembershipStatus, Role } from '@capacitylens/shared/account/types';
import type { BrowserAccountCommand } from './accountCommands';
import { runCommand, buildJsonCommandRequestInit } from './commandRequest';
import { clearMemberResourceLink, setMemberResourceLink } from './memberResourceClient';

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
 * Member and ownership requests. Their typed readers are `teamAccessClient` and
 * `ownershipTransferAccess`; screens use those, never these responses.
 */
export const memberRequests = {
  listMembers(companyId: string, signal?: AbortSignal): Promise<Response> {
    return apiFetch(apiRouteUrl('api.members.index', { params: { accountId: companyId } }), {
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
    return apiFetch(apiRouteUrl('api.members.tracking', { params: { accountId: companyId } }), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
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
};

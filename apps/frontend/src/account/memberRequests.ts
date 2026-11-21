import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
import type { MembershipStatus, Role } from '@capacitylens/shared/account/types';
import type { BrowserAccountOperation } from './accountOperations';
import { runOperation, buildJsonOperationRequestInit } from './operationRequest';
import { clearMemberResourceLink, setMemberResourceLink } from './memberResourceApi';

interface ChangeMemberRoleInput {
  companyId: string;
  principalId: string;
  role: Role;
  operation?: BrowserAccountOperation | undefined;
}

interface TransferOwnershipInput {
  companyId: string;
  targetPrincipalId: string;
  confirmationId: string;
  operation?: BrowserAccountOperation | undefined;
}

interface ChangeMemberStatusInput {
  companyId: string;
  principalId: string;
  status: MembershipStatus;
  operation?: BrowserAccountOperation | undefined;
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
    operation,
  }: ChangeMemberRoleInput): Promise<Response> {
    return runOperation({
      operationKey: `member-role:${companyId}:${principalId}:${role}`,
      explicit: operation,
      request: (resolved) =>
        fetchApi(
          buildApiRouteUrl('api.members.role', {
            params: { companyId, userId: principalId },
          }),
          buildJsonOperationRequestInit(
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
    operation,
  }: ChangeMemberStatusInput): Promise<Response> {
    return runOperation({
      operationKey: `member-status:${companyId}:${principalId}:${status}`,
      explicit: operation,
      request: (resolved) =>
        fetchApi(
          buildApiRouteUrl('api.members.status', {
            params: { companyId, userId: principalId },
          }),
          buildJsonOperationRequestInit(
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
    operation,
  }: TransferOwnershipInput): Promise<Response> {
    return runOperation({
      operationKey: `ownership-transfer:${companyId}:${targetPrincipalId}`,
      explicit: operation,
      request: (resolved) =>
        fetchApi(
          buildApiRouteUrl('api.ownership.transfer', { params: { companyId } }),
          buildJsonOperationRequestInit(
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

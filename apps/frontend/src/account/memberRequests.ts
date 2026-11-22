import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
import type { MembershipStatus, Role } from '@capacitylens/shared/account/types';
import type { BrowserAccountOperation } from './accountOperations';
import { runOperation, buildJsonOperationRequestInit } from './operationRequest';
import { clearMemberResourceLink, setMemberResourceLink } from './memberResourceApi';

interface ChangeMemberRoleInput {
  companyId: string;
  userId: string;
  role: Role;
  operation?: BrowserAccountOperation | undefined;
}

interface TransferOwnershipInput {
  companyId: string;
  targetUserId: string;
  confirmationId: string;
  operation?: BrowserAccountOperation | undefined;
}

interface ChangeMemberStatusInput {
  companyId: string;
  userId: string;
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
    return fetchApi(
      buildApiRouteUrl('api.member_sign_in_tracking.update', { params: { companyId } }),
      {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: buildJsonBody('api.member_sign_in_tracking.update', { enabled }),
      },
    );
  },

  changeMemberRole({
    companyId,
    userId,
    role,
    operation,
  }: ChangeMemberRoleInput): Promise<Response> {
    return runOperation({
      operationKey: `member-role:${companyId}:${userId}:${role}`,
      explicit: operation,
      request: (resolved) =>
        fetchApi(
          buildApiRouteUrl('api.members.update', {
            params: { companyId, userId },
          }),
          buildJsonOperationRequestInit(
            'PATCH',
            buildJsonBody('api.members.update', { role }),
            resolved,
          ),
        ),
    });
  },

  changeMemberStatus({
    companyId,
    userId,
    status,
    operation,
  }: ChangeMemberStatusInput): Promise<Response> {
    return runOperation({
      operationKey: `member-status:${companyId}:${userId}:${status}`,
      explicit: operation,
      request: (resolved) =>
        fetchApi(
          buildApiRouteUrl('api.member_status.update', {
            params: { companyId, userId },
          }),
          buildJsonOperationRequestInit(
            'PATCH',
            buildJsonBody('api.member_status.update', { status }),
            resolved,
          ),
        ),
    });
  },

  transferOwnership({
    companyId,
    targetUserId,
    confirmationId,
    operation,
  }: TransferOwnershipInput): Promise<Response> {
    return runOperation({
      operationKey: `ownership-transfer:${companyId}:${targetUserId}`,
      explicit: operation,
      request: (resolved) =>
        fetchApi(
          buildApiRouteUrl('api.ownership_transfers.store', { params: { companyId } }),
          buildJsonOperationRequestInit(
            'POST',
            buildJsonBody('api.ownership_transfers.store', {
              toUserId: targetUserId,
              confirmationId,
            }),
            resolved,
          ),
        ),
    });
  },
};

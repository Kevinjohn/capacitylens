import { fetchApi } from '@/data/requestTimeout';
import { buildApiRouteUrl, buildJsonBody } from '@/api/queryClient';
import type { MembershipStatus, Role } from '@capacitylens/shared/account/types';
import { clearMemberResourceLink, setMemberResourceLink } from './memberResourceApi';

interface ChangeMemberRoleInput {
  companyId: string;
  userId: string;
  role: Role;
}

interface TransferOwnershipInput {
  companyId: string;
  targetUserId: string;
  confirmationId: string;
}

interface ChangeMemberStatusInput {
  companyId: string;
  userId: string;
  status: MembershipStatus;
}

type SetMemberSignInTrackingOptions = { companyId: string; enabled: boolean };

/** Builds a JSON request; `body` comes from `buildJsonBody`. */
export function buildJsonRequestInit(method: 'POST' | 'PATCH' | 'PUT', body: string): RequestInit {
  return {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body,
  };
}

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
      buildJsonRequestInit('PUT', buildJsonBody('api.member_sign_in_tracking.update', { enabled })),
    );
  },

  changeMemberRole({ companyId, userId, role }: ChangeMemberRoleInput): Promise<Response> {
    return fetchApi(
      buildApiRouteUrl('api.members.update', { params: { companyId, userId } }),
      buildJsonRequestInit('PATCH', buildJsonBody('api.members.update', { role })),
    );
  },

  changeMemberStatus({ companyId, userId, status }: ChangeMemberStatusInput): Promise<Response> {
    return fetchApi(
      buildApiRouteUrl('api.member_status.update', { params: { companyId, userId } }),
      buildJsonRequestInit('PATCH', buildJsonBody('api.member_status.update', { status })),
    );
  },

  transferOwnership({
    companyId,
    targetUserId,
    confirmationId,
  }: TransferOwnershipInput): Promise<Response> {
    return fetchApi(
      buildApiRouteUrl('api.ownership_transfers.store', { params: { companyId } }),
      buildJsonRequestInit(
        'POST',
        buildJsonBody('api.ownership_transfers.store', { toUserId: targetUserId, confirmationId }),
      ),
    );
  },
};

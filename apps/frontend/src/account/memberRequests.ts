import { requestApiResponse } from '@/api/queryClient'
import type { MembershipStatus, Role } from '@capacitylens/shared/account/types'
import { clearMemberResourceLink, setMemberResourceLink } from './memberResourceApi'

interface ChangeMemberRoleInput {
  companyId: string
  userId: string
  role: Role
}

interface TransferOwnershipInput {
  companyId: string
  targetUserId: string
  confirmationId: string
}

interface ChangeMemberStatusInput {
  companyId: string
  userId: string
  status: MembershipStatus
}

type SetMemberSignInTrackingOptions = { companyId: string; enabled: boolean }

/**
 * Member and ownership requests. Their typed readers are `teamAccessApi` and
 * `ownershipTransferAccess`; screens use those, never these responses.
 */
export const memberRequests = {
  listMembers(companyId: string, signal?: AbortSignal): Promise<Response> {
    return requestApiResponse('api.members.index', {
      params: { companyId },
      ...(signal ? { signal } : {}),
    })
  },

  setMemberResourceLink,

  clearMemberResourceLink,

  setMemberSignInTracking({
    companyId,
    enabled,
  }: SetMemberSignInTrackingOptions): Promise<Response> {
    return requestApiResponse('api.member_sign_in_tracking.update', {
      params: { companyId },
      body: { enabled },
    })
  },

  changeMemberRole({ companyId, userId, role }: ChangeMemberRoleInput): Promise<Response> {
    return requestApiResponse('api.members.update', {
      params: { companyId, userId },
      body: { role },
    })
  },

  changeMemberStatus({ companyId, userId, status }: ChangeMemberStatusInput): Promise<Response> {
    return requestApiResponse('api.member_status.update', {
      params: { companyId, userId },
      body: { status },
    })
  },

  transferOwnership({
    companyId,
    targetUserId,
    confirmationId,
  }: TransferOwnershipInput): Promise<Response> {
    return requestApiResponse('api.ownership_transfers.store', {
      params: { companyId },
      body: { toUserId: targetUserId, confirmationId },
    })
  },
}

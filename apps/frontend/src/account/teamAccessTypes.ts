import type { InvitationRole } from '@capacitylens/shared/account/types'
import type { Route } from '@capacitylens/backend/registry'

/** Members, sign-in tracking state, and resource candidates for a company. */
export type TeamDirectory = Route.Response<'api.members.index'>['data']

/** A company member and the resource-link state shown in team access. */
export type TeamMember = TeamDirectory['members'][number]

/** A pending invitation for one address. */
export interface TeamInvitation {
  id: string
  role: InvitationRole
  preauthEmail: string
  expiresAt: string
  createdAt: string
}

/** A signed-in person waiting for an Owner or Admin to approve their access. */
export interface AdmissionRequest {
  userId: string
  email: string
  requestedAt: string | null
  /** The role an invitation offered, which completion grants when it is assignable. */
  invitedRole: string | null
  /** `pending` waits for a first decision; a declined or revoked person can still be approved. */
  approval: 'pending' | 'rejected' | 'revoked'
}

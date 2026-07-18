import type { AccountFailure } from './errors'
import type { AccountAuditEvent } from './audit'
import type {
  ActorContext,
  ApplicationSession,
  CommandIdentity,
  CreatedInvitation,
  FederatedSubject,
  IdentityAdminAction,
  IdentityAdminAuthorityDecision,
  InvitationPreview,
  InvitationRole,
  InvitationSummary,
  IsoInstant,
  Membership,
  OperationReceipt,
  OwnershipTransfer,
  PasswordResetCeremony,
  PrincipalId,
  PrincipalSummary,
  ProvisionalPrincipal,
  Role,
  SessionId,
  SessionSummary,
  SignOutResult,
  WorkspaceId,
  WorkspaceMembershipSummary,
} from './types'

/**
 * Append-only normalized account audit destination.
 *
 * Implementations must be fail-never: return false and latch/report degradation rather than
 * throwing after a security-sensitive command has already committed.
 */
export interface AccountAuditPort {
  append(event: AccountAuditEvent): boolean
}

export interface IdentityPort {
  verifyApplicationSession(input: { headers: Headers }): Promise<ApplicationSession | null>
  getPrincipalSummaries(input: {
    principalIds: readonly PrincipalId[]
  }): Promise<readonly PrincipalSummary[]>
  findPrincipalByFederatedSubject(input: {
    subject: FederatedSubject
  }): Promise<PrincipalSummary | null>
  signOut(input: { headers: Headers }): Promise<SignOutResult>
  listSessions(input: { actor: ActorContext }): Promise<readonly SessionSummary[]>
  revokeOwnSession(input: {
    actor: ActorContext
    sessionId: SessionId
    command: CommandIdentity
  }): Promise<OperationReceipt>
  createProvisionalCredentialPrincipal(input: {
    email: string
    displayName: string
    password: string
    emailVerified: boolean
    command: CommandIdentity
  }): Promise<ProvisionalPrincipal>
  compensateProvisionalPrincipal(input: {
    provisional: ProvisionalPrincipal
    reason: 'invitation-claim-failed' | 'workspace-provisioning-failed'
    command: CommandIdentity
  }): Promise<void>
  deprovisionLocalPrincipal(input: {
    principalId: PrincipalId
    reason: 'workspace-erasure' | 'identity-erasure'
    command: CommandIdentity
  }): Promise<OperationReceipt>
  issuePasswordReset(input: {
    targetPrincipalId: PrincipalId
    command: CommandIdentity
  }): Promise<PasswordResetCeremony>
  revokePasswordResetCeremony(input: {
    targetPrincipalId: PrincipalId
    ceremonyId: string
    command: CommandIdentity
  }): Promise<void>
  revokePrincipalSessions(input: {
    targetPrincipalId: PrincipalId
    command: CommandIdentity
  }): Promise<OperationReceipt>
}

export interface AccountAdminPort {
  listWorkspacesForPrincipal(input: {
    principalId: PrincipalId
  }): Promise<readonly WorkspaceMembershipSummary[]>
  getMembership(input: {
    principalId: PrincipalId
    workspaceId: WorkspaceId
  }): Promise<Membership | null>
  listMemberships(input: {
    actor: ActorContext
    workspaceId: WorkspaceId
  }): Promise<readonly Membership[]>
  listInvitations(input: {
    actor: ActorContext
    workspaceId: WorkspaceId
  }): Promise<readonly InvitationSummary[]>
  previewInvitation(input: { token: string }): Promise<InvitationPreview>
  preparePasswordInvitationClaim(input: {
    token: string
    normalizedEmail: string
  }): Promise<{ emailVerifiedByInvitation: boolean; workspaceId: WorkspaceId }>
  createInvitation(input: {
    actor: ActorContext
    workspaceId: WorkspaceId
    role: InvitationRole
    preauthorizedEmail: string | null
    /** Null selects the implementation's standard bounded lifetime at first execution. */
    expiresAt: IsoInstant | null
    command: CommandIdentity
  }): Promise<CreatedInvitation>
  acceptInvitation(input: {
    actor: ActorContext
    token: string
    /** Attributes from the verified application session; never accept these from a request body. */
    principalEmail: string
    emailVerified: boolean
    command: CommandIdentity
  }): Promise<Membership>
  claimInvitationForPrincipal(input: {
    token: string
    principalId: PrincipalId
    principalEmail: string
    emailVerified: boolean
    passwordMode: boolean
    command: CommandIdentity
  }): Promise<Membership>
  revokeInvitation(input: {
    actor: ActorContext
    workspaceId: WorkspaceId
    invitationId: string
    command: CommandIdentity
  }): Promise<OperationReceipt>
  changeMemberRole(input: {
    actor: ActorContext
    workspaceId: WorkspaceId
    targetPrincipalId: PrincipalId
    nextRole: Exclude<Role, 'owner'>
    command: CommandIdentity
  }): Promise<Membership>
  removeMember(input: {
    actor: ActorContext
    workspaceId: WorkspaceId
    targetPrincipalId: PrincipalId
    command: CommandIdentity
  }): Promise<OperationReceipt>
  transferOwnership(input: {
    actor: ActorContext
    workspaceId: WorkspaceId
    targetPrincipalId: PrincipalId
    command: CommandIdentity
  }): Promise<OwnershipTransfer>
  evaluateIdentityAdminAuthority(input: {
    actor: ActorContext
    targetPrincipalId: PrincipalId
    action: IdentityAdminAction
  }): Promise<IdentityAdminAuthorityDecision>
  /** Evaluate several identity-global actions against one consistent membership snapshot. */
  evaluateIdentityAdminAuthorities(input: {
    actor: ActorContext
    targetPrincipalId: PrincipalId
    actions: readonly IdentityAdminAction[]
  }): Promise<ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>
  confirmIdentityAdminAuthority(input: {
    actor: ActorContext
    targetPrincipalId: PrincipalId
    action: IdentityAdminAction
    expectedRevision: string
  }): Promise<boolean>
}

export interface RequestAccess {
  session: ApplicationSession
  membership: Membership
}

export interface MemberDirectoryEntry {
  membership: Membership
  principal: PrincipalSummary | null
}

export interface InviteSignupResult {
  principalId: PrincipalId
  membership: Membership
  compensated: false
}

export type AccountFlowOperation =
  | 'invite-password-signup'
  | 'password-reset'
  | 'session-revocation'
  | 'workspace-provisioning'
  | 'workspace-erasure'

export type CommandOutcome =
  | { status: 'completed'; receipt: OperationReceipt }
  | { status: 'compensated'; receipt: OperationReceipt }
  | { status: 'pending'; receipt: OperationReceipt }
  | {
      status: 'reconciliation-required'
      failure: AccountFailure
      repair: {
        kind: string
        workspaceId: WorkspaceId | null
        targetPrincipalId: PrincipalId | null
        provisionalPrincipalId: PrincipalId | null
        ceremonyId: string | null
      }
    }

export interface AccountFlows {
  resolveRequestAccess(input: {
    headers: Headers
    workspaceId: WorkspaceId
  }): Promise<RequestAccess | null>
  listMemberDirectory(input: {
    actor: ActorContext
    workspaceId: WorkspaceId
  }): Promise<readonly MemberDirectoryEntry[]>
  acceptInviteWithPasswordSignup(input: {
    token: string
    email: string
    displayName: string
    password: string
    command: CommandIdentity
  }): Promise<InviteSignupResult>
  issuePasswordReset(input: {
    actor: ActorContext
    targetPrincipalId: PrincipalId
    command: CommandIdentity
  }): Promise<PasswordResetCeremony>
  revokeMemberSessions(input: {
    actor: ActorContext
    targetPrincipalId: PrincipalId
    command: CommandIdentity
  }): Promise<OperationReceipt>
  reconcileCommand(input: {
    command: CommandIdentity
    operation: AccountFlowOperation
  }): Promise<CommandOutcome | null>
}

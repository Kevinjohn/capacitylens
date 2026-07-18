/**
 * Provider-, framework-, and persistence-neutral account contract types.
 *
 * This module is deliberately a pure leaf. It must remain safe to consume from the browser,
 * server, fakes, and a future sibling package without importing Better Auth, SQLite, Fastify, or
 * React.
 */

export type ApplicationId = string
export type WorkspaceId = string
export type PrincipalId = string
export type SessionId = string
export type MembershipRevision = string
export type PolicyVersion = string
export type CommandId = string
export type IdempotencyKey = string
export type IsoInstant = string
export type AccountMode = 'off' | 'password' | 'sso'

export interface AccountBranding {
  totpIssuer: string
  passwordContextWords: readonly string[]
  defaultProviderLabel: string
}

export const ACCOUNT_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const
export type Role = typeof ACCOUNT_ROLES[number]
export function isAccountRole(value: unknown): value is Role {
  return typeof value === 'string' && (ACCOUNT_ROLES as readonly string[]).includes(value)
}
export type MembershipStatus = 'active'

export interface BoundApplication {
  applicationId: ApplicationId
  displayName: string
  branding: AccountBranding
}

export interface CommandIdentity {
  commandId: CommandId
  idempotencyKey: IdempotencyKey
}

/** Created only from a session verified by IdentityPort; never from a request body's actor id. */
export interface ActorContext {
  principalId: PrincipalId
  sessionId: SessionId
  assurance: ApplicationSession['assurance']
  fresh: boolean
  mfaSatisfied: boolean
}

/** Durable upstream identity key. Email is explicitly not an identity-link key. */
export interface FederatedSubject {
  issuer: string
  subject: string
}

export interface LocalPrincipal {
  id: PrincipalId
  displayName: string
  email: string
  emailVerified: boolean
  linkedSubject: FederatedSubject | null
}

export interface PrincipalSummary {
  id: PrincipalId
  displayName: string | null
  email: string | null
}

export interface ApplicationSession {
  id: SessionId
  principal: LocalPrincipal
  createdAt: IsoInstant
  expiresAt: IsoInstant | null
  freshUntil: IsoInstant | null
  assurance: 'trusted-local' | 'password' | 'mfa' | 'federated'
}

export interface WorkspaceMembershipSummary {
  workspaceId: WorkspaceId
  workspaceName: string
  role: Role
  membershipRevision: MembershipRevision
  policyVersion: PolicyVersion
}

export interface Membership {
  workspaceId: WorkspaceId
  principalId: PrincipalId
  role: Role
  status: MembershipStatus
  joinedAt: IsoInstant
  membershipRevision: MembershipRevision
  policyVersion: PolicyVersion
}

export type InvitationRole = Exclude<Role, 'owner'>

export interface InvitationSummary {
  id: string
  workspaceId: WorkspaceId
  role: InvitationRole
  preauthorizedEmail: string | null
  expiresAt: IsoInstant
  usedAt: IsoInstant | null
  createdAt: IsoInstant
}

/** Public bearer preview. Intentionally excludes email, inviter, identity existence, and token. */
export interface InvitationPreview {
  workspaceName: string
  role: InvitationRole
  expiresAt: IsoInstant
}

/** The raw token is returned once on creation and must never appear on a later read path. */
export interface CreatedInvitation extends InvitationSummary {
  token: string
}

export interface SessionSummary {
  id: SessionId
  createdAt: IsoInstant
  expiresAt: IsoInstant | null
  current: boolean
}

/** Cookie mutations produced by an identity adapter without exposing framework response types. */
export interface SignOutResult {
  setCookies: readonly string[]
}

export interface OperationReceipt {
  commandId: CommandId
  completedAt: IsoInstant
  /** Whether an idempotent set/delete changed durable state, when the operation exposes it. */
  changed?: boolean
}

export interface ProvisionalPrincipal {
  principalId: PrincipalId
  /** Opaque, secret-bearing adapter handle. Never log, audit, or serialize to a browser. */
  compensationHandle: string
}

export interface PasswordResetCeremony {
  ceremonyId: string
  /** Write-once bearer. Never log, persist in audit, or expose from a list operation. */
  token: string
  expiresAt: IsoInstant
}

export interface OwnershipTransfer {
  previousOwner: Membership
  nextOwner: Membership
}

export type IdentityAdminAction = 'issue-password-reset' | 'revoke-sessions'

export type IdentityAdminAuthorityDecision =
  | {
      allowed: true
      revision: MembershipRevision
      policyVersion: PolicyVersion
    }
  | {
      allowed: false
      reason: 'no-standing' | 'insufficient-authority' | 'target-not-member'
    }

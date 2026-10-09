/**
 * Provider-, framework-, and persistence-neutral account contract types.
 *
 * This module is deliberately a pure leaf. It must remain safe to consume from the browser,
 * server, fakes, and a future account package without importing Better Auth, SQLite, Fastify, or
 * React.
 */

export type ApplicationId = string;
/** Opaque company (workspace) identifier. */
export type WorkspaceId = string;
/** Opaque identity-global principal (user) identifier. */
export type PrincipalId = string;
/** Opaque application-session identifier. */
export type SessionId = string;
/** Identity-global security revision. It intentionally changes for every workspace summary when
 * any membership of the principal changes, invalidating all cached authority conservatively. */
export type MembershipRevision = string;
/** Opaque version of the authorization policy a membership was evaluated under. */
export type PolicyVersion = string;
/** Client-supplied identifier of one account command. */
export type CommandId = string;
/** Client-supplied key that makes a retried command replay its first outcome. */
export type IdempotencyKey = string;
/** Canonical UTC instant produced by `Date#toISOString()`, including exactly three millisecond
 * digits and a trailing `Z` (for example `2026-07-18T10:00:00.000Z`). */
export type IsoInstant = string;
/** True only for a string that round-trips exactly through `Date#toISOString()`. Pure. */
export function isIsoInstant(value: unknown): value is IsoInstant {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  try {
    return new Date(milliseconds).toISOString() === value;
  } catch {
    return false;
  }
}
/** Sign-in mode controls authentication methods. Enabled providers determine available SSO
 * options; the access policy separately determines who may join the company. */
export type AccountMode = "off" | "password-only" | "sso-only" | "password-and-sso";

/** Who may join a company without an administrator adding them. */
export type JoiningPolicy = "invitation_only" | "open" | "approved_domains" | "approved_domains_or_invitation";
/** Narrow an untrusted value to a known {@link JoiningPolicy}. Pure. */
export function isJoiningPolicy(value: unknown): value is JoiningPolicy {
  return (
    value === "invitation_only" ||
    value === "open" ||
    value === "approved_domains" ||
    value === "approved_domains_or_invitation"
  );
}

/** A company's joining policy plus the email domains an approved-domain policy admits. */
export interface JoiningPolicySettings {
  policy: JoiningPolicy;
  approvedDomains: readonly string[];
}

/** Whether the selected mode permits local password sign-in and password recovery. */
export function allowsPasswordSignIn(mode: AccountMode): boolean {
  return mode === "password-only" || mode === "password-and-sso";
}

/** Whether the selected mode permits configured external provider sign-in. */
export function allowsProviderSignIn(mode: AccountMode): boolean {
  return mode === "sso-only" || mode === "password-and-sso";
}

/** Product-specific wording an account adapter embeds in password-screening flows. */
export interface AccountBranding {
  passwordContextWords: readonly string[];
  defaultProviderLabel: string;
}

/** Every membership role, most to least privileged. */
export const ACCOUNT_ROLES = Object.freeze(["owner", "admin", "editor", "viewer"] as const);
/** A membership role; see {@link ACCOUNT_ROLES}. */
export type Role = (typeof ACCOUNT_ROLES)[number];
/** Narrow an untrusted value to a known {@link Role}. Pure. */
export function isAccountRole(value: unknown): value is Role {
  return typeof value === "string" && (ACCOUNT_ROLES as readonly string[]).includes(value);
}
/**
 * The lifecycle state of one membership.
 *
 * - `'active'`: an ordinary member: may enter the account under their role.
 * - `'disabled'`: suspended by an administrator. The membership and its role are retained, but the
 *                  principal may not enter the account. Reversible.
 * - `'archived'`: retired by an administrator. Same denial of entry as `'disabled'`; the separate
 *                  state exists so a long-departed member can be filtered out of day-to-day
 *                  administration without destroying the audit trail a removal would.
 *
 * Only `'active'` confers authority. Every authorization read narrows on `status = 'active'`, so a
 * non-active membership is indistinguishable from absence to the access matrix; the widened union
 * is a listing/administration concern, never a permission one. Administration ports return
 * non-active rows only to the member-directory read, so an administrator can see and reverse the
 * state they applied.
 */
export const MEMBERSHIP_STATUSES = Object.freeze(["active", "disabled", "archived"] as const);
/** A membership lifecycle state; see {@link MEMBERSHIP_STATUSES}. */
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
/** Narrow an untrusted value to a known {@link MembershipStatus}. Pure. */
export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return typeof value === "string" && (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

/** The application an account adapter instance is bound to, with its display name and branding. */
export interface BoundApplication {
  applicationId: ApplicationId;
  displayName: string;
  branding: AccountBranding;
}

/** The id and idempotency key every mutating account command carries. */
export interface CommandIdentity {
  commandId: CommandId;
  idempotencyKey: IdempotencyKey;
}

/** Created only from a session verified by IdentityPort; never from a request body's actor id. */
export interface ActorContext {
  principalId: PrincipalId;
  sessionId: SessionId;
  assurance: ApplicationSession["assurance"];
  fresh: boolean;
}

/** Durable upstream identity key. Email is explicitly not an identity-link key. */
export interface FederatedSubject {
  issuer: string;
  subject: string;
}

/** The signed-in principal as the identity adapter resolved it from a verified session. */
export interface LocalPrincipal {
  id: PrincipalId;
  displayName: string;
  email: string;
  emailVerified: boolean;
  linkedSubject: FederatedSubject | null;
  /** IdP-asserted avatar URL for the session principal (https-validated upstream). Absent/`null`
   * for trusted-local and any provider without a picture. Deliberately not on {@link
   * PrincipalSummary}: only the signed-in user's own avatar is surfaced, teammates stay initials. */
  image?: string | null;
}

/** Directory projection of another principal; either field is null when withheld or unknown. */
export interface PrincipalSummary {
  id: PrincipalId;
  displayName: string | null;
  email: string | null;
}

interface ApplicationSessionBase {
  id: SessionId;
  principal: LocalPrincipal;
  createdAt: IsoInstant;
  expiresAt: IsoInstant | null;
  freshUntil: IsoInstant | null;
}

/** A verified application session. Federated assurance structurally requires the provider alias
 * that issued it; every non-federated session structurally excludes one. */
export type ApplicationSession = ApplicationSessionBase &
  (
    | {
        assurance: "federated";
        /** Provider alias only; never a bearer token or upstream subject. */
        providerId: string;
      }
    | {
        assurance: "trusted-local" | "password";
        providerId?: null;
      }
  );

/** One company the principal may enter, for the company picker. */
export interface WorkspaceMembershipSummary {
  workspaceId: WorkspaceId;
  workspaceName: string;
  role: Role;
  membershipRevision: MembershipRevision;
  policyVersion: PolicyVersion;
}

/** One principal's role and lifecycle state in one company. */
export interface Membership {
  workspaceId: WorkspaceId;
  principalId: PrincipalId;
  role: Role;
  status: MembershipStatus;
  /** Explicit company restriction, independent of the membership lifecycle. */
  accessDisabled?: boolean;
  /** False only for a retained restriction whose membership has been removed. */
  membershipPresent?: boolean;
  /** Administrator-only fallback when a removed restricted identity no longer exists. */
  restrictionEmail?: string | null;
  joinedAt: IsoInstant;
  membershipRevision: MembershipRevision;
  policyVersion: PolicyVersion;
}

/** Roles an invitation may grant. Ownership moves only through an ownership transfer. */
export type InvitationRole = Exclude<Role, "owner">;

/** Administrator view of one invitation. Never carries the bearer token. */
export interface InvitationSummary {
  id: string;
  workspaceId: WorkspaceId;
  role: InvitationRole;
  preauthorizedEmail: string | null;
  expiresAt: IsoInstant;
  usedAt: IsoInstant | null;
  createdAt: IsoInstant;
  /** Admin-only proposed schedule person; absent on public and invitee projections. */
  proposedResourceId?: string;
  /** Admin-only current label projection for the proposed person; absent on public and invitee projections. */
  proposedResourceLabel?: string;
}

/** Public bearer preview. Intentionally excludes the full address, domain, inviter, identity
 * existence, and token. `emailHint` contains only a bound address's local part plus `@…`. */
export interface InvitationPreview {
  workspaceId: WorkspaceId;
  workspaceName: string;
  role: InvitationRole;
  expiresAt: IsoInstant;
  emailBound: boolean;
  emailHint: string | null;
}

/** The raw token is returned once on creation and must never appear on a later read path. */
export interface CreatedInvitation extends InvitationSummary {
  token: string;
}

/** One of a principal's sessions, as listed for sign-out management. */
export interface SessionSummary {
  id: SessionId;
  createdAt: IsoInstant;
  expiresAt: IsoInstant | null;
  current: boolean;
}

/** Cookie mutations produced by an identity adapter without exposing framework response types. */
export interface SignOutResult {
  setCookies: readonly string[];
}

/** Proof that a command completed, returned again when the same command is replayed. */
export interface OperationReceipt {
  commandId: CommandId;
  completedAt: IsoInstant;
  /** Whether an idempotent set/delete changed durable state, when the operation exposes it. */
  changed?: boolean;
}

/** A non-terminal command observation. Kept distinct from OperationReceipt so callers cannot
 * mistake a ledger heartbeat for proof that the operation completed. */
export interface PendingOperationReceipt {
  commandId: CommandId;
  observedAt: IsoInstant;
}

/** A principal created ahead of a membership, compensated if the enclosing command fails. */
export interface ProvisionalPrincipal {
  principalId: PrincipalId;
  /** Opaque, secret-bearing adapter handle. Never log, audit, or serialize to a browser. */
  compensationHandle: string;
}

/** One issued password-reset ceremony and its write-once bearer token. */
export interface PasswordResetCeremony {
  ceremonyId: string;
  /** Write-once bearer. Never log, persist in audit, or expose from a list operation. */
  token: string;
  expiresAt: IsoInstant;
}

/** The two memberships exchanged by a completed ownership transfer. */
export interface OwnershipTransfer {
  previousOwner: Membership;
  nextOwner: Membership;
}

/** Identity-global administrative actions an administrator may take on another member. */
export type IdentityAdminAction =
  "issue-password-reset" | "revoke-sessions" | "correct-email" | "remove-federated-link";

/** Whether the actor may take an {@link IdentityAdminAction} on a target, with the revision it was decided against or the refusal reason. */
export type IdentityAdminAuthorityDecision =
  | {
      allowed: true;
      revision: MembershipRevision;
      policyVersion: PolicyVersion;
    }
  | {
      allowed: false;
      reason: "no-standing" | "insufficient-authority" | "target-not-member";
    };

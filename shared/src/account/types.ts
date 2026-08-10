/**
 * Provider-, framework-, and persistence-neutral account contract types.
 *
 * This module is deliberately a pure leaf. It must remain safe to consume from the browser,
 * server, fakes, and a future sibling package without importing Better Auth, SQLite, Fastify, or
 * React.
 */

export type ApplicationId = string;
export type WorkspaceId = string;
export type PrincipalId = string;
export type SessionId = string;
/** Identity-global security revision. It intentionally changes for every workspace summary when
 * any membership of the principal changes, invalidating all cached authority conservatively. */
export type MembershipRevision = string;
export type PolicyVersion = string;
export type CommandId = string;
export type IdempotencyKey = string;
/** Canonical UTC instant produced by `Date#toISOString()`, including exactly three millisecond
 * digits and a trailing `Z` (for example `2026-07-18T10:00:00.000Z`). */
export type IsoInstant = string;
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
export type AccountMode = "off" | "password" | "sso";

export interface AccountBranding {
  totpIssuer: string;
  passwordContextWords: readonly string[];
  defaultProviderLabel: string;
}

export const ACCOUNT_ROLES = Object.freeze(["owner", "admin", "editor", "viewer"] as const);
export type Role = (typeof ACCOUNT_ROLES)[number];
export function isAccountRole(value: unknown): value is Role {
  return typeof value === "string" && (ACCOUNT_ROLES as readonly string[]).includes(value);
}
/**
 * The lifecycle state of one membership.
 *
 * - `'active'`   — an ordinary member: may enter the account under their role.
 * - `'disabled'` — suspended by an administrator. The membership and its role are retained, but the
 *                  principal may NOT enter the account. Reversible.
 * - `'archived'` — retired by an administrator. Same denial of entry as `'disabled'`; the separate
 *                  state exists so a long-departed member can be filtered out of day-to-day
 *                  administration without destroying the audit trail a removal would.
 *
 * Only `'active'` confers authority. Every authorization read narrows on `status = 'active'`, so a
 * non-active membership is indistinguishable from absence to the access matrix; the widened union
 * is a listing/administration concern, never a permission one. Administration ports return
 * non-active rows ONLY to the member-directory read, so an administrator can see and reverse the
 * state they applied.
 */
export const MEMBERSHIP_STATUSES = Object.freeze(["active", "disabled", "archived"] as const);
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export function isMembershipStatus(value: unknown): value is MembershipStatus {
  return typeof value === "string" && (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

export interface BoundApplication {
  applicationId: ApplicationId;
  displayName: string;
  branding: AccountBranding;
}

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
  mfaSatisfied: boolean;
}

/** Durable upstream identity key. Email is explicitly not an identity-link key. */
export interface FederatedSubject {
  issuer: string;
  subject: string;
}

export interface LocalPrincipal {
  id: PrincipalId;
  displayName: string;
  email: string;
  emailVerified: boolean;
  linkedSubject: FederatedSubject | null;
  /** IdP-asserted avatar URL for the SESSION principal (https-validated upstream). Absent/`null`
   *  for trusted-local and any provider without a picture. Deliberately NOT on {@link
   *  PrincipalSummary}: only the signed-in user's own avatar is surfaced — teammates stay initials. */
  image?: string | null;
}

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
        assurance: "trusted-local" | "password" | "mfa";
        providerId?: null;
      }
  );

export interface WorkspaceMembershipSummary {
  workspaceId: WorkspaceId;
  workspaceName: string;
  role: Role;
  membershipRevision: MembershipRevision;
  policyVersion: PolicyVersion;
}

export interface Membership {
  workspaceId: WorkspaceId;
  principalId: PrincipalId;
  role: Role;
  status: MembershipStatus;
  joinedAt: IsoInstant;
  membershipRevision: MembershipRevision;
  policyVersion: PolicyVersion;
}

export type InvitationRole = Exclude<Role, "owner">;

export interface InvitationSummary {
  id: string;
  workspaceId: WorkspaceId;
  role: InvitationRole;
  preauthorizedEmail: string | null;
  expiresAt: IsoInstant;
  usedAt: IsoInstant | null;
  createdAt: IsoInstant;
}

/** Public bearer preview. Intentionally excludes email, inviter, identity existence, and token. */
export interface InvitationPreview {
  workspaceName: string;
  role: InvitationRole;
  expiresAt: IsoInstant;
}

/** The raw token is returned once on creation and must never appear on a later read path. */
export interface CreatedInvitation extends InvitationSummary {
  token: string;
}

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

export interface ProvisionalPrincipal {
  principalId: PrincipalId;
  /** Opaque, secret-bearing adapter handle. Never log, audit, or serialize to a browser. */
  compensationHandle: string;
}

export interface PasswordResetCeremony {
  ceremonyId: string;
  /** Write-once bearer. Never log, persist in audit, or expose from a list operation. */
  token: string;
  expiresAt: IsoInstant;
}

export interface OwnershipTransfer {
  previousOwner: Membership;
  nextOwner: Membership;
}

export type IdentityAdminAction =
  "issue-password-reset" | "revoke-sessions" | "correct-email" | "remove-federated-link";

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

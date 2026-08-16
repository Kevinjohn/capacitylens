import type { AccountFailure } from "./errors";
import type { AccountAuditEvent } from "./audit";
import type {
  ActorContext,
  ApplicationSession,
  CommandIdentity,
  CreatedInvitation,
  FederatedSubject,
  IdentityAdminAction,
  IdentityAdminAuthorityDecision,
  InvitationPreview,
  InvitationSummary,
  IsoInstant,
  Membership,
  MembershipStatus,
  OperationReceipt,
  PendingOperationReceipt,
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
} from "./types";

/**
 * Append-only normalized account audit destination.
 *
 * Implementations must be fail-never: return false and latch/report degradation rather than
 * throwing after a security-sensitive command has already committed.
 */
export interface AccountAuditPort {
  append(event: AccountAuditEvent): boolean;
}

/**
 * Asynchronous account-port contract.
 *
 * Implementations must settle every operation in bounded time. An adapter that awaits network or
 * other potentially unbounded work owns an internal deadline and must translate expiry into the
 * port's documented failure result. Request cancellation is deliberately not part of this
 * repository-local contract: once a durable command is accepted, it must run to a recorded terminal
 * or reconciliation-required outcome even if its originating client disconnects.
 *
 * The current implementations are embedded in the server process. Introducing a remote adapter
 * requires an explicit operation context (including an AbortSignal/deadline), cancellation and
 * reconciliation semantics, and conformance tests proving that coordinator locks are released.
 */
export interface IdentityPort {
  verifyApplicationSession(input: { headers: Headers }): Promise<ApplicationSession | null>;
  getPrincipalSummaries(input: { principalIds: readonly PrincipalId[] }): Promise<readonly PrincipalSummary[]>;
  findPrincipalByFederatedSubject(input: { subject: FederatedSubject }): Promise<PrincipalSummary | null>;
  signOut(input: { headers: Headers }): Promise<SignOutResult>;
  listSessions(input: { actor: ActorContext }): Promise<readonly SessionSummary[]>;
  revokeOwnSession(input: {
    actor: ActorContext;
    sessionId: SessionId;
    command: CommandIdentity;
  }): Promise<OperationReceipt>;
  createProvisionalCredentialPrincipal(input: {
    email: string;
    displayName: string;
    password: string;
    emailVerified: boolean;
    command: CommandIdentity;
  }): Promise<ProvisionalPrincipal>;
  compensateProvisionalPrincipal(input: {
    provisional: ProvisionalPrincipal;
    reason: "invitation-claim-failed" | "workspace-provisioning-failed";
    command: CommandIdentity;
  }): Promise<void>;
  deprovisionLocalPrincipal(input: {
    principalId: PrincipalId;
    reason: "workspace-erasure" | "identity-erasure";
    command: CommandIdentity;
  }): Promise<OperationReceipt>;
  issuePasswordReset(input: {
    targetPrincipalId: PrincipalId;
    command: CommandIdentity;
  }): Promise<PasswordResetCeremony>;
  revokePasswordResetCeremony(input: {
    targetPrincipalId: PrincipalId;
    ceremonyId: string;
    command: CommandIdentity;
  }): Promise<void>;
  revokePrincipalSessions(input: {
    targetPrincipalId: PrincipalId;
    command: CommandIdentity;
  }): Promise<OperationReceipt>;
}

export interface AccountAdminPort {
  listWorkspacesForPrincipal(input: { principalId: PrincipalId }): Promise<readonly WorkspaceMembershipSummary[]>;
  /** Active membership by default — this is the read request authorization goes through, so a
   *  disabled or archived row must look like no membership at all. `includeInactive` answers the
   *  different question "does this relationship exist?" and is for identity administration only:
   *  an admin disables a compromised account BEFORE rotating its password and killing its
   *  sessions, so those routes must still find the member they just suspended. */
  getMembership(input: {
    principalId: PrincipalId;
    workspaceId: WorkspaceId;
    includeInactive?: boolean;
  }): Promise<Membership | null>;
  /** Active memberships by default. `includeInactive` additionally returns disabled and archived
   *  rows and exists for ONE caller — the administrative member directory, which must show an
   *  administrator the state they applied so they can reverse it. Never widen an authorization read
   *  with it: a non-active membership confers nothing. */
  listMemberships(input: {
    actor: ActorContext;
    workspaceId: WorkspaceId;
    includeInactive?: boolean;
  }): Promise<readonly Membership[]>;
  listInvitations(input: { actor: ActorContext; workspaceId: WorkspaceId }): Promise<readonly InvitationSummary[]>;
  previewInvitation(input: { token: string }): Promise<InvitationPreview>;
  preparePasswordInvitationClaim(input: {
    token: string;
    normalizedEmail: string;
  }): Promise<{ emailVerifiedByInvitation: boolean; workspaceId: WorkspaceId }>;
  createInvitation(input: {
    actor: ActorContext;
    workspaceId: WorkspaceId;
    /** Transport-valid roles are accepted here; policy rejects owner with OWNER_TRANSFER_REQUIRED. */
    role: Role;
    preauthorizedEmail: string | null;
    /** Null selects the implementation's standard bounded lifetime at first execution. */
    expiresAt: IsoInstant | null;
    command: CommandIdentity;
  }): Promise<CreatedInvitation>;
  acceptInvitation(input: {
    actor: ActorContext;
    token: string;
    /** Attributes from the verified application session; never accept these from a request body. */
    principalEmail: string;
    emailVerified: boolean;
    command: CommandIdentity;
  }): Promise<Membership>;
  claimInvitationForPrincipal(input: {
    token: string;
    principalId: PrincipalId;
    principalEmail: string;
    emailVerified: boolean;
    passwordMode: boolean;
    command: CommandIdentity;
  }): Promise<Membership>;
  revokeInvitation(input: {
    actor: ActorContext;
    workspaceId: WorkspaceId;
    invitationId: string;
    command: CommandIdentity;
  }): Promise<OperationReceipt>;
  changeMemberRole(input: {
    actor: ActorContext;
    workspaceId: WorkspaceId;
    targetPrincipalId: PrincipalId;
    /** Transport-valid roles are accepted here; policy rejects owner with OWNER_TRANSFER_REQUIRED. */
    nextRole: Role;
    command: CommandIdentity;
  }): Promise<Membership>;
  /** Disable, archive or restore a membership. The role and join date are preserved; only the
   *  authority to enter the workspace changes. Owner memberships and the actor's own are refused. */
  changeMemberStatus(input: {
    actor: ActorContext;
    workspaceId: WorkspaceId;
    targetPrincipalId: PrincipalId;
    nextStatus: MembershipStatus;
    command: CommandIdentity;
  }): Promise<Membership>;
  removeMember(input: {
    actor: ActorContext;
    workspaceId: WorkspaceId;
    targetPrincipalId: PrincipalId;
    command: CommandIdentity;
  }): Promise<OperationReceipt>;
  transferOwnership(input: {
    actor: ActorContext;
    workspaceId: WorkspaceId;
    targetPrincipalId: PrincipalId;
    command: CommandIdentity;
  }): Promise<OwnershipTransfer>;
  evaluateIdentityAdminAuthority(input: {
    actor: ActorContext;
    targetPrincipalId: PrincipalId;
    action: IdentityAdminAction;
  }): Promise<IdentityAdminAuthorityDecision>;
  /** Evaluate several identity-global actions against one consistent membership snapshot. */
  evaluateIdentityAdminAuthorities(input: {
    actor: ActorContext;
    targetPrincipalId: PrincipalId;
    actions: readonly IdentityAdminAction[];
  }): Promise<ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>;
  /** Evaluate the same identity-global actions for several targets from one authority snapshot. */
  evaluateIdentityAdminAuthoritiesForTargets(input: {
    actor: ActorContext;
    targetPrincipalIds: readonly PrincipalId[];
    actions: readonly IdentityAdminAction[];
  }): Promise<ReadonlyMap<PrincipalId, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>>;
  confirmIdentityAdminAuthority(input: {
    actor: ActorContext;
    targetPrincipalId: PrincipalId;
    action: IdentityAdminAction;
    expectedRevision: string;
  }): Promise<boolean>;
}

export interface RequestAccess {
  session: ApplicationSession;
  membership: Membership;
}

export interface MemberDirectoryEntry {
  membership: Membership;
  principal: PrincipalSummary | null;
}

export interface InviteSignupResult {
  principalId: PrincipalId;
  membership: Membership;
  compensated: false;
}

/**
 * Closed vocabulary for durable account-flow operations coordinated across account ports.
 *
 * These values appear in operation receipts and reconciliation records. Adding, renaming or
 * removing a member changes the published serialized contract and is therefore a breaking change.
 */
export const ACCOUNT_FLOW_OPERATIONS = Object.freeze([
  "invite-password-signup",
  "password-reset",
  "session-revocation",
  "workspace-provisioning",
  "workspace-erasure",
] as const);

/** A durable account-flow operation from the closed {@link ACCOUNT_FLOW_OPERATIONS} vocabulary. */
export type AccountFlowOperation = (typeof ACCOUNT_FLOW_OPERATIONS)[number];

/**
 * Validate an untrusted transport or persisted value at the account-flow operation boundary.
 *
 * This pure guard never throws. It is the boundary check for unknown input, not a convenience
 * predicate for values that are already typed as {@link AccountFlowOperation}.
 */
export function isAccountFlowOperation(value: unknown): value is AccountFlowOperation {
  return typeof value === "string" && (ACCOUNT_FLOW_OPERATIONS as readonly string[]).includes(value);
}

export type ReconciliationRepairKind =
  | "invitation-claim-committed"
  | "provisional-principal-compensation-failed"
  | "password-reset-issued"
  | "password-reset-outcome-unknown"
  | "password-reset-revocation-failed"
  | "session-revocation-outcome-unknown"
  | "stale-pending"
  | "operator-review";

export type CommandOutcome =
  | { status: "completed"; receipt: OperationReceipt }
  | { status: "compensated"; receipt: OperationReceipt }
  | { status: "pending"; receipt: PendingOperationReceipt }
  | {
      status: "reconciliation-required";
      receipt: PendingOperationReceipt;
      failure: AccountFailure;
      repair: {
        kind: ReconciliationRepairKind;
        workspaceId: WorkspaceId | null;
        targetPrincipalId: PrincipalId | null;
        provisionalPrincipalId: PrincipalId | null;
        ceremonyId: string | null;
      };
    };

export interface AccountFlows {
  resolveRequestAccess(input: { headers: Headers; workspaceId: WorkspaceId }): Promise<RequestAccess | null>;
  listMemberDirectory(input: {
    actor: ActorContext;
    workspaceId: WorkspaceId;
  }): Promise<readonly MemberDirectoryEntry[]>;
  acceptInviteWithPasswordSignup(input: {
    token: string;
    email: string;
    displayName: string;
    password: string;
    command: CommandIdentity;
  }): Promise<InviteSignupResult>;
  issuePasswordReset(input: {
    actor: ActorContext;
    targetPrincipalId: PrincipalId;
    command: CommandIdentity;
  }): Promise<PasswordResetCeremony>;
  revokeMemberSessions(input: {
    actor: ActorContext;
    targetPrincipalId: PrincipalId;
    command: CommandIdentity;
  }): Promise<OperationReceipt>;
  reconcileCommand(input: {
    command: CommandIdentity;
    operation: AccountFlowOperation;
  }): Promise<CommandOutcome | null>;
}

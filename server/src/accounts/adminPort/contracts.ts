import type { StandardAccountAuditAction } from "@capacitylens/shared/account/audit";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import type {
  ActorContext,
  CommandIdentity,
  CreatedInvitation,
  IdentityAdminAction,
  IdentityAdminAuthorityDecision,
  Membership,
  Role,
} from "@capacitylens/shared/account/types";
import type { Db } from "../../db";
import type { SynchronousCallback } from "../../txn";
import type { WriteOnceSecretReplay } from "../writeOnceSecretReplay";

export interface LocalAccountAdminPort extends AccountAdminPort {
  roleForPrincipalInWorkspace(principalId: string, workspaceId: string): Role | null;
  workspacePrincipalIds(workspaceId: string): readonly string[];
  /** Read-only projection for a principal whose effective permissions have already been
   * authenticated and scoped by the HTTP adapter. This deliberately accepts a principal id,
   * rather than a fabricated ActorContext, and does not grant command authority. */
  projectIdentityAdminAuthoritiesForTargets(input: {
    principalId: string;
    targetPrincipalIds: readonly string[];
    actions: readonly IdentityAdminAction[];
  }): ReadonlyMap<string, ReadonlyMap<IdentityAdminAction, IdentityAdminAuthorityDecision>>;
  evaluateWorkspaceProvisioningAuthorityInTx(input: {
    actor: ActorContext;
    multiWorkspace: boolean;
    bootstrapAuthorized: boolean;
    /** Final transaction-wide count for a trusted-local batch replacement. */
    projectedWorkspaceCount?: number;
  }):
    | { allowed: true }
    | {
        allowed: false;
        reason: "single-workspace-cap" | "insufficient-authority";
      };
  provisionOwnerMembershipInTx(input: { workspaceId: string; principalId: string; joinedAt: string }): Membership;
  assertWorkspaceErasureAuthorityInTx(actor: ActorContext, workspaceId: string): void;
  /** Remove the erased workspace's control rows and return principals with no membership row in
   * any surviving workspace. All statuses count here so identity deprovisioning cannot leave a
   * surviving control row pointing at an erased principal. */
  eraseWorkspaceAdministrationInTx(workspaceId: string): readonly string[];
}

/** Account-control capabilities needed by cutover inventory and transaction-bound repair. */
export interface SsoCutoverAccountAdminPort extends LocalAccountAdminPort {
  inspectSsoCutoverWorkspaces(): readonly SsoCutoverWorkspaceFact[];
  /** Recheck requested-workspace membership and the identity-global authority revision while the
   * identity adapter owns the same SQLite write transaction. */
  assertIdentityRepairAuthorityInTx(input: {
    actor: ActorContext;
    workspaceId: string;
    targetPrincipalId: string;
    action: Extract<IdentityAdminAction, "correct-email" | "remove-federated-link">;
    expectedRevision: string;
  }): void;
  /** Promote one existing active member only while the workspace is still ownerless. This narrow
   * stopped-server repair seam keeps control-table writes inside the account storage owner. */
  repairOwnerlessWorkspaceInTx(workspaceId: string, principalId: string): boolean;
}

/** Immutable account-side workspace/member inventory for cutover evaluation. */
export interface SsoCutoverWorkspaceFact {
  workspaceId: string;
  workspaceName: string;
  members: readonly { principalId: string; role: Role; status: "active" }[];
}

export const ACCOUNT_POLICY_VERSION = "account-policy-v1";

export const MAX_INVITATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export interface AdminPortContext {
  applicationId: string;
  db: Db;
  trustedLocal: boolean;
  requireMfa: boolean;
  invitationSecretReplay: WriteOnceSecretReplay<CreatedInvitation>;
  runMutation: <Execute extends () => unknown>(options: {
    operation: string;
    actorPrincipalId: string | null;
    targetPrincipalId?: string | null;
    workspaceId?: string | null;
    command: CommandIdentity;
    payload: unknown;
    lockKeys: readonly string[];
    execute: SynchronousCallback<Execute>;
    persistResult?: (result: ReturnType<Execute>) => unknown;
    replayResult?: (stored: unknown, commandId: string) => ReturnType<Execute>;
    replayGuard?: () => void;
    /** In-memory secret/cache maintenance that must happen after commit but before lock release. */
    afterCommit?: (result: ReturnType<Execute>) => void;
    /** Release any in-memory reservation after the database transaction rolls back. */
    afterRollback?: () => void;
    audit?: {
      action: StandardAccountAuditAction;
      changedFields: readonly string[];
    };
  }) => Promise<ReturnType<Execute>>;
}

import "@capacitylens/shared/account/errors"; // Pinned coordinator-to-contract runtime boundary.
import type {
  AccountAdminPort,
  AccountAuditPort,
  AccountFlows,
  CommandOutcome,
} from "@capacitylens/shared/account/ports";
import type { ActorContext, CommandIdentity, PasswordResetCeremony } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import { tx } from "../txn";
import { accountAuditWriter, type AccountAuditInput } from "./accountFlowRuntime";
import type { LocalIdentityPort } from "./betterAuthIdentityPort";
import { getAccountCommandById, getAccountCommandByIdForReconciliation, terminateCommand } from "./commands";
import { denied } from "./flows/failures";
import { inviteSignup } from "./flows/inviteSignup";
import { passwordReset } from "./flows/passwordReset";
import { reads } from "./flows/reads";
import { storedReconciliationRepair } from "./flows/reconciliationRepair";
import { sessionRevocation } from "./flows/sessionRevocation";
import { workspaceLifecycle } from "./flows/workspaceLifecycle";
import { KeyedOperationLock } from "./operationLock";
import type { LocalAccountAdminPort } from "./sqliteAccountAdminPort";
import { WriteOnceSecretReplay } from "./writeOnceSecretReplay";
export { actorContextFromSession } from "./flows/actorContext";
export { CorruptAccountCommandStateError } from "./flows/reconciliationRepair";

export interface LocalAccountFlows extends AccountFlows {
  provisionWorkspace<T>(input: {
    actor: ActorContext;
    workspaceId: string;
    joinedAt: string;
    command: CommandIdentity;
    multiWorkspace: boolean;
    bootstrapAuthorized: boolean;
    canonicalProductPayload: unknown;
    provisionProductData: () => T;
  }): Promise<{
    product: T;
    membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
    replayed: boolean;
  }>;
  replayWorkspaceProvisioning<T>(input: {
    actor: ActorContext;
    workspaceId: string;
    command: CommandIdentity;
    canonicalProductPayload: unknown;
  }): Promise<{
    product: T;
    membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
    replayed: true;
  } | null>;
  replayWorkspaceErasure(input: {
    actor: ActorContext;
    workspaceId: string;
    command: CommandIdentity;
  }): Promise<{ commandId: string; completedAt: string } | null>;
  eraseWorkspace(input: {
    actor: ActorContext;
    workspaceId: string;
    command: CommandIdentity;
    auditProductMutationInTx?: () => void;
  }): Promise<{ commandId: string; completedAt: string }>;
  provisionWorkspaceInExistingTransaction(input: {
    workspaceId: string;
    principalId: string;
    joinedAt: string;
    multiWorkspace: boolean;
    projectedWorkspaceCount: number;
  }): void;
  withWorkspaceErasureLocks<T>(
    workspaceIds: readonly string[],
    operation: () => Promise<T> | T,
    options?: { serializeWorkspaceProvisioning?: boolean },
  ): Promise<T>;
}

/** Cross-port orchestration with explicit transaction and command-ledger ownership. Policy
 * decisions remain inside AccountAdminPort; durable ledger representation remains in commands.ts. */
export function localAccountFlows(input: {
  applicationId: string;
  db: Db;
  identity: LocalIdentityPort;
  administration: LocalAccountAdminPort;
  lock: KeyedOperationLock;
  eraseProductWorkspaceInTx(workspaceId: string): void;
  audit?: AccountAuditPort;
  /** Test seam; production uses the bounded default. */
  writeOnceReplayCapacity?: number;
}): LocalAccountFlows {
  const { applicationId, db, identity, administration, lock, eraseProductWorkspaceInTx } = input;
  const audit = accountAuditWriter(applicationId, input.audit);
  const persistTerminalOutcome = (write: () => boolean | void, event: AccountAuditInput): boolean | void =>
    tx(
      db,
      () => {
        const result = write();
        if (result === false) return false;
        audit(event);
        return result;
      },
      "immediate",
    );
  // issuePasswordReset and revokeMemberSessions both deny on the same evaluateIdentityAdminAuthority
  // shape: persist the compensated terminal outcome, then throw denied(). Only the audit action and
  // denied()'s second argument differ between the two callers; their outer catch blocks have real
  // divergence (requiresReconciliation exclusions, non-reconciliation audit action) and stay separate.
  const denyIdentityAdminCommand = (
    scope: Pick<Parameters<typeof terminateCommand>[1], "applicationId" | "operation">,
    command: CommandIdentity,
    reason: string,
    actorPrincipalId: string,
    targetPrincipalId: string,
    auditAction: AccountAuditInput["action"],
    deniedAction: "issue-password-reset" | "revoke-sessions",
  ): never => {
    persistTerminalOutcome(
      () =>
        terminateCommand(db, scope, command, "compensated", reason === "target-not-member" ? "NOT_FOUND" : "FORBIDDEN"),
      {
        action: auditAction,
        outcome: "denied",
        actorPrincipalId,
        targetPrincipalId,
        command,
      },
    );
    throw denied(reason, deniedAction, command.commandId);
  };
  const resetReplay = new WriteOnceSecretReplay<PasswordResetCeremony>(input.writeOnceReplayCapacity ?? 128);
  // Every live coordinator execution and its reconciliation read share this key. The NUL prefix
  // sorts before all external principal/workspace keys, so invitation signup may safely discover
  // and acquire those keys later without violating KeyedOperationLock's global order.
  const commandExecutionKey = (command: CommandIdentity): string =>
    `\0account-command:${applicationId}:${command.commandId}`;

  const context = {
    applicationId,
    db,
    identity,
    administration,
    lock,
    eraseProductWorkspaceInTx,
    audit,
    persistTerminalOutcome,
    denyIdentityAdminCommand,
    resetReplay,
    commandExecutionKey,
  };
  return {
    ...workspaceLifecycle(context),
    ...reads(context),
    ...inviteSignup(context),
    ...passwordReset(context),
    ...sessionRevocation(context),

    async reconcileCommand({ command, operation }): Promise<CommandOutcome | null> {
      const matchesRequest = (row: ReturnType<typeof getAccountCommandById>): boolean =>
        row !== null &&
        row.idempotencyKey === command.idempotencyKey &&
        (row.operation === operation || row.operation.startsWith(`${operation}:actor:`));
      // Validate the reconciliation bearer before waiting on a possibly long-running command.
      // Only the second read may age the row, and it runs under the exact key held by every live
      // executor. After a process restart the process-local lock is absent, which is proof that a
      // stale pending row has no surviving executor in this supported single-process topology.
      if (!matchesRequest(getAccountCommandById(db, applicationId, command.commandId))) return null;
      return lock.withKeys([commandExecutionKey(command)], () => {
        const row = getAccountCommandByIdForReconciliation(db, applicationId, command.commandId);
        if (!matchesRequest(row) || row === null) return null;
        const receipt = {
          commandId: row.commandId,
          completedAt: row.updatedAt,
        };
        if (row.status === "completed") return { status: "completed", receipt };
        if (row.status === "compensated") return { status: "compensated", receipt };
        if (row.status === "pending") {
          return {
            status: "pending",
            receipt: { commandId: row.commandId, observedAt: row.updatedAt },
          };
        }
        if (row.status === "reconciliation_required") {
          const stored = storedReconciliationRepair(row, operation);
          return {
            status: "reconciliation-required",
            receipt: { commandId: row.commandId, observedAt: row.updatedAt },
            failure: {
              code: row.failureCode ?? "DEPENDENCY_UNAVAILABLE",
              message: "This command requires operator reconciliation before it can be retried.",
              retryable: true,
              commandId: row.commandId,
            },
            repair: {
              kind: stored.kind,
              workspaceId: typeof stored.workspaceId === "string" ? stored.workspaceId : row.workspaceId,
              targetPrincipalId:
                typeof stored.targetPrincipalId === "string" ? stored.targetPrincipalId : row.targetPrincipalId,
              provisionalPrincipalId:
                typeof stored.provisionalPrincipalId === "string" ? stored.provisionalPrincipalId : null,
              ceremonyId: typeof stored.ceremonyId === "string" ? stored.ceremonyId : null,
            },
          };
        }
        return {
          status: "pending",
          receipt: { commandId: row.commandId, observedAt: row.updatedAt },
        };
      });
    },
  } satisfies LocalAccountFlows;
}

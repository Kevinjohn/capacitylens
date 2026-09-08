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
import { createAccountAuditWriter, type AccountAuditInput } from "./accountFlowRuntime";
import type { LocalIdentityPort } from "./betterAuthIdentityPort";
import { getAccountCommandById, getAccountCommandByIdForReconciliation, terminateCommand } from "./commands";
import type { DenyIdentityAdminCommandInput } from "./flows/context";
import { createAuthorityDenial } from "./flows/failures";
import { createInviteSignupFlows } from "./flows/inviteSignup";
import { createPasswordResetFlows } from "./flows/passwordReset";
import { createAccountReadFlows } from "./flows/reads";
import { parseStoredReconciliationRepair } from "./flows/reconciliationRepair";
import { createSessionRevocationFlows } from "./flows/sessionRevocation";
import { createWorkspaceLifecycleFlows } from "./flows/workspaceLifecycle";
import { KeyedOperationLock } from "./KeyedOperationLock";
import type { LocalAccountAdminPort } from "./sqliteAccountAdminPort";
import { WriteOnceSecretReplay } from "./WriteOnceSecretReplay";
export { buildActorContextFromSession } from "./flows/actorContext";
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

type ReconcileInput = Parameters<AccountFlows["reconcileCommand"]>[0];
type ReconciliationRow = NonNullable<ReturnType<typeof getAccountCommandByIdForReconciliation>>;

function matchesReconciliationRequest(row: ReturnType<typeof getAccountCommandById>, input: ReconcileInput): boolean {
  return (
    row !== null &&
    row.idempotencyKey === input.command.idempotencyKey &&
    (row.operation === input.operation || row.operation.startsWith(`${input.operation}:actor:`))
  );
}

function buildReconciliationOutcome(row: ReconciliationRow, operation: ReconcileInput["operation"]): CommandOutcome {
  const receipt = { commandId: row.commandId, completedAt: row.updatedAt };
  if (row.status === "completed") return { status: "completed", receipt };
  if (row.status === "compensated") return { status: "compensated", receipt };
  const pendingReceipt = { commandId: row.commandId, observedAt: row.updatedAt };
  if (row.status === "pending") return { status: "pending", receipt: pendingReceipt };

  const stored = parseStoredReconciliationRepair(row, operation);
  return {
    status: "reconciliation-required",
    receipt: pendingReceipt,
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
      provisionalPrincipalId: typeof stored.provisionalPrincipalId === "string" ? stored.provisionalPrincipalId : null,
      ceremonyId: typeof stored.ceremonyId === "string" ? stored.ceremonyId : null,
    },
  };
}

async function reconcileCommand(
  input: ReconcileInput,
  context: {
    applicationId: string;
    db: Db;
    lock: KeyedOperationLock;
    buildCommandExecutionKey: (command: CommandIdentity) => string;
  },
): Promise<CommandOutcome | null> {
  const { applicationId, db, lock, buildCommandExecutionKey } = context;
  if (!matchesReconciliationRequest(getAccountCommandById(db, applicationId, input.command.commandId), input)) {
    return null;
  }
  return lock.withKeys([buildCommandExecutionKey(input.command)], () => {
    const row = getAccountCommandByIdForReconciliation({ db, applicationId, commandId: input.command.commandId });
    if (row === null || !matchesReconciliationRequest(row, input)) return null;
    return buildReconciliationOutcome(row, input.operation);
  });
}

function createTerminalOutcomePersister(db: Db, audit: (event: AccountAuditInput) => void) {
  return (write: () => boolean | void, event: AccountAuditInput): boolean | void =>
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
}

function createIdentityAdminDenial(db: Db, persistTerminalOutcome: ReturnType<typeof createTerminalOutcomePersister>) {
  return ({
    scope,
    command,
    reason,
    actorPrincipalId,
    targetPrincipalId,
    auditAction,
    deniedAction,
  }: DenyIdentityAdminCommandInput): never => {
    persistTerminalOutcome(
      () =>
        terminateCommand({
          db,
          scope,
          command,
          status: "compensated",
          failureCode: reason === "target-not-member" ? "NOT_FOUND" : "FORBIDDEN",
        }),
      { action: auditAction, outcome: "denied", actorPrincipalId, targetPrincipalId, command },
    );
    throw createAuthorityDenial(reason, deniedAction, command.commandId);
  };
}

/** Cross-port orchestration with explicit transaction and command-ledger ownership. Policy
 * decisions remain inside AccountAdminPort; durable ledger representation remains in commands.ts. */
export function createLocalAccountFlows(input: {
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
  const audit = createAccountAuditWriter(applicationId, input.audit);
  const persistTerminalOutcome = createTerminalOutcomePersister(db, audit);
  // issuePasswordReset and revokeMemberSessions both deny on the same evaluateIdentityAdminAuthority
  // shape: persist the compensated terminal outcome, then throw createAuthorityDenial(). Only the audit action and
  // createAuthorityDenial()'s second argument differ between the two callers; their outer catch blocks have real
  // divergence (requiresReconciliation exclusions, non-reconciliation audit action) and stay separate.
  const denyIdentityAdminCommand = createIdentityAdminDenial(db, persistTerminalOutcome);
  const resetReplay = new WriteOnceSecretReplay<PasswordResetCeremony>(input.writeOnceReplayCapacity ?? 128);
  // Every live coordinator execution and its reconciliation read share this key. The NUL prefix
  // sorts before all external principal/workspace keys, so invitation signup may safely discover
  // and acquire those keys later without violating KeyedOperationLock's global order.
  const buildCommandExecutionKey = (command: CommandIdentity): string =>
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
    buildCommandExecutionKey,
  };
  return {
    ...createWorkspaceLifecycleFlows(context),
    ...createAccountReadFlows(context),
    ...createInviteSignupFlows(context),
    ...createPasswordResetFlows(context),
    ...createSessionRevocationFlows(context),

    async reconcileCommand(reconcileInput): Promise<CommandOutcome | null> {
      // Validate the reconciliation bearer before waiting on a possibly long-running command.
      // Only the second read may age the row, and it runs under the exact key held by every live
      // executor. After a process restart the process-local lock is absent, which is proof that a
      // stale pending row has no surviving executor in this supported single-process topology.
      return reconcileCommand(reconcileInput, { applicationId, db, lock, buildCommandExecutionKey });
    },
  } satisfies LocalAccountFlows;
}

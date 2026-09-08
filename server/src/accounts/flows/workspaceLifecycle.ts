import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import { tx } from "../../txn";
import { recordTerminalOutcome } from "../accountFlowRuntime";
import {
  beginCommand,
  completeCommand,
  eraseWorkspaceCommandHistoryInTx,
  markAccountCommandReplay,
  readCommand,
  resumeExistingCommand,
  terminateCommand,
} from "../commands";
import type { LocalAccountFlows } from "../createLocalAccountFlows";
import { assertWorkspaceProvisioningAllowedInTx, withMembershipSnapshotRetry } from "./actorContext";
import type { LocalAccountFlowContext } from "./context";
import { isAuthorityDenial } from "./failures";

type WorkspaceLifecycleFlows = Pick<
  LocalAccountFlows,
  | "replayWorkspaceProvisioning"
  | "replayWorkspaceErasure"
  | "provisionWorkspace"
  | "eraseWorkspace"
  | "provisionWorkspaceInExistingTransaction"
  | "withWorkspaceErasureLocks"
>;

type ProvisionWorkspaceInput<T> = Omit<
  Parameters<LocalAccountFlows["provisionWorkspace"]>[0],
  "provisionProductData"
> & {
  provisionProductData: () => T;
};
type ProvisionWorkspaceFailureInput = Pick<
  Parameters<LocalAccountFlows["provisionWorkspace"]>[0],
  "actor" | "workspaceId" | "command"
>;
type UpdateProvisioningFailureInput = {
  provisioning: ProvisionWorkspaceFailureInput;
  scope: Parameters<typeof beginCommand>[0]["scope"];
  error: unknown;
};
type EraseWorkspaceInput = Parameters<LocalAccountFlows["eraseWorkspace"]>[0];
type UpdateErasureFailureInput = {
  erasure: EraseWorkspaceInput;
  scope: Parameters<typeof beginCommand>[0]["scope"];
  error: unknown;
};
type WorkspaceReplayDependencies = Pick<
  LocalAccountFlowContext,
  "applicationId" | "db" | "lock" | "buildCommandExecutionKey"
>;
type ProvisioningFailureDependencies = Pick<LocalAccountFlowContext, "db" | "persistTerminalOutcome">;
type ProvisioningTransactionDependencies = Pick<LocalAccountFlowContext, "db" | "administration" | "audit">;
type WorkspaceProvisioningDependencies = Pick<
  LocalAccountFlowContext,
  "applicationId" | "db" | "administration" | "audit" | "persistTerminalOutcome" | "lock" | "buildCommandExecutionKey"
>;
type ErasureTransactionDependencies = Pick<
  LocalAccountFlowContext,
  "db" | "identity" | "administration" | "eraseProductWorkspaceInTx" | "audit"
>;
type ErasureFailureDependencies = Pick<LocalAccountFlowContext, "db" | "persistTerminalOutcome">;
type WorkspaceErasureDependencies = Pick<
  LocalAccountFlowContext,
  | "applicationId"
  | "db"
  | "identity"
  | "administration"
  | "eraseProductWorkspaceInTx"
  | "audit"
  | "persistTerminalOutcome"
  | "lock"
  | "buildCommandExecutionKey"
>;
type WorkspaceProvisioningReplay<T> = {
  product: T;
  membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
  replayed: true;
};

async function replayWorkspaceProvisioning<T>(
  dependencies: WorkspaceReplayDependencies,
  input: Parameters<LocalAccountFlows["replayWorkspaceProvisioning"]>[0],
): Promise<WorkspaceProvisioningReplay<T> | null> {
  const { applicationId, db, lock, buildCommandExecutionKey } = dependencies;
  const { actor, workspaceId, command, canonicalProductPayload } = input;
  return lock.withKeys([buildCommandExecutionKey(command), actor.principalId], () => {
    const operation = `workspace-provisioning:actor:${actor.principalId}`;
    if (!readCommand({ db, applicationId, operation, command })) return null;
    const begun = beginCommand<{
      product: T;
      membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
    }>({
      db,
      scope: {
        applicationId,
        operation,
        actorPrincipalId: actor.principalId,
        targetPrincipalId: actor.principalId,
        workspaceId,
      },
      command,
      canonicalPayload: { workspaceId, product: canonicalProductPayload },
    });
    if (begun.kind !== "replay") {
      throw new AccountContractError({
        code: "COMMAND_IN_PROGRESS",
        message: "That workspace-provisioning command is still in progress.",
        retryable: true,
        commandId: command.commandId,
      });
    }
    return { ...begun.result, replayed: true };
  });
}

async function replayWorkspaceErasure(
  dependencies: WorkspaceReplayDependencies,
  input: Parameters<LocalAccountFlows["replayWorkspaceErasure"]>[0],
) {
  const { applicationId, db, lock, buildCommandExecutionKey } = dependencies;
  const { actor, workspaceId, command } = input;
  return lock.withKeys([buildCommandExecutionKey(command), actor.principalId], () => {
    const operation = "workspace-erasure";
    const existing = readCommand({ db, applicationId, operation, command });
    // Only a committed success may bypass live workspace authorization. New, pending and
    // failed commands continue through the ordinary Owner/fresh-session checks below.
    if (!existing || existing.status !== "completed") return null;
    const replay = resumeExistingCommand<{
      commandId: string;
      completedAt: string;
    }>({
      db,
      scope: {
        applicationId,
        operation,
        // Successful erasure anonymises its receipt. Accept a redacted scope only after the
        // exact completed command is found; a live binding must still match the caller.
        actorPrincipalId: existing.actorPrincipalId === null ? null : actor.principalId,
        workspaceId,
      },
      command,
      canonicalPayload: { workspaceId },
    });
    return replay ? markAccountCommandReplay(replay.result) : null;
  });
}

function createWorkspaceReplayFlows(
  dependencies: WorkspaceReplayDependencies,
): Pick<WorkspaceLifecycleFlows, "replayWorkspaceProvisioning" | "replayWorkspaceErasure"> {
  return {
    async replayWorkspaceProvisioning<T>(input: Parameters<LocalAccountFlows["replayWorkspaceProvisioning"]>[0]) {
      return replayWorkspaceProvisioning<T>(dependencies, input);
    },
    async replayWorkspaceErasure(input) {
      return replayWorkspaceErasure(dependencies, input);
    },
  };
}

function updateProvisioningFailure(
  dependencies: ProvisioningFailureDependencies,
  input: UpdateProvisioningFailureInput,
): void {
  const { db, persistTerminalOutcome } = dependencies;
  const { provisioning, scope, error } = input;
  const { actor, workspaceId, command } = provisioning;
  const deniedOutcome = isAuthorityDenial(error);
  recordTerminalOutcome(error, () =>
    persistTerminalOutcome(
      () =>
        terminateCommand({
          db,
          scope,
          command,
          status: "compensated",
          failureCode: error instanceof AccountContractError ? error.failure.code : "CONFLICT",
        }),
      {
        action: deniedOutcome ? "workspace.provisioned" : "flow.compensated",
        outcome: deniedOutcome ? "denied" : "compensated",
        workspaceId,
        actorPrincipalId: actor.principalId,
        command,
      },
    ),
  );
}

function provisionWorkspaceInTransaction<T>(
  dependencies: ProvisioningTransactionDependencies,
  input: ProvisionWorkspaceInput<T>,
  scope: Parameters<typeof beginCommand>[0]["scope"],
) {
  const { db, administration, audit } = dependencies;
  const { actor, workspaceId, joinedAt, command, multiWorkspace, bootstrapAuthorized, provisionProductData } = input;
  return tx(
    db,
    () => {
      assertWorkspaceProvisioningAllowedInTx(administration, {
        actor,
        multiWorkspace,
        bootstrapAuthorized,
        commandId: command.commandId,
      });
      const product = provisionProductData();
      const membership = administration.provisionOwnerMembershipInTx({
        workspaceId,
        principalId: actor.principalId,
        joinedAt,
      });
      const result = { product, membership };
      completeCommand({ db, scope, command, result });
      audit({
        action: "workspace.provisioned",
        outcome: "success",
        workspaceId,
        actorPrincipalId: actor.principalId,
        targetPrincipalId: actor.principalId,
        command,
        changedFields: ["workspace", "membership"],
      });
      return result;
    },
    "immediate",
  );
}

async function executeWorkspaceProvisioning<T>(
  dependencies: WorkspaceProvisioningDependencies,
  input: ProvisionWorkspaceInput<T>,
) {
  const { applicationId, db } = dependencies;
  const { actor, workspaceId, command, canonicalProductPayload } = input;
  const operation = `workspace-provisioning:actor:${actor.principalId}`;
  const scope = {
    applicationId,
    operation,
    actorPrincipalId: actor.principalId,
    targetPrincipalId: actor.principalId,
    workspaceId,
  };
  const begun = beginCommand<{
    product: T;
    membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
  }>({ db, scope, command, canonicalPayload: { workspaceId, product: canonicalProductPayload } });
  if (begun.kind === "replay") return { ...begun.result, replayed: true };
  try {
    const result = provisionWorkspaceInTransaction(dependencies, input, scope);
    return { ...result, replayed: false };
  } catch (error) {
    updateProvisioningFailure(dependencies, { provisioning: input, scope, error });
    throw error;
  }
}

function createWorkspaceProvisioningFlows(
  dependencies: WorkspaceProvisioningDependencies,
): Pick<WorkspaceLifecycleFlows, "provisionWorkspace" | "provisionWorkspaceInExistingTransaction"> {
  const { applicationId, administration, lock, buildCommandExecutionKey } = dependencies;
  return {
    async provisionWorkspace<T>(input: ProvisionWorkspaceInput<T>) {
      const { actor, workspaceId, command } = input;
      return lock.withKeys(
        [
          buildCommandExecutionKey(command),
          actor.principalId,
          `application:${applicationId}:workspace-provisioning`,
          `workspace:${workspaceId}`,
        ],
        () => executeWorkspaceProvisioning(dependencies, input),
      );
    },
    provisionWorkspaceInExistingTransaction({
      workspaceId,
      principalId,
      joinedAt,
      multiWorkspace,
      projectedWorkspaceCount,
    }) {
      assertWorkspaceProvisioningAllowedInTx(administration, {
        actor: {
          principalId,
          sessionId: "trusted-local",
          assurance: "trusted-local",
          fresh: true,
          mfaSatisfied: true,
        },
        multiWorkspace,
        bootstrapAuthorized: false,
        projectedWorkspaceCount,
      });
      administration.provisionOwnerMembershipInTx({ workspaceId, principalId, joinedAt });
    },
  };
}

type ErasedWorkspace = {
  receipt: { commandId: string; completedAt: string };
  masqueradeHandles: readonly string[];
};

function eraseWorkspaceInTransaction(
  dependencies: ErasureTransactionDependencies,
  input: EraseWorkspaceInput,
  scope: Parameters<typeof beginCommand>[0]["scope"],
): ErasedWorkspace {
  const { db, identity, administration, eraseProductWorkspaceInTx, audit } = dependencies;
  const { actor, workspaceId, command, auditProductMutationInTx } = input;
  return tx(
    db,
    () => {
      administration.assertWorkspaceErasureAuthorityInTx(actor, workspaceId);
      eraseProductWorkspaceInTx(workspaceId);
      const orphaned = administration.eraseWorkspaceAdministrationInTx(workspaceId);
      const masqueradeHandles = identity.deprovisionLocalPrincipalsInTx(orphaned, command.commandId);
      auditProductMutationInTx?.();
      const receipt = { commandId: command.commandId, completedAt: new Date().toISOString() };
      eraseWorkspaceCommandHistoryInTx(db, workspaceId, command.commandId);
      completeCommand({ db, scope, command, result: receipt });
      for (const principalId of orphaned) {
        audit({
          action: "identity.local_deprovisioned",
          outcome: "success",
          workspaceId,
          actorPrincipalId: actor.principalId,
          targetPrincipalId: principalId,
          command,
          changedFields: ["localPrincipal"],
        });
      }
      audit({
        action: "workspace.erased",
        outcome: "success",
        workspaceId,
        actorPrincipalId: actor.principalId,
        command,
        changedFields: ["workspace", "memberships", "localPrincipals"],
      });
      return { receipt, masqueradeHandles };
    },
    "immediate",
  );
}
function updateErasureFailure(dependencies: ErasureFailureDependencies, input: UpdateErasureFailureInput): void {
  const { db, persistTerminalOutcome } = dependencies;
  const { erasure, scope, error } = input;
  const { actor, workspaceId, command } = erasure;
  recordTerminalOutcome(error, () =>
    persistTerminalOutcome(
      () =>
        terminateCommand({
          db,
          scope,
          command,
          status: "compensated",
          failureCode: error instanceof AccountContractError ? error.failure.code : "CONFLICT",
        }),
      {
        action: "flow.compensated",
        outcome: "compensated",
        workspaceId,
        actorPrincipalId: actor.principalId,
        command,
      },
    ),
  );
}

async function executeWorkspaceErasure(
  dependencies: WorkspaceErasureDependencies,
  input: EraseWorkspaceInput,
): Promise<{ commandId: string; completedAt: string }> {
  const { applicationId, db, identity } = dependencies;
  const { actor, workspaceId, command } = input;
  // Do not embed the erased actor id in the durable operation key. Its receipt remains briefly
  // available for replay and has its principal/workspace columns anonymised transactionally.
  const scope = {
    applicationId,
    operation: "workspace-erasure",
    actorPrincipalId: actor.principalId,
    workspaceId,
  };
  const begun = beginCommand<{ commandId: string; completedAt: string }>({
    db,
    scope,
    command,
    canonicalPayload: { workspaceId },
  });
  if (begun.kind === "replay") return markAccountCommandReplay(begun.result);
  try {
    const erased = eraseWorkspaceInTransaction(dependencies, input, scope);
    identity.commitMasqueradeSessionEnds(erased.masqueradeHandles);
    return erased.receipt;
  } catch (error) {
    updateErasureFailure(dependencies, { erasure: input, scope, error });
    throw error;
  }
}

function assertErasureMembershipSnapshotStable(commandId: string): never {
  throw new AccountContractError({
    code: "CONFLICT",
    message: "Company membership changed repeatedly during erasure. Retry the request.",
    retryable: true,
    commandId,
  });
}

function assertWorkspaceMembershipSnapshotStable(): never {
  throw new AccountContractError({
    code: "CONFLICT",
    message: "Company membership changed repeatedly during erasure. Retry the request.",
    retryable: true,
  });
}

function createWorkspaceErasureFlows(
  dependencies: WorkspaceErasureDependencies,
): Pick<WorkspaceLifecycleFlows, "eraseWorkspace" | "withWorkspaceErasureLocks"> {
  const { applicationId, administration, lock, buildCommandExecutionKey } = dependencies;
  return {
    async eraseWorkspace(input) {
      const { actor, workspaceId, command } = input;
      return withMembershipSnapshotRetry({
        lock,
        currentPrincipalIds: () => administration.workspacePrincipalIds(workspaceId),
        lockKeysFor: (principalIds) => [
          buildCommandExecutionKey(command),
          actor.principalId,
          `workspace:${workspaceId}`,
          ...principalIds,
        ],
        run: () => executeWorkspaceErasure(dependencies, input),
        onAttemptsExhausted: () => assertErasureMembershipSnapshotStable(command.commandId),
      });
    },

    async withWorkspaceErasureLocks(workspaceIds, operation, options = {}) {
      const uniqueWorkspaceIds = [...new Set(workspaceIds)];
      return withMembershipSnapshotRetry({
        lock,
        currentPrincipalIds: () =>
          uniqueWorkspaceIds.flatMap((workspaceId) => administration.workspacePrincipalIds(workspaceId)),
        lockKeysFor: (principalIds) => [
          ...(options.serializeWorkspaceProvisioning ? [`application:${applicationId}:workspace-provisioning`] : []),
          ...uniqueWorkspaceIds.map((workspaceId) => `workspace:${workspaceId}`),
          ...principalIds,
        ],
        run: async () => operation(),
        onAttemptsExhausted: () => assertWorkspaceMembershipSnapshotStable(),
      });
    },
  };
}

export function createWorkspaceLifecycleFlows(context: LocalAccountFlowContext): WorkspaceLifecycleFlows {
  return {
    ...createWorkspaceReplayFlows(context),
    ...createWorkspaceProvisioningFlows(context),
    ...createWorkspaceErasureFlows(context),
  };
}

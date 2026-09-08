import { AccountContractError } from "@capacitylens/shared/account/errors";
import { tx } from "../../txn";
import { recordTerminalOutcome } from "../accountFlowRuntime";
import {
  beginCommand,
  completeCommand,
  eraseWorkspaceCommandHistoryInTx,
  markAccountCommandReplay,
  terminateCommand,
} from "../commands";
import type { LocalAccountFlows } from "../createLocalAccountFlows";
import { withMembershipSnapshotRetry } from "./actorContext";
import type { LocalAccountFlowContext } from "./context";

type WorkspaceErasureFlows = Pick<LocalAccountFlows, "eraseWorkspace" | "withWorkspaceErasureLocks">;
type EraseWorkspaceInput = Parameters<LocalAccountFlows["eraseWorkspace"]>[0];
type EraseWorkspaceFailureInput = Pick<EraseWorkspaceInput, "actor" | "workspaceId" | "command">;
type UpdateErasureFailureInput = {
  erasure: EraseWorkspaceFailureInput;
  scope: Parameters<typeof beginCommand>[0]["scope"];
  error: unknown;
};
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

export function createWorkspaceErasureFlows(dependencies: WorkspaceErasureDependencies): WorkspaceErasureFlows {
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

import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import { tx } from "../../txn";
import { recordTerminalOutcome } from "../accountFlowRuntime";
import {
  beginCommand,
  completeCommand,
  markAccountCommandReplay,
  readCommand,
  resumeExistingCommand,
  terminateCommand,
} from "../commands";
import type { LocalAccountFlows } from "../createLocalAccountFlows";
import { assertWorkspaceProvisioningAllowedInTx } from "./actorContext";
import type { LocalAccountFlowContext } from "./context";
import { isAuthorityDenial } from "./failures";
import { createWorkspaceErasureFlows } from "./workspaceErasure";

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
type ProvisionWorkspaceTransactionInput<T> = Pick<
  ProvisionWorkspaceInput<T>,
  "actor" | "workspaceId" | "joinedAt" | "command" | "multiWorkspace" | "bootstrapAuthorized" | "provisionProductData"
>;
type UpdateProvisioningFailureInput = {
  provisioning: ProvisionWorkspaceFailureInput;
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
  input: ProvisionWorkspaceTransactionInput<T>,
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

export function createWorkspaceLifecycleFlows(context: LocalAccountFlowContext): WorkspaceLifecycleFlows {
  return {
    ...createWorkspaceReplayFlows(context),
    ...createWorkspaceProvisioningFlows(context),
    ...createWorkspaceErasureFlows(context),
  };
}

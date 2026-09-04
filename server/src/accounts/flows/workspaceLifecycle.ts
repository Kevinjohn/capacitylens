import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import type { ActorContext, CommandIdentity } from "@capacitylens/shared/account/types";
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
import type { LocalAccountFlows } from "../localAccountFlows";
import { assertWorkspaceProvisioningAllowedInTx, withMembershipSnapshotRetry } from "./actorContext";
import type { LocalAccountFlowContext } from "./context";
import { isAuthorityDenial } from "./failures";

export function workspaceLifecycle(
  context: LocalAccountFlowContext,
): Pick<
  LocalAccountFlows,
  | "replayWorkspaceProvisioning"
  | "replayWorkspaceErasure"
  | "provisionWorkspace"
  | "eraseWorkspace"
  | "provisionWorkspaceInExistingTransaction"
  | "withWorkspaceErasureLocks"
> {
  const {
    applicationId,
    db,
    identity,
    administration,
    lock,
    eraseProductWorkspaceInTx,
    audit,
    persistTerminalOutcome,
    commandExecutionKey,
  } = context;
  return {
    async replayWorkspaceProvisioning<T>({
      actor,
      workspaceId,
      command,
      canonicalProductPayload,
    }: {
      actor: ActorContext;
      workspaceId: string;
      command: CommandIdentity;
      canonicalProductPayload: unknown;
    }) {
      return lock.withKeys([commandExecutionKey(command), actor.principalId], () => {
        const operation = `workspace-provisioning:actor:${actor.principalId}`;
        if (!readCommand(db, applicationId, operation, command)) return null;
        const begun = beginCommand<{
          product: unknown;
          membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
        }>(
          db,
          {
            applicationId,
            operation,
            actorPrincipalId: actor.principalId,
            targetPrincipalId: actor.principalId,
            workspaceId,
          },
          command,
          { workspaceId, product: canonicalProductPayload },
        );
        if (begun.kind !== "replay") {
          throw new AccountContractError({
            code: "COMMAND_IN_PROGRESS",
            message: "That workspace-provisioning command is still in progress.",
            retryable: true,
            commandId: command.commandId,
          });
        }
        return { ...begun.result, replayed: true };
      }) as Promise<{
        product: T;
        membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
        replayed: true;
      } | null>;
    },

    async replayWorkspaceErasure({ actor, workspaceId, command }) {
      return lock.withKeys([commandExecutionKey(command), actor.principalId], () => {
        const operation = "workspace-erasure";
        const existing = readCommand(db, applicationId, operation, command);
        // Only a committed success may bypass live workspace authorization. New, pending and
        // failed commands continue through the ordinary Owner/fresh-session checks below.
        if (!existing || existing.status !== "completed") return null;
        const replay = resumeExistingCommand<{
          commandId: string;
          completedAt: string;
        }>(
          db,
          {
            applicationId,
            operation,
            // A successful erasure deliberately anonymises its retained receipt. Accept that
            // redacted scope only after the exact completed command has been found above; a live
            // principal binding must still match the authenticated caller.
            actorPrincipalId: existing.actorPrincipalId === null ? null : actor.principalId,
            workspaceId,
          },
          command,
          { workspaceId },
        );
        return replay ? markAccountCommandReplay(replay.result) : null;
      });
    },

    async provisionWorkspace({
      actor,
      workspaceId,
      joinedAt,
      command,
      multiWorkspace,
      bootstrapAuthorized,
      canonicalProductPayload,
      provisionProductData,
    }) {
      return lock.withKeys(
        [
          commandExecutionKey(command),
          actor.principalId,
          `application:${applicationId}:workspace-provisioning`,
          `workspace:${workspaceId}`,
        ],
        async () => {
          const operation = `workspace-provisioning:actor:${actor.principalId}`;
          const scope = {
            applicationId,
            operation,
            actorPrincipalId: actor.principalId,
            targetPrincipalId: actor.principalId,
            workspaceId,
          };
          const begun = beginCommand<{
            product: unknown;
            membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
          }>(db, scope, command, {
            workspaceId,
            product: canonicalProductPayload,
          });
          if (begun.kind === "replay") {
            return {
              ...(begun.result as {
                product: ReturnType<typeof provisionProductData>;
                membership: Awaited<ReturnType<AccountAdminPort["getMembership"]>>;
              }),
              replayed: true,
            };
          }
          try {
            const result = tx(
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
                completeCommand(db, scope, command, result);
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
            return { ...result, replayed: false };
          } catch (error) {
            const deniedOutcome = isAuthorityDenial(error);
            recordTerminalOutcome(error, () =>
              persistTerminalOutcome(
                () =>
                  terminateCommand(
                    db,
                    scope,
                    command,
                    "compensated",
                    error instanceof AccountContractError ? error.failure.code : "CONFLICT",
                  ),
                {
                  action: deniedOutcome ? "workspace.provisioned" : "flow.compensated",
                  outcome: deniedOutcome ? "denied" : "compensated",
                  workspaceId,
                  actorPrincipalId: actor.principalId,
                  command,
                },
              ),
            );
            throw error;
          }
        },
      );
    },

    async eraseWorkspace({ actor, workspaceId, command, auditProductMutationInTx }) {
      return withMembershipSnapshotRetry(
        lock,
        () => administration.workspacePrincipalIds(workspaceId),
        (principalIds) => [
          commandExecutionKey(command),
          actor.principalId,
          `workspace:${workspaceId}`,
          ...principalIds,
        ],
        async () => {
          // Do not embed the soon-to-be-erased actor id in the durable operation key. The row is
          // retained briefly for safe client replay after erasure, with principal/workspace
          // columns anonymized in the same transaction.
          const operation = "workspace-erasure";
          const scope = {
            applicationId,
            operation,
            actorPrincipalId: actor.principalId,
            workspaceId,
          };
          const begun = beginCommand<{
            commandId: string;
            completedAt: string;
          }>(db, scope, command, { workspaceId });
          if (begun.kind === "replay") {
            return markAccountCommandReplay(begun.result);
          }
          try {
            let masqueradeHandles: readonly string[] = [];
            const erased = tx(
              db,
              () => {
                administration.assertWorkspaceErasureAuthorityInTx(actor, workspaceId);
                eraseProductWorkspaceInTx(workspaceId);
                const orphaned = administration.eraseWorkspaceAdministrationInTx(workspaceId);
                masqueradeHandles = identity.deprovisionLocalPrincipalsInTx(orphaned, command.commandId);
                auditProductMutationInTx?.();
                const receipt = {
                  commandId: command.commandId,
                  completedAt: new Date().toISOString(),
                };
                eraseWorkspaceCommandHistoryInTx(db, workspaceId, command.commandId);
                completeCommand(db, scope, command, receipt);
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
                return { receipt, orphaned };
              },
              "immediate",
            );
            identity.commitMasqueradeSessionEnds(masqueradeHandles);
            return erased.receipt;
          } catch (error) {
            recordTerminalOutcome(error, () =>
              persistTerminalOutcome(
                () =>
                  terminateCommand(
                    db,
                    scope,
                    command,
                    "compensated",
                    error instanceof AccountContractError ? error.failure.code : "CONFLICT",
                  ),
                {
                  action: "flow.compensated",
                  outcome: "compensated",
                  workspaceId,
                  actorPrincipalId: actor.principalId,
                  command,
                },
              ),
            );
            throw error;
          }
        },
        () => {
          throw new AccountContractError({
            code: "CONFLICT",
            message: "Company membership changed repeatedly during erasure. Retry the request.",
            retryable: true,
            commandId: command.commandId,
          });
        },
      );
    },

    provisionWorkspaceInExistingTransaction({
      workspaceId,
      principalId,
      joinedAt,
      multiWorkspace,
      projectedWorkspaceCount,
    }): void {
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
      administration.provisionOwnerMembershipInTx({
        workspaceId,
        principalId,
        joinedAt,
      });
    },

    async withWorkspaceErasureLocks<T>(
      workspaceIds: readonly string[],
      operation: () => Promise<T> | T,
      options: { serializeWorkspaceProvisioning?: boolean } = {},
    ): Promise<T> {
      const uniqueWorkspaceIds = [...new Set(workspaceIds)];
      return withMembershipSnapshotRetry(
        lock,
        () => uniqueWorkspaceIds.flatMap((workspaceId) => administration.workspacePrincipalIds(workspaceId)),
        (principalIds) => [
          ...(options.serializeWorkspaceProvisioning ? [`application:${applicationId}:workspace-provisioning`] : []),
          ...uniqueWorkspaceIds.map((workspaceId) => `workspace:${workspaceId}`),
          ...principalIds,
        ],
        async () => operation(),
        () => {
          throw new AccountContractError({
            code: "CONFLICT",
            message: "Company membership changed repeatedly during erasure. Retry the request.",
            retryable: true,
          });
        },
      );
    },
  };
}

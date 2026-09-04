import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { PasswordResetCeremony } from "@capacitylens/shared/account/types";
import { recordTerminalOutcome } from "../accountFlowRuntime";
import {
  beginCommand,
  completeCommand,
  markAccountCommandReplay,
  terminateCommand,
  terminatePendingCommand,
} from "../commands";
import type { LocalAccountFlows } from "../localAccountFlows";
import { clearTrackedMemberSignIn } from "../memberSignInTracking";
import type { LocalAccountFlowContext } from "./context";
import { authorityChanged, denied, replayCapacityExceeded } from "./failures";

export function passwordReset(context: LocalAccountFlowContext): Pick<LocalAccountFlows, "issuePasswordReset"> {
  const {
    applicationId,
    db,
    identity,
    administration,
    lock,
    persistTerminalOutcome,
    denyIdentityAdminCommand,
    resetReplay,
    commandExecutionKey,
  } = context;
  return {
    async issuePasswordReset({ actor, targetPrincipalId, command }) {
      return lock.withKeys([commandExecutionKey(command), actor.principalId, targetPrincipalId], async () => {
        const operation = `password-reset:actor:${actor.principalId}`;
        const scope = {
          applicationId,
          operation,
          actorPrincipalId: actor.principalId,
          targetPrincipalId,
        };
        const begun = beginCommand<Omit<PasswordResetCeremony, "token">>(db, scope, command, {
          targetPrincipalId,
        });
        if (begun.kind === "replay") {
          // Replaying this command re-discloses a write-once bearer token, so idempotency must not
          // bypass authority changes that happened after its original issuance.
          const decision = await administration.evaluateIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: "issue-password-reset",
          });
          if (!decision.allowed) {
            throw denied(decision.reason, "issue-password-reset", begun.record.commandId);
          }
          const confirmed = await administration.confirmIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: "issue-password-reset",
            expectedRevision: decision.revision,
          });
          if (!confirmed) throw authorityChanged(begun.record.commandId);
          const replay = resetReplay.get(begun.record.commandId);
          if (replay) return markAccountCommandReplay(replay);
          throw new AccountContractError({
            code: "CONFLICT",
            message: "The reset command already completed; its write-once token is no longer available.",
            retryable: false,
            commandId: begun.record.commandId,
          });
        }
        let issuanceStarted = false;
        let ceremony: PasswordResetCeremony | null = null;
        let terminalOutcomeRecorded = false;
        try {
          const decision = await administration.evaluateIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: "issue-password-reset",
          });
          if (!decision.allowed) {
            terminalOutcomeRecorded = true;
            throw denyIdentityAdminCommand(
              scope,
              command,
              decision.reason,
              actor.principalId,
              targetPrincipalId,
              "identity.password_reset_issued",
              "issue-password-reset",
            );
          }
          const reservation = resetReplay.reserve(command.commandId);
          if (!reservation.accepted) {
            const capacityError = replayCapacityExceeded(command.commandId, reservation.retryAfterMs);
            persistTerminalOutcome(() => terminateCommand(db, scope, command, "compensated", "RATE_LIMITED"), {
              action: "identity.password_reset_issued",
              outcome: "failed",
              actorPrincipalId: actor.principalId,
              targetPrincipalId,
              command,
            });
            terminalOutcomeRecorded = true;
            throw capacityError;
          }
          issuanceStarted = true;
          ceremony = await identity.issuePasswordReset({
            targetPrincipalId,
            command,
          });
          const confirmed = await administration.confirmIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: "issue-password-reset",
            expectedRevision: decision.revision,
          });
          if (!confirmed) {
            const changed = authorityChanged(command.commandId);
            const ceremonyId = ceremony.ceremonyId;
            try {
              await identity.revokePasswordResetCeremony({
                targetPrincipalId,
                ceremonyId,
                command,
              });
            } catch (revokeError) {
              recordTerminalOutcome(revokeError, () =>
                persistTerminalOutcome(
                  () =>
                    terminateCommand(db, scope, command, "reconciliation_required", "COMPENSATION_FAILED", {
                      kind: "password-reset-revocation-failed",
                      workspaceId: null,
                      targetPrincipalId,
                      provisionalPrincipalId: null,
                      ceremonyId,
                    }),
                  {
                    action: "flow.reconciliation_required",
                    outcome: "failed",
                    actorPrincipalId: actor.principalId,
                    targetPrincipalId,
                    command,
                    changedFields: ["passwordResetCeremony"],
                  },
                ),
              );
              terminalOutcomeRecorded = true;
              throw new AccountContractError(
                {
                  code: "COMPENSATION_FAILED",
                  message: "Authority changed and the new reset ceremony could not be revoked.",
                  retryable: true,
                  commandId: command.commandId,
                },
                { cause: revokeError },
              );
            }
            recordTerminalOutcome(changed, () =>
              persistTerminalOutcome(() => terminateCommand(db, scope, command, "compensated", "AUTHORITY_CHANGED"), {
                action: "flow.compensated",
                outcome: "compensated",
                actorPrincipalId: actor.principalId,
                targetPrincipalId,
                command,
                changedFields: ["passwordResetCeremony"],
              }),
            );
            terminalOutcomeRecorded = true;
            throw changed;
          }
          persistTerminalOutcome(
            () => {
              clearTrackedMemberSignIn(db, targetPrincipalId);
              return completeCommand(db, scope, command, {
                ceremonyId: ceremony!.ceremonyId,
                expiresAt: ceremony!.expiresAt,
              });
            },
            {
              action: "identity.password_reset_issued",
              outcome: "success",
              actorPrincipalId: actor.principalId,
              targetPrincipalId,
              command,
              changedFields: ["credential", "signInConfirmation"],
            },
          );
          resetReplay.storeReserved(command.commandId, ceremony);
          return ceremony;
        } catch (error) {
          // A completed response is not a reservation, so this only releases capacity when issuance
          // failed or was compensated before the write-once value could be returned.
          resetReplay.releaseReservation(command.commandId);
          const code = error instanceof AccountContractError ? error.failure.code : "DEPENDENCY_UNAVAILABLE";
          const knownWithoutCeremony =
            error instanceof AccountContractError &&
            (error.failure.code === "NOT_FOUND" ||
              error.failure.code === "VALIDATION_FAILED" ||
              error.failure.code === "UNSUPPORTED_CAPABILITY");
          const requiresReconciliation =
            issuanceStarted &&
            !(error instanceof AccountContractError && error.failure.code === "AUTHORITY_CHANGED") &&
            !knownWithoutCeremony;
          if (!terminalOutcomeRecorded) {
            recordTerminalOutcome(error, () =>
              persistTerminalOutcome(
                () =>
                  terminatePendingCommand(
                    db,
                    scope,
                    command,
                    requiresReconciliation ? "reconciliation_required" : "compensated",
                    requiresReconciliation ? "DEPENDENCY_UNAVAILABLE" : code,
                    requiresReconciliation
                      ? {
                          kind: ceremony ? "password-reset-issued" : "password-reset-outcome-unknown",
                          workspaceId: null,
                          targetPrincipalId,
                          provisionalPrincipalId: null,
                          ceremonyId: ceremony?.ceremonyId ?? null,
                        }
                      : undefined,
                  ),
                {
                  action: requiresReconciliation ? "flow.reconciliation_required" : "flow.compensated",
                  outcome: requiresReconciliation ? "failed" : "compensated",
                  actorPrincipalId: actor.principalId,
                  targetPrincipalId,
                  command,
                  changedFields: requiresReconciliation
                    ? ["passwordResetCeremony", "commandLedger"]
                    : ["commandLedger"],
                },
              ),
            );
          }
          throw error;
        }
      });
    },
  };
}

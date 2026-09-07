import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { IdentityPort } from "@capacitylens/shared/account/ports";
import { recordTerminalOutcome } from "../accountFlowRuntime";
import { beginCommand, completeCommand, markAccountCommandReplay, terminatePendingCommand } from "../commands";
import type { LocalAccountFlows } from "../createLocalAccountFlows";
import { clearTrackedMemberSignIn } from "../memberSignInTracking";
import type { LocalAccountFlowContext } from "./context";

export function createSessionRevocationFlows(
  context: LocalAccountFlowContext,
): Pick<LocalAccountFlows, "revokeMemberSessions"> {
  const {
    applicationId,
    db,
    identity,
    administration,
    lock,
    persistTerminalOutcome,
    denyIdentityAdminCommand,
    buildCommandExecutionKey,
  } = context;
  return {
    async revokeMemberSessions({ actor, targetPrincipalId, command }) {
      return lock.withKeys([buildCommandExecutionKey(command), actor.principalId, targetPrincipalId], async () => {
        const operation = `session-revocation:actor:${actor.principalId}`;
        const scope = {
          applicationId,
          operation,
          actorPrincipalId: actor.principalId,
          targetPrincipalId,
        };
        const begun = beginCommand<Awaited<ReturnType<IdentityPort["revokePrincipalSessions"]>>>({
          db,
          scope,
          command,
          canonicalPayload: {
            targetPrincipalId,
          },
        });
        if (begun.kind === "replay") return markAccountCommandReplay(begun.result);
        let revocationStarted = false;
        let terminalOutcomeRecorded = false;
        try {
          const decision = await administration.evaluateIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: "revoke-sessions",
          });
          if (!decision.allowed) {
            terminalOutcomeRecorded = true;
            throw denyIdentityAdminCommand({
              scope,
              command,
              reason: decision.reason,
              actorPrincipalId: actor.principalId,
              targetPrincipalId,
              auditAction: "identity.sessions_revoked",
              deniedAction: "revoke-sessions",
            });
          }
          revocationStarted = true;
          const result = await identity.revokePrincipalSessions({
            targetPrincipalId,
            command,
          });
          persistTerminalOutcome(
            () => {
              clearTrackedMemberSignIn(db, targetPrincipalId);
              return completeCommand({ db, scope, command, result });
            },
            {
              action: "identity.sessions_revoked",
              outcome: "success",
              actorPrincipalId: actor.principalId,
              targetPrincipalId,
              command,
              changedFields: ["sessions", "signInConfirmation"],
            },
          );
          return result;
        } catch (error) {
          const code = error instanceof AccountContractError ? error.failure.code : "DEPENDENCY_UNAVAILABLE";
          if (!terminalOutcomeRecorded) {
            recordTerminalOutcome(error, () =>
              persistTerminalOutcome(
                () =>
                  terminatePendingCommand({
                    db,
                    scope,
                    command,
                    status: revocationStarted ? "reconciliation_required" : "compensated",
                    failureCode: revocationStarted ? "DEPENDENCY_UNAVAILABLE" : code,
                    result: revocationStarted
                      ? {
                          kind: "session-revocation-outcome-unknown",
                          workspaceId: null,
                          targetPrincipalId,
                          provisionalPrincipalId: null,
                          ceremonyId: null,
                        }
                      : undefined,
                  }),
                {
                  action: revocationStarted ? "flow.reconciliation_required" : "identity.sessions_revoked",
                  outcome: "failed",
                  actorPrincipalId: actor.principalId,
                  targetPrincipalId,
                  command,
                  changedFields: revocationStarted ? ["sessions", "commandLedger"] : ["commandLedger"],
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

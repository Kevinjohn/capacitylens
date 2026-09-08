import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { IdentityPort } from "@capacitylens/shared/account/ports";
import { recordTerminalOutcome } from "../accountFlowRuntime";
import { beginCommand, completeCommand, markAccountCommandReplay, terminatePendingCommand } from "../commands";
import type { LocalAccountFlows } from "../createLocalAccountFlows";
import { clearTrackedMemberSignIn } from "../memberSignInTracking";
import type { LocalAccountFlowContext } from "./context";

type RevokeMemberSessionsInput = Parameters<LocalAccountFlows["revokeMemberSessions"]>[0];
type SessionRevocationResult = Awaited<ReturnType<IdentityPort["revokePrincipalSessions"]>>;
type SessionRevocationExecutionDependencies = Pick<
  LocalAccountFlowContext,
  "applicationId" | "db" | "identity" | "administration" | "persistTerminalOutcome" | "denyIdentityAdminCommand"
>;
type SessionRevocationLockDependencies = Pick<LocalAccountFlowContext, "lock" | "buildCommandExecutionKey">;
type SessionRevocationTerminalDependencies = Pick<
  LocalAccountFlowContext,
  "applicationId" | "db" | "persistTerminalOutcome"
>;
type SessionRevocationTerminalInput = SessionRevocationTerminalDependencies &
  Pick<RevokeMemberSessionsInput, "actor" | "targetPrincipalId" | "command">;

function completeSessionRevocation(
  input: SessionRevocationTerminalInput & { result: SessionRevocationResult; operation: string },
): void {
  const { db, persistTerminalOutcome, actor, targetPrincipalId, command, result, operation } = input;
  persistTerminalOutcome(
    () => {
      clearTrackedMemberSignIn(db, targetPrincipalId);
      return completeCommand({ db, scope: { applicationId: input.applicationId, operation }, command, result });
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
}

function recordSessionRevocationFailure(
  input: SessionRevocationTerminalInput & {
    error: unknown;
    operation: string;
    revocationStarted: boolean;
  },
): void {
  const { db, persistTerminalOutcome, actor, targetPrincipalId, command, error, operation, revocationStarted } = input;
  const code = error instanceof AccountContractError ? error.failure.code : "DEPENDENCY_UNAVAILABLE";
  recordTerminalOutcome(error, () =>
    persistTerminalOutcome(
      () =>
        terminatePendingCommand({
          db,
          scope: { applicationId: input.applicationId, operation },
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

function createSessionRevocationExecutor(
  dependencies: SessionRevocationExecutionDependencies,
): LocalAccountFlows["revokeMemberSessions"] {
  return async (request) => {
    const input = { ...dependencies, ...request };
    const { db, identity, administration, denyIdentityAdminCommand, actor, targetPrincipalId, command } = input;
    const operation = `session-revocation:actor:${actor.principalId}`;
    const scope = {
      applicationId: input.applicationId,
      operation,
      actorPrincipalId: actor.principalId,
      targetPrincipalId,
    };
    const begun = beginCommand<SessionRevocationResult>({
      db,
      scope,
      command,
      canonicalPayload: { targetPrincipalId },
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
        return denyIdentityAdminCommand({
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
      const result = await identity.revokePrincipalSessions({ targetPrincipalId, command });
      completeSessionRevocation({ ...input, operation, result });
      return result;
    } catch (error) {
      if (!terminalOutcomeRecorded) {
        recordSessionRevocationFailure({ ...input, error, operation, revocationStarted });
      }
      throw error;
    }
  };
}

function createLockedSessionRevocation(
  dependencies: SessionRevocationLockDependencies,
  revokeMemberSessionsUnlocked: LocalAccountFlows["revokeMemberSessions"],
): LocalAccountFlows["revokeMemberSessions"] {
  const { lock, buildCommandExecutionKey } = dependencies;
  return (input) =>
    lock.withKeys([buildCommandExecutionKey(input.command), input.actor.principalId, input.targetPrincipalId], () =>
      revokeMemberSessionsUnlocked(input),
    );
}

export function createSessionRevocationFlows(
  context: LocalAccountFlowContext,
): Pick<LocalAccountFlows, "revokeMemberSessions"> {
  const revokeMemberSessionsUnlocked = createSessionRevocationExecutor({
    applicationId: context.applicationId,
    db: context.db,
    identity: context.identity,
    administration: context.administration,
    persistTerminalOutcome: context.persistTerminalOutcome,
    denyIdentityAdminCommand: context.denyIdentityAdminCommand,
  });
  return {
    revokeMemberSessions: createLockedSessionRevocation(
      { lock: context.lock, buildCommandExecutionKey: context.buildCommandExecutionKey },
      revokeMemberSessionsUnlocked,
    ),
  };
}

import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { IdentityPort } from "@capacitylens/shared/account/ports";
import { recordTerminalOutcome } from "../accountFlowRuntime";
import { beginCommand, completeCommand, markAccountCommandReplay, terminatePendingCommand } from "../commands";
import type { LocalAccountFlows } from "../createLocalAccountFlows";
import { clearTrackedMemberSignIn } from "../memberSignInTracking";
import type { LocalAccountFlowContext } from "./context";

type RevokeMemberSessionsInput = Parameters<LocalAccountFlows["revokeMemberSessions"]>[0];
type SessionRevocationResult = Awaited<ReturnType<IdentityPort["revokePrincipalSessions"]>>;
type SessionRevocationDependencies = Pick<
  LocalAccountFlowContext,
  | "applicationId"
  | "db"
  | "identity"
  | "administration"
  | "lock"
  | "persistTerminalOutcome"
  | "denyIdentityAdminCommand"
  | "buildCommandExecutionKey"
>;
type SessionRevocationExecutionInput = SessionRevocationDependencies & RevokeMemberSessionsInput;

function persistSuccessfulSessionRevocation(
  input: SessionRevocationExecutionInput & { result: SessionRevocationResult; operation: string },
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

function recordFailedSessionRevocation(
  input: SessionRevocationExecutionInput & {
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

async function executeLockedSessionRevocation(
  input: SessionRevocationExecutionInput,
): Promise<SessionRevocationResult> {
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
    persistSuccessfulSessionRevocation({ ...input, operation, result });
    return result;
  } catch (error) {
    if (!terminalOutcomeRecorded) recordFailedSessionRevocation({ ...input, error, operation, revocationStarted });
    throw error;
  }
}

async function executeSessionRevocation(input: SessionRevocationExecutionInput): Promise<SessionRevocationResult> {
  const { lock, buildCommandExecutionKey, actor, targetPrincipalId, command } = input;
  return lock.withKeys([buildCommandExecutionKey(command), actor.principalId, targetPrincipalId], () =>
    executeLockedSessionRevocation(input),
  );
}

export function createSessionRevocationFlows(
  context: LocalAccountFlowContext,
): Pick<LocalAccountFlows, "revokeMemberSessions"> {
  const dependencies: SessionRevocationDependencies = {
    applicationId: context.applicationId,
    db: context.db,
    identity: context.identity,
    administration: context.administration,
    lock: context.lock,
    persistTerminalOutcome: context.persistTerminalOutcome,
    denyIdentityAdminCommand: context.denyIdentityAdminCommand,
    buildCommandExecutionKey: context.buildCommandExecutionKey,
  };
  return {
    revokeMemberSessions: (input) => executeSessionRevocation({ ...dependencies, ...input }),
  };
}

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
import type { LocalAccountFlows } from "../createLocalAccountFlows";
import { clearTrackedMemberSignIn } from "../memberSignInTracking";
import type { LocalAccountFlowContext } from "./context";
import { createAuthorityChangedError, createAuthorityDenial, createReplayCapacityError } from "./failures";

type PasswordResetInput = Parameters<LocalAccountFlows["issuePasswordReset"]>[0];

interface PasswordResetScope {
  applicationId: string;
  operation: string;
  actorPrincipalId: string;
  targetPrincipalId: string;
}

interface PasswordResetExecutionState {
  issuanceStarted: boolean;
  ceremony: PasswordResetCeremony | null;
  terminalOutcomeRecorded: boolean;
}

interface PasswordResetOperation {
  context: LocalAccountFlowContext;
  input: PasswordResetInput;
  scope: PasswordResetScope;
}

function createCompensationFailedError(commandId: string, cause: unknown): AccountContractError {
  return new AccountContractError(
    {
      code: "COMPENSATION_FAILED",
      message: "Authority changed and the new reset ceremony could not be revoked.",
      retryable: true,
      commandId,
    },
    { cause },
  );
}

async function replayPasswordReset(
  context: LocalAccountFlowContext,
  input: PasswordResetInput,
  commandId: string,
): Promise<PasswordResetCeremony> {
  const { actor, targetPrincipalId } = input;
  const decision = await context.administration.evaluateIdentityAdminAuthority({
    actor,
    targetPrincipalId,
    action: "issue-password-reset",
  });
  if (!decision.allowed) throw createAuthorityDenial(decision.reason, "issue-password-reset", commandId);
  const confirmed = await context.administration.confirmIdentityAdminAuthority({
    actor,
    targetPrincipalId,
    action: "issue-password-reset",
    expectedRevision: decision.revision,
  });
  if (!confirmed) throw createAuthorityChangedError(commandId);
  const replay = context.resetReplay.get(commandId);
  if (replay) return markAccountCommandReplay(replay);
  throw new AccountContractError({
    code: "CONFLICT",
    message: "The reset command already completed; its write-once token is no longer available.",
    retryable: false,
    commandId,
  });
}

function reservePasswordReset(
  { context, input, scope }: PasswordResetOperation,
  state: PasswordResetExecutionState,
): void {
  const { actor, targetPrincipalId, command } = input;
  const reservation = context.resetReplay.reserve(command.commandId);
  if (reservation.kind !== "rejected") return;
  const capacityError = createReplayCapacityError(command.commandId, reservation.retryAfterMs);
  context.persistTerminalOutcome(
    () => terminateCommand({ db: context.db, scope, command, status: "compensated", failureCode: "RATE_LIMITED" }),
    {
      action: "identity.password_reset_issued",
      outcome: "failed",
      actorPrincipalId: actor.principalId,
      targetPrincipalId,
      command,
    },
  );
  state.terminalOutcomeRecorded = true;
  throw capacityError;
}

async function compensateAuthorityChange(
  { context, input, scope }: PasswordResetOperation,
  ceremony: PasswordResetCeremony,
  state: PasswordResetExecutionState,
): Promise<never> {
  const { actor, targetPrincipalId, command } = input;
  const changed = createAuthorityChangedError(command.commandId);
  try {
    await context.identity.revokePasswordResetCeremony({ targetPrincipalId, ceremonyId: ceremony.ceremonyId, command });
  } catch (revokeError) {
    recordTerminalOutcome(revokeError, () =>
      context.persistTerminalOutcome(
        () =>
          terminateCommand({
            db: context.db,
            scope,
            command,
            status: "reconciliation_required",
            failureCode: "COMPENSATION_FAILED",
            result: {
              kind: "password-reset-revocation-failed",
              workspaceId: null,
              targetPrincipalId,
              provisionalPrincipalId: null,
              ceremonyId: ceremony.ceremonyId,
            },
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
    state.terminalOutcomeRecorded = true;
    throw createCompensationFailedError(command.commandId, revokeError);
  }
  recordTerminalOutcome(changed, () =>
    context.persistTerminalOutcome(
      () =>
        terminateCommand({ db: context.db, scope, command, status: "compensated", failureCode: "AUTHORITY_CHANGED" }),
      {
        action: "flow.compensated",
        outcome: "compensated",
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        command,
        changedFields: ["passwordResetCeremony"],
      },
    ),
  );
  state.terminalOutcomeRecorded = true;
  throw changed;
}

function completePasswordReset(
  { context, input, scope }: PasswordResetOperation,
  ceremony: PasswordResetCeremony,
): void {
  const { actor, targetPrincipalId, command } = input;
  context.persistTerminalOutcome(
    () => {
      clearTrackedMemberSignIn(context.db, targetPrincipalId);
      return completeCommand({
        db: context.db,
        scope,
        command,
        result: { ceremonyId: ceremony.ceremonyId, expiresAt: ceremony.expiresAt },
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
}

function recordPasswordResetFailure(
  { context, input, scope }: PasswordResetOperation,
  state: PasswordResetExecutionState,
  error: unknown,
): void {
  if (state.terminalOutcomeRecorded) return;
  const { actor, targetPrincipalId, command } = input;
  const code = error instanceof AccountContractError ? error.failure.code : "DEPENDENCY_UNAVAILABLE";
  const knownWithoutCeremony =
    error instanceof AccountContractError &&
    ["NOT_FOUND", "VALIDATION_FAILED", "UNSUPPORTED_CAPABILITY"].includes(error.failure.code);
  const requiresReconciliation =
    state.issuanceStarted &&
    !(error instanceof AccountContractError && error.failure.code === "AUTHORITY_CHANGED") &&
    !knownWithoutCeremony;
  recordTerminalOutcome(error, () =>
    context.persistTerminalOutcome(
      () =>
        terminatePendingCommand({
          db: context.db,
          scope,
          command,
          status: requiresReconciliation ? "reconciliation_required" : "compensated",
          failureCode: requiresReconciliation ? "DEPENDENCY_UNAVAILABLE" : code,
          result: requiresReconciliation
            ? {
                kind: state.ceremony ? "password-reset-issued" : "password-reset-outcome-unknown",
                workspaceId: null,
                targetPrincipalId,
                provisionalPrincipalId: null,
                ceremonyId: state.ceremony?.ceremonyId ?? null,
              }
            : undefined,
        }),
      {
        action: requiresReconciliation ? "flow.reconciliation_required" : "flow.compensated",
        outcome: requiresReconciliation ? "failed" : "compensated",
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        command,
        changedFields: requiresReconciliation ? ["passwordResetCeremony", "commandLedger"] : ["commandLedger"],
      },
    ),
  );
}

async function issueNewPasswordReset(operation: PasswordResetOperation): Promise<PasswordResetCeremony> {
  const { context, input, scope } = operation;
  const { actor, targetPrincipalId, command } = input;
  const state: PasswordResetExecutionState = { issuanceStarted: false, ceremony: null, terminalOutcomeRecorded: false };
  try {
    const decision = await context.administration.evaluateIdentityAdminAuthority({
      actor,
      targetPrincipalId,
      action: "issue-password-reset",
    });
    if (!decision.allowed) {
      state.terminalOutcomeRecorded = true;
      return context.denyIdentityAdminCommand({
        scope,
        command,
        reason: decision.reason,
        actorPrincipalId: actor.principalId,
        targetPrincipalId,
        auditAction: "identity.password_reset_issued",
        deniedAction: "issue-password-reset",
      });
    }
    reservePasswordReset(operation, state);
    state.issuanceStarted = true;
    const ceremony = await context.identity.issuePasswordReset({ targetPrincipalId, command });
    state.ceremony = ceremony;
    const confirmed = await context.administration.confirmIdentityAdminAuthority({
      actor,
      targetPrincipalId,
      action: "issue-password-reset",
      expectedRevision: decision.revision,
    });
    if (!confirmed) {
      return compensateAuthorityChange(operation, ceremony, state);
    }
    completePasswordReset(operation, ceremony);
    context.resetReplay.storeReserved(command.commandId, ceremony);
    return ceremony;
  } catch (error) {
    // Completed responses are no longer reservations, so this only releases failed or compensated issuance.
    context.resetReplay.releaseReservation(command.commandId);
    recordPasswordResetFailure(operation, state, error);
    throw error;
  }
}

export function createPasswordResetFlows(
  context: LocalAccountFlowContext,
): Pick<LocalAccountFlows, "issuePasswordReset"> {
  return {
    async issuePasswordReset(input) {
      const { actor, targetPrincipalId, command } = input;
      return context.lock.withKeys(
        [context.buildCommandExecutionKey(command), actor.principalId, targetPrincipalId],
        async () => {
          const scope = {
            applicationId: context.applicationId,
            operation: `password-reset:actor:${actor.principalId}`,
            actorPrincipalId: actor.principalId,
            targetPrincipalId,
          };
          const begun = beginCommand<Omit<PasswordResetCeremony, "token">>({
            db: context.db,
            scope,
            command,
            canonicalPayload: { targetPrincipalId },
          });
          // Replaying re-discloses a write-once bearer, so repeat both authority checks before it.
          if (begun.kind === "replay") return replayPasswordReset(context, input, begun.record.commandId);
          return issueNewPasswordReset({ context, input, scope });
        },
      );
    },
  };
}

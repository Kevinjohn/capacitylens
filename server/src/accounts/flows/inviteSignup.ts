import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { IdentityPort, InviteSignupResult } from "@capacitylens/shared/account/ports";
import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { recordTerminalOutcome } from "../accountFlowRuntime";
import {
  beginCommand,
  buildSecretDigest,
  completeCommand,
  correlatePendingAccountCommand,
  markAccountCommandReplay,
  resumeExistingCommand,
  terminateCommand,
  terminatePendingCommand,
} from "../commands";
import type { LocalAccountFlows } from "../createLocalAccountFlows";
import type { LocalAccountFlowContext } from "./context";

type InviteSignupInput = Parameters<LocalAccountFlows["acceptInviteWithPasswordSignup"]>[0];
type ProvisionalPrincipal = Awaited<ReturnType<IdentityPort["createProvisionalCredentialPrincipal"]>>;
type InviteSignupDependencies = Pick<
  LocalAccountFlowContext,
  | "administration"
  | "applicationId"
  | "buildCommandExecutionKey"
  | "db"
  | "identity"
  | "lock"
  | "persistTerminalOutcome"
>;
type SignupExecution = {
  dependencies: InviteSignupDependencies;
  input: InviteSignupInput;
  operation: "invite-password-signup";
  scope: { applicationId: string; operation: "invite-password-signup"; actorPrincipalId: null };
};
type SignupState = {
  claimCommitted: boolean;
  membership: InviteSignupResult["membership"] | null;
  provisional: ProvisionalPrincipal | null;
};
type CompensationFailureInput = {
  claimError: unknown;
  compensationError: unknown;
  execution: SignupExecution;
  provisionalPrincipalId: string;
};

function recordCommittedClaimFailure(execution: SignupExecution, claimError: unknown, state: SignupState): never {
  const { dependencies, input, scope } = execution;
  const { db, persistTerminalOutcome } = dependencies;
  const { command } = input;
  const workspaceId = state.membership?.workspaceId ?? null;
  const targetPrincipalId = state.provisional?.principalId ?? null;
  recordTerminalOutcome(claimError, () =>
    persistTerminalOutcome(
      () =>
        terminatePendingCommand({
          db,
          scope,
          command,
          status: "reconciliation_required",
          failureCode: "DEPENDENCY_UNAVAILABLE",
          result: {
            kind: "invitation-claim-committed",
            workspaceId,
            targetPrincipalId,
            provisionalPrincipalId: targetPrincipalId,
            ceremonyId: null,
          },
        }),
      {
        action: "flow.reconciliation_required",
        outcome: "failed",
        workspaceId,
        targetPrincipalId,
        command,
        changedFields: ["commandLedger"],
      },
    ),
  );
  throw new AccountContractError(
    {
      code: "DEPENDENCY_UNAVAILABLE",
      message: "The invitation was claimed, but completion must be reconciled before retrying.",
      retryable: true,
      commandId: command.commandId,
    },
    { cause: claimError },
  );
}

function recordPreProvisionFailure(execution: SignupExecution, claimError: unknown): never {
  const { dependencies, input, scope } = execution;
  const { db, persistTerminalOutcome } = dependencies;
  const { command } = input;
  recordTerminalOutcome(claimError, () =>
    persistTerminalOutcome(
      () =>
        terminateCommand({
          db,
          scope,
          command,
          status: "compensated",
          failureCode: claimError instanceof AccountContractError ? claimError.failure.code : "CONFLICT",
        }),
      { action: "flow.compensated", outcome: "compensated", command },
    ),
  );
  throw claimError;
}

function recordCompensatedFailure(
  execution: SignupExecution,
  claimError: unknown,
  provisionalPrincipalId: string,
): never {
  const { dependencies, input, scope } = execution;
  const { db, persistTerminalOutcome } = dependencies;
  const { command } = input;
  recordTerminalOutcome(claimError, () =>
    persistTerminalOutcome(
      () =>
        terminateCommand({
          db,
          scope,
          command,
          status: "compensated",
          failureCode: claimError instanceof AccountContractError ? claimError.failure.code : "CONFLICT",
        }),
      {
        action: "flow.compensated",
        outcome: "compensated",
        targetPrincipalId: provisionalPrincipalId,
        command,
        changedFields: ["localPrincipal"],
      },
    ),
  );
  throw claimError;
}

function recordCompensationFailure({
  claimError,
  compensationError,
  execution,
  provisionalPrincipalId,
}: CompensationFailureInput): never {
  const { dependencies, input, scope } = execution;
  const { db, persistTerminalOutcome } = dependencies;
  const { command } = input;
  const combinedFailure = new AggregateError([claimError, compensationError]);
  recordTerminalOutcome(combinedFailure, () =>
    persistTerminalOutcome(
      () =>
        terminateCommand({
          db,
          scope,
          command,
          status: "reconciliation_required",
          failureCode: "COMPENSATION_FAILED",
          result: {
            kind: "provisional-principal-compensation-failed",
            workspaceId: null,
            targetPrincipalId: provisionalPrincipalId,
            provisionalPrincipalId,
            ceremonyId: null,
          },
        }),
      {
        action: "flow.reconciliation_required",
        outcome: "failed",
        targetPrincipalId: provisionalPrincipalId,
        command,
        changedFields: ["localPrincipal"],
      },
    ),
  );
  throw new AccountContractError(
    {
      code: "COMPENSATION_FAILED",
      message: "Invitation claim failed and the provisional local identity could not be removed.",
      retryable: true,
      commandId: command.commandId,
    },
    { cause: combinedFailure },
  );
}

async function compensateFailedSignup(
  execution: SignupExecution,
  claimError: unknown,
  provisional: ProvisionalPrincipal,
): Promise<never> {
  const { identity } = execution.dependencies;
  const { command } = execution.input;
  try {
    await identity.compensateProvisionalPrincipal({
      provisional,
      reason: "invitation-claim-failed",
      command,
    });
  } catch (compensationError) {
    recordCompensationFailure({
      execution,
      claimError,
      compensationError,
      provisionalPrincipalId: provisional.principalId,
    });
  }
  return recordCompensatedFailure(execution, claimError, provisional.principalId);
}

async function claimInvitation(
  execution: SignupExecution,
  admission: Awaited<ReturnType<LocalAccountFlowContext["administration"]["preparePasswordInvitationClaim"]>>,
  state: SignupState,
): Promise<InviteSignupResult> {
  const { administration, db, lock } = execution.dependencies;
  const { command, email, token } = execution.input;
  const provisional = state.provisional;
  if (!provisional) throw new Error("Invitation claim requires a provisional principal");

  return lock.withKeys([provisional.principalId, `workspace:${admission.workspaceId}`], async () => {
    const membership = await administration.claimInvitationForPrincipal({
      token,
      principalId: provisional.principalId,
      principalEmail: email,
      emailVerified: admission.emailVerifiedByInvitation,
      passwordMode: true,
      command: {
        commandId: `${command.commandId}:claim`,
        idempotencyKey: `${command.idempotencyKey}:claim`,
      },
    });
    state.claimCommitted = true;
    state.membership = membership;
    const result: InviteSignupResult = { principalId: provisional.principalId, membership, compensated: false };
    // Keep both keys through parent completion so workspace erasure cannot remove the command rows
    // after the child claim commits but before this durable parent outcome is recorded.
    completeCommand({ db, scope: execution.scope, command, result });
    return result;
  });
}

async function executeSignup(
  execution: SignupExecution,
  admission: Awaited<ReturnType<LocalAccountFlowContext["administration"]["preparePasswordInvitationClaim"]>>,
  state: SignupState,
): Promise<InviteSignupResult> {
  const { applicationId, db, identity } = execution.dependencies;
  const { command, displayName, email, password } = execution.input;
  const { operation } = execution;
  correlatePendingAccountCommand(db, {
    applicationId,
    operation,
    idempotencyKey: command.idempotencyKey,
    workspaceId: admission.workspaceId,
  });
  state.provisional = await identity.createCorrelatedProvisionalCredentialPrincipal({
    email,
    displayName,
    password,
    emailVerified: admission.emailVerifiedByInvitation,
    command,
    correlatePrincipalInTransaction: (principalId) =>
      correlatePendingAccountCommand(db, {
        applicationId,
        operation,
        idempotencyKey: command.idempotencyKey,
        workspaceId: admission.workspaceId,
        targetPrincipalId: principalId,
      }),
  });
  return claimInvitation(execution, admission, state);
}

function buildCanonicalPayload({ displayName, email, password, token }: InviteSignupInput) {
  return {
    // Testing a password candidate requires possession of the high-entropy invitation token too.
    credentialBindingDigest: buildSecretDigest("invite-signup-credentials", `${token}\0${password}`),
    normalizedEmail: normalizeAccountEmail(email),
    displayName,
  };
}

async function acceptInviteWithPasswordSignup(
  dependencies: InviteSignupDependencies,
  input: InviteSignupInput,
): Promise<InviteSignupResult> {
  const { applicationId, buildCommandExecutionKey, db, lock } = dependencies;
  const { administration } = dependencies;
  const { command, email, token } = input;
  const operation: SignupExecution["operation"] = "invite-password-signup";
  const scope = { applicationId, operation, actorPrincipalId: null };
  const canonicalPayload = buildCanonicalPayload(input);
  return lock.withKeys([buildCommandExecutionKey(command)], async () => {
    const replay = resumeExistingCommand<InviteSignupResult>({ db, scope, command, canonicalPayload });
    if (replay) return markAccountCommandReplay(replay.result);

    // The invitation is the only authority on this unauthenticated route. Validate it before
    // reserving a command so invalid bearer values cannot amplify durable SQLite writes.
    const admission = await administration.preparePasswordInvitationClaim({ token, normalizedEmail: email });
    const begun = beginCommand<InviteSignupResult>({ db, scope, command, canonicalPayload });
    if (begun.kind === "replay") return markAccountCommandReplay(begun.result);

    const execution: SignupExecution = { dependencies, input, operation, scope };
    const state: SignupState = { claimCommitted: false, membership: null, provisional: null };
    try {
      return await executeSignup(execution, admission, state);
    } catch (claimError) {
      if (state.claimCommitted) return recordCommittedClaimFailure(execution, claimError, state);
      if (!state.provisional) return recordPreProvisionFailure(execution, claimError);
      return compensateFailedSignup(execution, claimError, state.provisional);
    }
  });
}

export function createInviteSignupFlows(
  context: LocalAccountFlowContext,
): Pick<LocalAccountFlows, "acceptInviteWithPasswordSignup"> {
  const dependencies: InviteSignupDependencies = context;
  return {
    acceptInviteWithPasswordSignup: (input) => acceptInviteWithPasswordSignup(dependencies, input),
  };
}

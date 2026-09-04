import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { IdentityPort, InviteSignupResult } from "@capacitylens/shared/account/ports";
import { normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import { recordTerminalOutcome } from "../accountFlowRuntime";
import {
  beginCommand,
  completeCommand,
  correlatePendingAccountCommand,
  markAccountCommandReplay,
  resumeExistingCommand,
  secretDigest,
  terminateCommand,
  terminatePendingCommand,
} from "../commands";
import type { LocalAccountFlows } from "../localAccountFlows";
import type { LocalAccountFlowContext } from "./context";

export function inviteSignup(
  context: LocalAccountFlowContext,
): Pick<LocalAccountFlows, "acceptInviteWithPasswordSignup"> {
  const { applicationId, db, identity, administration, lock, persistTerminalOutcome, commandExecutionKey } = context;
  return {
    async acceptInviteWithPasswordSignup({
      token,
      email,
      displayName,
      password,
      command,
    }): Promise<InviteSignupResult> {
      return lock.withKeys([commandExecutionKey(command)], async () => {
        const operation = "invite-password-signup";
        const scope = { applicationId, operation, actorPrincipalId: null };
        const canonicalPayload = {
          // Bind the full credential-bearing request without persisting either bearer, or a
          // standalone password verifier that a ledger reader could attack independently. Testing a
          // password candidate requires possession of the high-entropy invitation token as well.
          credentialBindingDigest: secretDigest("invite-signup-credentials", `${token}\0${password}`),
          normalizedEmail: normalizeAccountEmail(email),
          displayName,
        };
        const replay = resumeExistingCommand<InviteSignupResult>(db, scope, command, canonicalPayload);
        if (replay) return markAccountCommandReplay(replay.result);

        // The invitation is the only authority on this unauthenticated route. Validate it before
        // reserving a command so arbitrary invalid bearer values cannot amplify durable SQLite
        // writes. Completed retries were handled by the read-only lookup above because their
        // legitimate single-use invitation has already been consumed.
        const admission = await administration.preparePasswordInvitationClaim({
          token,
          normalizedEmail: email,
        });
        const begun = beginCommand<InviteSignupResult>(db, scope, command, canonicalPayload);
        if (begun.kind === "replay") return markAccountCommandReplay(begun.result);

        let provisional: Awaited<ReturnType<IdentityPort["createProvisionalCredentialPrincipal"]>> | null = null;
        const claimState: {
          committed: boolean;
          membership: InviteSignupResult["membership"] | null;
        } = {
          committed: false,
          membership: null,
        };
        try {
          correlatePendingAccountCommand(db, {
            applicationId,
            operation,
            idempotencyKey: command.idempotencyKey,
            workspaceId: admission.workspaceId,
          });
          provisional = await identity.createCorrelatedProvisionalCredentialPrincipal({
            email,
            displayName,
            password,
            emailVerified: admission.emailVerifiedByInvitation,
            command,
            // The embedded identity adapter invokes this after inserting the user and credential link
            // but before their shared SQLite transaction commits. A crash can therefore leave either
            // all three durable facts or none, never an uncorrelated provisional principal.
            correlatePrincipalInTransaction: (principalId) =>
              correlatePendingAccountCommand(db, {
                applicationId,
                operation,
                idempotencyKey: command.idempotencyKey,
                workspaceId: admission.workspaceId,
                targetPrincipalId: principalId,
              }),
          });
          return await lock.withKeys([provisional.principalId, `workspace:${admission.workspaceId}`], async () => {
            const membership = await administration.claimInvitationForPrincipal({
              token,
              principalId: provisional!.principalId,
              principalEmail: email,
              emailVerified: admission.emailVerifiedByInvitation,
              passwordMode: true,
              command: {
                commandId: `${command.commandId}:claim`,
                idempotencyKey: `${command.idempotencyKey}:claim`,
              },
            });
            claimState.committed = true;
            claimState.membership = membership;
            const result: InviteSignupResult = {
              principalId: provisional!.principalId,
              membership,
              compensated: false,
            };
            // Keep the principal/workspace keys through parent completion. Otherwise workspace
            // erasure could delete both command rows after the child claim commits but before this
            // durable parent outcome is recorded, leaving the browser with nothing to reconcile.
            completeCommand(db, scope, command, result);
            return result;
          });
        } catch (claimError) {
          if (claimState.committed) {
            recordTerminalOutcome(claimError, () =>
              persistTerminalOutcome(
                () =>
                  terminatePendingCommand(db, scope, command, "reconciliation_required", "DEPENDENCY_UNAVAILABLE", {
                    kind: "invitation-claim-committed",
                    workspaceId: claimState.membership?.workspaceId ?? null,
                    targetPrincipalId: provisional?.principalId ?? null,
                    provisionalPrincipalId: provisional?.principalId ?? null,
                    ceremonyId: null,
                  }),
                {
                  action: "flow.reconciliation_required",
                  outcome: "failed",
                  workspaceId: claimState.membership?.workspaceId ?? null,
                  targetPrincipalId: provisional?.principalId ?? null,
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
          if (!provisional) {
            recordTerminalOutcome(claimError, () =>
              persistTerminalOutcome(
                () =>
                  terminateCommand(
                    db,
                    scope,
                    command,
                    "compensated",
                    claimError instanceof AccountContractError ? claimError.failure.code : "CONFLICT",
                  ),
                { action: "flow.compensated", outcome: "compensated", command },
              ),
            );
            throw claimError;
          }
          const provisionalPrincipalId = provisional.principalId;
          let compensationError: unknown = null;
          try {
            await identity.compensateProvisionalPrincipal({
              provisional,
              reason: "invitation-claim-failed",
              command,
            });
          } catch (error) {
            compensationError = error;
          }
          if (compensationError === null) {
            recordTerminalOutcome(claimError, () =>
              persistTerminalOutcome(
                () =>
                  terminateCommand(
                    db,
                    scope,
                    command,
                    "compensated",
                    claimError instanceof AccountContractError ? claimError.failure.code : "CONFLICT",
                  ),
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
          const combinedFailure = new AggregateError([claimError, compensationError]);
          recordTerminalOutcome(combinedFailure, () =>
            persistTerminalOutcome(
              () =>
                terminateCommand(db, scope, command, "reconciliation_required", "COMPENSATION_FAILED", {
                  kind: "provisional-principal-compensation-failed",
                  workspaceId: null,
                  targetPrincipalId: provisionalPrincipalId,
                  provisionalPrincipalId,
                  ceremonyId: null,
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
      });
    },
  };
}

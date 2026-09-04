import type { StandardAccountAuditAction } from "@capacitylens/shared/account/audit";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { AccountAuditPort } from "@capacitylens/shared/account/ports";
import type { CommandIdentity, CreatedInvitation } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import { tx, type SynchronousCallback } from "../txn";
import { accountAuditWriter, recordTerminalOutcome } from "./accountFlowRuntime";
import { createAuthority } from "./adminPort/authority";
import type { SsoCutoverAccountAdminPort } from "./adminPort/contracts";
import { createCutover } from "./adminPort/cutover";
import { createInvitationClaims } from "./adminPort/invitationClaims";
import { createInvitations } from "./adminPort/invitations";
import { createMembership } from "./adminPort/membership";
import { beginCommand, completeCommand, markAccountCommandReplay, terminateCommand } from "./commands";
import { KeyedOperationLock } from "./operationLock";
import { WriteOnceSecretReplay } from "./writeOnceSecretReplay";
export { ACCOUNT_POLICY_VERSION, MAX_INVITATION_TTL_MS } from "./adminPort/contracts";

export type { LocalAccountAdminPort, SsoCutoverAccountAdminPort, SsoCutoverWorkspaceFact } from "./adminPort/contracts";
export {
  assertAccountControlPlaneCurrent,
  assertAccountControlPlaneSchemaCurrent,
  listSoleOwnerAccountIds,
} from "./adminPort/cutover";
export { hasLivePreauthorizedInvitation } from "./adminPort/invitations";

const MAX_SECRET_REPLAYS = 256;

export function sqliteAccountAdminPort(input: {
  applicationId: string;
  db: Db;
  lock: KeyedOperationLock;
  trustedLocal?: boolean;
  requireMfa?: boolean;
  audit?: AccountAuditPort;
  /** Test seam; production uses the bounded default. */
  writeOnceReplayCapacity?: number;
}): SsoCutoverAccountAdminPort {
  const { applicationId, db, lock, trustedLocal = false, requireMfa = false } = input;
  const audit = accountAuditWriter(applicationId, input.audit);
  const invitationSecretReplay = new WriteOnceSecretReplay<CreatedInvitation>(
    input.writeOnceReplayCapacity ?? MAX_SECRET_REPLAYS,
  );
  async function runMutation<Execute extends () => unknown>(options: {
    operation: string;
    actorPrincipalId: string | null;
    targetPrincipalId?: string | null;
    workspaceId?: string | null;
    command: CommandIdentity;
    payload: unknown;
    lockKeys: readonly string[];
    execute: SynchronousCallback<Execute>;
    persistResult?: (result: ReturnType<Execute>) => unknown;
    replayResult?: (stored: unknown, commandId: string) => ReturnType<Execute>;
    replayGuard?: () => void;
    /** In-memory secret/cache maintenance that must happen after commit but before lock release. */
    afterCommit?: (result: ReturnType<Execute>) => void;
    /** Release any in-memory reservation after the database transaction rolls back. */
    afterRollback?: () => void;
    audit?: {
      action: StandardAccountAuditAction;
      changedFields: readonly string[];
    };
  }): Promise<ReturnType<Execute>> {
    return lock.withKeys(options.lockKeys, async () => {
      const scope = {
        applicationId,
        operation: options.actorPrincipalId
          ? `${options.operation}:actor:${options.actorPrincipalId}`
          : options.operation,
        actorPrincipalId: options.actorPrincipalId,
        targetPrincipalId: options.targetPrincipalId ?? null,
        workspaceId: options.workspaceId ?? null,
      };
      const begun = beginCommand<unknown>(db, scope, options.command, options.payload);
      if (begun.kind === "replay") {
        options.replayGuard?.();
        return markAccountCommandReplay(
          options.replayResult
            ? options.replayResult(begun.result, begun.record.commandId)
            : (begun.result as ReturnType<Execute>),
        );
      }
      let result: ReturnType<Execute>;
      try {
        // Execute has already crossed this coordinator's SynchronousCallback boundary. Preserve
        // that proof for the transaction wrapper that also writes the command completion row.
        const transaction = (() => {
          const result = options.execute() as ReturnType<Execute>;
          completeCommand(db, scope, options.command, options.persistResult ? options.persistResult(result) : result);
          if (options.audit) {
            audit({
              action: options.audit.action,
              outcome: "success",
              workspaceId: options.workspaceId,
              actorPrincipalId: options.actorPrincipalId,
              targetPrincipalId: options.targetPrincipalId,
              command: options.command,
              changedFields: options.audit.changedFields,
            });
          }
          return result;
        }) as SynchronousCallback<() => ReturnType<Execute>>;
        result = tx(db, transaction, "immediate");
      } catch (error) {
        options.afterRollback?.();
        // The domain write rolled back with the transaction, so this is a known compensated outcome.
        // Record it outside the rolled-back transaction without hiding the original error.
        recordTerminalOutcome(
          error,
          () => {
            tx(
              db,
              () => {
                terminateCommand(
                  db,
                  scope,
                  options.command,
                  "compensated",
                  error instanceof AccountContractError ? error.failure.code : "CONFLICT",
                );
                if (options.audit) {
                  const code = error instanceof AccountContractError ? error.failure.code : null;
                  const denied =
                    code === "FORBIDDEN" ||
                    code === "NOT_MEMBER" ||
                    code === "SESSION_NOT_FRESH" ||
                    code === "MFA_REQUIRED";
                  audit({
                    action: options.audit.action,
                    outcome: denied ? "denied" : "failed",
                    workspaceId: options.workspaceId,
                    actorPrincipalId: options.actorPrincipalId,
                    targetPrincipalId: options.targetPrincipalId,
                    command: options.command,
                  });
                }
              },
              "immediate",
            );
          },
          "Account command failed and its compensation outcome could not be recorded.",
        );
        throw error;
      }
      // The command and domain mutation are now committed, while all mutation keys are still held.
      // This closes the replay window in which another request could otherwise recover a consumed
      // or revoked write-once token before the process-local cache was updated.
      options.afterCommit?.(result);
      return result;
    });
  }
  const context = { applicationId, db, trustedLocal, requireMfa, invitationSecretReplay, runMutation };
  return {
    ...createAuthority(context),
    ...createCutover(context),
    ...createMembership(context),
    ...createInvitations(context),
    ...createInvitationClaims(context),
  };
}

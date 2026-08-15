import type { AccountAuditAction, AccountAuditEvent } from "@capacitylens/shared/account/audit";
import type { AccountAuditPort } from "@capacitylens/shared/account/ports";
import type { CommandIdentity, OperationReceipt } from "@capacitylens/shared/account/types";

export interface AccountAuditInput {
  action: AccountAuditAction;
  outcome: AccountAuditEvent["outcome"];
  workspaceId?: string | null;
  actorPrincipalId?: string | null;
  targetPrincipalId?: string | null;
  command: CommandIdentity;
  changedFields?: readonly string[];
}

export function accountAuditWriter(
  applicationId: string,
  port: AccountAuditPort | undefined,
): (event: AccountAuditInput) => void {
  const audit = port ?? { append: () => true };
  return (event) => {
    const targetSuffix =
      event.action === "identity.local_deprovisioned" && event.targetPrincipalId ? `:${event.targetPrincipalId}` : "";
    audit.append({
      id: `${event.command.commandId}:${event.action}:${event.outcome}${targetSuffix}`,
      occurredAt: new Date().toISOString(),
      applicationId,
      workspaceId: event.workspaceId ?? null,
      actorPrincipalId: event.actorPrincipalId ?? null,
      targetPrincipalId: event.targetPrincipalId ?? null,
      commandId: event.command.commandId,
      action: event.action,
      outcome: event.outcome,
      changedFields: event.changedFields ?? [],
    });
  };
}

/** Shared identity-port operation receipt: an embedded port (Better Auth, trusted-local) stamps
 *  this on completion rather than reading back a stored record (contrast {@link
 *  "./commands".operationReceipt}, which reflects a persisted command's own `updatedAt`). */
export function receipt(commandId: string, changed?: boolean): OperationReceipt {
  return { commandId, completedAt: new Date().toISOString(), ...(changed === undefined ? {} : { changed }) };
}

/** Preserve the primary failure if recording its terminal command state fails too. */
export function recordTerminalOutcome(
  originalError: unknown,
  record: () => boolean | void,
  message = "Account flow failed and its terminal command outcome could not be recorded.",
): void {
  try {
    if (record() === false) {
      throw new Error("The pending account command no longer accepted its terminal outcome.");
    }
  } catch (recordingError) {
    throw new AggregateError([originalError, recordingError], message, {
      cause: recordingError,
    });
  }
}

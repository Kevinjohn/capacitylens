import type { AccountAuditEvent, StandardAccountAuditAction } from "@capacitylens/shared/account/audit";
import type { AccountAuditPort } from "@capacitylens/shared/account/ports";
import type { CommandIdentity, OperationReceipt } from "@capacitylens/shared/account/types";

export interface AccountAuditInput {
  action: StandardAccountAuditAction;
  outcome: AccountAuditEvent["outcome"];
  workspaceId?: string | null;
  actorPrincipalId?: string | null;
  targetPrincipalId?: string | null;
  command: CommandIdentity;
  changedFields?: readonly string[];
  /** Disambiguates two events one command emits with the SAME action and outcome.
   *
   *  Event identity is `commandId:action:outcome`, which is unique per command for a mutation that
   *  changes one thing. It is NOT unique when a single command legitimately acts on several rows —
   *  erasing a company deprovisions every orphaned principal, and one membership write can
   *  invalidate more than one ownership-transfer request. Without a key those events collide on the
   *  outbox row id and all but one are silently dropped, which is exactly the evidence an audit
   *  trail exists to keep. Pass the id of the thing the event is about. */
  eventKey?: string;
}

export function createAccountAuditWriter(
  applicationId: string,
  port: AccountAuditPort | undefined,
): (event: AccountAuditInput) => void {
  const audit = port ?? { append: () => true };
  return (event) => {
    // The per-principal suffix erasure has always needed is the same mechanism as `eventKey`, so it
    // is now expressed through it rather than as a second, action-specific rule.
    const legacyPrincipalKey =
      event.action === "identity.local_deprovisioned" ? (event.targetPrincipalId ?? null) : null;
    const eventKey = event.eventKey ?? legacyPrincipalKey;
    const targetSuffix = eventKey === null ? "" : `:${eventKey}`;
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

interface CreateOperationReceiptInput {
  commandId: string;
  changed?: boolean | undefined;
}

/** Shared identity-port operation receipt: an embedded port (Better Auth, trusted-local) stamps
 *  this on completion rather than deriving the receipt from a persisted command record's `updatedAt`. */
export function createOperationReceipt({ commandId, changed }: CreateOperationReceiptInput): OperationReceipt {
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

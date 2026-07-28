import type {
  AccountAuditAction,
  AccountAuditEvent,
} from '@capacitylens/shared/account/audit'
import type { AccountAuditPort } from '@capacitylens/shared/account/ports'
import type { CommandIdentity } from '@capacitylens/shared/account/types'

export interface AccountAuditInput {
  action: AccountAuditAction
  outcome: AccountAuditEvent['outcome']
  workspaceId?: string | null
  actorPrincipalId?: string | null
  targetPrincipalId?: string | null
  command: CommandIdentity
  changedFields?: readonly string[]
}

export function accountAuditWriter(
  applicationId: string,
  port: AccountAuditPort | undefined,
): (event: AccountAuditInput) => void {
  const audit = port ?? { append: () => true }
  return (event) => {
    audit.append({
      id: `${event.command.commandId}:${event.action}:${event.outcome}`,
      occurredAt: new Date().toISOString(),
      applicationId,
      workspaceId: event.workspaceId ?? null,
      actorPrincipalId: event.actorPrincipalId ?? null,
      targetPrincipalId: event.targetPrincipalId ?? null,
      commandId: event.command.commandId,
      action: event.action,
      outcome: event.outcome,
      changedFields: event.changedFields ?? [],
    })
  }
}

/** Preserve the primary failure if recording its terminal command state fails too. */
export function recordTerminalOutcome(
  originalError: unknown,
  record: () => void,
  message = 'Account flow failed and its terminal command outcome could not be recorded.',
): void {
  try {
    record()
  } catch (recordingError) {
    throw new AggregateError([originalError, recordingError], message, {
      cause: recordingError,
    })
  }
}

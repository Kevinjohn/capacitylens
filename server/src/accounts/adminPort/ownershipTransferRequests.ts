import {
  isLiveOwnershipTransferState,
  type OwnershipTransferOutcome,
  type OwnershipTransferRequest,
  type OwnershipTransferState,
  type OwnershipTransferTerminalReason,
} from "@capacitylens/shared/account/ownershipTransfer";
import type { OwnershipTransferCommandInput } from "@capacitylens/shared/account/ports";
import {
  canReadOwnershipTransfer,
  isOwnershipTransferExpired,
} from "@capacitylens/shared/account/ownershipTransferPolicy";
import { applyTransition, nextOwnershipTransferRevision, readRequestById } from "../../controlTables";
import type { AdminPortContext } from "./contracts";
import { createAccountFailure } from "./failures";

/**
 * The pieces every ceremony command shares: who the context is, how one row is found and checked,
 * and how one transition is written. Kept apart from the operations themselves so the initiation
 * path and the row-command path can each stay readable, and so neither has to import the other.
 */

export type TransferContext = Pick<AdminPortContext, "db" | "trustedLocal" | "requireMfa" | "runMutation" | "audit">;
/**
 * A row whose deadline has passed is not a live ceremony: it is an expiry nobody has committed yet.
 *
 * The commit still belongs to the command path — the unique-live-slot guarantee is a partial index,
 * and a read must not write. But handing the stored row back verbatim would show both participants
 * an open ceremony with a deadline in the past and offer them controls that can only fail, so the
 * projection says what is true and the next command makes it durable.
 */
export function projectExpiry(request: OwnershipTransferRequest, now: number): OwnershipTransferRequest {
  return isLiveOwnershipTransferState(request.state) && isOwnershipTransferExpired(request.expiresAt, now)
    ? { ...request, state: "expired", terminalAt: request.expiresAt, terminalReason: "deadline_passed" }
    : request;
}

export function readRequiredRequest(
  context: TransferContext,
  input: OwnershipTransferCommandInput,
): OwnershipTransferRequest {
  const row = readRequestById(context.db, input.workspaceId, input.requestId);
  if (!row) throw createAccountFailure("NOT_FOUND", "Ownership transfer not found.", input.command.commandId);
  return row;
}

export function assertParticipant(row: OwnershipTransferRequest, principalId: string, commandId: string): void {
  if (
    !canReadOwnershipTransfer({
      isInitiator: row.initiatorUserId === principalId,
      isTarget: row.targetUserId === principalId,
    })
  ) {
    throw createAccountFailure("FORBIDDEN", "Forbidden.", commandId);
  }
}

export interface TransitionInput {
  row: OwnershipTransferRequest;
  state: OwnershipTransferState;
  now: string;
  reason?: OwnershipTransferTerminalReason;
  targetAcceptedAt?: string | null;
  commandId: string;
}

export function applyRequestTransition({ db }: TransferContext, input: TransitionInput): OwnershipTransferRequest {
  const { row, state, now, reason, commandId } = input;
  const request: OwnershipTransferRequest = {
    ...row,
    state,
    revision: nextOwnershipTransferRevision(row.revision),
    targetAcceptedAt: input.targetAcceptedAt === undefined ? row.targetAcceptedAt : input.targetAcceptedAt,
    terminalAt: isLiveOwnershipTransferState(state) ? null : now,
    terminalReason: reason ?? null,
  };
  if (
    !applyTransition({
      db,
      id: row.id,
      accountId: row.accountId,
      expectedState: row.state,
      expectedRevision: row.revision,
      nextState: request.state,
      nextRevision: request.revision,
      targetAcceptedAt: request.targetAcceptedAt,
      terminalAt: request.terminalAt,
      terminalReason: request.terminalReason,
    })
  )
    throw createAccountFailure("CONFLICT", "Ownership transfer changed.", commandId);
  return request;
}

export function terminaliseRequest(
  context: TransferContext,
  input: TransitionInput & { reason: OwnershipTransferTerminalReason },
): OwnershipTransferOutcome {
  applyRequestTransition(context, input);
  return { kind: "terminal", state: input.state, reason: input.reason };
}

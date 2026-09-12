import type { StandardAccountAuditAction } from "@capacitylens/shared/account/audit";
import type { AccountAdminPort, OwnershipTransferCommandInput } from "@capacitylens/shared/account/ports";
import {
  canTransitionOwnershipTransfer,
  isLiveOwnershipTransferState,
  nextOwnershipTransferState,
  type OwnershipTransferAction,
  type OwnershipTransferOutcome,
  type OwnershipTransferRequest,
  type OwnershipTransferState,
  type OwnershipTransferTerminalReason,
} from "@capacitylens/shared/account/ownershipTransfer";
import {
  canActOnOwnershipTransfer,
  canReadOwnershipTransfer,
  isOwnershipTransferExpired,
  OWNERSHIP_TRANSFER_TTL_MS,
} from "@capacitylens/shared/account/ownershipTransferPolicy";
import {
  applyTransition,
  getActiveMemberRole,
  insertRequest,
  listMembersForAccount,
  nextOwnershipTransferRevision,
  readLatestTerminalForParticipant,
  readLiveRequest,
  readRequestById,
  sweepExpiredHistory,
} from "../../controlTables";
import { assertAccountAuthority, assertAdministrativeAssurance } from "./authority";
import type { AdminPortContext } from "./contracts";
import { createAccountFailure } from "./failures";
import { exchangeOwnershipInTx } from "./membership";

type TransferContext = Pick<AdminPortContext, "db" | "trustedLocal" | "requireMfa" | "runMutation">;
type InitiateInput = Parameters<AccountAdminPort["initiateOwnershipTransfer"]>[0];
type RowAction = Exclude<OwnershipTransferAction, "initiate">;
type TransferPort = Pick<
  AccountAdminPort,
  | "readOwnershipTransfer"
  | "initiateOwnershipTransfer"
  | "acceptOwnershipTransfer"
  | "withdrawOwnershipTransfer"
  | "declineOwnershipTransfer"
  | "cancelOwnershipTransfer"
  | "completeOwnershipTransfer"
>;
const AUDIT_ACTIONS = {
  accept: "ownership_transfer.accepted",
  withdraw: "ownership_transfer.withdrawn",
  decline: "ownership_transfer.declined",
  cancel: "ownership_transfer.cancelled",
  complete: "ownership_transfer.completed",
} as const satisfies Record<RowAction, StandardAccountAuditAction>;
const CHANGED_FIELDS = ["state", "revision"] as const;

/**
 * A row whose deadline has passed is not a live ceremony: it is an expiry nobody has committed yet.
 *
 * The commit still belongs to the command path — the unique-live-slot guarantee is a partial index,
 * and a read must not write. But handing the stored row back verbatim would show both participants
 * an open ceremony with a deadline in the past and offer them controls that can only fail, so the
 * projection says what is true and the next command makes it durable.
 */
function projectExpiry(request: OwnershipTransferRequest, now: number): OwnershipTransferRequest {
  return isLiveOwnershipTransferState(request.state) && isOwnershipTransferExpired(request.expiresAt, now)
    ? { ...request, state: "expired", terminalAt: request.expiresAt, terminalReason: "deadline_passed" }
    : request;
}

function readRequiredRequest(context: TransferContext, input: OwnershipTransferCommandInput): OwnershipTransferRequest {
  const row = readRequestById(context.db, input.workspaceId, input.requestId);
  if (!row) throw createAccountFailure("NOT_FOUND", "Ownership transfer not found.", input.command.commandId);
  return row;
}

function assertParticipant(row: OwnershipTransferRequest, principalId: string, commandId: string): void {
  if (
    !canReadOwnershipTransfer({
      isInitiator: row.initiatorUserId === principalId,
      isTarget: row.targetUserId === principalId,
    })
  ) {
    throw createAccountFailure("FORBIDDEN", "Forbidden.", commandId);
  }
}

interface TransitionInput {
  row: OwnershipTransferRequest;
  state: OwnershipTransferState;
  now: string;
  reason?: OwnershipTransferTerminalReason;
  targetAcceptedAt?: string | null;
  commandId: string;
}

function applyRequestTransition({ db }: TransferContext, input: TransitionInput): OwnershipTransferRequest {
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

function terminaliseRequest(
  context: TransferContext,
  input: TransitionInput & { reason: OwnershipTransferTerminalReason },
): OwnershipTransferOutcome {
  applyRequestTransition(context, input);
  return { kind: "terminal", state: input.state, reason: input.reason };
}

function replaceLiveRequest(context: TransferContext, input: InitiateInput, now: string): boolean {
  const { workspaceId, expectedRequestId, expectedRevision, command } = input;
  if ((expectedRequestId === null) !== (expectedRevision === null)) {
    throw createAccountFailure(
      "VALIDATION_FAILED",
      "Replacement requires both request id and revision.",
      command.commandId,
    );
  }
  const live = readLiveRequest(context.db, workspaceId);
  // An expired row is nobody's nomination: commit the expiry and carry on, whatever the caller named.
  // Otherwise a forgotten request holds the company's only live slot until someone runs a command
  // against it purely to kill it.
  if (live && isOwnershipTransferExpired(live.expiresAt, Date.parse(now))) {
    applyRequestTransition(context, {
      row: live,
      state: "expired",
      reason: "deadline_passed",
      now,
      commandId: command.commandId,
    });
    return false;
  }
  if (live?.id !== (expectedRequestId ?? undefined) || live?.revision !== (expectedRevision ?? undefined)) {
    throw createAccountFailure("CONFLICT", "Ownership transfer changed.", command.commandId);
  }
  if (!live) return false;
  applyRequestTransition(context, {
    row: live,
    state: "cancelled",
    reason: "replaced",
    now,
    commandId: command.commandId,
  });
  return true;
}

function assertInitiationTarget(context: TransferContext, input: InitiateInput): void {
  const { db } = context;
  const { actor, workspaceId, targetPrincipalId, command } = input;
  if (actor.principalId === targetPrincipalId) {
    throw createAccountFailure("VALIDATION_FAILED", "The actor already owns this workspace.", command.commandId);
  }
  const role = getActiveMemberRole(db, workspaceId, targetPrincipalId);
  if (!role) throw createAccountFailure("NOT_FOUND", "The next owner must already be a member.", command.commandId);
  if (role !== "admin")
    throw createAccountFailure("VALIDATION_FAILED", "The next owner must be an Admin.", command.commandId);
}

function createRequest(input: InitiateInput, now: number): OwnershipTransferRequest {
  return {
    // Command ids are globally unique in the ledger. Reusing this identity lets replayGuard find
    // the original immutable participant pair even after later replacement or completion.
    id: input.command.commandId,
    accountId: input.workspaceId,
    initiatorUserId: input.actor.principalId,
    targetUserId: input.targetPrincipalId,
    state: "awaiting_target",
    revision: "0",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + OWNERSHIP_TRANSFER_TTL_MS).toISOString(),
    targetAcceptedAt: null,
    terminalAt: null,
    terminalReason: null,
  };
}

function initiateOwnershipTransfer(context: TransferContext, input: InitiateInput): Promise<OwnershipTransferOutcome> {
  const { db, trustedLocal, requireMfa, runMutation } = context;
  const { actor, workspaceId, targetPrincipalId, expectedRequestId, expectedRevision, command } = input;
  let replaced = false;
  return runMutation({
    operation: "ownership-transfer:initiate",
    actorPrincipalId: actor.principalId,
    targetPrincipalId,
    workspaceId,
    command,
    payload: { workspaceId, targetPrincipalId, expectedRequestId, expectedRevision },
    lockKeys: [actor.principalId, targetPrincipalId, `workspace:${workspaceId}`],
    replayGuard: () =>
      assertParticipant(
        readRequiredRequest(context, { ...input, requestId: command.commandId, expectedRevision: "0" }),
        actor.principalId,
        command.commandId,
      ),
    audit: {
      action: "ownership_transfer.initiated",
      changedFields: CHANGED_FIELDS,
      successAction: () => ({
        action: replaced ? "ownership_transfer.replaced" : "ownership_transfer.initiated",
        changedFields: CHANGED_FIELDS,
        eventKey: command.commandId,
      }),
    },
    execute: (): OwnershipTransferOutcome => {
      assertAdministrativeAssurance({ actor, requireMfa, trustedLocal, commandId: command.commandId });
      assertAccountAuthority({ db, actor, workspaceId, action: "transfer-ownership", trustedLocal });
      assertInitiationTarget(context, input);
      const now = Date.now();
      replaced = replaceLiveRequest(context, input, new Date(now).toISOString());
      const request = createRequest(input, now);
      insertRequest(db, request);
      sweepExpiredHistory(db, now);
      return { kind: "applied", request };
    },
  });
}

function assertCommandParticipant(
  context: TransferContext,
  input: OwnershipTransferCommandInput,
  action: RowAction,
): OwnershipTransferRequest {
  const row = readRequiredRequest(context, input);
  const callerRole = getActiveMemberRole(context.db, input.workspaceId, input.actor.principalId);
  if (
    !callerRole ||
    !canActOnOwnershipTransfer(action, {
      callerRole,
      isInitiator: input.actor.principalId === row.initiatorUserId,
      isTarget: input.actor.principalId === row.targetUserId,
    })
  )
    throw createAccountFailure("FORBIDDEN", "Forbidden.", input.command.commandId);
  return row;
}

function assertSingleOwner(context: TransferContext, workspaceId: string): void {
  const owners = listMembersForAccount(context.db, workspaceId).filter(
    (member) => member.role === "owner" && member.status === "active",
  );
  if (owners.length !== 1)
    throw new Error(`Ownership exchange left ${owners.length} active Owners in workspace ${workspaceId}.`);
}

function executeRowCommand(
  context: TransferContext,
  input: OwnershipTransferCommandInput,
  action: RowAction,
): OwnershipTransferOutcome {
  const { actor, workspaceId, command, expectedRevision } = input;
  const { db, trustedLocal, requireMfa } = context;
  assertAdministrativeAssurance({ actor, requireMfa, trustedLocal, commandId: command.commandId });
  const row = assertCommandParticipant(context, input, action);
  const instant = Date.now();
  const now = new Date(instant).toISOString();
  sweepExpiredHistory(db, instant);
  if (isLiveOwnershipTransferState(row.state) && isOwnershipTransferExpired(row.expiresAt, instant)) {
    return terminaliseRequest(context, {
      row,
      state: "expired",
      reason: "deadline_passed",
      now,
      commandId: command.commandId,
    });
  }
  if (!canTransitionOwnershipTransfer(row.state, action)) {
    throw createAccountFailure("CONFLICT", "Ownership transfer cannot make that transition.", command.commandId);
  }
  if (expectedRevision !== row.revision)
    throw createAccountFailure("CONFLICT", "Ownership transfer changed.", command.commandId);
  const state = nextOwnershipTransferState(row.state, action);
  if (!state) throw new Error("An allowed ownership transfer transition has no destination.");
  if (action === "complete") {
    exchangeOwnershipInTx({
      db,
      workspaceId,
      previousOwnerId: row.initiatorUserId,
      nextOwnerId: row.targetUserId,
      now,
    });
  }
  const request = applyRequestTransition(context, {
    row,
    state,
    now,
    commandId: command.commandId,
    ...(action === "accept" ? { targetAcceptedAt: now } : {}),
    ...(action === "withdraw" ? { targetAcceptedAt: null } : {}),
    ...(action === "decline" ? { reason: "target_declined" as const } : {}),
    ...(action === "cancel" ? { reason: "owner_cancelled" as const } : {}),
  });
  if (action === "complete") assertSingleOwner(context, workspaceId);
  return { kind: "applied", request };
}

function runRowCommand(
  context: TransferContext,
  input: OwnershipTransferCommandInput,
  action: RowAction,
): Promise<OwnershipTransferOutcome> {
  const { actor, workspaceId, requestId, expectedRevision, command } = input;
  return context.runMutation({
    operation: `ownership-transfer:${action}`,
    actorPrincipalId: actor.principalId,
    workspaceId,
    command,
    payload: { workspaceId, requestId, expectedRevision },
    lockKeys: [actor.principalId, `workspace:${workspaceId}`],
    replayGuard: () => assertParticipant(readRequiredRequest(context, input), actor.principalId, command.commandId),
    audit: {
      action: AUDIT_ACTIONS[action],
      changedFields: CHANGED_FIELDS,
      successAction: (result: OwnershipTransferOutcome) => ({
        action:
          result.kind === "terminal"
            ? `ownership_transfer.${result.state === "expired" ? "expired" : "invalidated"}`
            : AUDIT_ACTIONS[action],
        changedFields: CHANGED_FIELDS,
        eventKey: requestId,
      }),
    },
    execute: () => executeRowCommand(context, input, action),
  });
}

export function createOwnershipTransferOperations(context: TransferContext): TransferPort {
  return {
    async readOwnershipTransfer({ actor, workspaceId }) {
      // A READ, and freshness is a mutation threshold: the route waives it deliberately (every step
      // still asserts it), because an Owner who signed in an hour ago must still be able to SEE the
      // nomination they are being asked to approve.
      assertAdministrativeAssurance({
        actor,
        requireMfa: context.requireMfa,
        trustedLocal: context.trustedLocal,
        requireFresh: false,
      });
      const stored = readLiveRequest(context.db, workspaceId);
      const live =
        stored &&
        canReadOwnershipTransfer({
          isInitiator: stored.initiatorUserId === actor.principalId,
          isTarget: stored.targetUserId === actor.principalId,
        })
          ? projectExpiry(stored, Date.now())
          : null;
      const outcome = live && !isLiveOwnershipTransferState(live.state) ? live : null;
      return {
        live: outcome ? null : live,
        latestOutcome: outcome ?? readLatestTerminalForParticipant(context.db, workspaceId, actor.principalId),
      };
    },
    initiateOwnershipTransfer: (input) => initiateOwnershipTransfer(context, input),
    acceptOwnershipTransfer: (input) => runRowCommand(context, input, "accept"),
    withdrawOwnershipTransfer: (input) => runRowCommand(context, input, "withdraw"),
    declineOwnershipTransfer: (input) => runRowCommand(context, input, "decline"),
    cancelOwnershipTransfer: (input) => runRowCommand(context, input, "cancel"),
    completeOwnershipTransfer: (input) => runRowCommand(context, input, "complete"),
  };
}

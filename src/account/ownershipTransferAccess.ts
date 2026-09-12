import {
  isOwnershipTransferState,
  OWNERSHIP_TRANSFER_TERMINAL_REASONS,
  type OwnershipTransferState,
  type OwnershipTransferTerminalReason,
} from "@capacitylens/shared/account/ownershipTransfer";
import { accountClient, type OwnershipTransferStep } from "./accountClient";
import {
  isNullableString,
  isRecord,
  isTimestamp,
  readCommandResult,
  readResult,
  type TeamAccessResult,
} from "./accessResult";

/**
 * The ownership transfer ceremony's typed boundary.
 *
 * Separate from the rest of the account-administration client because it decodes something none of
 * the others do: a committed terminal outcome that arrives as a 409. Reading that as a success is
 * specific to this ceremony and must not leak into the generic command decoding.
 */

/** One request as the ceremony endpoints report it. Ids and instants only: names come from the
 *  member directory, so a stale card can never show a name the directory has since changed. */
export interface OwnershipTransferView {
  id: string;
  fromUserId: string;
  toUserId: string;
  state: OwnershipTransferState;
  revision: string;
  createdAt: string;
  expiresAt: string;
  targetAcceptedAt: string | null;
  terminalAt: string | null;
  terminalReason: OwnershipTransferTerminalReason | null;
}

export interface OwnershipTransferProjectionView {
  live: OwnershipTransferView | null;
  latestOutcome: OwnershipTransferView | null;
}

/**
 * What a ceremony command answered.
 *
 * `terminal` is the server's COMMITTED outcome — a deadline that had passed and was materialised —
 * not a refusal. It arrives as a 409 carrying its own code, and it is decoded as a success here so
 * the card can explain what happened instead of showing an error the user cannot act on.
 */
export type OwnershipTransferOutcomeView =
  | { kind: "applied"; request: OwnershipTransferView }
  | { kind: "terminal"; state: OwnershipTransferState; reason: OwnershipTransferTerminalReason | null };

/** The committed-terminal half on its own. The card only ever holds one of these to explain, so
 *  naming it saves every reader of that state re-proving which variant it is. */
export type OwnershipTransferTerminalView = Extract<OwnershipTransferOutcomeView, { kind: "terminal" }>;

/** The reason vocabulary is closed and server-authored, so an unrecognised one is decoded as "no
 *  reason" rather than rendered: the card explains outcomes it understands and stays silent
 *  otherwise, instead of printing an identifier at the user. */
function isOwnershipTransferTerminalReason(value: unknown): value is OwnershipTransferTerminalReason {
  return typeof value === "string" && (OWNERSHIP_TRANSFER_TERMINAL_REASONS as readonly string[]).includes(value);
}

/** The identity and lifecycle fields every request carries, checked together so the decoder below
 *  stays one readable shape rather than a wall of guards. */
function hasOwnershipTransferShape(
  value: Record<string, unknown>,
): value is Record<string, unknown> &
  Pick<
    OwnershipTransferView,
    "id" | "fromUserId" | "toUserId" | "revision" | "createdAt" | "expiresAt" | "targetAcceptedAt" | "terminalAt"
  > {
  return (
    typeof value.id === "string" &&
    typeof value.fromUserId === "string" &&
    typeof value.toUserId === "string" &&
    typeof value.revision === "string" &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.expiresAt) &&
    isNullableString(value.targetAcceptedAt) &&
    isNullableString(value.terminalAt)
  );
}

function parseOwnershipTransfer(value: unknown): OwnershipTransferView | null {
  if (!isRecord(value) || !hasOwnershipTransferShape(value)) return null;
  const { id, fromUserId, toUserId, state, revision, createdAt, expiresAt, targetAcceptedAt, terminalAt } = value;
  if (!isOwnershipTransferState(state)) return null;
  const reason = value.terminalReason;
  if (reason !== null && !isOwnershipTransferTerminalReason(reason)) return null;
  return {
    id,
    fromUserId,
    toUserId,
    state,
    revision,
    createdAt,
    expiresAt,
    targetAcceptedAt,
    terminalAt,
    terminalReason: reason,
  };
}

function parseOwnershipTransferProjection(body: unknown): OwnershipTransferProjectionView | null {
  if (!isRecord(body)) return null;
  const live = body.live === null ? null : parseOwnershipTransfer(body.live);
  const latestOutcome = body.latestOutcome === null ? null : parseOwnershipTransfer(body.latestOutcome);
  if ((body.live !== null && live === null) || (body.latestOutcome !== null && latestOutcome === null)) return null;
  return { live, latestOutcome };
}

function parseOwnershipTransferOutcome(body: unknown): OwnershipTransferOutcomeView | null {
  if (!isRecord(body)) return null;
  const request = parseOwnershipTransfer(body.request);
  return request === null ? null : { kind: "applied", request };
}

/** A committed terminal outcome is the one non-ok response this client reads as a success. Its code
 *  is what distinguishes it from an ordinary conflict, which stays a rejection. */
async function readCeremonyResult(response: Response): Promise<TeamAccessResult<OwnershipTransferOutcomeView>> {
  if (response.status === 409) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    if (isRecord(body) && body.code === "OWNERSHIP_TRANSFER_TERMINAL" && isOwnershipTransferState(body.state)) {
      const reason = body.reason;
      return {
        kind: "ok",
        status: response.status,
        value: {
          kind: "terminal",
          state: body.state,
          reason: isOwnershipTransferTerminalReason(reason) ? reason : null,
        },
      };
    }
  }
  return readCommandResult(response, parseOwnershipTransferOutcome);
}

export const ownershipTransferAccess = {
  async readOwnershipTransfer(workspaceId: string): Promise<TeamAccessResult<OwnershipTransferProjectionView>> {
    return readResult(await accountClient.readOwnershipTransfer(workspaceId), parseOwnershipTransferProjection);
  },

  async initiateOwnershipTransfer(input: {
    workspaceId: string;
    targetPrincipalId: string;
    replaces?: { requestId: string; revision: string } | undefined;
  }): Promise<TeamAccessResult<OwnershipTransferOutcomeView>> {
    return readCeremonyResult(await accountClient.initiateOwnershipTransfer(input));
  },

  async commandOwnershipTransfer(input: {
    workspaceId: string;
    requestId: string;
    step: OwnershipTransferStep;
    expectedRevision: string;
  }): Promise<TeamAccessResult<OwnershipTransferOutcomeView>> {
    return readCeremonyResult(await accountClient.commandOwnershipTransfer(input));
  },
};

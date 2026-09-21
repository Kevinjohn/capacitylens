import type { IsoInstant, PrincipalId, WorkspaceId } from "./types";

/**
 * The durable workflow states of an ownership transfer.
 *
 * Ownership moves through a three-party ceremony — the Owner nominates, the nominated Admin
 * consents, the same Owner gives final approval — so the workflow spans sessions and days and
 * cannot be a single mutation. Only the two live states accept transitions; every other state is
 * terminal and immutable, because a terminal row is the durable evidence a participant who was
 * offline reads to learn what happened.
 *
 * `expired` and `invalidated` are MATERIALISED, not derived. A read may show that a row is
 * effectively expired, but the unique-live-slot guarantee is a partial unique index over the two
 * live states, and SQLite cannot express a time-dependent partial index against the current clock.
 * So a command that observes a passed deadline commits `expired` before doing anything else.
 */
export const OWNERSHIP_TRANSFER_STATES = Object.freeze([
  "awaiting_target",
  "awaiting_owner",
  "declined",
  "cancelled",
  "expired",
  "invalidated",
  "completed",
] as const);

export type OwnershipTransferState = (typeof OWNERSHIP_TRANSFER_STATES)[number];

/** The two states that hold the company's single live-request slot. */
export const LIVE_OWNERSHIP_TRANSFER_STATES = Object.freeze(["awaiting_target", "awaiting_owner"] as const);

export type LiveOwnershipTransferState = (typeof LIVE_OWNERSHIP_TRANSFER_STATES)[number];

export function isOwnershipTransferState(value: unknown): value is OwnershipTransferState {
  return typeof value === "string" && (OWNERSHIP_TRANSFER_STATES as readonly string[]).includes(value);
}

export function isLiveOwnershipTransferState(state: OwnershipTransferState): state is LiveOwnershipTransferState {
  return (LIVE_OWNERSHIP_TRANSFER_STATES as readonly string[]).includes(state);
}

/** The wire shape of a committed terminal outcome: a 409 whose code identifies the ceremony as
 *  DONE rather than rejected, carrying one of the non-live terminal states. Both HTTP clients that
 *  decode this response (the ceremony reader and the generic unknown-outcome classifier) share this
 *  predicate so they cannot drift — a malformed code or a live state must never match either. */
export function isOwnershipTransferTerminalOutcomeBody(
  body: Record<string, unknown>,
): body is Record<string, unknown> & { code: "OWNERSHIP_TRANSFER_TERMINAL"; state: OwnershipTransferState } {
  return (
    body.code === "OWNERSHIP_TRANSFER_TERMINAL" &&
    isOwnershipTransferState(body.state) &&
    !isLiveOwnershipTransferState(body.state)
  );
}

/**
 * The state-changing commands. These are explicit transitions rather than a generic
 * `PATCH {state}` on purpose: they are security-sensitive, each has a different authorised caller,
 * and a generic patch would invite invalid caller/state combinations and spread policy through
 * request parsing.
 */
export const OWNERSHIP_TRANSFER_ACTIONS = Object.freeze([
  "initiate",
  "accept",
  "withdraw",
  "decline",
  "cancel",
  "complete",
] as const);

export type OwnershipTransferAction = (typeof OWNERSHIP_TRANSFER_ACTIONS)[number];

/** Why a request reached a terminal state without the roles being exchanged. Bounded on purpose:
 *  it is persisted and surfaced to a participant, so it must never carry free text or identifiers. */
export const OWNERSHIP_TRANSFER_TERMINAL_REASONS = Object.freeze([
  "target_declined",
  "owner_cancelled",
  "replaced",
  "deadline_passed",
  "initiator_not_owner",
  "target_not_admin",
  "participant_membership_changed",
  "account_erased",
  "owner_repaired",
] as const);

export type OwnershipTransferTerminalReason = (typeof OWNERSHIP_TRANSFER_TERMINAL_REASONS)[number];

/**
 * The permitted transitions, keyed by the state a command is applied to.
 *
 * `withdraw` returning `awaiting_owner` → `awaiting_target` is deliberately NOT a decline: it
 * removes the "accepted forever" trap without discarding the Owner's original nomination, so the
 * nominee may accept again before the deadline. Because accept → withdraw → accept returns to a
 * state it already held, a monotonic revision — not the state alone — is what stops a delayed
 * command from applying to a later acceptance cycle.
 */
const PERMITTED_TRANSITIONS = {
  awaiting_target: Object.freeze(["accept", "decline", "cancel"] as const),
  awaiting_owner: Object.freeze(["withdraw", "complete", "cancel"] as const),
  declined: Object.freeze([] as const),
  cancelled: Object.freeze([] as const),
  expired: Object.freeze([] as const),
  invalidated: Object.freeze([] as const),
  completed: Object.freeze([] as const),
} as const satisfies Record<OwnershipTransferState, readonly OwnershipTransferAction[]>;

/**
 * May `action` be applied to a request currently in `state`?
 *
 * Purely structural: it answers "is this a legal edge of the state machine", never "is this caller
 * allowed" (see {@link canActOnOwnershipTransfer}) and never "has the deadline passed" (a live row
 * past its deadline is terminalised first, and the command then applies to `expired`, which accepts
 * nothing). Both other questions are asked separately because collapsing them would make an
 * authorisation failure indistinguishable from a state conflict, and the two must not share a
 * response: one is non-mutating, the other terminalises.
 *
 * `initiate` is absent from every row because it creates a request rather than transitioning one.
 */
export function canTransitionOwnershipTransfer(
  state: OwnershipTransferState,
  action: OwnershipTransferAction,
): boolean {
  const permitted: readonly OwnershipTransferAction[] = PERMITTED_TRANSITIONS[state];
  return permitted.includes(action);
}

/** The state a successful `action` moves a request to. `null` when the edge is not permitted, so a
 *  caller cannot accidentally read a destination for a transition that may not happen. */
export function nextOwnershipTransferState(
  state: OwnershipTransferState,
  action: OwnershipTransferAction,
): OwnershipTransferState | null {
  if (!canTransitionOwnershipTransfer(state, action)) return null;
  switch (action) {
    case "accept":
      return "awaiting_owner";
    case "withdraw":
      return "awaiting_target";
    case "decline":
      return "declined";
    case "cancel":
      return "cancelled";
    case "complete":
      return "completed";
    case "initiate":
      return null;
  }
}

/** One transfer request as any participant-facing projection sees it. Display identity is resolved
 *  from the membership and identity projections at read time: no name or email is ever copied into
 *  the workflow row, so the ceremony creates no second store of personal data. */
export interface OwnershipTransferRequest {
  id: string;
  accountId: WorkspaceId;
  initiatorUserId: PrincipalId;
  targetUserId: PrincipalId;
  state: OwnershipTransferState;
  /** Monotonic workflow revision. Every state-changing command supplies the value it was authorised
   *  against, so a command formed against an earlier acceptance cycle cannot apply to a later one. */
  revision: string;
  createdAt: IsoInstant;
  expiresAt: IsoInstant;
  targetAcceptedAt: IsoInstant | null;
  terminalAt: IsoInstant | null;
  terminalReason: OwnershipTransferTerminalReason | null;
}

/**
 * What the ceremony read returns to one caller.
 *
 * Two independently nullable projections rather than a history list: the live request, and the most
 * recent terminal outcome this caller took part in. The second exists because an offline
 * participant must be able to tell a decline from a cancellation, an expiry and an invalidation —
 * a live-only read would hand them `null` for all four.
 */
export interface OwnershipTransferProjection {
  live: OwnershipTransferRequest | null;
  latestOutcome: OwnershipTransferRequest | null;
}

/**
 * The result of a state-changing command.
 *
 * `terminal` is a COMMITTED outcome, not a failure. The mutation boundary runs `execute`, the
 * command-ledger completion and the audit write in one transaction and rolls all three back when
 * `execute` throws, so an invalidation written and then thrown would be silently undone and the
 * request would stay live, holding the company's only slot. Returning the terminal state instead
 * commits it with its own audit event; the HTTP layer maps it to a conflict.
 *
 * An unauthorised caller and a retryable infrastructure failure are NEITHER of these: they throw,
 * and they leave the workflow untouched. A different Admin submitting a command against someone
 * else's request must not be able to destroy that ceremony.
 */
export type OwnershipTransferOutcome =
  | { kind: "applied"; request: OwnershipTransferRequest }
  | { kind: "terminal"; state: OwnershipTransferState; reason: OwnershipTransferTerminalReason };

import { parseISOTimestamp } from "../lib/integrity";
import type { OwnershipTransferAction } from "./ownershipTransfer";
import type { Role } from "./types";

/**
 * How long a nomination stays open, from initiation. Seven days is long enough for an
 * administrative handover across two people's working schedules, and short enough that a forgotten
 * request is not a latent elevation path. Acceptance does NOT extend it: the deadline bounds the
 * whole ceremony, not the wait for any one step.
 *
 * The single source for both the server's deadline arithmetic and the interface's explanation of
 * it. Embedding the number independently in either would let them drift, and a UI that promises a
 * different deadline from the one the server enforces is worse than no promise.
 */
export const OWNERSHIP_TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long a terminal request row is retained before it is swept.
 *
 * Deliberately longer than the account command ledger's 30-day replay horizon, and deliberately
 * distinct from it: the row explains an outcome to a participant, while the ledger replays a
 * receipt. After the ledger horizon a repeated command is a new attempt and receives the current
 * deterministic result; the retained row still says what happened. The durable audit events outlive
 * both under audit policy.
 */
export const OWNERSHIP_TRANSFER_HISTORY_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/** Has a request with this deadline passed it? The bound is exclusive: a request is live for every
 *  instant strictly before `expiresAt`, so the deadline instant itself is already expired. Both
 *  values are server-generated ISO instants; a client clock never participates. */
export function isOwnershipTransferExpired(expiresAt: string, now: number): boolean {
  // Parsed by the repository's own ISO reader rather than `Date.parse`, which accepts shapes the
  // rest of the codebase rejects; `inviteIsExpired` reads its deadline the same way.
  const deadline = parseISOTimestamp(expiresAt);
  // An unparseable deadline is treated as passed. A row whose deadline cannot be read is not
  // evidence that the request is still live, and failing closed here costs at most one restart of
  // a rare ceremony, where failing open would leave a nomination open indefinitely.
  return deadline === null || now >= deadline;
}

export interface OwnershipTransferActorStanding {
  /** The caller's CURRENT active role in the company, re-read inside the transaction. */
  callerRole: Role;
  /** Is the caller the Owner who proposed this request? */
  isInitiator: boolean;
  /** Is the caller the Admin this request nominates? */
  isTarget: boolean;
}

/**
 * May this caller perform this ceremony action?
 *
 * Role tier alone can never answer this. The nominated Admin's own consent (accept, withdraw,
 * decline) is performed at Admin tier, so a tier-only rule would let EVERY Admin consent on the
 * nominee's behalf — which is precisely the consent the ceremony exists to obtain. Participant
 * identity is therefore part of the predicate, not a separate courtesy check.
 *
 * The two sides are deliberately asymmetric:
 *
 * - `initiate`, `cancel` and `complete` belong to the current Owner. `complete` is the second
 *   deliberate act by the same person who proposed, which is what makes the ceremony three actions
 *   rather than two.
 * - `accept`, `withdraw` and `decline` belong to the nominated Admin and to nobody else. The role
 *   must be exactly `admin`: a nominee who has since been promoted or demoted is no longer the
 *   person whose consent was sought, and a nominee who somehow became Owner is a broken invariant,
 *   not a valid consent.
 *
 * This is a pure predicate over facts the caller must read transactionally. It is necessary, never
 * sufficient: the server still asserts the account's administrative threshold and the fresh
 * administrative assurance separately, and UI visibility is never the authorisation mechanism.
 */
export function canActOnOwnershipTransfer(
  action: OwnershipTransferAction,
  { callerRole, isInitiator, isTarget }: OwnershipTransferActorStanding,
): boolean {
  switch (action) {
    case "initiate":
      return callerRole === "owner";
    case "cancel":
    case "complete":
      return callerRole === "owner" && isInitiator;
    case "accept":
    case "withdraw":
    case "decline":
      return callerRole === "admin" && isTarget;
  }
}

/** May this caller see this request at all? Participants only — a transfer in progress, and who it
 *  names, is not ordinary member-management information, so other Admins and every lower role read
 *  nothing rather than a redacted something. */
export function canReadOwnershipTransfer({
  isInitiator,
  isTarget,
}: Pick<OwnershipTransferActorStanding, "isInitiator" | "isTarget">): boolean {
  return isInitiator || isTarget;
}

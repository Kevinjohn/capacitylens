import { createHash, randomBytes } from "node:crypto";

/** One-way lookup key for an invite bearer. Domain separation prevents cross-protocol reuse. */
export function inviteTokenHash(token: string): string {
  return createHash("sha256").update("capacitylens-invite\0").update(token).digest("base64url");
}

/**
 * Mint a fresh NON-SECRET invite id (P1.11) — a `randomBytes`-based value DISTINCT from the bearer
 * token. It need not be unguessable (it grants nothing on its own — list/revoke also key on
 * `accountId`), but it must be collision-resistant so two invites of one account get distinct ids;
 * 16 random bytes is ample. Kept SEPARATE from the token generator so the two are never confused.
 *
 * @returns A base64url-encoded random id for an invite row.
 */
export function newInviteId(): string {
  return randomBytes(16).toString("base64url");
}

import type { Role } from "@capacitylens/shared/account/types";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import { inviteTokenHash } from "../controlTables";
import { isKnownRole } from "./members.model";

/**
 * Revoke EVERY outstanding invite of one account in a single statement — the bulk revoke the per-tenant
 * erasure (P2.6b) runs when an account is hard-deleted. Mirrors {@link revokeInvite} but drops all of
 * the account's invites at once: `invites` carries NO FK to `accounts` (see {@link ensureControlTables}),
 * so the AppData delete-cascade never reaches it — without this an erased account leaves live,
 * role-bearing invite tokens behind.
 *
 * IDEMPOTENT: an account with no invites is a no-op. The `accountId = ?` predicate is the CROSS-TENANT
 * guard — it can only ever delete invites of the named account.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account whose invites to revoke entirely.
 */
export function removeAllInvitesForAccount(db: Db, accountId: string): void {
  db.prepare(`DELETE FROM invites WHERE accountId = ?`).run(accountId);
}

/**
 * One row of the `invites` control table (P1.9): a single-use, expiring link that, when accepted by
 * a signed-in caller, binds {@link role} to that caller's membership of {@link accountId}.
 *
 * @property token         The opaque, unguessable invite secret — the link's `:token` segment.
 *   NEVER STORED: only `inviteTokenHash(token)` persists, and that hash is the table's PRIMARY KEY.
 *   Treat it like a password: never log it, never return it on a read path.
 * @property id            A NON-SECRET handle (P1.11), distinct from {@link token}. list/revoke key on
 *   THIS, so the bearer `token` is write-once: minted + returned to the authorised creator and never
 *   read back. Safe to surface on a read path (it grants nothing on its own).
 * @property accountId     The account a successful accept joins the caller to.
 * @property role          The {@link Role} the accept binds (see shared/domain/access for semantics).
 * @property preauthEmail  An OPTIONAL pre-authorised email. `null` in P1.9 (any signed-in caller may
 *   accept); P1.10 will require the caller's verified email to match this when non-null.
 * @property expiresAt     ISO-8601 instant after which the invite is rejected (410).
 * @property usedAt        ISO-8601 instant the invite was consumed, or `null` while unused. A
 *   non-null value is the single-use marker — a second accept is rejected (409).
 * @property createdAt     ISO-8601 timestamp the invite was minted.
 *
 * This is a CONTROL-table type, never an AppData entity; it never flows through the entity drift path.
 */
export interface Invite {
  token: string;
  id: string;
  accountId: string;
  role: Role;
  preauthEmail: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

/**
 * Persist a new invite. The write the create endpoint (POST /api/invites) uses after generating the
 * token + computing the TTL.
 *
 * @param db      The open SQLite handle.
 * @param invite  The invite to insert (token is its PRIMARY KEY).
 * @throws Error  If `invite.role` is not a known {@link Role} — a bad role is a programming/integrity
 *   fault, not a recoverable request condition, so fail LOUD (mirrors {@link upsertMember}) rather
 *   than silently coercing it and minting an invite that grants the wrong access level.
 */
export function createInvite(db: Db, invite: Invite): void {
  if (!isKnownRole(invite.role)) {
    throw new Error(
      `createInvite: unknown role ${JSON.stringify(invite.role)} — expected owner, admin, editor, or viewer.`,
    );
  }
  db.prepare(
    `INSERT INTO invites (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    inviteTokenHash(invite.token),
    invite.id,
    invite.accountId,
    invite.role,
    invite.preauthEmail,
    invite.expiresAt,
    invite.usedAt,
    invite.createdAt,
  );
}

/**
 * Resolve one invite by its token, or `null` if no such token exists. The lookup the accept endpoint
 * (POST /api/invites/:token/accept) uses before validating used/expired and binding the membership.
 *
 * @param db     The open SQLite handle.
 * @param token  The invite token (the link's `:token` segment).
 * @returns The {@link Invite}, or `null` when no row has that token.
 */
export function getInvite(db: Db, token: string): Invite | null {
  const row = db
    .prepare(`SELECT id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt FROM invites WHERE tokenHash = ?`)
    .get(inviteTokenHash(token)) as
    | {
        id: string;
        accountId: string;
        role: string;
        preauthEmail: string | null;
        expiresAt: string;
        usedAt: string | null;
        createdAt: string;
      }
    | undefined;
  if (!row) return null;
  // Map the row explicitly (mirrors upsertMember/listMembershipsForUser's row→object discipline) so
  // the returned object carries the precise Role union, not the raw TEXT column. A stored role that
  // is not a known Role is a control-table integrity fault (every write goes through createInvite's
  // guard) — fail LOUD rather than hand back a mistyped, access-granting role.
  if (!isKnownRole(row.role)) {
    throw new Error(
      `getInvite: stored role ${JSON.stringify(row.role)} for token is not a known role — control table corrupted.`,
    );
  }
  return {
    token,
    id: row.id,
    accountId: row.accountId,
    role: row.role,
    // Coerce SQLite's nullable cols to a real `null` (node:sqlite yields null already, but pin the
    // contract so the type is honest and a future driver change can't leak `undefined`).
    preauthEmail: row.preauthEmail ?? null,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * Normalize an email for preauth comparison: trim + lowercase. Both the stored `preauthEmail`
 * (normalized once at create time) and the caller's verified email (normalized at accept time) pass
 * through this, so the match is always normalized-vs-normalized — case and surrounding whitespace
 * never cause a legitimate match to slip through (or, worse, a near-miss to bind the wrong account).
 *
 * Pure: no I/O. Deliberately NOT a full RFC validator — local-parts are case-sensitive in the
 * abstract, but in practice every mail provider folds them, and the IdP-returned verified address is
 * the trust anchor here, so casefolding is the right comparison for binding.
 *
 * @param email  The raw email (from a request body, or from an IdP-asserted session user).
 * @returns The trimmed, lowercased form used for storage and comparison.
 */
export function normalizeEmail(email: string): string {
  return normalizeAccountEmail(email);
}

/**
 * May this signed-in principal accept this invite? The PURE security-matrix decision behind the
 * accept endpoint's email-preauth gate (P1.10) — extracted so the matrix is deterministically
 * unit-testable without spinning up a session/DB.
 *
 * - `preauthEmail === null` → `true` (a LINK invite: any signed-in caller may accept — P1.9
 *   behaviour, preserved).
 * - `preauthEmail !== null` → the normalized email must match. SSO additionally requires
 *   `user.emailVerified === true`; password mode does not, because possession of the addressed
 *   invite is the verification ceremony in deployments with no outbound verification service.
 *
 * Pure: no I/O, no session lookup — the caller passes the already-resolved principal. A `false`
 * result MUST translate to a 403 that binds nothing and consumes nothing (the invite stays live for
 * the genuinely-matching caller). Nothing is ever emailed.
 *
 * @param preauthEmail  The invite's pre-authorised email (already normalized), or `null` for a link
 *   invite.
 * @param user          The resolved signed-in principal — its email and, for SSO, the
 *   load-bearing IdP-asserted `emailVerified` flag.
 * @param passwordMode  Whether invite possession substitutes for email verification.
 * @returns `true` if this principal may accept this invite, `false` otherwise.
 */
export function preauthInviteAllows(
  preauthEmail: string | null,
  user: { email: string; emailVerified: boolean },
  passwordMode = false,
): boolean {
  if (preauthEmail === null) return true; // link invite: any signed-in caller (P1.9)
  // Password deployments have no outbound verification service: possession of the
  // email-addressed invite is their verification ceremony. SSO still requires the IdP's verified
  // email claim. Both sides are normalized before the exact comparison.
  return (passwordMode || user.emailVerified === true) && normalizeEmail(user.email) === preauthEmail;
}

/**
 * A light, deterministic email-shape check for the create endpoint — a single `@` separating a
 * non-empty local part from a non-empty domain. DELIBERATELY not a full RFC 5322 validator: its only
 * job is to reject obvious junk (no `@`, empty side, multiple `@`) before storing a preauth email, so
 * a malformed value can't mint an invite that could never bind. The trust anchor for the actual
 * binding is the signed-in identity plus the bearer invite; SSO additionally requires the IdP's
 * verified-email assertion.
 *
 * @param email  The (already trimmed) candidate email.
 * @returns `true` if it has a single `@` with non-empty local + domain parts.
 */
export function looksLikeEmail(email: string): boolean {
  return isAccountEmail(email);
}

/**
 * Mark an invite consumed — the single-use stamp the accept endpoint runs (in the SAME transaction
 * as the membership it mints, so the bind and the consume commit together or not at all).
 *
 * The `AND usedAt IS NULL` clause is the single-use SQL BACKSTOP: even if two accepts race past the
 * handler's `usedAt !== null` check, only the first UPDATE matches an unused row, so the token can be
 * consumed at most once. (The handler's check is the friendly 409; this is the hard guarantee.)
 *
 * @param db      The open SQLite handle.
 * @param token   The invite token to consume.
 * @param usedAt  The ISO-8601 instant to stamp as the consumption time.
 */
export class InviteAlreadyUsedError extends Error {
  constructor() {
    super("This invite has already been used.");
    this.name = "InviteAlreadyUsedError";
  }
}

export function markInviteUsed(db: Db, token: string, usedAt: string): void {
  const result = db
    .prepare(`UPDATE invites SET usedAt = ? WHERE tokenHash = ? AND usedAt IS NULL`)
    .run(usedAt, inviteTokenHash(token));
  if (result.changes !== 1) throw new InviteAlreadyUsedError();
}

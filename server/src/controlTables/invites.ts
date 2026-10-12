import type { Role } from "@capacitylens/shared/account/types";
import { isAccountEmail, normalizeAccountEmail } from "@capacitylens/shared/account/validation";
import type { Db } from "../db";
import { inviteTokenHash } from "./inviteTokens";
import { isKnownRole } from "./members.model";
import { removeInvitationPersonProposalsForAccount } from "./invitationPersonProposals";

/**
 * Revoke every outstanding invite of one account in a single statement, the bulk revoke the per-tenant
 * erasure runs when an account is hard-deleted. Mirrors {@link revokeInvite} but drops all of
 * the account's invites at once: `invites` carries no FK to `accounts` (see {@link ensureControlTables}),
 * so the AppData delete-cascade never reaches it, without this an erased account leaves live,
 * role-bearing invite tokens behind.
 *
 * Idempotent: an account with no invites is a no-op. The `accountId = ?` predicate is the cross-tenant
 * guard. It can only ever delete invites of the named account.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account whose invites to revoke entirely.
 */
export function removeAllInvitesForAccount(db: Db, accountId: string): void {
  db.prepare(`DELETE FROM invites WHERE accountId = ?`).run(accountId);
  removeInvitationPersonProposalsForAccount(db, accountId);
}

/**
 * One row of the `invites` control table: a single-use, expiring link that, when accepted by
 * a signed-in caller, binds {@link role} to that caller's membership of {@link accountId}.
 *
 * @property token         The opaque, unguessable invite secret, the link's `:token` segment.
 * Never stored: only `inviteTokenHash(token)` persists, and that hash is the table's PRIMARY KEY.
 * Treat it like a password: never log it, never return it on a read path.
 * @property id            A non-secret handle, distinct from {@link token}. list/revoke key on
 * this, so the bearer `token` is write-once: minted + returned to the authorised creator and never
 * read back. Safe to surface on a read path (it grants nothing on its own).
 * @property accountId     The account a successful accept joins the caller to.
 * @property role          The {@link Role} the accept binds (see shared/domain/access for semantics).
 * @property preauthEmail  An optional pre-authorised email. `null` means any signed-in caller may
 * accept; otherwise the caller's verified email must match it.
 * @property expiresAt     ISO-8601 instant after which the invite is rejected (410).
 * @property usedAt        ISO-8601 instant the invite was consumed, or `null` while unused. A
 * non-null value is the single-use marker. A second accept is rejected (409).
 * @property createdAt     ISO-8601 timestamp the invite was minted.
 *
 * This is a control-table type, never an AppData entity; it never flows through the entity drift path.
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

/** Persists an invite using a digest of its bearer token as the primary key.
 * @throws When the role is unknown, indicating caller or control-table corruption.
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
  // guard): fail loud rather than hand back a mistyped, access-granting role.
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

/** Read only the fields needed to recheck a callback-bound invitation without its bearer token. */
export function getInviteTargetById(
  db: Db,
  id: string | null,
): Pick<Invite, "accountId" | "preauthEmail" | "expiresAt" | "usedAt"> | null {
  if (!id) return null;
  return (
    (db.prepare(`SELECT accountId, preauthEmail, expiresAt, usedAt FROM invites WHERE id = ?`).get(id) as
      Pick<Invite, "accountId" | "preauthEmail" | "expiresAt" | "usedAt"> | undefined) ?? null
  );
}

/** Returns a new trimmed, lowercase email string for the application’s address comparison policy.
 * Pure; this intentionally treats the local part as case-insensitive and is not RFC address validation.
 */
export function normalizeEmail(email: string): string {
  return normalizeAccountEmail(email);
}

interface PreauthInviteAllowsInput {
  preauthEmail: string | null;
  user: { email: string; emailVerified: boolean };
  passwordMode?: boolean | undefined;
}

/** Checks whether the resolved principal may accept an invitation.
 * Link invitations accept any resolved principal. Addressed invitations require a normalized email match and, outside password mode, verified email.
 * A refusal consumes nothing.
 */
export function preauthInviteAllows({ preauthEmail, user, passwordMode = false }: PreauthInviteAllowsInput): boolean {
  // Link invites are not bound to an email address.
  if (preauthEmail === null) return true;
  // Password mode accepts addressed-invite possession as proof; other modes require verified email.
  return (passwordMode || user.emailVerified) && normalizeEmail(user.email) === preauthEmail;
}

/**
 * A light, deterministic email-shape check for the create endpoint, a single `@` separating a
 * non-empty local part from a non-empty domain. Deliberately not a full RFC 5322 validator: its only
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

/** Signals that an invitation was already consumed; callers must report a conflict without changing membership. */
export class InviteAlreadyUsedError extends Error {
  constructor() {
    super("This invite has already been used.");
    this.name = "InviteAlreadyUsedError";
  }
}

/** Consumes an unused invite inside the caller’s membership transaction.
 * @throws InviteAlreadyUsedError when no unused row matches, so the caller must roll back membership admission. */
export function markInviteUsed(db: Db, token: string, usedAt: string): void {
  const result = db
    .prepare(`UPDATE invites SET usedAt = ? WHERE tokenHash = ? AND usedAt IS NULL`)
    .run(usedAt, inviteTokenHash(token));
  if (result.changes !== 1) throw new InviteAlreadyUsedError();
}

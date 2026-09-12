import type { Role } from "@capacitylens/shared/account/types";
import type { Db } from "../db";
import { terminaliseLiveRequestsForAccount, terminaliseLiveRequestsForMember } from "./ownershipTransfers";
import { revokeResetTokensForUser } from "../auth";
import { bumpSecurityRevision } from "../accounts/state";
import { removeMemberSignInTrackingForAccount } from "../accounts/memberSignInTracking";
import { cachedStatement } from "./preparedStatement";
import {
  isKnownRole,
  toAccountMember,
  type AccountMember,
  type AccountMemberRow,
  type MembershipStatus,
} from "./members.model";

/**
 * What a membership write should do to the live ownership-transfer requests naming this principal.
 *
 * `"invalidate"` — the default and the answer for every ordinary write — ends them: a demotion,
 * promotion, status change or removal means the person whose consent the ceremony holds is no
 * longer the person it names. `"keep"` belongs to ONE caller, the ownership exchange kernel, whose
 * two role writes ARE the ceremony completing; without it, completion would invalidate the request
 * it is in the middle of applying.
 *
 * Passed explicitly rather than carried in module state, so the exemption is visible at the call
 * site that claims it and cannot be turned on for a write that never asked for it.
 */
export type LiveTransferHandling = "invalidate" | "keep";

// A migration-era handle has no v41 table yet; the terminaliser itself answers "nothing to end"
// rather than throwing, so only the completion exemption is decided here.
function terminaliseMemberTransfers(db: Db, accountId: string, userId: string): string[] {
  return terminaliseLiveRequestsForMember({
    db,
    accountId,
    userId,
    reason: "participant_membership_changed",
    now: new Date().toISOString(),
  });
}

/**
 * Insert a membership, or update the role/status of an existing `(accountId, userId)`. `createdAt`
 * is the JOIN timestamp and is **preserved** on a role/status change (it is set ONCE, on the first
 * insert) — so a role change or ownership transfer never re-orders the member list (which sorts by
 * createdAt) nor rewrites a member's displayed "joined" date. The idempotent write the permissioned
 * member-management endpoints (P1.5) use: re-inviting an existing member just changes their role
 * rather than erroring on the PK conflict.
 *
 * @param db      The open SQLite handle.
 * @param member  The membership to upsert.
 * @throws Error  If `member.role` is not a known {@link Role}. A bad role is a programming/integrity
 *   fault, not a recoverable request condition — fail LOUD (mirroring the store's deliberate
 *   integrity throws) rather than silently coercing it to a default, which would hand someone the
 *   wrong access level.
 */
export function upsertMember(db: Db, member: AccountMember, transfers: LiveTransferHandling = "invalidate"): string[] {
  if (!isKnownRole(member.role)) {
    throw new Error(
      `upsertMember: unknown role ${JSON.stringify(member.role)} — expected owner, admin, editor, or viewer.`,
    );
  }
  // Read the membership BEFORE the upsert: SQLite counts a row it matched as changed even when the
  // values written are identical, so an unguarded write would let anyone end a live nomination by
  // re-applying the role its participant already holds — repeatedly, and with nothing to show for
  // it. The same distinction setMemberStatus already draws between "changed" and "unchanged".
  const previous = getMembershipRow(db, member.accountId, member.userId);
  const changed = previous === null || previous.role !== member.role || previous.status !== member.status;
  db.prepare(
    `INSERT INTO account_members (accountId, userId, role, status, createdAt, signInConfirmed)
     VALUES (?, ?, ?, ?, ?, CASE WHEN EXISTS (
       SELECT 1 FROM account_member_sign_in_tracking WHERE accountId = ?
     ) THEN 'false' ELSE NULL END)
     ON CONFLICT(accountId, userId) DO UPDATE SET
       role = excluded.role, status = excluded.status`,
  ).run(member.accountId, member.userId, member.role, member.status, member.createdAt, member.accountId);
  // P1.18 (TOCTOU close): a password-reset link is authorized at MINT time against the user's
  // membership snapshot THEN — so ANY membership write for this user (a role change, becoming the
  // owner of a new org, even a lateral move) invalidates that
  // authorization and must burn their outstanding reset links, else a link minted while they were
  // lower-tier could redeem into the elevated identity. Centralised HERE, at the single membership
  // -write choke point, precisely so no elevation path (PATCH role, transfer-ownership, invite
  // accept, POST /api/orgs) can forget it — the sprinkle-at-each-callsite approach missed two.
  // No-op when the user holds no reset token (the common case: fresh membership) or in OFF mode
  // (no Better Auth tables). The reset-token implementation remains identity-owned in auth.ts.
  // Deliberately unconditional, unlike the ceremony below: the reset-link and security-revision
  // protocol is this path's TOCTOU close, it is pinned by the late-auth probe test, and narrowing
  // it is a change to that security decision rather than to this ceremony. A live nomination is
  // different — ending one is visible to two people and undoes work, so it needs a real change.
  revokeResetTokensForUser(db, member.userId);
  bumpSecurityRevision(db, member.userId);
  return changed && transfers === "invalidate" ? terminaliseMemberTransfers(db, member.accountId, member.userId) : [];
}

interface SetMemberStatusInput {
  db: Db;
  accountId: string;
  userId: string;
  status: MembershipStatus;
}

/**
 * Move an EXISTING membership between lifecycle states, leaving its role and join date untouched.
 *
 * Distinct from {@link upsertMember} on purpose: that helper is the create/role-change path and
 * needs a role plus a join timestamp, neither of which a disable/archive/restore knows or should
 * overwrite. It shares upsertMember's post-write security handling, and for the same reason: the
 * status column is exactly what {@link getActiveMemberRole} narrows on, so flipping it changes the
 * authority the user holds. That must burn any outstanding password-reset link (a link minted while
 * they were an active member must not redeem into a non-active one) and bump the security revision
 * so live sessions re-resolve their membership instead of coasting on a cached one.
 *
 * @param input The named inputs for this operation.
 * @param input.db         The open SQLite handle.
 * @param input.accountId  The account whose membership is changing.
 * @param input.userId     The login whose membership is changing.
 * @param input.status     The {@link MembershipStatus} to move to.
 * @returns Which of the three outcomes occurred. `"missing"` is NOT_FOUND to callers — an absent
 *   membership must never report a committed lifecycle change. `"unchanged"` is a SUCCESS: the
 *   membership already holds the requested status, so the caller's intent is satisfied. The three
 *   are distinguished rather than collapsed to a boolean precisely because "no row" and "no change"
 *   demand opposite responses, and because a re-applied status must not pay the security cost below.
 */
export function setMemberStatus({ db, accountId, userId, status }: SetMemberStatusInput): {
  outcome: "changed" | "unchanged" | "missing";
  invalidatedTransferIds: string[];
} {
  // `AND status <> ?` makes a same-value write matchless, which is what keeps the security protocol
  // below off the no-op path: SQLite counts a row it MATCHED as changed even when the value written
  // is identical, so an unguarded UPDATE would burn an unrelated admin's freshly-minted reset link
  // every time anyone re-applied a status the member already had.
  const changed =
    db
      .prepare(
        `UPDATE account_members
            SET status = ?,
                signInConfirmed = CASE WHEN signInConfirmed IS NULL THEN NULL ELSE 'false' END
          WHERE accountId = ? AND userId = ? AND status <> ?`,
      )
      .run(status, accountId, userId, status).changes > 0;
  if (!changed) {
    // Matchless: either the membership is absent, or it already holds this status. Only the second
    // is success, so distinguish them with a read rather than guessing.
    return {
      outcome: getMembershipRow(db, accountId, userId) === null ? "missing" : "unchanged",
      invalidatedTransferIds: [],
    };
  }
  revokeResetTokensForUser(db, userId);
  bumpSecurityRevision(db, userId);
  return { outcome: "changed", invalidatedTransferIds: terminaliseMemberTransfers(db, accountId, userId) };
}

const membershipRowStatement = cachedStatement(
  `SELECT accountId, userId, role, status, createdAt FROM account_members
        WHERE accountId = ? AND userId = ?`,
);
const memberRoleStatement = cachedStatement(`SELECT role FROM account_members WHERE accountId = ? AND userId = ?`);
const activeMemberRoleStatement = cachedStatement(`
    SELECT role FROM account_members
     WHERE accountId = ? AND userId = ? AND status = 'active'
  `);

/**
 * Read ONE membership row, whatever its lifecycle status.
 *
 * The status-agnostic counterpart to {@link getActiveMemberRole}, and deliberately NOT a substitute
 * for it: this helper answers "does this relationship exist?" (administration, lifecycle), never
 * "what authority does this login hold?" (authorization). A disabled or archived row is a real
 * membership that an administrator must still be able to see, restore and remove — and one that
 * must confer nothing. Callers that narrow authority keep using {@link getActiveMemberRole}.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account to look up.
 * @param userId     The login to look up.
 * @returns The membership row, or `null` when this login has no membership in this account.
 * @throws Error  If the stored role is not a known {@link Role} — control-table corruption, which
 *   fails loud here exactly as it does in {@link listMembersForAccount}.
 */
export function getMembershipRow(db: Db, accountId: string, userId: string): AccountMember | null {
  const row = membershipRowStatement(db).get(accountId, userId) as AccountMemberRow | undefined;
  if (!row) return null;
  return toAccountMember(row, "getMembershipRow");
}

/**
 * Resolve one login's role for one account, or `null` if it is not a member. The account adapter
 * narrows this to active memberships before applying canonical account policy.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account to look up.
 * @param userId     The login to look up.
 * @returns The {@link Role}, or `null` when no `(accountId, userId)` membership exists.
 */
export function getMemberRole(db: Db, accountId: string, userId: string): Role | null {
  const row = memberRoleStatement(db).get(accountId, userId) as { role?: string } | undefined;
  // A MISSING membership is `null`; a PRESENT membership with an unreadable role is corruption and
  // must surface like every other control-table reader, never masquerade as absence.
  if (!row) return null;
  if (!isKnownRole(row.role)) {
    throw new Error(
      `getMemberRole: stored role ${JSON.stringify(row.role)} for (${accountId}, ${userId}) is not a known role — control table corrupted.`,
    );
  }
  return row.role;
}

/** Security-sensitive role lookup. Legacy control rows may carry a non-active status; those rows
 * never confer application or administrative authority and must be indistinguishable from absence. */
export function getActiveMemberRole(db: Db, accountId: string, userId: string): Role | null {
  const row = activeMemberRoleStatement(db).get(accountId, userId) as { role?: string } | undefined;
  // Same distinction as getMemberRole: legacy NON-ACTIVE status is filtered out by the statement
  // itself and stays indistinguishable from absence, but a returned row whose role cannot be read
  // is corruption and surfaces rather than degrading authority to `null`.
  if (!row) return null;
  if (!isKnownRole(row.role)) {
    throw new Error(
      `getActiveMemberRole: stored role ${JSON.stringify(row.role)} for (${accountId}, ${userId}) is not a known role — control table corrupted.`,
    );
  }
  return row.role;
}

/**
 * List every membership a login holds, across all accounts — the by-`userId` lookup P1.2's
 * `listAccounts` builds on (it is what answers "which accounts may this login see?").
 *
 * @param db      The open SQLite handle.
 * @param userId  The login whose memberships to list.
 * @returns That login's membership rows (possibly empty); never another login's rows.
 */
export function listMembershipsForUser(db: Db, userId: string): AccountMember[] {
  const rows = db
    .prepare(`SELECT accountId, userId, role, status, createdAt FROM account_members WHERE userId = ?`)
    .all(userId) as unknown as Array<AccountMemberRow>;
  // Map rows explicitly (mirrors rowCodec's row→object discipline) so the returned objects carry
  // the precise Role/MembershipStatus unions, not the raw TEXT columns. A row whose role is somehow
  // not a known Role is a control-table integrity fault (every write goes through upsertMember's
  // guard) — fail LOUD rather than hand back a mistyped role.
  return rows.map((r) => toAccountMember(r, "listMembershipsForUser"));
}

/**
 * List EVERY membership row of one account — the by-`accountId` lookup the member-management UI
 * (P1.11) builds on ("who is in this account?"). Ordered by `createdAt` then `userId` so the member
 * list renders deterministically.
 *
 * LOUD role-integrity throw (mirrors {@link listMembershipsForUser}): a stored role that is not a
 * known {@link Role} is a control-table corruption — fail rather than hand back a mistyped,
 * access-bearing role.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account whose members to list.
 * @returns The account's membership rows (possibly empty), in a stable order.
 */
const activeOwnerCountStatement = cachedStatement(
  `SELECT COUNT(*) AS owners FROM account_members WHERE accountId = ? AND role = 'owner' AND status = 'active'`,
);

/** How many active Owners one account has. Counted in SQLite — served directly by the partial
 *  unique index that holds the single-active-Owner invariant — rather than by mapping every member
 *  row into objects to answer a question about a number. */
export function countActiveOwners(db: Db, accountId: string): number {
  const row = activeOwnerCountStatement(db).get(accountId) as { owners: number };
  return Number(row.owners);
}

export function listMembersForAccount(db: Db, accountId: string): AccountMember[] {
  const rows = db
    .prepare(
      `SELECT accountId, userId, role, status, createdAt FROM account_members
       WHERE accountId = ? ORDER BY createdAt, userId`,
    )
    .all(accountId) as unknown as Array<AccountMemberRow>;
  return rows.map((r) => toAccountMember(r, "listMembersForAccount"));
}

/**
 * Remove one membership — the member-revoke write (P1.11). IDEMPOTENT: deleting an absent
 * `(accountId, userId)` is a no-op (mirrors {@link deleteRow}). The `accountId` predicate is the
 * cross-tenant guard: a revoke can only ever touch a row of the named account.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account the membership belongs to.
 * @param userId     The login whose membership to remove.
 */
export function removeMember(db: Db, accountId: string, userId: string): string[] {
  const result = db.prepare(`DELETE FROM account_members WHERE accountId = ? AND userId = ?`).run(accountId, userId);
  if (result.changes > 0) {
    revokeResetTokensForUser(db, userId);
    bumpSecurityRevision(db, userId);
    return terminaliseMemberTransfers(db, accountId, userId);
  }
  return [];
}

/**
 * Remove EVERY membership row of one account in a single statement — the bulk revoke the per-tenant
 * erasure (P2.6b) runs when an account is hard-deleted. Mirrors {@link removeMember} but drops all of
 * the account's rows at once: `account_members` carries NO FK to `accounts` (see {@link ensureControlTables}),
 * so the AppData delete-cascade never reaches it — this is what stops the membership rows leaking when
 * the account row goes.
 *
 * IDEMPOTENT: an account with no members is a no-op. The `accountId = ?` predicate is the CROSS-TENANT
 * guard — it can only ever delete rows of the named account, never another tenant's memberships.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account whose memberships to remove entirely.
 */
export function removeAllMembersForAccount(db: Db, accountId: string): void {
  const affected = db
    .prepare(`SELECT DISTINCT userId FROM account_members WHERE accountId = ?`)
    .all(accountId) as Array<{ userId: string }>;
  removeMemberSignInTrackingForAccount(db, accountId);
  db.prepare(`DELETE FROM account_members WHERE accountId = ?`).run(accountId);
  for (const { userId } of affected) {
    revokeResetTokensForUser(db, userId);
    bumpSecurityRevision(db, userId);
  }
  terminaliseLiveRequestsForAccount({
    db,
    accountId,
    reason: "participant_membership_changed",
    now: new Date().toISOString(),
  });
}

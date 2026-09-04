import {
  isAccountRole,
  isMembershipStatus,
  type MembershipStatus,
  type Role,
} from "@capacitylens/shared/account/types";

/**
 * The lifecycle status of one membership row: `'active' | 'disabled' | 'archived'`.
 *
 * Re-exported from the shared account contract rather than declared here, so the storage column and
 * the public port contract cannot drift apart — the whole reason the status was modelled as a named
 * union from the start. Only `'active'` confers authority: every authorization read below narrows on
 * `status = 'active'` (see {@link getActiveMemberRole}), so a disabled or archived row is
 * indistinguishable from absence to the access matrix.
 */
export type { MembershipStatus };

/**
 * One row of the `account_members` control table: a single login's role for a single account.
 *
 * @property accountId  The account this membership grants access to.
 * @property userId     The login (auth-provider user id) that holds the role.
 * @property role       The account-wide {@link Role} (see shared/domain/access for the semantics).
 * @property status     The membership {@link MembershipStatus} (`'active'` today).
 * @property createdAt  ISO-8601 timestamp the membership was created.
 *
 * INVARIANT: `(accountId, userId)` is unique — a login has at most one role per account. This is a
 * CONTROL-table type, never an AppData entity; it never flows through the entity drift path.
 */
export interface AccountMember {
  accountId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  createdAt: string;
}

export const isKnownRole = isAccountRole;

/**
 * Narrow a stored `account_members.status` TEXT value onto {@link MembershipStatus}.
 *
 * Unlike a stored role — where an unknown value is a corruption we fail LOUD on, because guessing
 * would hand someone the wrong access level — an unknown status is neither dangerous nor
 * necessarily a fault: alpha databases carry rows written as `'suspended'` / `'inactive'` before
 * this union existed. Every one of those legacy spellings meant the same thing, "retained but may
 * not enter", so they normalise to `'disabled'`.
 *
 * The direction of the fallback is the safety property: an unrecognised value can only ever become
 * a NON-active status, never `'active'`. A row we cannot interpret must not confer authority, and
 * the authorization reads narrow on the stored `'active'` literal in SQL anyway — this mapping
 * governs only what administration surfaces display.
 */
function membershipStatus(stored: string, accountId: string, userId: string): MembershipStatus {
  if (isMembershipStatus(stored)) return stored;
  console.warn(
    `controlTables: membership (${accountId}, ${userId}) carries unrecognised status ${JSON.stringify(stored)} — reading it as 'disabled'.`,
  );
  return "disabled";
}

/** Shared row shape for the three `account_members` readers below. */
export interface AccountMemberRow {
  accountId: string;
  userId: string;
  role: string;
  status: string;
  createdAt: string;
}

/**
 * Map one raw `account_members` row to an {@link AccountMember}, failing LOUD on a stored role that
 * is not a known {@link Role} — control-table corruption, never a recoverable request condition.
 * Extracted from {@link getMembershipRow}, {@link listMembershipsForUser} and
 * {@link listMembersForAccount}, which shared this mapping and integrity throw verbatim; `caller`
 * keeps each call site's error message byte-identical to its pre-extraction text.
 */
export function toAccountMember(row: AccountMemberRow, caller: string): AccountMember {
  if (!isKnownRole(row.role)) {
    throw new Error(
      `${caller}: stored role ${JSON.stringify(row.role)} for (${row.accountId}, ${row.userId}) is not a known role — control table corrupted.`,
    );
  }
  return {
    accountId: row.accountId,
    userId: row.userId,
    role: row.role,
    status: membershipStatus(row.status, row.accountId, row.userId),
    createdAt: row.createdAt,
  };
}

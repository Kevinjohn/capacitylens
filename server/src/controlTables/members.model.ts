import { isAccountRole, isMembershipStatus } from "@capacitylens/shared/account/types";
import type { MembershipStatus, Role } from "@capacitylens/shared/account/types";

/** Defines the membership lifecycle state shared by storage and account policy.
 * Only active rows confer authority; disabled and archived memberships remain visible to administration.
 */
export type { MembershipStatus };

/** Represents one principal’s membership in one account, independent of portable AppData.
 * The account/principal pair is unique; createdAt records the original join timestamp.
 * Only active status confers authority, while disabled and archived rows are retained.
 */
export interface AccountMember {
  accountId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  createdAt: string;
}

/**
 * Uses the shared account-role validator for membership rows and request inputs.
 */
export const isKnownRole = isAccountRole;

// Unknown stored status must remain non-active so unreadable retained rows never grant authority.
// Normalize it to disabled for administration display; authorization SQL still matches only active.
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

/** Maps a stored membership and throws on an unknown role instead of guessing authority. */
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

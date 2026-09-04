// Server-CONTROL tables — the user↔account binding (membership + its roles) AND the single-use
// invite links that mint such memberships (P1.9). These mirror Better Auth's own user/session/
// account tables (see auth.ts): they live in the same SQLite file but are DELIBERATELY OUTSIDE the
// AppData drift path. BOTH `account_members` AND `invites` are intentionally absent from shared
// AppData / SCOPED_KEYS, tables.ts TABLES / CREATE_ORDER / SCOPED_ORDER, KNOWN_KEYS, the seed
// fixtures, sanitizeImportedRecord, loadState, the generic /api/:entity CRUD, and import/export. They
// are reached ONLY through the helpers below, which permissioned endpoints (P1.2 / P1.5 / P1.9) wrap
// — never through the entity machinery. Keeping them off that path is the whole point: if either were
// AppData it would leak through generic CRUD and the state read/export (an invite leak would hand out
// a live, role-bearing token).

export {
  migrateSingleOwnerControlPlaneV10,
  reportOwnerlessPromotionsV11,
  migrateOwnerlessControlPlaneV11,
  migrateOwnerResetCeremoniesV12,
  migrateMemberResetCeremoniesV14,
} from "./controlTables/ownershipMigrations";
export type { OwnerlessPromotionV11 } from "./controlTables/ownershipMigrations";
export {
  USED_INVITATION_RETENTION_LIMIT,
  USED_INVITATION_RETENTION_MS,
  INVITATION_RETENTION_INDEXES_V24_SQL,
  USED_INVITATION_RETENTION_V24_DEFINITION,
  ensureControlTables,
} from "./controlTables/retentionV24";
export {
  inviteIsExpired,
  listInvitesForAccount,
  revokeInvite,
  pruneInvites,
  migrateUsedInvitationHistoryV24,
} from "./controlTables/inviteRetention";
export type { InviteSummary } from "./controlTables/inviteRetention";
export {
  SINGLE_OWNER_INDEX,
  assertControlTablesCurrent,
  assertSingleOwnerControlPlaneV10,
  assertSingleOwnerControlPlaneCurrent,
} from "./controlTables/assert";
export {
  upsertMember,
  setMemberStatus,
  getMembershipRow,
  getMemberRole,
  getActiveMemberRole,
  listMembershipsForUser,
  listMembersForAccount,
  removeMember,
  removeAllMembersForAccount,
} from "./controlTables/members";
export {
  removeAllInvitesForAccount,
  createInvite,
  getInvite,
  normalizeEmail,
  preauthInviteAllows,
  looksLikeEmail,
  InviteAlreadyUsedError,
  markInviteUsed,
} from "./controlTables/invites";
export type { Invite } from "./controlTables/invites";
export type { AccountMember, MembershipStatus } from "./controlTables/members.model";

export { inviteTokenHash, newInviteId } from "./controlTables/inviteTokens";

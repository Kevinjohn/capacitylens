import type { Role } from "@capacitylens/shared/account/types";
import { parseISOTimestamp } from "@capacitylens/shared/lib/integrity";
import type { Db } from "../db";
import { isKnownRole } from "./members.model";
import {
  INVITATION_RETENTION_INDEXES_V24_SQL,
  USED_INVITATION_RETENTION_LIMIT,
  USED_INVITATION_RETENTION_MS,
} from "./retentionV24";

/** One row of {@link listInvitesForAccount} — an account's outstanding-invite summary for the
 *  member-management UI. DELIBERATELY has NO `token` field: the bearer token is a write-once secret
 *  (returned to the creator at mint time and never again), so a read path must never carry it. The
 *  non-secret {@link Invite.id} is what list/revoke key on. */
export interface InviteSummary {
  id: string;
  accountId: string;
  role: Role;
  preauthEmail: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

/** Interpret invitation expiry consistently for admission, preview, redemption and pruning.
 * Malformed stored values fail closed as expired. */
export function inviteIsExpired(expiresAt: string, now = Date.now()): boolean {
  const parsed = parseISOTimestamp(expiresAt);
  return parsed === null || now >= parsed;
}

/**
 * List an account's invites for the member-management UI (P1.11) — ordered newest-first by
 * `createdAt`. CRITICAL: this NEVER selects or returns the token digest. The token is a write-once
 * bearer secret (handed to the creator at mint time and nowhere else); returning it on this read path
 * would hand out live, role-bearing links to anyone who can list invites. list/revoke key on the
 * non-secret `id` instead.
 *
 * LOUD role-integrity throw (mirrors the other control-table readers): a stored role that is not a
 * known {@link Role} is corruption — fail rather than hand back a mistyped role.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account whose invites to list.
 * @returns The account's invite summaries (NO token), newest first (possibly empty).
 */
export function listInvitesForAccount(db: Db, accountId: string): InviteSummary[] {
  const rows = db
    .prepare(
      // NOTE: tokenHash is intentionally ABSENT from this SELECT — it must never leave on a read path.
      // Used invites are LISTED (not filtered out): the member-management UI shows them with a "used"
      // badge (MembersSection's `usedAt ? …used()` branch) so an admin can confirm an invite was
      // consumed. Dead expired-unused links are removed separately by pruneInvites, not hidden here.
      `SELECT id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt FROM invites
       WHERE accountId = ?`,
    )
    .all(accountId) as Array<{
    id: string;
    accountId: string;
    role: string;
    preauthEmail: string | null;
    expiresAt: string;
    usedAt: string | null;
    createdAt: string;
  }>;
  const invitations = rows.map((r) => {
    if (!isKnownRole(r.role)) {
      throw new Error(
        `listInvitesForAccount: stored role ${JSON.stringify(r.role)} for invite ${r.id} is not a known role — control table corrupted.`,
      );
    }
    return {
      id: r.id,
      accountId: r.accountId,
      role: r.role,
      preauthEmail: r.preauthEmail ?? null,
      expiresAt: r.expiresAt,
      usedAt: r.usedAt ?? null,
      createdAt: r.createdAt,
    };
  });
  return invitations.sort((a, b) => {
    const aInstant = parseISOTimestamp(a.createdAt) ?? Number.NEGATIVE_INFINITY;
    const bInstant = parseISOTimestamp(b.createdAt) ?? Number.NEGATIVE_INFINITY;
    if (aInstant !== bInstant) return bInstant - aInstant;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Revoke (delete) one outstanding invite by its non-secret `id` — the member-management revoke write
 * (P1.11). IDEMPOTENT: deleting an absent id is a no-op. The `accountId = ?` predicate is the
 * CROSS-TENANT guard: a revoke can only ever delete an invite of the named account, so an admin of
 * one account cannot revoke another account's invite even with its id.
 *
 * @param db         The open SQLite handle.
 * @param accountId  The account the invite must belong to (the cross-tenant guard).
 * @param id         The non-secret invite id to revoke.
 */
export function revokeInvite(db: Db, accountId: string, id: string): number {
  return Number(db.prepare(`DELETE FROM invites WHERE id = ? AND accountId = ?`).run(id, accountId).changes);
}

/** Remove dead unused links and bound used operational history. This is a write-oriented
 * maintenance primitive: callers must provide their own mutation transaction/coordination and must
 * not invoke it from a declared read. When accountId is supplied, every write remains scoped to the
 * workspace whose mutation lock the caller holds. */
export function pruneInvites(db: Db, now = Date.now(), accountId?: string): number {
  const accountClause = accountId === undefined ? "" : " AND accountId = ?";
  const parameters = accountId === undefined ? [] : [accountId];
  const candidates = db
    .prepare(`SELECT tokenHash, expiresAt FROM invites WHERE usedAt IS NULL${accountClause}`)
    .all(...parameters) as Array<{
    tokenHash: string;
    expiresAt: string;
  }>;
  const removeUnused = db.prepare(`DELETE FROM invites WHERE tokenHash = ? AND usedAt IS NULL`);
  let deleted = 0;
  for (const candidate of candidates) {
    if (inviteIsExpired(candidate.expiresAt, now)) {
      deleted += Number(removeUnused.run(candidate.tokenHash).changes);
    }
  }

  return deleted + pruneUsedInvitationHistory(db, now, accountId);
}

/** Apply only the bounded used-history policy. Kept separate so the one-time migration cannot
 * unexpectedly delete an expired unused bearer row outside its declared data-repair scope. */
function pruneUsedInvitationHistory(db: Db, now = Date.now(), accountId?: string): number {
  const accountClause = accountId === undefined ? "" : " AND accountId = ?";
  const parameters = accountId === undefined ? [] : [accountId];
  const used = db
    .prepare(`SELECT tokenHash, id, accountId, usedAt FROM invites WHERE usedAt IS NOT NULL${accountClause}`)
    .all(...parameters) as Array<{ tokenHash: string; id: string; accountId: string; usedAt: string }>;
  const cutoff = now - USED_INVITATION_RETENTION_MS;
  const retainedByAccount = new Map<string, Array<{ tokenHash: string; instant: number; id: string }>>();
  const removeUsed = db.prepare(`DELETE FROM invites WHERE tokenHash = ? AND usedAt IS NOT NULL`);
  let deleted = 0;
  for (const row of used) {
    const instant = parseISOTimestamp(row.usedAt);
    if (instant === null || instant < cutoff) {
      deleted += Number(removeUsed.run(row.tokenHash).changes);
      continue;
    }
    const retained = retainedByAccount.get(row.accountId) ?? [];
    retained.push({ tokenHash: row.tokenHash, instant, id: row.id });
    retainedByAccount.set(row.accountId, retained);
  }
  for (const retained of retainedByAccount.values()) {
    retained.sort((left, right) => right.instant - left.instant || left.id.localeCompare(right.id));
    for (const row of retained.slice(USED_INVITATION_RETENTION_LIMIT)) {
      deleted += Number(removeUsed.run(row.tokenHash).changes);
    }
  }
  return deleted;
}

/** One-time v24 repair for pre-existing used history plus its supporting lookup indexes. */
export function migrateUsedInvitationHistoryV24(db: Db, now = Date.now()): number {
  const deleted = pruneUsedInvitationHistory(db, now);
  db.exec(INVITATION_RETENTION_INDEXES_V24_SQL);
  return deleted;
}

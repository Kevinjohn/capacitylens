import { parseResourceAvatarUrl } from "@capacitylens/shared/domain/resourceAvatarUrl";
import type { Db } from "../db";
import { tx } from "../txn";
import { newInviteId } from "./inviteTokens";
import { isIsoInstant } from "@capacitylens/shared/account/types";

/** Immutable v43 DDL for the app-owned, deliberately no-FK association control table. */
export const ACCOUNT_MEMBER_RESOURCES_SQL = `
CREATE TABLE IF NOT EXISTS account_member_resources (
  accountId TEXT NOT NULL,
  userId TEXT NOT NULL,
  resourceId TEXT NOT NULL,
  revision TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  PRIMARY KEY (accountId, userId),
  UNIQUE (accountId, resourceId)
);`;

/** Complete durable association row used only inside the SQLite account-storage adapter. */
export interface AccountMemberResourceLink {
  accountId: string;
  userId: string;
  resourceId: string;
  revision: string;
  createdAt: string;
  updatedAt: string;
}

/** Privacy-minimal active avatar projection returned to an authorized account reader. */
export interface ResourceAvatarProjection {
  resourceId: string;
  imageUrl: string;
}

interface ResourceAvatarRow {
  userId: unknown;
  resourceId: string;
  revision: unknown;
  createdAt: unknown;
  updatedAt: unknown;
  status: string | null;
  kind: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  identityId: string | null;
  image: unknown;
}

function hasValidProjectionMetadata(row: ResourceAvatarRow): boolean {
  return (
    typeof row.userId === "string" &&
    row.userId.length > 0 &&
    typeof row.resourceId === "string" &&
    row.resourceId.length > 0 &&
    typeof row.revision === "string" &&
    row.revision.length > 0 &&
    isIsoInstant(row.createdAt) &&
    isIsoInstant(row.updatedAt)
  );
}

function projectAvatarRow(row: ResourceAvatarRow, accountId: string): ResourceAvatarProjection[] {
  const statusValid = row.status === "active" || row.status === "disabled" || row.status === "archived";
  if (!hasValidProjectionMetadata(row) || !statusValid || row.kind !== "person" || row.identityId === null)
    throw new Error(`Corrupt member/resource link detected for account ${accountId}.`);
  if (row.status !== "active" || row.archivedAt || row.deletedAt) return [];
  const parsed = parseResourceAvatarUrl(row.image);
  return parsed.ok && parsed.value ? [{ resourceId: row.resourceId, imageUrl: parsed.value }] : [];
}

function associationTableExists(db: Db): boolean {
  return (
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'account_member_resources'`).get() !==
    undefined
  );
}

function canSkipLegacyCleanup(db: Db): boolean {
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  return version < 43 && !associationTableExists(db);
}

/** Install the app-owned, no-FK member/resource association table. */
export function ensureAccountMemberResources(db: Db): void {
  db.exec(ACCOUNT_MEMBER_RESOURCES_SQL);
}

/** Read retained links for an administration directory, including inactive endpoints. */
export function listAccountMemberResourceLinks(db: Db, accountId: string): AccountMemberResourceLink[] {
  return db
    .prepare(
      `SELECT accountId, userId, resourceId, revision, createdAt, updatedAt
       FROM account_member_resources WHERE accountId = ? ORDER BY userId`,
    )
    .all(accountId) as unknown as AccountMemberResourceLink[];
}

function conflict(message: string, options?: ErrorOptions): Error {
  const error = new Error(message, options);
  error.name = "AccountMemberResourceConflict";
  return error;
}

type SetLinkInput = {
  db: Db;
  accountId: string;
  userId: string;
  resourceId: string;
  expectedRevision: string | null;
  now: string;
};
type CurrentLink = { revision: string; resourceId: string; createdAt: string; updatedAt: string };

function requireLinkTargets(input: SetLinkInput): void {
  const member = input.db
    .prepare(`SELECT 1 FROM account_members WHERE accountId = ? AND userId = ?`)
    .get(input.accountId, input.userId);
  if (!member) throw conflict("The selected member no longer belongs to this account.");
  const resource = input.db
    .prepare(`SELECT kind, archivedAt, deletedAt FROM resources WHERE accountId = ? AND id = ?`)
    .get(input.accountId, input.resourceId) as
    { kind: string; archivedAt: string | null; deletedAt: string | null } | undefined;
  if (!resource || resource.kind !== "person" || resource.archivedAt || resource.deletedAt)
    throw conflict("The selected scheduled person is no longer available.");
}

function persistLink(input: SetLinkInput, revision: string): void {
  try {
    input.db
      .prepare(
        `INSERT INTO account_member_resources (accountId, userId, resourceId, revision, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(accountId, userId) DO UPDATE SET
           resourceId = excluded.resourceId, revision = excluded.revision, updatedAt = excluded.updatedAt`,
      )
      .run(input.accountId, input.userId, input.resourceId, revision, input.now, input.now);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "";
    if (
      detail.includes(
        "UNIQUE constraint failed: account_member_resources.accountId, account_member_resources.resourceId",
      )
    )
      throw conflict("That scheduled person is already linked to another member.", { cause });
    throw cause;
  }
}

function setLinkInTransaction(input: SetLinkInput): AccountMemberResourceLink {
  requireLinkTargets(input);
  const current = input.db
    .prepare(
      `SELECT revision, resourceId, createdAt, updatedAt FROM account_member_resources WHERE accountId = ? AND userId = ?`,
    )
    .get(input.accountId, input.userId) as CurrentLink | undefined;
  if ((current?.revision ?? null) !== input.expectedRevision)
    throw conflict("The member link changed. Reload and try again.");
  if (current?.resourceId === input.resourceId) return { accountId: input.accountId, userId: input.userId, ...current };
  const revision = newInviteId();
  persistLink(input, revision);
  return {
    accountId: input.accountId,
    userId: input.userId,
    resourceId: input.resourceId,
    revision,
    createdAt: current?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

/** Create or replace a member/person link under compare-and-swap semantics. */
export function setAccountMemberResourceLink(input: SetLinkInput): AccountMemberResourceLink {
  return tx(input.db, () => setLinkInTransaction(input), "immediate");
}

/** Remove one link only if its current opaque revision matches. */
export function clearAccountMemberResourceLink(input: {
  db: Db;
  accountId: string;
  userId: string;
  expectedRevision: string;
}): void {
  const result = input.db
    .prepare(`DELETE FROM account_member_resources WHERE accountId = ? AND userId = ? AND revision = ?`)
    .run(input.accountId, input.userId, input.expectedRevision);
  if (result.changes !== 1) throw conflict("The member link changed. Reload and try again.");
}

/** Return only active, safe avatar pointers for resources visible in one account. */
export function listResourceAvatarProjection(db: Db, accountId: string): ResourceAvatarProjection[] {
  const rows = db
    .prepare(
      `SELECT l.userId, l.resourceId, l.revision, l.createdAt, l.updatedAt,
              m.status, r.kind, r.archivedAt, r.deletedAt, u.id AS identityId, u.image
         FROM account_member_resources l
         LEFT JOIN account_members m ON m.accountId = l.accountId AND m.userId = l.userId
         LEFT JOIN resources r ON r.accountId = l.accountId AND r.id = l.resourceId
         LEFT JOIN user u ON u.id = l.userId
        WHERE l.accountId = ?`,
    )
    .all(accountId) as unknown as ResourceAvatarRow[];
  return rows.flatMap((row) => projectAvatarRow(row, accountId));
}

/** Explicit cleanup for a permanently removed membership. */
export function removeAccountMemberResourceForMember(db: Db, accountId: string, userId: string): void {
  if (canSkipLegacyCleanup(db)) return;
  db.prepare(`DELETE FROM account_member_resources WHERE accountId = ? AND userId = ?`).run(accountId, userId);
}

/** Explicit cleanup for a permanently purged resource. */
export function removeAccountMemberResourceForResource(db: Db, accountId: string, resourceId: string): void {
  if (canSkipLegacyCleanup(db)) return;
  db.prepare(`DELETE FROM account_member_resources WHERE accountId = ? AND resourceId = ?`).run(accountId, resourceId);
}

/** Explicit cleanup for account erasure. */
export function removeAccountMemberResourcesForAccount(db: Db, accountId: string): void {
  if (canSkipLegacyCleanup(db)) return;
  db.prepare(`DELETE FROM account_member_resources WHERE accountId = ?`).run(accountId);
}

/** Delete links whose resource disappeared or changed away from the person kind after replacement/import. */
export function reconcileAccountMemberResources(input: {
  db: Db;
  accountId: string;
  resourceIdMap?: ReadonlyMap<string, string>;
  updatedAt?: string;
}): void {
  const { db, accountId, resourceIdMap = new Map<string, string>(), updatedAt = new Date().toISOString() } = input;
  const update = db.prepare(
    `UPDATE account_member_resources SET resourceId = ?, revision = ?, updatedAt = ?
     WHERE accountId = ? AND resourceId = ?`,
  );
  for (const [sourceId, importedId] of resourceIdMap) {
    if (sourceId !== importedId) update.run(importedId, newInviteId(), updatedAt, accountId, sourceId);
  }
  db.prepare(
    `DELETE FROM account_member_resources WHERE accountId = ? AND NOT EXISTS (
       SELECT 1 FROM resources r WHERE r.accountId = account_member_resources.accountId
        AND r.id = account_member_resources.resourceId AND r.kind = 'person')`,
  ).run(accountId);
}

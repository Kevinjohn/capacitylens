import type { Db } from "../db";

/** Seed a no-FK association so lifecycle tests exercise their production cleanup owner. */
export function seedMemberResourceLink(input: { db: Db; accountId: string; userId: string; resourceId: string }): void {
  const { db, accountId, userId, resourceId } = input;
  db.prepare(
    `INSERT INTO account_member_resources (accountId, userId, resourceId, revision, createdAt, updatedAt)
     VALUES (?, ?, ?, 'cleanup-revision', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  ).run(accountId, userId, resourceId);
}

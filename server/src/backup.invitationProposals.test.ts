import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBackups } from "./backup";
import { insertAll, openDb, type Db } from "./db";
import { seed } from "@capacitylens/shared/data/seed";

const directories = new Set<string>();
const databases = new Set<Db>();

afterEach(() => {
  for (const db of databases) if (db.isOpen) db.close();
  databases.clear();
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  directories.clear();
});

describe("invitation proposal backup preservation", () => {
  it("preserves proposal and exception control rows in a portable SQLite backup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "capacitylens-proposal-backup-"));
    directories.add(directory);
    const db = openDb(":memory:");
    databases.add(db);
    insertAll(db, seed());
    db.prepare(
      `INSERT INTO invitation_person_proposals (invitationId, accountId, resourceId, createdAt, updatedAt)
       VALUES ('backup-invite', 'a-studio', 'backup-resource', ?, ?)`,
    ).run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    db.prepare(
      `INSERT INTO member_resource_link_exceptions
       (accountId, userId, proposedResourceId, reason, createdAt, updatedAt)
       VALUES ('a-studio', 'backup-member', 'backup-resource', 'resource_unavailable', ?, ?)`,
    ).run("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    const backups = startBackups({
      db,
      config: { dir: directory, intervalMin: 60, keep: 1 },
      log: () => {},
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const file = await backups.snapshotNow();
    await backups.stop();
    const restored = openDb(file);
    databases.add(restored);
    expect(restored.prepare(`SELECT resourceId FROM invitation_person_proposals`).get()).toEqual({
      resourceId: "backup-resource",
    });
    expect(restored.prepare(`SELECT reason FROM member_resource_link_exceptions`).get()).toEqual({
      reason: "resource_unavailable",
    });
  });
});

import { afterEach, describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync, existsSync, chmodSync, renameSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBackups } from "./backup";
import { openDb as openDbRaw, readState, insertAll } from "./db";
import { seed } from "@capacitylens/shared/data/seed";

const temporaryDirectories = new Set<string>();
const openDatabases = new Set<DatabaseSync>();
const openDb = (...args: Parameters<typeof openDbRaw>) => {
  const db = openDbRaw(...args);
  openDatabases.add(db);
  return db;
};
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "capacitylens-restore-drill-"));
  temporaryDirectories.add(dir);
  return dir;
};

afterEach(() => {
  for (const db of openDatabases) {
    if (db.isOpen) db.close();
  }
  openDatabases.clear();
  for (const dir of temporaryDirectories) rmSync(dir, { recursive: true, force: true });
  temporaryDirectories.clear();
});

// Exercise the documented restore sequence against real files, including a verified snapshot, corrupted live database and atomic replacement.
// Seeded data must return while post-snapshot edits disappear, proving point-in-time recovery.

// Advance the fixture clock so snapshots receive distinct names.
function tickingClock(start = new Date("2026-06-13T00:00:00")) {
  let t = start.getTime();
  return () => new Date((t += 1000));
}

describe("P3.3 restore drill", () => {
  it("backup → simulate loss → restore from snapshot recovers seeded data and discards the post-snapshot edit", async () => {
    const work = tempDir();
    const livePath = join(work, "capacitylens.db");
    const backupsDir = join(work, "backups");

    const live = openDb(livePath);
    insertAll(live, seed());
    expect(readState(live).accounts.map((a) => a.name)).toContain("Wayne Enterprises");

    const backups = startBackups({
      db: live,
      config: { dir: backupsDir, intervalMin: 60, keep: 48 },
      log: () => {},
      now: tickingClock(),
    });
    const snapshot = await backups.snapshotNow();
    await backups.stop();
    expect(existsSync(snapshot)).toBe(true);

    // An edit after the snapshot must be absent after restore, proving the recovery point.
    live.exec("UPDATE accounts SET name = 'POST-SNAPSHOT-EDIT' WHERE name = 'Wayne Enterprises'");
    const afterEdit = readState(live).accounts.map((a) => a.name);
    expect(afterEdit).toContain("POST-SNAPSHOT-EDIT");
    expect(afterEdit).not.toContain("Wayne Enterprises");

    // Remove sidecars before corruption so stale WAL frames cannot reconstruct the overwritten database.
    live.close();
    rmSync(livePath + "-wal", { force: true });
    rmSync(livePath + "-shm", { force: true });

    writeFileSync(livePath, "this is not a sqlite database");

    // The corrupted live database must fail before restore; otherwise recovery could pass without replacing lost data.
    let corrupt: DatabaseSync | undefined;
    try {
      expect(() => {
        corrupt = new DatabaseSync(livePath);
        readState(corrupt);
      }).toThrow();
    } finally {
      if (corrupt?.isOpen) corrupt.close();
    }
    expect(corrupt?.isOpen).toBe(false);

    // Follow the runbook’s temporary-file verification and atomic rename before removing sidecars.
    const temporary = livePath + ".restore";
    copyFileSync(snapshot, temporary);
    chmodSync(temporary, 0o600);
    expect(statSync(temporary).mode & 0o777).toBe(0o600);
    expect(statSync(temporary).uid).toBe(process.getuid?.() ?? statSync(livePath).uid);
    // Atomic replacement, no partially-written live file window.
    renameSync(temporary, livePath);
    rmSync(livePath + "-wal", { force: true });
    rmSync(livePath + "-shm", { force: true });

    // Require both restored seed data and the absence of later edits to prove the snapshot replaced the live database.
    const restored = openDb(livePath);
    const names = readState(restored).accounts.map((a) => a.name);
    const quickCheck = restored.prepare("PRAGMA quick_check").all();
    const foreignKeyViolations = restored.prepare("PRAGMA foreign_key_check").all();
    restored.close();
    expect(names).toContain("Wayne Enterprises");
    expect(names).not.toContain("POST-SNAPSHOT-EDIT");
    expect(quickCheck).toEqual([{ quick_check: "ok" }]);
    expect(foreignKeyViolations).toEqual([]);
  });
});

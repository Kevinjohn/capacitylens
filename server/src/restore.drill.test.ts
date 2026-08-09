import { afterEach, describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBackups } from "./backup";
import { openDb as openDbRaw, loadState, insertAll } from "./db";
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

// P3.3 — the RESTORE DRILL, codified. A backup that has never been restored is a hope, not a
// backup: this exercises the WHOLE recovery path end to end so the restore SEQUENCE itself is
// continuously verified by `pnpm run gate:server`, not just on a one-off manual run on the droplet.
//
// The cycle mirrors docs/self-hosting/backups-and-restore.md's "Restore" section EXACTLY: snapshot the live DB → make an
// edit AFTER the snapshot (work the backup can't have captured) → simulate disaster by corrupting
// the live file → restore by copying the snapshot over it and removing the WAL/SHM sidecars → open
// and verify. The two assertions below are deliberately NON-VACUOUS: the corrupt live DB must fail
// to open BEFORE the restore (so "lost" is real, not a no-op that quietly left the data in place),
// and after the restore the seeded data must be back (recovery proven) while the post-snapshot edit
// must be gone (point-in-time RPO — proof the file was genuinely replaced by the snapshot).
//
// Everything runs against ON-DISK files in a tmp dir: the source MUST be on disk so it can be
// corrupted, unlike backup.test.ts's `:memory:` source.

/** A fake clock that advances one second per call, so every snapshot gets a unique name. */
function tickingClock(start = new Date("2026-06-13T00:00:00")) {
  let t = start.getTime();
  return () => new Date((t += 1000));
}

describe("P3.3 restore drill", () => {
  it("backup → simulate loss → restore from snapshot recovers seeded data and discards the post-snapshot edit", async () => {
    const work = tempDir();
    const livePath = join(work, "capacitylens.db");
    const backupsDir = join(work, "backups");

    // 1. Seed the live DB on disk (sanity: the seeded 'Studio North' account is present).
    const live = openDb(livePath);
    insertAll(live, seed());
    expect(loadState(live).accounts.map((a) => a.name)).toContain("Studio North");

    // 2. Snapshot S1 — the point we will recover to. Then stop the daemon's timer.
    const backups = startBackups(live, { dir: backupsDir, intervalMin: 60, keep: 48 }, () => {}, tickingClock());
    const snapshot = await backups.snapshotNow();
    await backups.stop();
    expect(existsSync(snapshot)).toBe(true);

    // 3. An edit made AFTER the snapshot — work the backup cannot have captured (the RPO loss).
    live.exec("UPDATE accounts SET name = 'POST-SNAPSHOT-EDIT' WHERE name = 'Studio North'");
    const afterEdit = loadState(live).accounts.map((a) => a.name);
    expect(afterEdit).toContain("POST-SNAPSHOT-EDIT");
    expect(afterEdit).not.toContain("Studio North");

    // 4. Close the live handle and clear its WAL/SHM sidecars so the corruption below is unambiguous
    //    (a stale WAL must not replay old frames over the garbage we are about to write).
    live.close();
    rmSync(livePath + "-wal", { force: true });
    rmSync(livePath + "-shm", { force: true });

    // 5. Simulate disaster: overwrite the live file with garbage — a real, not faked, loss.
    writeFileSync(livePath, "this is not a sqlite database");

    // 6. Non-vacuous "lost": opening + reading the corrupted live DB must throw. (If this were a
    //    no-op the restore could trivially "succeed" while the data was never actually gone.)
    let corrupt: DatabaseSync | undefined;
    try {
      expect(() => {
        corrupt = new DatabaseSync(livePath);
        loadState(corrupt);
      }).toThrow();
    } finally {
      if (corrupt?.isOpen) corrupt.close();
    }
    expect(corrupt?.isOpen).toBe(false);

    // 7. Restore — the runbook sequence EXACTLY: copy the snapshot over the live file, then remove
    //    the WAL/SHM sidecars.
    copyFileSync(snapshot, livePath);
    rmSync(livePath + "-wal", { force: true });
    rmSync(livePath + "-shm", { force: true });

    // 8. Verify recovery (both non-vacuous): the seeded data is back (if restore were a no-op the
    //    open would still throw → test fails), and the post-snapshot edit is GONE — point-in-time
    //    RPO behaviour, i.e. the live file was genuinely replaced by the snapshot.
    const restored = openDb(livePath);
    const names = loadState(restored).accounts.map((a) => a.name);
    const quickCheck = restored.prepare("PRAGMA quick_check").all();
    const foreignKeyViolations = restored.prepare("PRAGMA foreign_key_check").all();
    restored.close(); // on-disk handle — close it to be tidy (unlike the :memory: handles in backup.test.ts)
    expect(names).toContain("Studio North");
    expect(names).not.toContain("POST-SNAPSHOT-EDIT");
    expect(quickCheck).toEqual([{ quick_check: "ok" }]);
    expect(foreignKeyViolations).toEqual([]);
  });
});

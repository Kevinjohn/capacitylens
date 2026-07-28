import { afterEach, describe, it, expect, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  renameSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  formatBackupStartupFailure,
  parseBackupConfig,
  startBackups,
  writePreMigrationBackup,
} from "./backup";
import {
  DB_SCHEMA_VERSION,
  initializeOpenDb,
  insertAll,
  loadState,
  openDb,
  openDbConnection,
  planDatabaseMigrations,
} from "./db";
import { seed } from "@capacitylens/shared/data/seed";

// P4.1 (flag CAPACITYLENS_BACKUP_DIR): OFF (unset) means backups don't exist — parseBackupConfig
// is the single gate. ON: snapshots are real, openable SQLite files holding the data, the
// retention prunes oldest-first by filename, and stop() ends the timer AND waits for an
// in-flight snapshot (the shutdown path closes the DB right after).

const temporaryDirectories = new Set<string>();
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "capacitylens-backup-test-"));
  temporaryDirectories.add(dir);
  return dir;
};

afterEach(() => {
  for (const dir of temporaryDirectories)
    rmSync(dir, { recursive: true, force: true });
  temporaryDirectories.clear();
});

const snapshots = (dir: string) =>
  readdirSync(dir)
    .filter((f) => /^capacitylens-(?:utc-)?\d{8}-\d{6}-\d{3}\.db$/.test(f))
    .sort();
const syncTestPath = (path: string): void => {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
};

/** A fake clock that advances one second per call, so every snapshot gets a unique name. */
function tickingClock(start = new Date("2026-06-13T00:00:00")) {
  let t = start.getTime();
  return () => new Date((t += 1000));
}

describe("parseBackupConfig (fail-closed)", () => {
  it("is null without CAPACITYLENS_BACKUP_DIR — backups simply do not exist", () => {
    expect(parseBackupConfig({})).toBeNull();
    expect(
      parseBackupConfig({
        CAPACITYLENS_BACKUP_INTERVAL_MIN: "5",
        CAPACITYLENS_BACKUP_KEEP: "3",
      }),
    ).toBeNull();
  });

  it("applies the documented defaults and ignores junk knob values", () => {
    expect(parseBackupConfig({ CAPACITYLENS_BACKUP_DIR: "/tmp/x" })).toEqual({
      dir: "/tmp/x",
      intervalMin: 60,
      keep: 48,
    });
    expect(
      parseBackupConfig({
        CAPACITYLENS_BACKUP_DIR: "/tmp/x",
        CAPACITYLENS_BACKUP_INTERVAL_MIN: "lots",
        CAPACITYLENS_BACKUP_KEEP: "-2",
      }),
    ).toEqual({ dir: "/tmp/x", intervalMin: 60, keep: 48 });
    expect(
      parseBackupConfig({
        CAPACITYLENS_BACKUP_DIR: "/tmp/x",
        CAPACITYLENS_BACKUP_KEEP: "0.5",
      }),
    ).toEqual({ dir: "/tmp/x", intervalMin: 60, keep: 48 });
    expect(
      parseBackupConfig({
        CAPACITYLENS_BACKUP_DIR: "/tmp/x",
        CAPACITYLENS_BACKUP_INTERVAL_MIN: "15",
        CAPACITYLENS_BACKUP_KEEP: "4",
      }),
    ).toEqual({ dir: "/tmp/x", intervalMin: 15, keep: 4 });
  });

  it("floors bounded fractional retention without falling back to a smaller destructive window", () => {
    const configured = (keep: string) =>
      parseBackupConfig({
        CAPACITYLENS_BACKUP_DIR: "/tmp/x",
        CAPACITYLENS_BACKUP_KEEP: keep,
      })?.keep;

    expect(configured("100.5")).toBe(100);
    expect(configured("1.9")).toBe(1);
    expect(configured("10000.9")).toBe(10_000);
    expect(configured("0.5")).toBe(48);
    expect(configured("10001")).toBe(48);
    expect(configured("lots")).toBe(48);

    // Cadence remains explicitly whole minutes; this compatibility rule is retention-only.
    expect(
      parseBackupConfig({
        CAPACITYLENS_BACKUP_DIR: "/tmp/x",
        CAPACITYLENS_BACKUP_INTERVAL_MIN: "100.5",
      })?.intervalMin,
    ).toBe(60);
  });
});

describe("pre-migration rollback snapshot", () => {
  it("tightens an existing rollback directory to mode 0700", async () => {
    const work = tempDir();
    const dbPath = join(work, "capacitylens.db");
    const rollbacks = join(work, "rollbacks");
    mkdirSync(rollbacks);
    chmodSync(rollbacks, 0o777);
    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE example (value TEXT NOT NULL); PRAGMA user_version = 7;",
    );

    await writePreMigrationBackup(
      db,
      { dbPath, fromVersion: 7, toVersion: 8, dir: rollbacks },
      () => {},
    );
    db.close();

    expect(statSync(rollbacks).mode & 0o777).toBe(0o700);
  });

  it("copies and verifies v7 before the live handle advances through every current migration", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "capacitylens.db");
    // Use the retained released v7 image. Relabelling a current openDb() file as v7 fabricates
    // future columns that no real v7 installation contained and correctly fails version assertions.
    copyFileSync(
      join(process.cwd(), "src", "fixtures", "databases", "v7-off.db"),
      dbPath,
    );

    const db = openDbConnection(dbPath);
    const plan = planDatabaseMigrations(db);
    expect(plan.fromVersion).toBe(7);
    expect(plan.migrations.map((migration) => migration.version)).toEqual([
      8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
    const snapshot = await writePreMigrationBackup(
      db,
      {
        dbPath,
        fromVersion: plan.fromVersion,
        toVersion: plan.toVersion,
        dir: join(dir, "rollbacks"),
      },
      () => {},
    );
    expect(snapshot).not.toBeNull();

    initializeOpenDb(db, dbPath);
    expect(
      (db.prepare(`PRAGMA user_version`).get() as { user_version: number })
        .user_version,
    ).toBe(DB_SCHEMA_VERSION);
    db.close();

    const rollback = new DatabaseSync(snapshot!, { readOnly: true });
    expect(
      (
        rollback.prepare(`PRAGMA user_version`).get() as {
          user_version: number;
        }
      ).user_version,
    ).toBe(7);
    expect(
      (
        rollback.prepare(`PRAGMA application_id`).get() as {
          application_id: number;
        }
      ).application_id,
    ).toBe(0);
    expect(
      (
        rollback.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as {
          n: number;
        }
      ).n,
    ).toBeGreaterThan(0);
    expect(
      (rollback.prepare(`PRAGMA quick_check`).get() as { quick_check: string })
        .quick_check,
    ).toBe("ok");
    expect(
      (
        rollback.prepare(`PRAGMA journal_mode`).get() as {
          journal_mode: string;
        }
      ).journal_mode,
    ).toBe("delete");
    rollback.close();
    expect(statSync(snapshot!).mode & 0o777).toBe(0o600);
    expect(existsSync(`${snapshot}.tmp-wal`)).toBe(false);
    expect(existsSync(`${snapshot}.tmp-shm`)).toBe(false);
  });

  it("does not create a rollback artifact for an in-memory database", async () => {
    const db = openDb(":memory:");
    await expect(
      writePreMigrationBackup(db, {
        dbPath: ":memory:",
        fromVersion: 7,
        toVersion: 8,
      }),
    ).resolves.toBeNull();
    db.close();
  });

  it.each(["chmod-file", "sync-file", "rename", "sync-directory"] as const)(
    "refuses migration when the %s publication barrier fails",
    async (failureStage) => {
      const dir = tempDir();
      const dbPath = join(dir, "capacitylens.db");
      const rollbacks = join(dir, "rollbacks");
      const db = new DatabaseSync(dbPath);
      const steps: string[] = [];
      const orderedStages = [
        "chmod-file",
        "sync-file",
        "rename",
        "sync-directory",
      ] as const;
      const runStage = (
        stage: (typeof orderedStages)[number],
        operation: () => void,
      ): void => {
        steps.push(stage);
        if (stage === failureStage)
          throw new Error(`simulated ${stage} failure`);
        operation();
      };
      const initialize = vi.fn();
      const log = vi.fn();
      db.exec(
        "CREATE TABLE example (value TEXT NOT NULL); PRAGMA user_version = 7;",
      );

      try {
        await expect(
          (async () => {
            await writePreMigrationBackup(
              db,
              { dbPath, fromVersion: 7, toVersion: 19, dir: rollbacks },
              log,
              {
                chmod: (path, mode) =>
                  runStage("chmod-file", () => chmodSync(path, mode)),
                syncFile: (path) =>
                  runStage("sync-file", () => syncTestPath(path)),
                rename: (from, to) =>
                  runStage("rename", () => renameSync(from, to)),
                syncDirectory: (path) =>
                  runStage("sync-directory", () => syncTestPath(path)),
              },
            );
            initialize();
          })(),
        ).rejects.toThrow(`simulated ${failureStage} failure`);

        expect(steps).toEqual(
          orderedStages.slice(0, orderedStages.indexOf(failureStage) + 1),
        );
        expect(initialize).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalledWith(
          expect.stringContaining("pre-migration backup written"),
        );
        expect(
          existsSync(
            join(rollbacks, "capacitylens-pre-migration-v7-to-v19.db.tmp"),
          ),
        ).toBe(false);
      } finally {
        db.close();
      }
    },
  );

  it("atomically refreshes one rollback artifact per migration pair across restart attempts", async () => {
    const dir = tempDir();
    const dbPath = join(dir, "capacitylens.db");
    const rollbacks = join(dir, "rollbacks");
    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE example (value TEXT NOT NULL); PRAGMA user_version = 7;",
    );
    db.prepare("INSERT INTO example (value) VALUES (?)").run(
      "before-first-attempt",
    );
    mkdirSync(rollbacks);
    writeFileSync(
      join(
        rollbacks,
        "capacitylens-pre-migration-v7-to-v16-20260715-120000-123.db",
      ),
      "legacy crash-loop artifact",
    );
    writeFileSync(
      join(rollbacks, "capacitylens-pre-migration-v7-to-v16.db.tmp"),
      "torn stable refresh",
    );
    const first = await writePreMigrationBackup(
      db,
      { dbPath, fromVersion: 7, toVersion: 16, dir: rollbacks },
      () => {},
    );
    db.prepare("INSERT INTO example (value) VALUES (?)").run(
      "before-second-attempt",
    );
    const second = await writePreMigrationBackup(
      db,
      { dbPath, fromVersion: 7, toVersion: 16, dir: rollbacks },
      () => {},
    );
    db.close();

    expect(second).toBe(first);
    expect(
      readdirSync(rollbacks).filter((file) => file.endsWith(".db")),
    ).toEqual(["capacitylens-pre-migration-v7-to-v16.db"]);
    expect(
      readdirSync(rollbacks).filter((file) => file.endsWith(".tmp")),
    ).toEqual([]);
    const refreshed = new DatabaseSync(second!, { readOnly: true });
    expect(
      (
        refreshed.prepare("SELECT COUNT(*) AS n FROM example").get() as {
          n: number;
        }
      ).n,
    ).toBe(2);
    refreshed.close();
  });
});

describe("startBackups", () => {
  it("frames an uncreatable configured directory with the variable and recovery choices", () => {
    const parentFile = join(tempDir(), "not-a-directory");
    writeFileSync(parentFile, "occupied");
    const dir = join(parentFile, "backups");
    const db = openDb(":memory:");

    let failure: unknown;
    try {
      startBackups(db, { dir, intervalMin: 60, keep: 48 });
    } catch (error) {
      failure = error;
    }

    const message = formatBackupStartupFailure(dir, failure);
    expect(message).toContain(`CAPACITYLENS_BACKUP_DIR=${JSON.stringify(dir)}`);
    expect(message).toMatch(/ENOTDIR|not a directory/i);
    expect(message).toContain(
      "CAPACITYLENS_BACKUP_DIR= to disable scheduled backups",
    );
  });

  it("tightens an existing scheduled-backup directory to mode 0700", async () => {
    const dir = tempDir();
    chmodSync(dir, 0o777);
    const db = openDb(":memory:");

    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      () => {},
      tickingClock(),
    );
    await backups.stop();

    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("writes a real, openable snapshot containing the seeded rows", async () => {
    const dir = tempDir();
    const db = openDb(":memory:");
    insertAll(db, seed());
    const log = vi.fn();
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      log,
      tickingClock(),
    );
    const file = await backups.snapshotNow();
    await backups.stop();

    expect(snapshots(dir).length).toBeGreaterThanOrEqual(1);
    // The snapshot opens through the SAME openDb (schema assert included) and holds the data.
    const restored = loadState(openDb(file));
    expect(restored.accounts.length).toBeGreaterThan(0);
    expect(restored.accounts.map((a) => a.name)).toContain("Studio North");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("backup written"));
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(backups.health).toEqual({
      degraded: false,
      lastSuccessAt: expect.any(String),
    });
  });

  it("persists the scheduled snapshot name before retention and then persists deletions", async () => {
    const dir = tempDir();
    const oldSnapshot = join(dir, "capacitylens-20200101-000000-000.db");
    writeFileSync(oldSnapshot, "old recovery point");
    const db = openDb(":memory:");
    const stages: string[] = [];
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 1 },
      () => {},
      tickingClock(),
      {
        chmod: (path, mode) => {
          stages.push("chmod-file");
          chmodSync(path, mode);
        },
        syncFile: (path) => {
          stages.push("sync-file");
          syncTestPath(path);
        },
        rename: (from, to) => {
          stages.push("rename");
          renameSync(from, to);
        },
        syncDirectory: (path) => {
          stages.push(
            `sync-directory:${existsSync(oldSnapshot) ? "before-retention" : "after-retention"}`,
          );
          syncTestPath(path);
        },
      },
    );

    await backups.stop();

    expect(stages).toEqual([
      "chmod-file",
      "sync-file",
      "rename",
      "sync-directory:before-retention",
      "sync-directory:after-retention",
    ]);
    expect(existsSync(oldSnapshot)).toBe(false);
  });

  it.each(["chmod-file", "sync-file", "rename", "sync-directory"] as const)(
    "skips scheduled retention when the %s publication barrier fails",
    async (failureStage) => {
      const dir = tempDir();
      const oldSnapshot = join(dir, "capacitylens-20200101-000000-000.db");
      writeFileSync(oldSnapshot, "old recovery point");
      const db = openDb(":memory:");
      const log = vi.fn();
      const failAt = (
        stage: typeof failureStage,
        operation: () => void,
      ): void => {
        if (stage === failureStage)
          throw new Error(`simulated ${stage} failure`);
        operation();
      };
      const backups = startBackups(
        db,
        { dir, intervalMin: 60, keep: 1 },
        log,
        tickingClock(),
        {
          chmod: (path, mode) =>
            failAt("chmod-file", () => chmodSync(path, mode)),
          syncFile: (path) => failAt("sync-file", () => syncTestPath(path)),
          rename: (from, to) => failAt("rename", () => renameSync(from, to)),
          syncDirectory: (path) =>
            failAt("sync-directory", () => syncTestPath(path)),
        },
      );

      await backups.stop();

      expect(existsSync(oldSnapshot)).toBe(true);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          `backup FAILED — simulated ${failureStage} failure`,
        ),
      );
      expect(log).not.toHaveBeenCalledWith(
        expect.stringContaining("backup written"),
      );
    },
  );

  it("prunes to the newest `keep` snapshots, oldest first, leaving other files alone", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "not-a-snapshot.txt"), "keep me");
    const db = openDb(":memory:");
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 2 },
      () => {},
      tickingClock(),
    );
    await backups.snapshotNow();
    await backups.snapshotNow();
    await backups.snapshotNow();
    await backups.snapshotNow();
    await backups.stop();

    const kept = snapshots(dir);
    expect(kept).toHaveLength(2);
    // Names sort chronologically, so the two NEWEST stamps survive (clock started at 00:00:00,
    // start-up shot + 4 manual = stamps :01..:05; kept = :04 and :05).
    expect(kept[0] < kept[1]).toBe(true);
    expect(readdirSync(dir)).toContain("not-a-snapshot.txt");
  });

  it("retains and returns the newer snapshot across a daylight-saving fall-back", async () => {
    vi.stubEnv("TZ", "Europe/London");
    const dir = tempDir();
    const db = openDb(":memory:");
    const instants = ["2026-10-25T00:59:59.900Z", "2026-10-25T01:00:00.100Z"];
    let nextInstant = 0;
    const clock = () =>
      new Date(instants[Math.min(nextInstant++, instants.length - 1)]);
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 1 },
      () => {},
      clock,
    );
    try {
      const newest = await backups.snapshotNow();
      expect(existsSync(newest)).toBe(true);
      expect(snapshots(dir)).toEqual([basename(newest)]);
    } finally {
      await backups.stop();
      vi.unstubAllEnvs();
    }
  });

  it("never treats the live database as retention when its path has a snapshot-shaped name", async () => {
    const dir = tempDir();
    const livePath = join(dir, "capacitylens-20000101-000000-000.db");
    const db = openDb(livePath);
    insertAll(db, seed());
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 1 },
      () => {},
      tickingClock(),
    );

    await backups.snapshotNow();
    await backups.stop();

    expect(existsSync(livePath)).toBe(true);
    expect(loadState(db).accounts.map((account) => account.name)).toContain(
      "Studio North",
    );
    const files = snapshots(dir);
    expect(files).toContain(basename(livePath));
    expect(files.filter((file) => file !== basename(livePath))).toHaveLength(1);
    db.close();
    const reopened = openDb(livePath);
    expect(
      loadState(reopened).accounts.map((account) => account.name),
    ).toContain("Studio North");
    reopened.close();
  });

  it("excludes a snapshot-shaped hard-link alias of the live database from retention", async () => {
    const dir = tempDir();
    const livePath = join(dir, "live.db");
    const alias = join(dir, "capacitylens-20000101-000000-000.db");
    const db = openDb(livePath);
    insertAll(db, seed());
    linkSync(livePath, alias);
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 1 },
      () => {},
      tickingClock(),
    );

    await backups.snapshotNow();
    await backups.stop();

    expect(existsSync(alias)).toBe(true);
    expect(statSync(alias).ino).toBe(statSync(livePath).ino);
    expect(
      snapshots(dir).filter((file) => file !== basename(alias)),
    ).toHaveLength(1);
    db.close();
  });

  it("rejects a foreign-key-invalid snapshot without publishing it or pruning the last good restore point", async () => {
    const dir = tempDir();
    const db = openDb(":memory:");
    insertAll(db, seed());
    const log = vi.fn();
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 1 },
      log,
      tickingClock(),
    );

    // Queue behind the start-up shot and retain this second, verified snapshot as the sole known-
    // good recovery point. The invalid attempt below would previously replace it under keep=1.
    const healthy = await backups.snapshotNow();
    expect(snapshots(dir)).toEqual([basename(healthy)]);

    // Use a real production relationship, not a synthetic probe table. SQLite permits controlled
    // insertion only with enforcement disabled; foreign_key_check still reports it afterwards.
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare(
      `
      INSERT INTO clients (id, accountId, name, color, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    ).run("orphan-client", "missing-account", "Orphan", "#111111", "t", "t");
    db.exec("PRAGMA foreign_keys = ON");

    await expect(backups.snapshotNow()).rejects.toThrow(
      /scheduled snapshot.*foreign_key_check.*1 violation/i,
    );
    await backups.stop();

    expect(snapshots(dir)).toEqual([basename(healthy)]);
    expect(readdirSync(dir).filter((file) => file.includes(".tmp"))).toEqual(
      [],
    );
    expect(
      log.mock.calls.filter(([message]) =>
        String(message).includes("backup written"),
      ),
    ).toHaveLength(2);
  });

  it("never reuses a filename, even when the clock does not advance (monotonic stamp bump)", async () => {
    const dir = tempDir();
    const db = openDb(":memory:");
    // A FROZEN clock is the worst case: without the monotonic bump every snapshot would target
    // the same file and silently overwrite the previous one.
    const frozen = () => new Date("2026-06-13T00:00:00");
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      () => {},
      frozen,
    );
    const a = await backups.snapshotNow();
    const b = await backups.snapshotNow();
    await backups.stop();

    expect(a).not.toBe(b);
    // Start-up shot + 2 manual = 3 distinct files despite identical clock readings.
    await vi.waitFor(() => expect(snapshots(dir)).toHaveLength(3));
  });

  it("skips (and logs) an interval tick while a snapshot is still in flight", async () => {
    vi.useFakeTimers();
    const dir = tempDir();
    const db = openDb(":memory:");
    const log = vi.fn();
    const backups = startBackups(
      db,
      { dir, intervalMin: 1, keep: 48 },
      log,
      tickingClock(),
    );
    try {
      // The start-up snapshot is suspended at its async write (no microtask has run yet); firing
      // the first interval tick NOW must hit the in-flight guard — skipped, with a loud notice.
      vi.advanceTimersByTime(60_000);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("backup skipped"),
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("still in flight"),
      );
    } finally {
      // stop() awaits the in-flight start-up snapshot; its write is real I/O, not timer-driven,
      // so it settles fine under fake timers.
      await backups.stop();
      vi.useRealTimers();
    }
    // Let the in-flight start-up snapshot settle: exactly one file, none from the skipped tick.
    await vi.waitFor(() => expect(snapshots(dir)).toHaveLength(1));
  });

  it("the interval timer keeps snapshotting until stop()", async () => {
    const dir = tempDir();
    const db = openDb(":memory:");
    // 0.0005 min = 30ms — the injected tiny interval from the activity spec.
    const backups = startBackups(
      db,
      { dir, intervalMin: 0.0005, keep: 48 },
      () => {},
      tickingClock(),
    );
    await vi.waitFor(
      () => expect(snapshots(dir).length).toBeGreaterThanOrEqual(3),
      { timeout: 5000 },
    );
    await backups.stop();
    const after = snapshots(dir).length;
    await new Promise((r) => setTimeout(r, 120));
    expect(snapshots(dir)).toHaveLength(after); // no timer left running
  });

  it("stop() resolves only after the in-flight start-up snapshot has completed", async () => {
    const dir = tempDir();
    const db = openDb(":memory:");
    insertAll(db, seed());
    const log = vi.fn();
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      log,
      tickingClock(),
    );
    // The start-up snapshot is still suspended at its async write (no microtask has run yet).
    // stop() must wait it out: the shutdown path (index.ts) closes the DB immediately after,
    // and closing under a running backup can leave a truncated file behind a snapshot name.
    await backups.stop();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("backup written"));
    const files = snapshots(dir);
    expect(files).toHaveLength(1);
    // The file was COMPLETE before stop() resolved — it opens and holds the data.
    const restored = loadState(openDb(join(dir, files[0])));
    expect(restored.accounts.map((a) => a.name)).toContain("Studio North");
  });

  it("never clobbers an existing snapshot after a restart, even with a stuck/stepped-back clock", async () => {
    const dir = tempDir();
    const db = openDb(":memory:");
    // The same frozen clock across both instances is the restart worst case: an in-memory-only
    // monotonic floor resets to 0, so the second instance would reuse the first one's stamp
    // and silently overwrite its file on the node:sqlite backup path.
    const frozen = () => new Date("2026-06-13T01:00:00");
    const first = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      () => {},
      frozen,
    );
    const before = await first.snapshotNow();
    await first.stop();
    // "Restart": a fresh instance over the same dir must seed its floor from the files on disk.
    const second = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      () => {},
      frozen,
    );
    const after = await second.snapshotNow();
    await second.stop();

    expect(after).not.toBe(before);
    // Two files per instance (start-up shot + manual), all four distinct — nothing clobbered.
    await vi.waitFor(() => expect(snapshots(dir)).toHaveLength(4));
  });

  it("never overwrites a pre-existing file with the exact colliding name (existsSync backstop)", async () => {
    const dir = tempDir();
    // A second-precision UTC name seeds the restart floor at .000 while another file already
    // occupies the .001 stamp the monotonic bump would otherwise hand out next. Only the
    // existsSync loop stands between the first snapshot and silently clobbering that file.
    const occupied = join(dir, "capacitylens-utc-20260613-010000-001.db");
    writeFileSync(occupied, "PRE-EXISTING SNAPSHOT — MUST SURVIVE");
    writeFileSync(
      join(dir, "capacitylens-utc-20260613-010000.db"),
      "second-precision snapshot (seeds the floor)",
    );
    const db = openDb(":memory:");
    const frozen = () => new Date("2026-06-13T01:00:00Z");
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      () => {},
      frozen,
    );
    const written = await backups.snapshotNow();
    await backups.stop();

    // The occupied name was never reused, let alone overwritten.
    expect(written).not.toBe(occupied);
    expect(readFileSync(occupied, "utf8")).toBe(
      "PRE-EXISTING SNAPSHOT — MUST SURVIVE",
    );
    // Start-up shot + manual both landed on fresh names past the collision (…-002 / …-003).
    await vi.waitFor(() =>
      expect(
        readdirSync(dir).filter((f) =>
          /^capacitylens-(?:utc-)?\d{8}-\d{6}(-\d{3})?\.db$/.test(f),
        ),
      ).toHaveLength(4),
    );
  });

  it("sweeps only STALE .tmp files at start-up, sparing fresh ones and other files", async () => {
    const dir = tempDir();
    // A stale temp is a torn write from a crashed process; a FRESH one could be a sibling
    // instance mid-snapshot during a rolling restart — the sweep must not delete its live file.
    const stale = join(dir, "capacitylens-20260613-000000-000.db.tmp");
    const fresh = join(dir, "capacitylens-20260613-000000-001.db.tmp");
    writeFileSync(stale, "torn write from a crash");
    utimesSync(
      stale,
      new Date(Date.now() - 2 * 60 * 60_000),
      new Date(Date.now() - 2 * 60 * 60_000),
    );
    writeFileSync(fresh, "live write from a sibling instance");
    writeFileSync(join(dir, "not-a-snapshot.txt"), "keep me");
    const db = openDb(":memory:");
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      () => {},
      tickingClock(),
    );
    await backups.stop();

    const files = readdirSync(dir);
    expect(files).not.toContain("capacitylens-20260613-000000-000.db.tmp");
    expect(files).toContain("capacitylens-20260613-000000-001.db.tmp");
    expect(files).toContain("not-a-snapshot.txt");
    // The sweep is name-scoped: the finished start-up snapshot itself is untouched.
    expect(snapshots(dir)).toHaveLength(1);
  });

  it("the start-up sweep skips (never throws on) an entry it cannot stat, and still boots", async () => {
    const dir = tempDir();
    // A dangling symlink makes statSync throw ENOENT — the same failure shape as a tmp file a
    // sibling process removes between the readdir and the stat. startBackups() runs at module
    // top level with no guard above it, so an unguarded throw here would kill the daemon at
    // boot; the sweep must warn, skip the entry, and carry on (named to sort FIRST, so an
    // unguarded loop would have aborted before reaching the genuinely stale file below).
    symlinkSync(
      join(dir, "does-not-exist"),
      join(dir, "capacitylens-20260101-000000-000.db.tmp"),
    );
    const stale = join(dir, "capacitylens-20260102-000000-000.db.tmp");
    writeFileSync(stale, "torn write from a crash");
    utimesSync(
      stale,
      new Date(Date.now() - 2 * 60 * 60_000),
      new Date(Date.now() - 2 * 60 * 60_000),
    );
    const log = vi.fn();
    const db = openDb(":memory:");
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      log,
      tickingClock(),
    );
    await backups.stop();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("start-up sweep skipped"),
    );
    // The bad entry was an isolated skip: the stale tmp beyond it was still swept, and the
    // boot completed all the way to the start-up snapshot.
    expect(readdirSync(dir)).not.toContain(
      "capacitylens-20260102-000000-000.db.tmp",
    );
    expect(snapshots(dir)).toHaveLength(1);
  });

  it("a snapshot still succeeds when retention cannot remove an old entry (warn + skip)", async () => {
    const dir = tempDir();
    // A directory squatting on the oldest snapshot name: rmSync without `recursive` refuses
    // it — the same "delete failed" shape as an EACCES, while `force: true` already absorbs
    // the ENOENT of a file pruned out from under us. Either way the new snapshot has ALREADY
    // been renamed into place when prune() runs, so the caller must see success — a rejection
    // here would be a false runbook alarm over a backup that exists.
    mkdirSync(join(dir, "capacitylens-20200101-000000-000.db"));
    const log = vi.fn();
    const db = openDb(":memory:");
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 1 },
      log,
      tickingClock(),
    );
    await expect(backups.snapshotNow()).resolves.toMatch(/\.db$/);
    await backups.stop();

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("retention failed to remove"),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("backup written"));
    // The unremovable entry is skipped in place (retried next prune), not a fatal.
    expect(readdirSync(dir)).toContain("capacitylens-20200101-000000-000.db");
  });

  it("a failed snapshot removes its temp file and surfaces the original error", async () => {
    const dir = tempDir();
    const db = openDb(":memory:");
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      () => {},
      tickingClock(),
    );
    // Let the start-up shot finish cleanly (snapshotNow queues behind it), THEN break the DB:
    // backup()/VACUUM INTO on a closed handle is a realistic mid-write fault.
    await backups.snapshotNow();
    db.close();
    await expect(backups.snapshotNow()).rejects.toThrow();
    await backups.stop();

    expect(backups.health.degraded).toBe(true);
    expect(backups.health.lastSuccessAt).toEqual(expect.any(String));

    // The rejection surfaced to the caller AND no partial `.tmp` was orphaned — under a
    // persistent fault (e.g. ENOSPC) each retry would otherwise leave one behind.
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    expect(snapshots(dir)).toHaveLength(2); // start-up shot + first manual, both intact
  });

  it("overlapping snapshotNow() calls serialize, and stop() awaits ALL in-flight work", async () => {
    const dir = tempDir();
    const db = openDb(":memory:");
    insertAll(db, seed());
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      () => {},
      tickingClock(),
    );
    // Fire two overlapping calls without awaiting (both also overlap the start-up shot). An
    // unserialized implementation would run two writers at once and let the newer call null the
    // guard stop() awaits while the older still runs — shutdown would close the DB under it.
    const order: string[] = [];
    const a = backups.snapshotNow().then((f) => {
      order.push("a");
      return f;
    });
    const b = backups.snapshotNow().then((f) => {
      order.push("b");
      return f;
    });
    await backups.stop();
    order.push("stop");

    // stop() resolved only after BOTH queued snapshots finished, in submission order — so the
    // shutdown path (which closes the DB right after stop()) can never undercut a running write.
    expect(order).toEqual(["a", "b", "stop"]);
    const [fileA, fileB] = await Promise.all([a, b]);
    expect(fileA).not.toBe(fileB);
    // Start-up shot + 2 manual = 3 distinct, COMPLETE files: each opens and holds the data.
    const files = snapshots(dir);
    expect(files).toHaveLength(3);
    for (const f of files) {
      expect(
        loadState(openDb(join(dir, f))).accounts.map((x) => x.name),
      ).toContain("Studio North");
    }
  });

  it("stop() drains the pre-stop chain, and a snapshotNow() during shutdown is refused", async () => {
    const dir = tempDir();
    const db = openDb(":memory:");
    insertAll(db, seed());
    const backups = startBackups(
      db,
      { dir, intervalMin: 60, keep: 48 },
      () => {},
      tickingClock(),
    );
    const order: string[] = [];
    // Queued behind the start-up shot, NOT awaited — stop() begins while both are pending.
    const a = backups.snapshotNow().then((f) => {
      order.push("a");
      return f;
    });
    const stopped = backups.stop().then(() => order.push("stop"));
    // Chained while stop() is already draining: the pre-fix stop() awaited only the promise it
    // captured at the moment of the await, so a call here would run AFTER stop() resolved —
    // i.e. under the DB close. It is refused instead, loudly, and writes nothing.
    await expect(backups.snapshotNow()).rejects.toThrow(
      /snapshot refused during shutdown/,
    );
    await stopped;

    // stop() resolved only after the whole accepted chain finished.
    expect(order).toEqual(["a", "stop"]);
    // Start-up shot + the one accepted call; the refused call left no file (or temp) behind.
    expect(snapshots(dir)).toHaveLength(2);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    expect(await a).toMatch(/\.db$/);
  });
});

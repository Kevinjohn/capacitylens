import { backup, DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Db } from "./db";

// Online DB snapshots (production plan P4.1, flag CAPACITYLENS_BACKUP_DIR — default OFF: this
// module is never started, touches no filesystem, owns no timer). A small server feature
// rather than a host cron because WAL mode means a raw `cp` can catch a torn state —
// node:sqlite's backup() takes a consistent online snapshot instead (fallback:
// VACUUM INTO, same guarantee). New filenames carry UTC stamps; retention also recognises legacy
// local-time names and orders those by publication mtime. The shutdown path (index.ts) awaits
// stop(), which clears the timer AND waits for
// any in-flight snapshot, so a drain can't close the DB under a running backup.

export interface BackupConfig {
  dir: string;
  /** Snapshot cadence in minutes (CAPACITYLENS_BACKUP_INTERVAL_MIN, default 60). */
  intervalMin: number;
  /** Rolling retention count, oldest pruned (CAPACITYLENS_BACKUP_KEEP, default 48). */
  keep: number;
}

interface FileIdentity {
  path: string;
  device: bigint;
  inode: bigint;
}

export interface Backups {
  /** Process-lifetime health for monitored deep-readiness. A failed snapshot latches degraded;
   * later successes advance lastSuccessAt but do not erase evidence of the failure. */
  readonly health: Readonly<{
    degraded: boolean;
    lastSuccessAt: string | null;
  }>;
  /** Take one snapshot; resolves to the file written. Also used by the start-up shot.
   *  Concurrency contract: calls SERIALIZE — a call made while another snapshot is in flight
   *  queues behind it (two writers pruning the same dir would race), and each call's own
   *  rejection is its own to surface (a predecessor's failure never fails a queued call).
   *  Rejects immediately once stop() has begun: shutdown closes the DB right after the drain,
   *  so a snapshot accepted here could only run against a closing handle. */
  snapshotNow(): Promise<string>;
  /** Clears the timer, then resolves once the WHOLE in-flight snapshot chain has drained — the
   *  shutdown path must not close the DB under a running (or queued) backup. Never rejects. */
  stop(): Promise<void>;
}

// The optional `-mmm` millisecond group keeps pre-v0.15 second-precision snapshots inside the
// retention window (they'd otherwise pile up forever); mixed-format names still sort
// chronologically except within a single second, which retention doesn't care about.
const SNAPSHOT_RE = /^capacitylens-(?:utc-)?\d{8}-\d{6}(-\d{3})?\.db$/;
const UTC_SNAPSHOT_RE = /^capacitylens-utc-\d{8}-\d{6}(-\d{3})?\.db$/;

// In-progress writes go to `<snapshot>.tmp` and are renamed on success, so a crash mid-write
// can never leave a torn file behind a valid snapshot name. Deliberately does NOT match
// SNAPSHOT_RE (no `.db$`), so prune() and the stamp seeding both ignore temp files.
const TMP_RE = /^capacitylens-(?:utc-)?\d{8}-\d{6}(-\d{3})?\.db\.tmp$/;

// Only sweep temp files at least this old at start-up. A snapshot takes seconds, so one hour is
// generous headroom for "abandoned by a crashed process" without racing a *live* writer during a
// rolling restart (two instances briefly sharing a dir is unsupported, but the sweep must not be
// the thing that corrupts it). A fixed constant rather than 2× the interval because the interval
// is operator-tunable down to seconds, which would defeat the margin.
const TMP_SWEEP_AGE_MS = 60 * 60_000;
export const MAX_BACKUP_INTERVAL_MIN = 35_000;
export const MAX_BACKUP_KEEP = 10_000;

/** Fail-closed env parse: no CAPACITYLENS_BACKUP_DIR ⇒ null ⇒ backups don't exist. The numeric
 *  knobs are only read when backups are on; junk falls back to the documented defaults. */
export function parseBackupConfig(env: Record<string, string | undefined>): BackupConfig | null {
  const dir = env.CAPACITYLENS_BACKUP_DIR;
  if (!dir) return null;
  const boundedInteger = (raw: string | undefined, fallback: number, max: number) => {
    const n = Number(raw);
    return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : fallback;
  };
  const boundedFloor = (raw: string | undefined, fallback: number, max: number) => {
    const floored = Math.floor(Number(raw));
    return Number.isSafeInteger(floored) && floored >= 1 && floored <= max ? floored : fallback;
  };
  return {
    dir,
    intervalMin: boundedInteger(env.CAPACITYLENS_BACKUP_INTERVAL_MIN, 60, MAX_BACKUP_INTERVAL_MIN),
    // Released compatibility contract: a bounded fractional retention value means its floor. Do
    // not route it through the whole-minute parser above: falling back from e.g. 100.5 to 48 would
    // silently prune 52 restore points the operator asked to keep.
    keep: boundedFloor(env.CAPACITYLENS_BACKUP_KEEP, 48, MAX_BACKUP_KEEP),
  };
}

function stampName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  const time = `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  const ms = String(now.getUTCMilliseconds()).padStart(3, "0");
  return `capacitylens-utc-${date}-${time}-${ms}.db`;
}

/** Atomically reserve a unique temporary snapshot path, retrying only name collisions. */
function claimBackupTemp(nextFile: () => string): {
  file: string;
  tmp: string;
} {
  for (;;) {
    const file = nextFile();
    const tmp = `${file}.tmp`;
    try {
      writeFileSync(tmp, "", { flag: "wx", mode: 0o600 });
      return { file, tmp };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

function databaseVersion(db: Db): number {
  return Number((db.prepare("PRAGMA user_version").get() as { user_version?: number }).user_version ?? 0);
}

/** Verify and normalize a completed snapshot while it still has an unpublished temp name.
 * quick_check catches structural/page faults; foreign_key_check catches a logically inconsistent
 * but structurally readable source; the version equality proves the copy is from the expected
 * schema generation. Open writable so WAL-mode metadata can be checkpointed and converted to one
 * standalone DELETE-journal `.db` file before publication. */
function verifyStandaloneSnapshot(path: string, label: string, expectedVersion: number): void {
  const verification = new DatabaseSync(path, {
    enableForeignKeyConstraints: false,
  });
  try {
    const quickCheck = verification.prepare("PRAGMA quick_check").all() as Array<{ quick_check?: string }>;
    if (quickCheck.length !== 1 || quickCheck[0]?.quick_check !== "ok") {
      throw new Error(`${label} failed SQLite quick_check`);
    }
    const foreignKeyViolations = verification.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length > 0) {
      throw new Error(`${label} failed SQLite foreign_key_check (${foreignKeyViolations.length} violation(s))`);
    }
    const copiedVersion = databaseVersion(verification);
    if (copiedVersion !== expectedVersion) {
      throw new Error(`${label} version mismatch (expected ${expectedVersion}, copied ${copiedVersion})`);
    }
    verification.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;");
  } finally {
    verification.close();
  }
}

/** Best-effort cleanup that attempts every artifact and never hides the original write/check error. */
function cleanupSnapshotTemp(path: string, label: string, log: (message: string) => void): void {
  for (const artifact of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      rmSync(artifact, { force: true });
    } catch (error) {
      log(
        `capacitylens-server: ${label} temp cleanup FAILED for ${artifact} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export interface PreMigrationBackupOptions {
  dbPath: string;
  fromVersion: number;
  toVersion: number;
  /** Uses the scheduled backup directory when configured; otherwise the database directory. */
  dir?: string;
}

/** Injectable only so tests can prove that every publication barrier fails startup closed. */
export interface DurableSnapshotPublisher {
  chmod(path: string, mode: number): void;
  syncFile(path: string): void;
  rename(from: string, to: string): void;
  syncDirectory(path: string): void;
}

function syncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

const durableSnapshotPublisher: DurableSnapshotPublisher = {
  chmod: chmodSync,
  syncFile: syncPath,
  rename: renameSync,
  syncDirectory: syncPath,
};

function ensurePrivateBackupDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  // mkdir's mode applies only when it creates the directory. Tighten a reused host/volume path too;
  // a configured backup destination that cannot meet the documented privacy boundary fails closed.
  chmodSync(path, 0o700);
}

function publishDurableSnapshot(tmp: string, file: string, dir: string, publisher: DurableSnapshotPublisher): void {
  // Persist the final mode and completed SQLite inode before exposing its valid rollback name, then
  // persist the directory entry itself. Any failure propagates to startup before forward-only DDL.
  publisher.chmod(tmp, 0o600);
  publisher.syncFile(tmp);
  publisher.rename(tmp, file);
  publisher.syncDirectory(dir);
}

function removeLegacyPreMigrationBackups(
  dir: string,
  fromVersion: number,
  toVersion: number,
  log: (message: string) => void,
): void {
  const legacyName = new RegExp(
    `^capacitylens-pre-migration-v${fromVersion}-to-v${toVersion}-\\d{8}-\\d{6}-\\d{3}(?:-\\d+)?\\.db$`,
  );
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    log(
      `capacitylens-server: legacy pre-migration backup cleanup skipped — cannot read ${dir} — ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  for (const entry of entries) {
    if (!legacyName.test(entry)) continue;
    const path = join(dir, entry);
    try {
      rmSync(path, { force: true });
    } catch (error) {
      log(
        `capacitylens-server: legacy pre-migration backup cleanup failed for ${path} — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** Write and verify the mandatory rollback point for an on-disk schema upgrade. Unlike periodic
 * snapshots this is not retention-pruned: the operator keeps it until the upgraded release has
 * been verified, then removes it deliberately. Repeated attempts for one version pair atomically
 * refresh one stable filename, bounding crash-loop storage without reusing stale database content.
 * A fresh or in-memory database has nothing to roll back and returns null. */
export async function writePreMigrationBackup(
  db: Db,
  options: PreMigrationBackupOptions,
  log: (message: string) => void = console.log,
  publisher: DurableSnapshotPublisher = durableSnapshotPublisher,
): Promise<string | null> {
  if (options.dbPath === ":memory:") return null;
  const dir = options.dir ?? dirname(resolve(options.dbPath));
  ensurePrivateBackupDirectory(dir);

  const base = `capacitylens-pre-migration-v${options.fromVersion}-to-v${options.toVersion}`;
  const file = join(dir, `${base}.db`);
  const tmp = `${file}.tmp`;

  // The supported deployment has one server process per SQLite file. A process killed during this
  // mandatory snapshot may leave its deterministic temp file behind; clear only that unpublished
  // path before exclusively recreating it. The previous verified `file` remains intact until the
  // final rename, so any new write/verification failure still leaves a usable rollback point.
  rmSync(tmp, { force: true });
  rmSync(`${tmp}-wal`, { force: true });
  rmSync(`${tmp}-shm`, { force: true });
  writeFileSync(tmp, "", { flag: "wx", mode: 0o600 });

  try {
    if (typeof backup === "function") await backup(db, tmp);
    else {
      rmSync(tmp);
      db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
    }

    verifyStandaloneSnapshot(tmp, "pre-migration snapshot", options.fromVersion);
    rmSync(`${tmp}-wal`, { force: true });
    rmSync(`${tmp}-shm`, { force: true });
    publishDurableSnapshot(tmp, file, dir, publisher);
  } catch (error) {
    cleanupSnapshotTemp(tmp, "pre-migration backup", log);
    throw error;
  }

  removeLegacyPreMigrationBackups(dir, options.fromVersion, options.toVersion, log);
  log(`capacitylens-server: pre-migration backup written ${file}`);
  return file;
}

/** Parse a snapshot filename back to an epoch floor. New names are unambiguous UTC; legacy local
 * names retain their historical interpretation for the collision-seeding fallback. */
function stampMs(name: string): number {
  const m = /^capacitylens-(utc-)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d{3}))?\.db$/.exec(name);
  if (!m) return 0;
  const parts = [+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7], m[8] ? +m[8] : 0] as const;
  return m[1] ? Date.UTC(...parts) : new Date(...parts).getTime();
}

/** Capture the open main database rather than trusting configuration text: PRAGMA supplies the
 * path SQLite actually opened, and device/inode equality also protects symlink or hard-link aliases
 * that happen to carry a retention-shaped name. An in-memory main database has no filesystem path. */
function mainDatabaseIdentity(db: Db): FileIdentity | null {
  const main = (
    db.prepare("PRAGMA database_list").all() as Array<{
      name?: unknown;
      file?: unknown;
    }>
  ).find((database) => database.name === "main");
  if (typeof main?.file !== "string" || main.file.length === 0) return null;
  const path = resolve(main.file);
  try {
    const stat = statSync(path, { bigint: true });
    return { path, device: stat.dev, inode: stat.ino };
  } catch (cause) {
    throw new Error(`Could not identify the live SQLite database at "${path}" for safe retention.`, { cause });
  }
}

function isProtectedDatabasePath(path: string, database: FileIdentity | null): boolean {
  if (!database) return false;
  if (resolve(path) === database.path) return true;
  try {
    const stat = statSync(path, { bigint: true });
    return stat.dev === database.device && stat.ino === database.inode;
  } catch {
    // Enumeration and deletion retain their existing per-file error handling. A vanished or
    // unstatable non-source entry cannot equal the captured live inode.
    return false;
  }
}

/** Order snapshots oldest-first. UTC names are exact; legacy local names use their publication
 * mtime because the repeated fall-back hour cannot be recovered unambiguously from their text. */
function listSnapshots(dir: string, database: FileIdentity | null): string[] {
  const files = readdirSync(dir).filter(
    (file) => SNAPSHOT_RE.test(file) && !isProtectedDatabasePath(join(dir, file), database),
  );
  const chronology = (file: string): number => {
    if (UTC_SNAPSHOT_RE.test(file)) return stampMs(file);
    try {
      return statSync(join(dir, file)).mtimeMs;
    } catch {
      return stampMs(file);
    }
  };
  return files.sort((left, right) => chronology(left) - chronology(right) || left.localeCompare(right));
}

/** Delete the oldest snapshots beyond `keep`; returns how many were pruned. Only files
 *  matching the snapshot pattern are touched — anything else in the dir is left alone.
 *  Never throws: prune() runs AFTER writeSnapshot() has renamed a complete snapshot into
 *  place, so a rejection here would fail (and page an operator over) a backup that actually
 *  SUCCEEDED — a false runbook alarm. Retention is retried on every snapshot anyway. */
function prune(
  dir: string,
  keep: number,
  database: FileIdentity | null,
  currentFile: string,
  log: (msg: string) => void,
): number {
  let files: string[];
  try {
    files = listSnapshots(dir, database);
  } catch (err) {
    // Can't even list the dir (stale NFS handle, EACCES): retention is skipped this round for
    // the same reason as below — it must not turn a successful snapshot into a rejection.
    log(
      `capacitylens-server: backup retention skipped — cannot list ${dir} — ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
  const excess = files.length - keep;
  const candidates = files.filter((file) => join(dir, file) !== currentFile);
  let pruned = 0;
  for (const candidate of candidates.slice(0, Math.max(0, excess))) {
    const p = join(dir, candidate);
    try {
      // `force` swallows exactly ENOENT: a file deleted out from under us (external cleanup
      // between the readdir and this rm) is gone either way — that IS the retention outcome.
      rmSync(p, { force: true });
      pruned++;
    } catch (err) {
      // Anything else (EACCES after a container uid change, a directory squatting on a
      // snapshot name): surface and skip — the next snapshot's prune retries it.
      log(
        `capacitylens-server: backup retention failed to remove ${p} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return pruned;
}

export function startBackups(
  db: Db,
  config: BackupConfig,
  log: (msg: string) => void = console.log,
  now: () => Date = () => new Date(),
  publisher: DurableSnapshotPublisher = durableSnapshotPublisher,
): Backups {
  // Deliberately fatal: the operator asked for backups via CAPACITYLENS_BACKUP_DIR, and a directory
  // we cannot create or restrict means snapshots cannot meet their configured privacy boundary.
  // Booting anyway would silently run without trustworthy backups. Later housekeeping degrades.
  ensurePrivateBackupDirectory(config.dir);
  // Establish the exclusion before any sweep or retention enumeration. Failure is fatal: once
  // backups are configured, running retention without knowing which inode is live is unsafe.
  const liveDatabase = mainDatabaseIdentity(db);

  // Sweep torn temp files from a previous crash mid-snapshot: they never match SNAPSHOT_RE,
  // so prune() would otherwise leave them on disk forever. Age-gated (real wall clock vs the
  // file's mtime, NOT the injected `now`) so a rolling restart can't delete a still-writing
  // sibling's live temp file — an abandoned one is swept on the *next* boot instead.
  // The entrypoint frames a fatal startBackups() failure for the operator, but this sweep must
  // NEVER throw — a stat/rm race with a sibling process, or an EACCES after a container
  // uid change, is a skipped tidy-up, not a reason to take the daemon down at boot.
  let sweepEntries: string[];
  try {
    sweepEntries = readdirSync(config.dir);
  } catch (err) {
    log(
      `capacitylens-server: backup start-up sweep skipped — cannot read ${config.dir} — ${err instanceof Error ? err.message : String(err)}`,
    );
    sweepEntries = [];
  }
  for (const f of sweepEntries) {
    if (!TMP_RE.test(f)) continue;
    const p = join(config.dir, f);
    if (isProtectedDatabasePath(p, liveDatabase)) continue;
    try {
      if (Date.now() - statSync(p).mtimeMs > TMP_SWEEP_AGE_MS) rmSync(p);
    } catch (err) {
      // Per-file, so one bad entry (vanished between readdir and stat, unremovable) can't stop
      // the rest of the sweep — it's retried on the next boot.
      log(
        `capacitylens-server: backup start-up sweep skipped ${p} — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Layered no-clobber guarantee, honest about what each layer covers:
  //   1. Millisecond stamps make same-name collisions unlikely to begin with.
  //   2. The monotonic bump makes reuse impossible among the names THIS instance has issued — two
  //      snapshots in the same ms, or a clock stepping backwards mid-run, bump past the last stamp.
  //   3. The restart seeding (floor = the newest snapshot already on disk) extends that across
  //      restarts — but only approximately: stampMs() parses names with the LOCAL-time Date
  //      constructor, which is ambiguous in the DST fall-back hour, so the seeded floor can sit up
  //      to 1h LOW and a clock rollback could still steer a stamp onto an existing file. It stays
  //      as a good floor (cheap, right outside that hour).
  //   4. The existsSync loop in uniqueStamp() is the DEFINITIVE backstop *within this process*:
  //      whatever the clock or the parse did, a name already on disk is never reused — bump 1ms
  //      and regenerate. It terminates because each iteration strictly advances lastStampMs past
  //      one of finitely many files.
  //   5. Across processes it is only best-effort: existsSync→renameSync is a TOCTOU window, and
  //      POSIX rename silently replaces. The exclusive (`wx`) temp-file claim in writeSnapshot()
  //      closes that window for the *temp* path (two instances can't share one), but the final
  //      rename stays last-writer-wins — the supported deployment is one server process per
  //      SQLite file (and so per backup dir); two daemons sharing one is not defended here.
  // New UTC names also keep filename order chronological; legacy retention uses publication mtime.
  let lastStampMs = 0;
  try {
    const newest = listSnapshots(config.dir, liveDatabase).at(-1);
    if (newest) lastStampMs = stampMs(newest);
  } catch (err) {
    // Boot-time housekeeping again (see the sweep above): a failed seed scan degrades the
    // floor to 0, which is SAFE against clobbers — layer 4 (the existsSync loop) never reuses
    // a name on disk regardless of where the floor sits. Not worth killing the daemon over.
    log(
      `capacitylens-server: backup stamp seeding skipped — cannot list ${config.dir} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const uniqueStamp = (): string => {
    lastStampMs = Math.max(now().getTime(), lastStampMs + 1);
    let name = stampName(new Date(lastStampMs));
    while (existsSync(join(config.dir, name))) {
      lastStampMs += 1;
      name = stampName(new Date(lastStampMs));
    }
    return name;
  };

  // Tail of the in-flight snapshot chain, or null when idle. Triples as (a) the tick-overlap
  // guard — a slow snapshot must not overlap the next interval tick (two writers in the same
  // dir), so the tick is SKIPPED, loudly, and the following tick covers the gap — (b) the
  // serialization point for direct snapshotNow() calls, which QUEUE behind it rather than skip,
  // and (c) the thing stop() awaits: it always points at the newest queued snapshot, which by
  // construction settles after every predecessor, so the shutdown path can't close the DB under
  // ANY running backup.
  let current: Promise<string> | null = null;

  // Set the instant stop() is entered, before its first await: index.ts closes the DB right
  // after stop() resolves, so once shutdown has begun no new snapshot may join the chain.
  let stopping = false;
  const health = { degraded: false, lastSuccessAt: null as string | null };

  /** The actual write. Only ever runs serialized (via snapshotNow's chain) — never call directly. */
  const writeSnapshot = async (): Promise<string> => {
    // Claim the temp name EXCLUSIVELY (`wx` = O_EXCL: atomic fail-if-exists) before writing.
    // existsSync in uniqueStamp() only covers finished `.db` names within this process; the
    // exclusive create is what stops a sibling instance from writing into the same temp file.
    // EEXIST just means the name is taken — bump to the next stamp and retry (terminates:
    // uniqueStamp strictly advances past one of finitely many files per iteration).
    const { file, tmp } = claimBackupTemp(() => join(config.dir, uniqueStamp()));
    try {
      // Write to the temp name and rename on success: rename is atomic on the same filesystem,
      // so a torn write (crash, full disk) never sits behind a valid snapshot name.
      // node:sqlite's online backup (verified on Node 24); VACUUM INTO is the pre-approved
      // fallback should the API regress — same consistent-snapshot guarantee. backup() happily
      // overwrites the zero-byte placeholder; VACUUM INTO refuses an existing target, so the
      // fallback drops the placeholder first (re-opening a tiny cross-instance window we accept
      // on this never-taken-today path rather than complicating it).
      if (typeof backup === "function") await backup(db, tmp);
      else {
        rmSync(tmp);
        db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
      }
      // The online copy is transactionally consistent, but can faithfully copy a source that is
      // already structurally or relationally invalid. Verify BEFORE the valid-name rename and
      // BEFORE retention, so an unusable new artifact cannot advertise success or prune a known-
      // good restore point. Read the source version for this attempt rather than caching it.
      verifyStandaloneSnapshot(tmp, "scheduled snapshot", databaseVersion(db));
      rmSync(`${tmp}-wal`, { force: true });
      rmSync(`${tmp}-shm`, { force: true });
      // Make the complete inode and its published name durable before retention can remove an
      // older recovery point. A publication-barrier failure rejects this attempt and skips prune.
      publishDurableSnapshot(tmp, file, config.dir, publisher);
    } catch (err) {
      health.degraded = true;
      // A failed write must not orphan its temp file: prune() and the start-up sweep both
      // ignore fresh `.tmp`s, so under a persistent fault (e.g. ENOSPC) each retry's partial
      // file would otherwise pile up and WORSEN the very disk-full condition that caused it.
      // Surface cleanup failures separately, but preserve the ORIGINAL error for the caller.
      cleanupSnapshotTemp(tmp, "backup", log);
      throw err;
    }
    // The just-published file is an explicit retention exclusion as a final fail-safe: a successful
    // snapshotNow() must never return a path that its own retention pass removed.
    const pruned = prune(config.dir, config.keep, liveDatabase, file, log);
    if (pruned > 0) {
      try {
        // The new snapshot name was already synced before prune. Persist retention metadata too;
        // failure is a retention warning rather than a false-negative snapshot result because the
        // safe power-loss outcome is merely that one or more older recovery points reappear.
        publisher.syncDirectory(config.dir);
      } catch (error) {
        log(
          `capacitylens-server: backup retention directory sync failed for ${config.dir} — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    log(`capacitylens-server: backup written ${file}${pruned > 0 ? ` (pruned ${pruned})` : ""}`);
    health.lastSuccessAt = now().toISOString();
    return file;
  };

  const snapshotNow = (): Promise<string> => {
    // Refuse once shutdown has begun — the honest surface: the caller learns its snapshot did
    // NOT happen, rather than a write racing the DB close (or extending the drain stop() has
    // already promised to finish). Rejection over silence per DEFENSIVE-CODING.md.
    if (stopping) {
      return Promise.reject(new Error("backups stopped — snapshot refused during shutdown"));
    }
    // Serialize: chain onto whatever is in flight so two writers never share the dir (or race
    // `current`, which stop() awaits — an unserialized overlap could null it while the older
    // snapshot still runs, letting shutdown close the DB underneath it). The predecessor's
    // rejection is swallowed HERE only as a queueing detail: its own initiator already surfaces
    // it (safeSnapshot logs; direct callers hold the rejection), and a failed predecessor must
    // not fail this independent snapshot.
    const run = (current ?? Promise.resolve()).then(writeSnapshot, writeSnapshot);
    current = run;
    // Clear only our own registration (a caller may already have chained the next snapshot);
    // rejection is the caller's to surface — this handler exists only to reset the guard.
    const clear = () => {
      if (current === run) current = null;
    };
    run.then(clear, clear);
    return run;
  };

  // A failed snapshot must never crash the daemon — log and try again next tick.
  const safeSnapshot = () => {
    if (current) {
      // Surface, don't silently drop: an operator watching the logs sees WHY a stamp is missing.
      log("capacitylens-server: backup skipped — previous snapshot still in flight");
      return;
    }
    void snapshotNow().catch((err: unknown) =>
      log(`capacitylens-server: backup FAILED — ${err instanceof Error ? err.message : String(err)}`),
    );
  };

  safeSnapshot(); // one immediately on start, so a fresh deploy is covered before the first hour
  const timer = setInterval(safeSnapshot, config.intervalMin * 60_000);
  timer.unref(); // the timer must not keep a draining process alive

  const stop = async (): Promise<void> => {
    stopping = true; // synchronously, so nothing can chain onto the tail once we start draining
    clearInterval(timer);
    // Drain the WHOLE chain, not one promise captured at a single instant (the start-up shot
    // is the common SIGTERM race), so the caller can close the DB safely. The `stopping` gate
    // already freezes the chain, but the loop keeps stop()'s contract self-sufficient: it
    // re-reads `current` after each settle (the clear handler nulls it only when it still
    // points at its own run) and only resolves once the tail is stable. Swallowing rejections
    // here is deliberate and safe: every snapshot's own initiator already surfaces its failure
    // (safeSnapshot logs it; direct snapshotNow() callers get the rejection) — stop() only
    // cares that the writes ended.
    while (current) await current.catch(() => undefined);
  };

  return { health, snapshotNow, stop };
}

export function formatBackupStartupFailure(dir: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `CAPACITYLENS_BACKUP_DIR=${JSON.stringify(dir)} could not be initialized: ${detail}. Fix the path and permissions, or set CAPACITYLENS_BACKUP_DIR= to disable scheduled backups.`;
}

import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { backup, DatabaseSync } from "node:sqlite";
import type { Db } from "../db";
/** Atomically reserve a unique temporary snapshot path, retrying only name collisions. */
export function claimBackupTemp(nextFile: () => string): {
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

export function databaseVersion(db: Db): number {
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
export function cleanupSnapshotTemp(path: string, label: string, log: (message: string) => void): void {
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

export const durableSnapshotPublisher: DurableSnapshotPublisher = {
  chmod: chmodSync,
  syncFile: syncPath,
  rename: renameSync,
  syncDirectory: syncPath,
};

export function ensurePrivateBackupDirectory(path: string): void {
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

/** Write (backup(), or VACUUM INTO as its pre-approved fallback), verify, checkpoint WAL/SHM, and
 * durably publish one snapshot at `tmp` under its final `file` name. Shared by
 * writePreMigrationBackup and startBackups's writeSnapshot — same online-copy-then-verify-then-
 * publish sequence for the same reason: the online copy is transactionally consistent, but can
 * faithfully copy a source that is already structurally or relationally invalid, so verification
 * must happen BEFORE the valid-name rename (and, for a retention-pruning caller, before any prune)
 * — an unusable new artifact must never advertise success or let a known-good restore point be
 * pruned in its place. Each caller keeps its own try/catch: cleanup-on-failure and degraded-health
 * signaling differ per caller and are not this function's concern. */
export async function writeVerifiedSnapshot(
  db: Db,
  tmp: string,
  file: string,
  dir: string,
  label: string,
  expectedVersion: number,
  publisher: DurableSnapshotPublisher,
): Promise<void> {
  // node:sqlite's online backup (verified on Node 24); VACUUM INTO is the pre-approved fallback
  // should the API regress — same consistent-snapshot guarantee. backup() happily overwrites the
  // zero-byte placeholder; VACUUM INTO refuses an existing target, so the fallback drops the
  // placeholder first (re-opening a tiny cross-instance window we accept on this never-taken-today
  // path rather than complicating it).
  if (typeof backup === "function") await backup(db, tmp);
  else {
    rmSync(tmp);
    db.exec(`VACUUM INTO '${tmp.replaceAll("'", "''")}'`);
  }
  verifyStandaloneSnapshot(tmp, label, expectedVersion);
  rmSync(`${tmp}-wal`, { force: true });
  rmSync(`${tmp}-shm`, { force: true });
  publishDurableSnapshot(tmp, file, dir, publisher);
}

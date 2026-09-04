import { readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Db } from "../db";
import { SNAPSHOT_RE, stampMs, UTC_SNAPSHOT_RE } from "./names";
interface FileIdentity {
  path: string;
  device: bigint;
  inode: bigint;
}
/** Capture the open main database rather than trusting configuration text: PRAGMA supplies the
 * path SQLite actually opened, and device/inode equality also protects symlink or hard-link aliases
 * that happen to carry a retention-shaped name. An in-memory main database has no filesystem path. */
export function mainDatabaseIdentity(db: Db): FileIdentity | null {
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

export function isProtectedDatabasePath(path: string, database: FileIdentity | null): boolean {
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
export function listSnapshots(dir: string, database: FileIdentity | null): string[] {
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
export function prune(
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

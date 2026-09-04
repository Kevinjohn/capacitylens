import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Db } from "../db";
import {
  cleanupSnapshotTemp,
  durableSnapshotPublisher,
  ensurePrivateBackupDirectory,
  writeVerifiedSnapshot,
  type DurableSnapshotPublisher,
} from "./publish";
export interface PreMigrationBackupOptions {
  dbPath: string;
  fromVersion: number;
  toVersion: number;
  /** Uses the scheduled backup directory when configured; otherwise the database directory. */
  dir?: string;
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
    await writeVerifiedSnapshot(db, tmp, file, dir, "pre-migration snapshot", options.fromVersion, publisher);
  } catch (error) {
    cleanupSnapshotTemp(tmp, "pre-migration backup", log);
    throw error;
  }

  removeLegacyPreMigrationBackups(dir, options.fromVersion, options.toVersion, log);
  log(`capacitylens-server: pre-migration backup written ${file}`);
  return file;
}

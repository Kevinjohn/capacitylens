export { writePreMigrationBackup, type PreMigrationBackupOptions } from "./backup/preMigration";
export type { DurableSnapshotPublisher } from "./backup/publish";
export { startBackups } from "./backup/scheduler";
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
export const MAX_BACKUP_INTERVAL_MIN = 35_000;
export const MAX_BACKUP_KEEP = 10_000;

/** Fail-closed env parse: no CAPACITYLENS_BACKUP_DIR ⇒ null ⇒ backups don't exist. The numeric
 *  knobs are only read when backups are on; junk/low values use the documented defaults while
 *  over-limit values clamp to the published operator-safety ceiling. */
export function parseBackupConfig(
  env: Record<string, string | undefined>,
  log: (message: string) => void = () => {},
): BackupConfig | null {
  const dir = env.CAPACITYLENS_BACKUP_DIR;
  if (!dir) return null;
  const reportSubstitution = (name: string, raw: string, applied: number, bound: string) => {
    log(
      `capacitylens-server: backup configuration warning — ${name} requested ${JSON.stringify(raw)}; applied ${applied} (${bound}).`,
    );
  };
  const boundedInteger = (name: string, raw: string | undefined, fallback: number, max: number) => {
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 1) {
      reportSubstitution(name, raw, fallback, `valid range 1..${max}; using default`);
      return fallback;
    }
    if (n > max) reportSubstitution(name, raw, max, `maximum ${max}`);
    return Math.min(n, max);
  };
  const boundedFloor = (name: string, raw: string | undefined, fallback: number, max: number) => {
    if (raw === undefined) return fallback;
    const floored = Math.floor(Number(raw));
    if (!Number.isSafeInteger(floored) || floored < 1) {
      reportSubstitution(name, raw, fallback, `valid range 1..${max}; using default`);
      return fallback;
    }
    if (Number(raw) !== floored) reportSubstitution(name, raw, Math.min(floored, max), "fractional value floored");
    else if (floored > max) reportSubstitution(name, raw, max, `maximum ${max}`);
    return Math.min(floored, max);
  };
  return {
    dir,
    intervalMin: boundedInteger(
      "CAPACITYLENS_BACKUP_INTERVAL_MIN",
      env.CAPACITYLENS_BACKUP_INTERVAL_MIN,
      60,
      MAX_BACKUP_INTERVAL_MIN,
    ),
    // Released compatibility contract: a bounded fractional retention value means its floor. Do
    // not route it through the whole-minute parser above: falling back from e.g. 100.5 to 48 would
    // silently prune 52 restore points the operator asked to keep.
    keep: boundedFloor("CAPACITYLENS_BACKUP_KEEP", env.CAPACITYLENS_BACKUP_KEEP, 48, MAX_BACKUP_KEEP),
  };
}
export function formatBackupStartupFailure(dir: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `CAPACITYLENS_BACKUP_DIR=${JSON.stringify(dir)} could not be initialized: ${detail}. Fix the path and permissions, or set CAPACITYLENS_BACKUP_DIR= to disable scheduled backups.`;
}

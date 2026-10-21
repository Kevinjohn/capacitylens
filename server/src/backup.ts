export { writePreMigrationBackup, type PreMigrationBackupOptions } from "./backup/writePreMigrationBackup";
export type { DurableSnapshotPublisher } from "./backup/publish";
export { startBackups } from "./backup/scheduler";
// Online DB snapshots (flag CAPACITYLENS_BACKUP_DIR, default off: this
// module is never started, touches no filesystem, owns no timer). A small server feature
// rather than a host cron because WAL mode means a raw `cp` can catch a torn state,
// node:sqlite's backup() takes a consistent online snapshot instead (fallback:
// VACUUM INTO, same guarantee). New filenames carry UTC stamps; retention also recognises legacy
// local-time names and orders those by publication mtime. The shutdown path (index.ts) awaits
// stop(), which clears the timer and waits for
// any in-flight snapshot, so a drain can't close the DB under a running backup.

/**
 * Controls snapshot creation and exposes backup health for the lifetime of the server.
 */
export interface Backups {
  /** Process-lifetime health for monitored deep-readiness. A failed snapshot latches degraded;
   * later successes advance lastSuccessAt but do not erase evidence of the failure. */
  readonly health: Readonly<{
    degraded: boolean;
    lastSuccessAt: string | null;
  }>;
  /** Take one snapshot; resolves to the file written. Also used by the start-up shot.
   * Concurrency contract: calls serialize, a call made while another snapshot is in flight
   * queues behind it (two writers pruning the same dir would race), and each call's own
   * rejection is its own to surface (a predecessor's failure never fails a queued call).
   * Rejects immediately once stop() has begun: shutdown closes the DB right after the drain,
   * so a snapshot accepted here could only run against a closing handle. */
  snapshotNow(): Promise<string>;
  /** Clears the timer, then resolves once the whole in-flight snapshot chain has drained. The
   * shutdown path must not close the DB under a running (or queued) backup. Never rejects. */
  stop(): Promise<void>;
}
export {
  formatBackupStartupFailure,
  MAX_BACKUP_INTERVAL_MIN,
  MAX_BACKUP_KEEP,
  parseBackupConfig,
  type BackupConfig,
} from "./backup/config";

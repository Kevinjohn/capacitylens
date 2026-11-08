import type { ApplicationService } from '@adonisjs/core/types';
import type { CreateResult, SqliteBackup } from '@kevinjohn/adonisjs-sqlite-backup';
import { formatBackupStartupFailure, type BackupConfig } from '#config/backup';

const DAY_MS = 24 * 60 * 60_000;

/** Own the web schedule while the package owns copying, verification and retention. */
export default class BackupProvider {
  private backup?: SqliteBackup;
  private pending?: Promise<CreateResult>;
  private cancelSchedule?: () => void;
  private stopping = false;

  constructor(protected application: ApplicationService) {}

  protected log(message: string): void {
    console.log(message);
  }

  protected schedule(callback: () => void, delayMs: number): () => void {
    const timer = setInterval(callback, delayMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  async ready() {
    if (this.application.getEnvironment() !== 'web' || this.backup || this.stopping) return;
    const config = this.application.config.get<BackupConfig>('backup');
    if (!config.directory) return;
    try {
      const backup = await this.application.container.make('sqlite.backup');
      backup.checkSource();
      backup.prepareDirectory();
      this.backup = backup;
    } catch (error) {
      throw new Error(formatBackupStartupFailure(config.directory, error), { cause: error });
    }
    const run = () => {
      if (this.pending) {
        this.log('backup skipped — previous backup still in flight');
        return;
      }
      void this.runBackup().catch((error) => {
        this.log(`backup FAILED — ${String(error)}`);
        const cleanupError = (error as { cleanupError?: unknown } | null)?.cleanupError;
        if (cleanupError !== undefined) {
          this.log(`backup temp cleanup failed: ${String(cleanupError)}`);
        }
      });
    };
    this.cancelSchedule = this.schedule(run, DAY_MS);
    run();
  }

  runBackup(): Promise<CreateResult> {
    if (this.stopping) return Promise.reject(new Error('backups stopped during shutdown'));
    if (this.pending) return this.pending;
    const backup = this.backup;
    if (!backup) return Promise.reject(new Error('backups have not started'));
    const run = (async () => {
      const created = await backup.create();
      for (const warning of created.warnings) this.log(`backup warning: ${warning}`);
      this.log(`backup written ${created.path}`);
      try {
        const result = await backup.prune();
        for (const failure of result.failed) {
          this.log(`backup retention could not remove ${failure.name}: ${failure.reason}`);
        }
      } catch (error) {
        this.log(`backup retention failed: ${String(error)}`);
      }
      return created;
    })();
    this.pending = run;
    const clear = () => {
      if (this.pending === run) this.pending = undefined;
    };
    void run.then(clear, clear);
    return run;
  }

  async shutdown() {
    this.stopping = true;
    this.cancelSchedule?.();
    if (this.pending) await Promise.allSettled([this.pending]);
  }
}

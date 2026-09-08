import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BackupConfig, Backups } from "../backup";
import type { Db } from "../db";
import { parseSnapshotTimestamp, buildSnapshotName, TMP_RE } from "./names";
import {
  claimBackupTemp,
  cleanupSnapshotTemp,
  readDatabaseVersion,
  durableSnapshotPublisher,
  ensurePrivateBackupDirectory,
  writeVerifiedSnapshot,
  type DurableSnapshotPublisher,
} from "./publish";
import { isProtectedDatabasePath, listSnapshots, readMainDatabaseIdentity, prune } from "./retention";
// Only sweep temp files at least this old at start-up. A snapshot takes seconds, so one hour is
// generous headroom for "abandoned by a crashed process" without racing a *live* writer during a
// rolling restart (two instances briefly sharing a dir is unsupported, but the sweep must not be
// the thing that corrupts it). A fixed constant rather than 2× the interval because the interval
// is operator-tunable down to seconds, which would defeat the margin.
const TMP_SWEEP_AGE_MS = 60 * 60_000;

interface StartBackupsInput {
  db: Db;
  config: BackupConfig;
  log?: ((msg: string) => void) | undefined;
  now?: (() => Date) | undefined;
  publisher?: DurableSnapshotPublisher | undefined;
}

type BackupLog = (message: string) => void;

interface ResolvedStartBackupsInput {
  db: Db;
  config: BackupConfig;
  log: BackupLog;
  now: () => Date;
  publisher: DurableSnapshotPublisher;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sweepAbandonedTemps(
  dir: string,
  liveDatabase: ReturnType<typeof readMainDatabaseIdentity>,
  log: BackupLog,
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    log(`capacitylens-server: backup start-up sweep skipped — cannot read ${dir} — ${errorText(error)}`);
    return;
  }
  for (const entry of entries) {
    if (!TMP_RE.test(entry)) continue;
    const path = join(dir, entry);
    if (isProtectedDatabasePath(path, liveDatabase)) continue;
    try {
      if (Date.now() - statSync(path).mtimeMs > TMP_SWEEP_AGE_MS) rmSync(path);
    } catch (error) {
      // Per-file isolation lets the remaining sweep proceed after a race or permission failure.
      log(`capacitylens-server: backup start-up sweep skipped ${path} — ${errorText(error)}`);
    }
  }
}

function createSnapshotNameFactory(
  input: Pick<StartBackupsInput, "now"> & {
    dir: string;
    liveDatabase: ReturnType<typeof readMainDatabaseIdentity>;
    log: BackupLog;
  },
): () => string {
  const { dir, liveDatabase, now, log } = input;
  const clock = now ?? (() => new Date());
  let lastStampMs = 0;
  try {
    const newest = listSnapshots(dir, liveDatabase).at(-1);
    if (newest) lastStampMs = parseSnapshotTimestamp(newest);
  } catch (error) {
    // Falling back to zero is safe because the existence loop remains the definitive no-clobber guard.
    log(`capacitylens-server: backup stamp seeding skipped — cannot list ${dir} — ${errorText(error)}`);
  }
  return () => {
    lastStampMs = Math.max(clock().getTime(), lastStampMs + 1);
    let name = buildSnapshotName(new Date(lastStampMs));
    while (existsSync(join(dir, name))) {
      lastStampMs += 1;
      name = buildSnapshotName(new Date(lastStampMs));
    }
    return name;
  };
}

class BackupScheduler implements Backups {
  readonly health = { degraded: false, lastSuccessAt: null as string | null };
  private current: Promise<string> | null = null;
  private stopping = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly liveDatabase: ReturnType<typeof readMainDatabaseIdentity>;
  private readonly createUniqueSnapshotName: () => string;

  private readonly db: Db;
  private readonly config: BackupConfig;
  private readonly log: BackupLog;
  private readonly now: () => Date;
  private readonly publisher: DurableSnapshotPublisher;

  constructor(input: ResolvedStartBackupsInput) {
    const { db, config, log, now, publisher } = input;
    this.db = db;
    this.config = config;
    this.log = log;
    this.now = now;
    this.publisher = publisher;
    // Directory and live-inode discovery are fatal because retention is unsafe without them.
    ensurePrivateBackupDirectory(config.dir);
    this.liveDatabase = readMainDatabaseIdentity(db);
    sweepAbandonedTemps(config.dir, this.liveDatabase, log);
    this.createUniqueSnapshotName = createSnapshotNameFactory({
      dir: config.dir,
      liveDatabase: this.liveDatabase,
      now,
      log,
    });
    this.writeSnapshotSafely();
    this.timer = setInterval(() => this.writeSnapshotSafely(), config.intervalMin * 60_000);
    this.timer.unref();
  }

  private async writeSnapshot(): Promise<string> {
    const { file, tmp } = claimBackupTemp(() => join(this.config.dir, this.createUniqueSnapshotName()));
    try {
      await writeVerifiedSnapshot({
        db: this.db,
        tmp,
        file,
        dir: this.config.dir,
        label: "scheduled snapshot",
        expectedVersion: readDatabaseVersion(this.db),
        publisher: this.publisher,
      });
    } catch (error) {
      this.health.degraded = true;
      cleanupSnapshotTemp(tmp, "backup", this.log);
      throw error;
    }
    const pruned = prune({
      dir: this.config.dir,
      keep: this.config.keep,
      database: this.liveDatabase,
      currentFile: file,
      log: this.log,
    });
    this.syncRetention(pruned);
    this.log(`capacitylens-server: backup written ${file}${pruned > 0 ? ` (pruned ${pruned})` : ""}`);
    this.health.lastSuccessAt = this.now().toISOString();
    return file;
  }

  private syncRetention(pruned: number): void {
    if (pruned === 0) return;
    try {
      this.publisher.syncDirectory(this.config.dir);
    } catch (error) {
      // Publication already succeeded; a sync failure can only resurrect older recovery points.
      this.log(
        `capacitylens-server: backup retention directory sync failed for ${this.config.dir} — ${errorText(error)}`,
      );
    }
  }

  snapshotNow(): Promise<string> {
    if (this.stopping) {
      return Promise.reject(new Error("backups stopped — snapshot refused during shutdown"));
    }
    // Both branches intentionally continue the queue: a surfaced predecessor failure must not cancel this request.
    const run = (this.current ?? Promise.resolve()).then(
      () => this.writeSnapshot(),
      () => this.writeSnapshot(),
    );
    this.current = run;
    const clear = () => {
      if (this.current === run) this.current = null;
    };
    run.then(clear, clear);
    return run;
  }

  private writeSnapshotSafely(): void {
    if (this.current) {
      this.log("capacitylens-server: backup skipped — previous snapshot still in flight");
      return;
    }
    void this.snapshotNow().catch((error: unknown) =>
      this.log(`capacitylens-server: backup FAILED — ${errorText(error)}`),
    );
  }

  async stop(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    // Every initiator already surfaces rejection; shutdown only waits until the frozen chain settles.
    while (this.current) await this.current.catch(() => undefined);
  }
}

export function startBackups({
  db,
  config,
  log = console.log,
  now = () => new Date(),
  publisher = durableSnapshotPublisher,
}: StartBackupsInput): Backups {
  return new BackupScheduler({ db, config, log, now, publisher });
}

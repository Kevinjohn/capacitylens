import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { BackupConfig, Backups } from "../backup";
import type { Db } from "../db";
import { stampMs, stampName, TMP_RE } from "./names";
import {
  claimBackupTemp,
  cleanupSnapshotTemp,
  databaseVersion,
  durableSnapshotPublisher,
  ensurePrivateBackupDirectory,
  writeVerifiedSnapshot,
  type DurableSnapshotPublisher,
} from "./publish";
import { isProtectedDatabasePath, listSnapshots, mainDatabaseIdentity, prune } from "./retention";
// Only sweep temp files at least this old at start-up. A snapshot takes seconds, so one hour is
// generous headroom for "abandoned by a crashed process" without racing a *live* writer during a
// rolling restart (two instances briefly sharing a dir is unsupported, but the sweep must not be
// the thing that corrupts it). A fixed constant rather than 2× the interval because the interval
// is operator-tunable down to seconds, which would defeat the margin.
const TMP_SWEEP_AGE_MS = 60 * 60_000;
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
      // so a torn write (crash, full disk) never sits behind a valid snapshot name. Read the
      // source version for this attempt rather than caching it.
      await writeVerifiedSnapshot(db, tmp, file, config.dir, "scheduled snapshot", databaseVersion(db), publisher);
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

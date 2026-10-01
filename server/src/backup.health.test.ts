import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBackups } from "./backup";
import { openDb } from "./db";

const temporaryDirectories = new Set<string>();

afterEach(() => {
  for (const dir of temporaryDirectories) rmSync(dir, { recursive: true, force: true });
  temporaryDirectories.clear();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "capacitylens-backup-health-test-"));
  temporaryDirectories.add(dir);
  return dir;
}

/** A fake clock that advances one second per call, so every snapshot gets a unique name. */
function tickingClock(start = new Date("2026-06-13T00:00:00")) {
  let t = start.getTime();
  return () => new Date((t += 1000));
}

describe("startBackups health", () => {
  it("latches degraded health when the backup destination disappears after a successful snapshot", async () => {
    const parent = tempDir();
    const dir = join(parent, "backups");
    const db = openDb(":memory:");
    const backups = startBackups({
      db,
      config: { dir, intervalMin: 60, keep: 48 },
      log: () => {},
      now: tickingClock(),
    });
    try {
      await backups.snapshotNow();
      expect(backups.health.degraded).toBe(false);

      renameSync(dir, join(parent, "moved"));
      await expect(backups.snapshotNow()).rejects.toThrow();
      expect(backups.health.degraded).toBe(true);
      expect(backups.health.lastSuccessAt).toEqual(expect.any(String));
    } finally {
      await backups.stop();
      db.close();
    }
  });
});

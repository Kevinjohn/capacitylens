import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";

if (process.argv[2] === "--child") {
  const [, , , mode, directory] = process.argv;
  const source = new DatabaseSync(":memory:");
  source.exec("CREATE TABLE probe (name TEXT NOT NULL); INSERT INTO probe VALUES ('Bruce Wayne')");
  const timer = setTimeout(() => {}, 60_000);
  try {
    if (mode === "success") {
      const snapshotPath = join(directory, "snapshot.db");
      await backup(source, snapshotPath);
      const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
      try {
        assert.equal(snapshot.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
        assert.equal(snapshot.prepare("SELECT name FROM probe").get().name, "Bruce Wayne");
      } finally {
        snapshot.close();
      }
    } else if (mode === "rejection") {
      const impossiblePath = join(directory, "missing-parent", "snapshot.db");
      await assert.rejects(backup(source, impossiblePath));
      assert.equal(existsSync(impossiblePath), false);
    } else {
      throw new Error(`Unknown backup probe mode: ${mode}`);
    }
  } finally {
    clearTimeout(timer);
    source.close();
  }
  console.log(`SQLite backup ${mode} completed with an unrelated pending timer.`);
} else {
  const directory = mkdtempSync(join(tmpdir(), "capacitylens-sqlite-probe-"));
  try {
    for (const mode of ["success", "rejection"]) {
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", mode, directory], {
        encoding: "utf8",
        timeout: 8_000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
      });
      if (result.status !== 0) {
        throw new Error(
          `SQLite timer backup ${mode} probe failed (${result.error?.message ?? result.signal ?? result.status}):\n${result.stdout}${result.stderr}`,
        );
      }
      process.stdout.write(result.stdout);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

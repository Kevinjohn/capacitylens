// Disposable issue #710 runtime probe. Not application code or a support claim.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, backup } from "node:sqlite";

if (process.argv[2] === "--child") {
  const [mode, targetKind, dir] = process.argv.slice(3);
  const source = new DatabaseSync(mode === "memory" ? ":memory:" : join(dir, "source.db"));
  if (mode === "wal") source.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0");
  source.exec(
    "CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO probe VALUES (1, 'Bruce Wayne'), (2, 'Clark Kent')",
  );
  const expected = source.prepare("SELECT * FROM probe ORDER BY id").all();
  const path = join(dir, "snapshot.db");
  if (targetKind === "precreated") writeFileSync(path, "");
  console.log(
    JSON.stringify({
      event: "start",
      mode,
      targetKind,
      sqlite: source.prepare("SELECT sqlite_version() AS version").get().version,
    }),
  );
  const pages = await backup(source, path);
  const snapshot = new DatabaseSync(path, { readOnly: true });
  assert.equal(snapshot.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(snapshot.prepare("SELECT * FROM probe ORDER BY id").all(), expected);
  snapshot.close();
  source.close();
  console.log(JSON.stringify({ event: "verified", pages, integrity: "ok", rows: expected.length }));
} else {
  console.log(
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      sqlite: process.versions.sqlite,
    }),
  );
  let failures = 0;
  for (const mode of ["memory", "file", "wal"]) {
    for (const targetKind of ["fresh", "precreated"]) {
      const dir = mkdtempSync(join(tmpdir(), "sqlite-backup-probe-"));
      try {
        const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--child", mode, targetKind, dir], {
          encoding: "utf8",
          timeout: 8000,
          killSignal: "SIGKILL",
          maxBuffer: 1024 * 1024,
        });
        const passed = result.status === 0 && result.stdout.includes('"event":"verified"');
        console.log(
          JSON.stringify({
            mode,
            targetKind,
            passed,
            status: result.status,
            signal: result.signal,
            error: result.error?.code,
            stdout: result.stdout,
            stderr: result.stderr,
          }),
        );
        if (!passed) failures++;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  console.log(JSON.stringify({ cases: 6, failures }));
  if (failures) process.exitCode = 1;
}

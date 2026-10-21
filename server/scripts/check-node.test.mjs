import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertSupportedNodeVersion, supportsNodeVersion } from "./check-node.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function fixture(t, version) {
  const directory = mkdtempSync(join(tmpdir(), "capacitylens-node-policy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const preload = join(directory, "version-override.cjs");
  writeFileSync(preload, `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });\n`);
  return { directory, preload };
}

function runWithVersion(preload, entry, args = [], env = {}) {
  return spawnSync(process.execPath, ["--require", preload, entry, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 10_000,
  });
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("admits only the declared Node 24 and 26 patch ranges", () => {
  for (const version of ["24.19.0", "24.19.1", "24.21.0", "26.9.0", "26.9.1", "26.10.0"]) {
    assert.equal(supportsNodeVersion(version), true, version);
    assert.doesNotThrow(() => assertSupportedNodeVersion(version));
  }
  for (const version of ["22.21.1", "24.18.99", "24.0.0", "25.1.0", "26.8.99", "27.0.0", "26.9.0-pre"]) {
    assert.equal(supportsNodeVersion(version), false, version);
    assert.throws(() => assertSupportedNodeVersion(version), /requires Node/);
  }
});

test("source preflight refuses versions immediately below each floor", (t) => {
  for (const version of ["24.18.99", "26.8.99"]) {
    const { preload } = fixture(t, version);
    const result = runWithVersion(preload, join(root, "server/scripts/check-node.mjs"));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`found Node ${version.replaceAll(".", "\\.")}`));
  }
});

test("source preflight still refuses when invoked through a symlinked directory", (t) => {
  const { directory, preload } = fixture(t, "24.18.99");
  const linked = join(directory, "scripts");
  symlinkSync(join(root, "server/scripts"), linked, "dir");
  const result = runWithVersion(preload, join(linked, "check-node.mjs"));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /found Node 24\.18\.99/);
});

test("built entrypoints refuse before initialization or recovery can write", (t) => {
  const { directory, preload } = fixture(t, "24.18.99");
  const databasePath = join(directory, "server.db");
  const backupDir = join(directory, "backups");
  const environmentPath = join(directory, "install.env");
  const index = join(root, "server/dist/index.mjs");
  const worker = join(root, "server/dist/importWorker.mjs");
  const recovery = join(root, "server/dist/reset-owner-password.mjs");
  for (const entry of [index, worker, recovery]) assert.ok(existsSync(entry), `Build ${entry} before this test.`);

  const init = runWithVersion(
    preload,
    index,
    ["init", "--public-url", "https://wayne.example", "--db", databasePath, "--out", environmentPath],
    { CAPACITYLENS_DB: databasePath, CAPACITYLENS_BACKUP_DIR: backupDir },
  );
  assert.notEqual(init.status, 0);
  assert.match(init.stderr, /requires Node >=24\.19\.0/);
  assert.equal(existsSync(environmentPath), false);
  assert.equal(existsSync(databasePath), false);
  assert.equal(existsSync(backupDir), false);

  const workerResult = runWithVersion(preload, worker, [], { CAPACITYLENS_DB: databasePath });
  assert.notEqual(workerResult.status, 0);
  assert.match(workerResult.stderr, /requires Node >=24\.19\.0/);

  const recoveryDatabase = join(directory, "recovery.db");
  copyFileSync(join(root, "server/src/fixtures/databases/v51-password.db"), recoveryDatabase);
  const before = hash(recoveryDatabase);
  const recoveryResult = runWithVersion(
    preload,
    recovery,
    [recoveryDatabase, "bruce@wayne.example", "--confirm-server-stopped"],
    { CAPACITYLENS_MODE: "password-only", CAPACITYLENS_PUBLIC_URL: "https://wayne.example" },
  );
  assert.notEqual(recoveryResult.status, 0);
  assert.match(recoveryResult.stderr, /requires Node >=24\.19\.0/);
  assert.equal(hash(recoveryDatabase), before);
  assert.deepEqual(readdirSync(directory).sort(), ["recovery.db", "version-override.cjs"]);
});

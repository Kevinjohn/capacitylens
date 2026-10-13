import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSmokeEnvironment, startServer, waitFor } from "./smoke-packaged-server.mjs";

test("packaged smoke strips deployment settings before applying its loopback fixture", () => {
  const inherited = {
    PATH: "/tools",
    NODE_PATH: "/workspace/node_modules",
    NODE_OPTIONS: "--import=/workspace/loader.mjs",
    CAPACITYLENS_HOST: "0.0.0.0",
    CAPACITYLENS_INTERNAL_TLS_KEY: "/private/key",
    SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: "https://identity.example.test",
    CAPACITYLENS_OIDC_DISCOVERY_URL: "https://identity.example.test",
    BETTER_AUTH_SECRET: "inherited",
    VITE_CAPACITYLENS_API: "https://api.example.test",
  };
  const environment = buildSmokeEnvironment(inherited, {
    backupDir: "/tmp/backups",
    databasePath: "/tmp/state.db",
    port: 43210,
  });

  assert.equal(environment.PATH, "/tools");
  assert.equal(environment.NODE_PATH, undefined);
  assert.equal(environment.NODE_OPTIONS, undefined);
  assert.equal(environment.HOST, "127.0.0.1");
  assert.equal(environment.NODE_ENV, "production");
  assert.equal(environment.CAPACITYLENS_MODE, "off");
  assert.equal(environment.CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION, "1");
  assert.equal(environment.CAPACITYLENS_INTERNAL_TLS_KEY, undefined);
  assert.equal(environment.SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL, undefined);
  assert.equal(environment.CAPACITYLENS_OIDC_DISCOVERY_URL, undefined);
  assert.equal(environment.BETTER_AUTH_SECRET, undefined);
  assert.equal(environment.VITE_CAPACITYLENS_API, undefined);
});

test("packaged smoke rejects an incomplete artifact before starting the server", () => {
  const deploymentDir = mkdtempSync(join(tmpdir(), "capacitylens-broken-deployment-"));
  mkdirSync(join(deploymentDir, "bin"));
  writeFileSync(join(deploymentDir, "bin/server.js"), 'throw new Error("fixture startup failure");\n');
  const script = fileURLToPath(new URL("./smoke-packaged-server.mjs", import.meta.url));
  const startedAt = Date.now();
  try {
    const result = spawnSync(process.execPath, [script, deploymentDir], { encoding: "utf8", timeout: 5_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ace\.js/);
    assert.ok(Date.now() - startedAt < 2_000, "Missing upgrade command left the smoke running.");
  } finally {
    rmSync(deploymentDir, { recursive: true, force: true });
  }
});

test("packaged smoke reports an early server exit without leaving the startup poll alive", async () => {
  const deploymentDir = mkdtempSync(join(tmpdir(), "capacitylens-early-server-exit-"));
  mkdirSync(join(deploymentDir, "bin"));
  writeFileSync(join(deploymentDir, "bin/server.js"), 'throw new Error("fixture startup failure");\n');
  const startedAt = Date.now();
  try {
    const child = startServer(deploymentDir, process.env, () => {});
    await assert.rejects(() => waitFor("readiness", 2_000, () => false, child), /exited early/);
    await child.exit;
    assert.ok(Date.now() - startedAt < 2_000, "Early server exit left the startup poll alive.");
  } finally {
    rmSync(deploymentDir, { recursive: true, force: true });
  }
});

test("failure preservation errors do not hide the original failure or leave scratch state", () => {
  const parent = mkdtempSync(join(tmpdir(), "capacitylens-smoke-failure-"));
  const deploymentDir = join(parent, "broken-deployment");
  mkdirSync(join(deploymentDir, "bin"), { recursive: true });
  writeFileSync(join(deploymentDir, "bin/server.js"), 'throw new Error("fixture startup failure");\n');
  const blockedArtifactDir = join(parent, "blocked-artifacts");
  writeFileSync(blockedArtifactDir, "not a directory");
  const script = fileURLToPath(new URL("./smoke-packaged-server.mjs", import.meta.url));
  try {
    const result = spawnSync(process.execPath, [script, deploymentDir], {
      encoding: "utf8",
      timeout: 5_000,
      env: { ...process.env, TMPDIR: parent, CAPACITYLENS_SMOKE_ARTIFACT_DIR: blockedArtifactDir },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ace\.js/);
    assert.match(result.stderr, /Could not preserve packaged smoke artifacts/);
    assert.deepEqual(readdirSync(parent).sort(), ["blocked-artifacts", "broken-deployment"]);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

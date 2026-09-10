import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSmokeEnvironment } from "./smoke-packaged-server.mjs";

test("packaged smoke strips deployment settings before applying its loopback fixture", () => {
  const inherited = {
    PATH: "/tools",
    CAPACITYLENS_HOST: "0.0.0.0",
    CAPACITYLENS_INTERNAL_TLS_KEY: "/private/key",
    SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL: "https://identity.example.test",
    BETTER_AUTH_SECRET: "inherited",
    VITE_CAPACITYLENS_API: "https://api.example.test",
  };
  const environment = buildSmokeEnvironment(inherited, {
    backupDir: "/tmp/backups",
    databasePath: "/tmp/state.db",
    port: 43210,
  });

  assert.equal(environment.PATH, "/tools");
  assert.equal(environment.CAPACITYLENS_HOST, "127.0.0.1");
  assert.equal(environment.CAPACITYLENS_INTERNAL_TLS_KEY, undefined);
  assert.equal(environment.SMALLSASS_ACCOUNT_OIDC_DISCOVERY_URL, undefined);
  assert.equal(environment.BETTER_AUTH_SECRET, undefined);
  assert.equal(environment.VITE_CAPACITYLENS_API, undefined);
});

test("packaged smoke reports an early deployed-server exit without leaving its startup poll alive", () => {
  const deploymentDir = mkdtempSync(join(tmpdir(), "capacitylens-broken-deployment-"));
  mkdirSync(join(deploymentDir, "dist"));
  writeFileSync(join(deploymentDir, "dist/index.mjs"), 'throw new Error("fixture startup failure");\n');
  const script = fileURLToPath(new URL("./smoke-packaged-server.mjs", import.meta.url));
  const startedAt = Date.now();
  try {
    const result = spawnSync(process.execPath, [script, deploymentDir], { encoding: "utf8", timeout: 5_000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exited early/);
    assert.match(result.stderr, /fixture startup failure/);
    assert.ok(Date.now() - startedAt < 2_000, "Early server exit left the startup poll alive.");
  } finally {
    rmSync(deploymentDir, { recursive: true, force: true });
  }
});

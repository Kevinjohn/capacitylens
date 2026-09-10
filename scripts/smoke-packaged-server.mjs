import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

const STARTUP_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 10_000;
const PERIODIC_TIMEOUT_MS = 80_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 250;
const PERIODIC_RESOURCE_NAME = "Bruce Wayne Periodic Backup Check";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string", "Could not reserve a loopback port.");
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
  return address.port;
}

async function waitFor({ description, timeoutMs, check, childOutcome }) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    const outcome = childOutcome();
    if (outcome) {
      throw new Error(
        outcome.error
          ? `The packaged server could not start: ${errorMessage(outcome.error)}`
          : `The packaged server exited early (${outcome.signal ?? `code ${outcome.code}`}).`,
      );
    }
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_INTERVAL_MS);
  }
  const detail = lastError ? ` Last error: ${errorMessage(lastError)}` : "";
  throw new Error(`Timed out waiting for ${description}.${detail}`);
}

export function buildSmokeEnvironment(inherited, { backupDir, databasePath, port }) {
  const environment = { ...inherited };
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("SMALLSASS_ACCOUNT_") ||
      key.startsWith("CAPACITYLENS_") ||
      key.startsWith("BETTER_AUTH_") ||
      key.startsWith("VITE_CAPACITYLENS_")
    ) {
      delete environment[key];
    }
  }
  return Object.assign(environment, {
    NODE_ENV: "test",
    CAPACITYLENS_AUTH: "off",
    CAPACITYLENS_AUDIT: "off",
    CAPACITYLENS_SEED_DEMO: "1",
    CAPACITYLENS_HEALTH_DEEP: "1",
    CAPACITYLENS_HTTPS: "0",
    CAPACITYLENS_DB: databasePath,
    CAPACITYLENS_BACKUP_DIR: backupDir,
    CAPACITYLENS_BACKUP_INTERVAL_MIN: "1",
    CAPACITYLENS_HOST: "127.0.0.1",
    PORT: String(port),
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const body = await response.text();
  assert.ok(response.ok, `${options.method ?? "GET"} ${url} returned ${response.status}: ${body}`);
  return JSON.parse(body);
}

async function snapshotFiles(backupDir) {
  try {
    return (await readdir(backupDir)).filter((name) => name.endsWith(".db")).sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

function inspectSnapshot(path, expectedResourceName) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const resources = database.prepare("SELECT COUNT(*) AS count FROM resources").get().count;
    assert.ok(resources > 0, "The packaged snapshot contains no seeded resources.");
    if (expectedResourceName) {
      const matching = database
        .prepare("SELECT COUNT(*) AS count FROM resources WHERE name = ?")
        .get(expectedResourceName).count;
      assert.equal(matching, 1, `The periodic snapshot does not contain ${expectedResourceName}.`);
    }
    return resources;
  } finally {
    database.close();
  }
}

async function terminate(child, exitPromise) {
  if (child.exitCode !== null || child.signalCode !== null) return exitPromise;
  child.kill("SIGTERM");
  let timer;
  const timeout = new Promise((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(null), SHUTDOWN_TIMEOUT_MS);
    timer.unref();
  });
  const graceful = await Promise.race([exitPromise, timeout]);
  clearTimeout(timer);
  if (graceful) return graceful;
  child.kill("SIGKILL");
  await exitPromise;
  throw new Error("The packaged server did not stop within 10 seconds of SIGTERM.");
}

async function preserveFailureArtifacts(sourceDir, log, artifactDir) {
  if (!artifactDir) return;
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, "packaged-server.log"), log);
  await cp(sourceDir, join(artifactDir, "packaged-server-state"), { recursive: true, force: true });
}

async function main() {
  const deploymentDir = process.argv.slice(2).find((argument) => argument !== "--");
  if (!deploymentDir) throw new Error("Usage: pnpm run smoke:packaged-server <deployed-server-directory>");
  const entrypoint = resolve(deploymentDir, "dist/index.mjs");
  await stat(entrypoint);
  const port = await reservePort();
  const workDir = await mkdtemp(join(tmpdir(), "capacitylens-packaged-smoke-"));
  const backupDir = join(workDir, "backups");
  let log = "";
  let passed = false;

  const child = spawn(process.execPath, [entrypoint], {
    cwd: deploymentDir,
    env: buildSmokeEnvironment(process.env, {
      backupDir,
      databasePath: join(workDir, "capacitylens.db"),
      port,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (log += chunk));
  child.stderr.on("data", (chunk) => (log += chunk));
  let childOutcome = null;
  const exitPromise = new Promise((resolveExit) => {
    child.once("error", (error) => {
      childOutcome = { code: null, signal: null, error };
      resolveExit(childOutcome);
    });
    child.once("exit", (code, signal) => {
      childOutcome = { code, signal, error: null };
      resolveExit(childOutcome);
    });
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitFor({
      description: "the packaged server health endpoint",
      timeoutMs: STARTUP_TIMEOUT_MS,
      check: async () => {
        const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
        return response.ok;
      },
      childOutcome: () => childOutcome,
    });
    const startupFiles = await waitFor({
      description: "the startup snapshot",
      timeoutMs: STARTUP_TIMEOUT_MS,
      check: async () => {
        const files = await snapshotFiles(backupDir);
        return files.length > 0 ? files : null;
      },
      childOutcome: () => childOutcome,
    });
    const seededResources = inspectSnapshot(join(backupDir, startupFiles.at(-1)));

    const state = await fetchJson(`${baseUrl}/api/state?accountId=a-studio`);
    assert.ok(Array.isArray(state.resources) && state.resources.length > 0, "Seed data has no resources to import.");
    state.resources[0].name = PERIODIC_RESOURCE_NAME;
    const importResult = await fetchJson(`${baseUrl}/api/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "a-studio", data: state }),
    });
    assert.ok(importResult.imported > 0, "The deployed import worker imported no rows.");

    const periodicFiles = await waitFor({
      description: "a periodic snapshot after the import",
      timeoutMs: PERIODIC_TIMEOUT_MS,
      check: async () => {
        const files = await snapshotFiles(backupDir);
        return files.length > startupFiles.length ? files : null;
      },
      childOutcome: () => childOutcome,
    });
    inspectSnapshot(join(backupDir, periodicFiles.at(-1)), PERIODIC_RESOURCE_NAME);

    const result = await terminate(child, exitPromise);
    assert.deepEqual(
      result,
      { code: 0, signal: null, error: null },
      `Unexpected packaged server exit: ${JSON.stringify(result)}`,
    );
    passed = true;
    console.log(
      JSON.stringify({
        node: process.version,
        importWorker: "passed",
        startupSnapshot: "passed",
        periodicSnapshot: "passed",
        seededResources: Number(seededResources),
        shutdown: "clean",
      }),
    );
  } finally {
    try {
      if (child.exitCode === null && child.signalCode === null) await terminate(child, exitPromise);
    } catch (error) {
      log += `\nSmoke cleanup error: ${errorMessage(error)}\n`;
    }
    if (!passed) {
      console.error(`Packaged server output:\n${log || "(no output)"}`);
      try {
        await preserveFailureArtifacts(workDir, log, process.env.CAPACITYLENS_SMOKE_ARTIFACT_DIR);
      } catch (error) {
        console.error(`Could not preserve packaged smoke artifacts: ${errorMessage(error)}`);
      }
    }
    await rm(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

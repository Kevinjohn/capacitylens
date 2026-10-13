import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const STARTUP_TIMEOUT_MS = 30_000;
const PERIODIC_TIMEOUT_MS = 80_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const RESOURCE_NAME = "Bruce Wayne Packaged Schedule";

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

async function reservePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose())),
  );
  return address.port;
}

/** Use production posture with the incomplete off-mode backend explicitly enabled. */
export function buildSmokeEnvironment(inherited, { backupDir, databasePath, port }) {
  const environment = { ...inherited };
  delete environment.NODE_PATH;
  delete environment.NODE_OPTIONS;
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("CAPACITYLENS_") ||
      key.startsWith("BETTER_AUTH_") ||
      key.startsWith("VITE_CAPACITYLENS_") ||
      key.startsWith("SMALLSASS_ACCOUNT_")
    )
      delete environment[key];
  }
  return Object.assign(environment, {
    NODE_ENV: "production",
    PORT: String(port),
    HOST: "127.0.0.1",
    LOG_LEVEL: "info",
    APP_KEY: "capacitylens-packaged-smoke-key-0123456789abcdef",
    APP_URL: `http://127.0.0.1:${port}`,
    SESSION_DRIVER: "cookie",
    CAPACITYLENS_MODE: "off",
    CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION: "1",
    CAPACITYLENS_AUDIT: "on",
    CAPACITYLENS_DB: databasePath,
    CAPACITYLENS_BACKUP_DIR: backupDir,
    CAPACITYLENS_BACKUP_INTERVAL_MIN: "1",
    CAPACITYLENS_PUBLIC_URL: `http://127.0.0.1:${port}`,
  });
}

function command(backend, environment, ...args) {
  const result = spawnSync(process.execPath, ["ace.js", ...args], {
    cwd: backend,
    env: environment,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function inspectDatabase(path, expectedResourceName) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const journal = database.prepare("SELECT name FROM adonis_schema ORDER BY id").all();
    if (expectedResourceName) {
      const count = database
        .prepare("SELECT COUNT(*) AS count FROM resources WHERE name = ?")
        .get(expectedResourceName).count;
      assert.equal(count, 1, `${path} did not preserve the scheduling write.`);
    }
    return journal;
  } finally {
    database.close();
  }
}

async function snapshotFiles(directory) {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".db")).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function waitFor(description, timeoutMs, check, child) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child?.outcome) throw new Error(`Packaged server exited early: ${JSON.stringify(child.outcome)}`);
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${message(lastError)}` : ""}`);
}

async function fetchOk(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const body = await response.text();
  assert.ok(response.ok, `${options.method ?? "GET"} ${url} returned ${response.status}: ${body}`);
  return { response, body };
}

export function startServer(backend, environment, appendLog) {
  const processHandle = spawn(process.execPath, ["bin/server.js"], {
    cwd: backend,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  processHandle.stdout.setEncoding("utf8").on("data", appendLog);
  processHandle.stderr.setEncoding("utf8").on("data", appendLog);
  const child = { processHandle, outcome: null, exit: null };
  child.exit = new Promise((resolveExit) => {
    processHandle.once("error", (error) => {
      child.outcome = { error: message(error) };
      resolveExit(child.outcome);
    });
    processHandle.once("exit", (code, signal) => {
      child.outcome = { code, signal };
      resolveExit(child.outcome);
    });
  });
  return child;
}

async function stopServer(child) {
  if (child.outcome) return child.outcome;
  child.processHandle.kill("SIGTERM");
  const result = await Promise.race([child.exit, delay(SHUTDOWN_TIMEOUT_MS, null)]);
  if (result) return result;
  child.processHandle.kill("SIGKILL");
  await child.exit;
  throw new Error("The packaged server did not stop within 10 seconds of SIGTERM.");
}

async function assertReady(baseUrl, child) {
  return waitFor(
    "readiness",
    STARTUP_TIMEOUT_MS,
    async () => {
      const response = await fetch(`${baseUrl}/health/ready`, { signal: AbortSignal.timeout(1_000) });
      return response.ok;
    },
    child,
  );
}

async function main() {
  const backend = resolve(process.argv.slice(2).find((argument) => argument !== "--") ?? "");
  if (!process.argv[2]) throw new Error("Usage: pnpm run smoke:packaged-server <extracted-artifact>/backend");
  await stat(join(backend, "bin", "server.js"));
  const workDir = await mkdtemp(join(tmpdir(), "capacitylens_package_smoke_"));
  const databasePath = join(workDir, "live.db");
  const backupDir = join(workDir, "backups");
  const port = await reservePort();
  const environment = buildSmokeEnvironment(process.env, { backupDir, databasePath, port });
  const baseUrl = `http://127.0.0.1:${port}`;
  let log = "";
  let child;
  let passed = false;
  try {
    const initial = command(backend, environment, "app:upgrade");
    assert.equal(initial.status, 0, initial.output);
    assert.equal(inspectDatabase(databasePath).length, 5);

    const rollback = command(backend, environment, "migration:rollback", "--step=4", "--force", "--no-schema-generate");
    assert.equal(rollback.status, 0, rollback.output);
    assert.equal(inspectDatabase(databasePath).length, 1);
    const upgrade = command(backend, environment, "app:upgrade");
    assert.equal(upgrade.status, 0, upgrade.output);
    assert.match(upgrade.output, /Pre-upgrade backup written/);
    assert.equal(inspectDatabase(databasePath).length, 5);
    assert.equal(inspectDatabase(join(backupDir, "capacitylens-pre-migration-v1-to-v5.db")).length, 1);

    const unknown = new DatabaseSync(databasePath);
    const lastName = unknown.prepare("SELECT name FROM adonis_schema ORDER BY id DESC LIMIT 1").get().name;
    unknown.prepare("UPDATE adonis_schema SET name = ? WHERE name = ?").run("database/migrations/unknown", lastName);
    unknown.close();
    const refused = command(backend, environment, "app:upgrade");
    assert.notEqual(refused.status, 0, refused.output);
    assert.match(refused.output, /Migration journal is inconsistent/);
    const restored = new DatabaseSync(databasePath);
    restored.prepare("UPDATE adonis_schema SET name = ? WHERE name = ?").run(lastName, "database/migrations/unknown");
    restored.close();

    child = startServer(backend, environment, (chunk) => {
      log += chunk;
    });
    await assertReady(baseUrl, child);
    const html = (await fetchOk(`${baseUrl}/`)).body;
    assert.match(html, /<html/);
    const asset = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
    assert.ok(asset, "The packaged SPA has no hashed asset reference.");
    const assetResponse = await fetchOk(`${baseUrl}${asset}`);
    assert.ok(assetResponse.body.length > 0);
    const spa = await fetchOk(`${baseUrl}/team`);
    assert.match(spa.body, /<html/);

    const { seed } = await import(
      pathToFileURL(join(backend, "node_modules", "@capacitylens", "shared", "dist", "data", "seed.js")).href
    );
    const fixture = seed();
    const account = fixture.accounts.find((row) => row.id === "a-studio");
    assert.ok(account);
    await fetchOk(`${baseUrl}/api/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify(account),
    });
    const resource = {
      ...fixture.resources.find((row) => row.kind === "person" && row.accountId === "a-studio"),
      name: RESOURCE_NAME,
    };
    assert.ok(resource.id);
    const discipline = fixture.disciplines.find((row) => row.id === resource.disciplineId);
    assert.ok(discipline);
    await fetchOk(`${baseUrl}/api/batch`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify({
        ops: [
          { method: "PUT", table: "disciplines", id: discipline.id, row: discipline },
          { method: "PUT", table: "resources", id: resource.id, row: resource },
        ],
      }),
    });
    assert.equal(inspectDatabase(databasePath, RESOURCE_NAME).length, 5);

    const beforeExplicit = await snapshotFiles(backupDir);
    const explicit = command(backend, environment, "db:backup");
    assert.equal(explicit.status, 0, explicit.output);
    const explicitPath = explicit.output.match(/Backup written (\S+\.db)/)?.[1];
    assert.ok(explicitPath, `Backup command did not name its snapshot: ${explicit.output}`);
    const afterExplicit = await snapshotFiles(backupDir);
    assert.ok(!beforeExplicit.includes(explicitPath.split("/").at(-1)));
    assert.ok(afterExplicit.includes(explicitPath.split("/").at(-1)));
    assert.equal(inspectDatabase(explicitPath, RESOURCE_NAME).length, 5);
    const scheduled = await waitFor(
      "a scheduled snapshot after the write",
      PERIODIC_TIMEOUT_MS,
      async () => {
        const files = await snapshotFiles(backupDir);
        const matching = files.filter((name) => name !== "capacitylens-pre-migration-v1-to-v5.db");
        if (matching.length <= afterExplicit.length - 1) return null;
        const latest = matching.at(-1);
        inspectDatabase(join(backupDir, latest), RESOURCE_NAME);
        return latest;
      },
      child,
    );
    assert.ok(scheduled);

    assert.deepEqual(await stopServer(child), { code: 0, signal: null });
    child = startServer(backend, environment, (chunk) => {
      log += chunk;
    });
    await assertReady(baseUrl, child);
    const state = JSON.parse((await fetchOk(`${baseUrl}/api/state?accountId=a-studio`)).body);
    assert.equal(state.resources.find((row) => row.id === resource.id)?.name, RESOURCE_NAME);
    assert.deepEqual(await stopServer(child), { code: 0, signal: null });
    passed = true;
    console.log(
      JSON.stringify({
        node: process.version,
        nativeArtifact: "passed",
        migrations: 5,
        scheduleWrite: "persisted",
        explicitBackup: "verified",
        scheduledBackup: "verified",
        upgradeSnapshot: "verified",
        unknownJournal: "refused",
        shutdown: "clean",
      }),
    );
  } finally {
    if (child && !child.outcome) {
      try {
        await stopServer(child);
      } catch (error) {
        log += `\nCleanup: ${message(error)}\n`;
      }
    }
    if (!passed) {
      console.error(`Packaged server output:\n${log || "(no output)"}`);
      if (process.env.CAPACITYLENS_SMOKE_ARTIFACT_DIR) {
        try {
          await mkdir(process.env.CAPACITYLENS_SMOKE_ARTIFACT_DIR, { recursive: true });
          await writeFile(join(process.env.CAPACITYLENS_SMOKE_ARTIFACT_DIR, "packaged-server.log"), log);
          await cp(workDir, join(process.env.CAPACITYLENS_SMOKE_ARTIFACT_DIR, "packaged-server-state"), {
            recursive: true,
            force: true,
          });
        } catch (error) {
          console.error(`Could not preserve packaged smoke artifacts: ${message(error)}`);
        }
      }
    }
    await rm(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

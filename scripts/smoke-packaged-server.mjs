import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const RESOURCE_NAME = "Bruce Wayne Packaged Schedule";
// The packaged schema includes the baseline, restoration groups, action proofs, and restoration origin.
const MIGRATION_COUNT = 4;

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

/** Use native password authentication and database sessions in a private loopback fixture. */
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
    SESSION_DRIVER: "database",
    CAPACITYLENS_MODE: "password-only",
    CAPACITYLENS_SECRET: "capacitylens-packaged-secret-0123456789abcdef",
    CAPACITYLENS_SETUP_TOKEN: "capacitylens-packaged-setup-0123456789abcdef",
    CAPACITYLENS_PASSWORD_BREACH_CHECK: "false",
    CAPACITYLENS_AUDIT: "on",
    CAPACITYLENS_DB: databasePath,
    CAPACITYLENS_BACKUP_DIR: backupDir,
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

/** Set up one disposable company for a real signed-in principal in the private smoke database. */
export function createSmokeCompany(databasePath, userId, account, internalClient) {
  const database = new DatabaseSync(databasePath);
  const accountId = randomUUID();
  const now = new Date().toISOString();
  try {
    database.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    assert.ok(database.prepare("SELECT id FROM users WHERE id = ?").get(userId), "Smoke principal must exist");
    const internal = internalClient(accountId, now);
    database
      .prepare(
        `INSERT INTO accounts (id, name, color, scheduling_mode, inline_activity_create_enabled, created_at, updated_at)
       VALUES (?, ?, ?, 'days', 'false', ?, ?)`,
      )
      .run(accountId, account.name, account.color, now, now);
    database
      .prepare(
        `INSERT INTO clients (id, account_id, name, color, builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'true', ?, ?)`,
      )
      .run(internal.id, accountId, internal.name, internal.color, now, now);
    database
      .prepare(
        `INSERT INTO memberships (id, account_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'owner', 'active', ?, ?)`,
      )
      .run(randomUUID(), accountId, userId, now, now);
    database.prepare("INSERT INTO company_planning_revisions (account_id, revision) VALUES (?, 1)").run(accountId);
    database.exec("COMMIT");
    return accountId;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

/** Write one resource through the authenticated typed planning route. */
export async function writeSmokeSchedule(baseUrl, cookie, accountId, fixture) {
  const account = fixture.accounts.find((row) => row.id === "a-studio");
  assert.ok(account);
  const resource = {
    ...fixture.resources.find((row) => row.kind === "person" && row.accountId === "a-studio"),
    id: randomUUID(),
    name: RESOURCE_NAME,
  };
  assert.ok(resource.id);
  await fetchOk(`${baseUrl}/api/accounts/${accountId}/resources`, {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", cookie },
    body: JSON.stringify({
      mutationId: randomUUID(),
      baseRevision: 1,
      intent: {
        operation: "resource.create",
        id: resource.id,
        fields: {
          kind: "person",
          name: resource.name,
          role: resource.role,
          avatarUrl: null,
          disciplineId: null,
          employmentType: resource.employmentType,
          engagement: resource.engagement,
          workingHoursPerDay: resource.workingHoursPerDay,
          workingDays: resource.workingDays,
          halfDays: resource.halfDays,
          projectId: null,
          color: resource.color,
          isFavourite: false,
          firstAvailableDate: null,
          lastAvailableDate: null,
        },
      },
    }),
  });
  return { accountId, resource };
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
    await stat(join(backend, "ace.js"));
    const initial = command(backend, environment, "app:upgrade");
    assert.equal(initial.status, 0, initial.output);
    assert.doesNotMatch(initial.output, /Pre-upgrade backup written/);
    assert.equal(inspectDatabase(databasePath).length, MIGRATION_COUNT);

    const upgradeDir = join(workDir, "upgrade snapshots");
    const upgrade = command(backend, { ...environment, CAPACITYLENS_BACKUP_DIR: upgradeDir }, "app:upgrade");
    assert.equal(upgrade.status, 0, upgrade.output);
    const upgradeSnapshot = upgrade.output.match(/Pre-upgrade backup written (.+\.db)/)?.[1];
    assert.ok(upgradeSnapshot, `Upgrade did not name its snapshot: ${upgrade.output}`);
    assert.match(upgradeSnapshot, /capacitylens-pre-migration-utc-/);
    assert.equal(inspectDatabase(upgradeSnapshot).length, MIGRATION_COUNT);
    assert.equal(inspectDatabase(databasePath).length, MIGRATION_COUNT);

    const beforeStartup = await snapshotFiles(backupDir);
    child = startServer(backend, environment, (chunk) => {
      log += chunk;
    });
    await assertReady(baseUrl, child);
    const scheduledAtStartup = await waitFor(
      "the daily scheduled startup snapshot",
      STARTUP_TIMEOUT_MS,
      async () => {
        const files = await snapshotFiles(backupDir);
        const created = files.find((name) => !beforeStartup.includes(name));
        if (!created) return null;
        inspectDatabase(join(backupDir, created));
        return created;
      },
      child,
    );
    assert.ok(scheduledAtStartup);
    const html = (await fetchOk(`${baseUrl}/`)).body;
    assert.match(html, /<html/);
    const asset = html.match(/(?:src|href)="(\/assets\/[^"]+)"/)?.[1];
    assert.ok(asset, "The packaged SPA has no hashed asset reference.");
    const assetResponse = await fetchOk(`${baseUrl}${asset}`);
    assert.ok(assetResponse.body.length > 0);
    const spa = await fetchOk(`${baseUrl}/team`);
    assert.match(spa.body, /<html/);

    const credentials = { email: "bruce@wayne.example", password: "packaged-password-2026" };
    const signup = await fetch(`${baseUrl}/api/auth/sign-up`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        "x-capacitylens-setup-token": environment.CAPACITYLENS_SETUP_TOKEN,
      },
      body: JSON.stringify({ ...credentials, name: "Bruce Wayne" }),
    });
    assert.equal(signup.status, 201, "Packaged native signup failed");
    let cookie = signup.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    await fetchOk(`${baseUrl}/api/auth/sign-out`, {
      method: "POST",
      headers: { cookie, "sec-fetch-site": "same-origin" },
    });
    const signin = await fetch(`${baseUrl}/api/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: JSON.stringify(credentials),
    });
    assert.equal(signin.status, 200, "Packaged native sign-in failed");
    cookie = signin.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    assert.ok(cookie, "Native sign-in did not return a session cookie");
    const session = JSON.parse((await fetchOk(`${baseUrl}/api/auth/me`, { headers: { cookie } })).body);
    assert.equal(session.user.email, credentials.email);

    const sharedDataUrl = join(backend, "node_modules", "@capacitylens", "shared", "dist", "data");
    const { seed } = await import(
      pathToFileURL(join(backend, "node_modules", "@capacitylens", "shared", "dist", "data", "seed.js")).href
    );
    const { buildInternalClient } = await import(pathToFileURL(join(sharedDataUrl, "internalClient.js")).href);
    const fixture = seed();
    const accountId = createSmokeCompany(
      databasePath,
      session.user.id,
      fixture.accounts.find((row) => row.id === "a-studio"),
      buildInternalClient,
    );
    const { resource } = await writeSmokeSchedule(baseUrl, cookie, accountId, fixture);
    assert.equal(inspectDatabase(databasePath, RESOURCE_NAME).length, MIGRATION_COUNT);

    const beforeExplicit = await snapshotFiles(backupDir);
    const explicit = command(backend, environment, "db:backup");
    assert.equal(explicit.status, 0, explicit.output);
    const explicitPath = explicit.output.match(/Backup written (\S+\.db)/)?.[1];
    assert.ok(explicitPath, `Backup command did not name its snapshot: ${explicit.output}`);
    const afterExplicit = await snapshotFiles(backupDir);
    assert.ok(!beforeExplicit.includes(explicitPath.split("/").at(-1)));
    assert.ok(afterExplicit.includes(explicitPath.split("/").at(-1)));
    assert.equal(inspectDatabase(explicitPath, RESOURCE_NAME).length, MIGRATION_COUNT);

    assert.deepEqual(await stopServer(child), { code: 0, signal: null });
    child = startServer(backend, environment, (chunk) => {
      log += chunk;
    });
    await assertReady(baseUrl, child);
    const state = JSON.parse(
      (await fetchOk(`${baseUrl}/api/state?accountId=${encodeURIComponent(accountId)}`, { headers: { cookie } })).body,
    );
    assert.equal(state.resources.find((row) => row.id === resource.id)?.name, RESOURCE_NAME);
    assert.deepEqual(await stopServer(child), { code: 0, signal: null });
    passed = true;
    console.log(
      JSON.stringify({
        node: process.version,
        nativeArtifact: "passed",
        migrations: MIGRATION_COUNT,
        passwordAuthentication: "verified",
        databaseSession: "survived restart",
        scheduleWrite: "persisted",
        explicitBackup: "verified",
        scheduledStartupBackup: "verified",
        upgradeSnapshot: "verified",
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

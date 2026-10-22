import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { gateCommands } from "./gateCommands.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("./run-gate.mjs", import.meta.url));

function fixture(t, installCommand = true) {
  const directory = mkdtempSync(join(tmpdir(), "ordered-gates-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const log = join(directory, "commands.jsonl");
  if (installCommand) {
    const command = join(directory, "pnpm");
    const source = readFileSync(new URL("./__tests__/gate-command.mjs", import.meta.url), "utf8");
    writeFileSync(`${command}.mjs`, source);
    if (process.platform === "win32") writeFileSync(`${command}.cmd`, `@"${process.execPath}" "${command}.mjs" %*\r\n`);
    else {
      writeFileSync(command, `#!${process.execPath}\n${source}`);
      chmodSync(command, 0o755);
    }
  }
  return {
    log,
    run(args, extra = {}) {
      rmSync(log, { force: true });
      return spawnSync(process.execPath, [cli, ...args], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: installCommand ? `${directory}${delimiter}${process.env.PATH}` : directory,
          CAPACITYLENS_GATE_LOG: log,
          CAPACITYLENS_GATE_SENTINEL: "preserved value",
          CAPACITYLENS_GATE_FAIL_COMMAND: "",
          CAPACITYLENS_GATE_SIGNAL: "",
          CAPACITYLENS_GATE_FAIL_CODE: "",
          ...extra,
        },
        encoding: "utf8",
        timeout: 30_000,
      });
    },
    entries() {
      return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [];
    },
  };
}

test("all gates execute their ordered commands once, from the repository, with inherited environment", (t) => {
  const fake = fixture(t);
  for (const gate of ["app", "backend", "all"]) {
    const result = fake.run([gate]);
    assert.equal(result.status, 0, result.stderr);
    const entries = fake.entries();
    assert.deepEqual(
      entries.map(({ args }) => args),
      gateCommands(gate),
    );
    assert.ok(
      entries.every(({ cwd, sentinel }) => cwd === root.replace(/[\\/]$/, "") && sentinel === "preserved value"),
    );
  }
});

test("a command failure keeps its exit code and prevents every later check", (t) => {
  const fake = fixture(t);
  for (const gate of ["app", "backend", "all"]) {
    const commands = gateCommands(gate);
    const failing = commands.findIndex((args) => args.includes("policy:ports"));
    assert.ok(failing > 0);
    const result = fake.run([gate], {
      CAPACITYLENS_GATE_FAIL_COMMAND: JSON.stringify(commands[failing]),
      CAPACITYLENS_GATE_FAIL_CODE: "17",
    });
    assert.equal(result.status, 17, result.stderr);
    assert.deepEqual(
      fake.entries().map(({ args }) => args),
      commands.slice(0, failing + 1),
    );
  }
});

test("a terminated child is reported through the repository launcher policy and stops the gate", (t) => {
  const fake = fixture(t);
  const first = gateCommands("app")[0];
  const result = fake.run(["app"], {
    CAPACITYLENS_GATE_FAIL_COMMAND: JSON.stringify(first),
    CAPACITYLENS_GATE_SIGNAL: "SIGTERM",
  });
  assert.notEqual(result.status, 0);
  if (process.platform !== "win32") assert.match(result.stderr, /terminated by SIGTERM/);
  assert.equal(fake.entries().length, 1);
});

test("a missing executable fails visibly before another command can run", (t) => {
  const fake = fixture(t, false);
  const result = fake.run(["backend"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /could not start/);
  assert.deepEqual(fake.entries(), []);
});

test("invalid modes and extra arguments fail before launching anything", (t) => {
  const fake = fixture(t);
  for (const args of [[], ["unknown"], ["constructor"], ["__proto__"], ["app", "extra"]]) {
    const result = fake.run(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Expected app, backend, or all/);
    assert.deepEqual(fake.entries(), []);
  }
});

test("all mode runs shared checks once before the app-only and server-only checks", () => {
  const app = gateCommands("app");
  const server = gateCommands("backend");
  const all = gateCommands("all");
  const key = (args) => JSON.stringify(args);
  const appKeys = new Set(app.map(key));
  const serverKeys = new Set(server.map(key));
  const sharedKeys = new Set(app.filter((args) => serverKeys.has(key(args))).map(key));
  const expectedKeys = new Set([...app, ...server].map(key));
  const actualKeys = all.map(key);
  const sharedPrefix = all.slice(0, sharedKeys.size);
  const lastAppOnly = all.findLastIndex((args) => appKeys.has(key(args)) && !sharedKeys.has(key(args)));
  const firstServerOnly = all.findIndex((args) => serverKeys.has(key(args)) && !sharedKeys.has(key(args)));

  assert.deepEqual(new Set(actualKeys), expectedKeys);
  assert.equal(new Set(actualKeys).size, actualKeys.length);
  assert.ok(sharedPrefix.every((args) => sharedKeys.has(key(args))));
  assert.ok(all.slice(sharedKeys.size).every((args) => !sharedKeys.has(key(args))));
  assert.deepEqual(
    sharedPrefix,
    server.filter((args) => sharedKeys.has(key(args))),
  );
  assert.deepEqual(
    all.filter((args) => appKeys.has(key(args)) && !sharedKeys.has(key(args))),
    app.filter((args) => !sharedKeys.has(key(args))),
  );
  assert.deepEqual(
    all.filter((args) => serverKeys.has(key(args)) && !sharedKeys.has(key(args))),
    server.filter((args) => !sharedKeys.has(key(args))),
  );
  assert.ok(lastAppOnly >= 0 && firstServerOnly >= 0 && lastAppOnly < firstServerOnly);
});

test("mode selection returns independent argument arrays and includes the runner's regressions", () => {
  const first = gateCommands("app");
  first[0].push("mutated");
  assert.ok(!gateCommands("app")[0].includes("mutated"));
  for (const mode of ["app", "backend", "all"]) {
    assert.ok(gateCommands(mode).some((args) => args.includes("policy:gate-runner:test")));
  }
  assert.throws(() => gateCommands("unknown"), /Expected app, backend, or all/);
});

test("gateCommands('all') excludes every retired custom structural check", () => {
  const names = gateCommands("all").map((args) => args.join(" "));
  for (const retired of [
    "policy:typed-lint:test",
    "policy:shared-environment:test",
    "policy:typecheck-graph:test",
    "policy:build-tsconfig:test",
    "policy:script-environments:test",
    "policy:import-cycles",
    "policy:dependencies:test",
    "security:crypto-inventory",
  ]) {
    assert.ok(!names.includes(`run ${retired}`), retired);
  }
});

test("gateCommands('all') includes every retained policy, package and security check", () => {
  const names = gateCommands("all").map((args) => args.join(" "));
  for (const retained of [
    "policy:gate-runner:test",
    "policy:ports",
    "policy:ports:test",
    "policy:sonner-csp:test",
    "package:managed-release:test",
    "security:screenshot-publication",
    "security:screenshot-publication:test",
    "policy:dependabot",
    "policy:dependabot:test",
    "security:gitleaks-config",
    "policy:dco:test",
    "policy:workflow-report:test",
    "policy:node-runtime:test",
  ]) {
    assert.ok(names.includes(`run ${retained}`), retained);
  }
});

test("backend and combined gates build application assets once before runtime checks and backend tests", () => {
  for (const mode of ["backend", "all"]) {
    const commands = gateCommands(mode);
    const builds = commands.flatMap((args, index) => (args[0] === "run" && args[1] === "build" ? [index] : []));
    assert.equal(builds.length, 1);
    const runtime = commands.findIndex((args) => args.includes("policy:node-runtime:test"));
    const backendTests = commands.findIndex(
      (args) => args[0] === "--dir" && args[1] === "apps/backend" && args[2] === "test",
    );
    assert.ok(builds[0] < runtime && runtime < backendTests);
    if (mode === "all") {
      const frontendTests = commands.findIndex((args) => args.includes("vitest"));
      assert.ok(builds[0] < frontendTests);
    }
  }
});

test("only the root production build receives production settings while tests retain their environment", (t) => {
  const fake = fixture(t);
  const result = fake.run(["app"], { NODE_ENV: "test", CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION: "0" });
  assert.equal(result.status, 0, result.stderr);
  for (const entry of fake.entries()) {
    const build = entry.args[0] === "run" && entry.args[1] === "build";
    assert.equal(entry.nodeEnv, build ? "production" : "test", entry.args.join(" "));
    assert.equal(entry.allowOpen, build ? "1" : "0", entry.args.join(" "));
  }
});

test("backend CI builds actual application assets before tests without leaking production settings", async () => {
  const { parse } = await import("yaml");
  const workflow = parse(readFileSync(new URL("../.github/workflows/gate.yml", import.meta.url), "utf8"));
  const backend = workflow.jobs.backend;
  const buildIndex = backend.steps.findIndex((step) => step.run === "pnpm run build");
  const testIndex = backend.steps.findIndex((step) => step.run === "pnpm --dir apps/backend test");
  assert.ok(buildIndex >= 0 && buildIndex < testIndex);
  const build = backend.steps[buildIndex];
  assert.equal(build.env.NODE_ENV, "production");
  assert.equal(build.env.CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION, "1");
  for (const key of ["APP_KEY", "APP_URL", "HOST", "PORT", "LOG_LEVEL", "SESSION_DRIVER"])
    assert.ok(build.env[key], key);
  assert.notEqual(backend.env?.NODE_ENV, "production");
  assert.notEqual(backend.steps[testIndex].env?.NODE_ENV, "production");
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseDocument } from "yaml";
import { gateCommands } from "./gate-commands.mjs";
import { validateDependabot } from "./check-dependabot.mjs";

const entry = (changes = {}) => ({
  "package-ecosystem": "npm",
  directory: "/",
  schedule: { interval: "monthly" },
  ...changes,
});
const config = (updates = [entry()]) => ({ version: 2, updates });

test("accepts the checked-in YAML and the existing three schedule choices", () => {
  assert.equal(validateDependabot(readFileSync(new URL("../.github/dependabot.yml", import.meta.url), "utf8")), 3);
  for (const interval of ["daily", "weekly", "monthly"]) {
    assert.equal(validateDependabot(JSON.stringify(config([entry({ schedule: { interval } })]))), 1);
  }
  assert.equal(validateDependabot(JSON.stringify(config([entry(), entry({ "package-ecosystem": "docker" })]))), 2);
  assert.equal(validateDependabot(JSON.stringify(config([entry({ directory: "", "package-ecosystem": "" })]))), 1);
});

test("rejects invalid version, updates, entry fields and schedules with a useful diagnostic", () => {
  for (const value of [null, [], {}, { version: "2" }, { version: 1 }]) {
    assert.throws(() => validateDependabot(JSON.stringify(value)), /version must be 2/);
  }
  for (const updates of [undefined, null, {}, "updates", []]) {
    assert.throws(() => validateDependabot(JSON.stringify({ version: 2, updates })), /non-empty list/);
  }
  for (const value of [undefined, null, 1, true, [], {}]) {
    assert.throws(
      () => validateDependabot(JSON.stringify(config([entry({ "package-ecosystem": value })]))),
      /package-ecosystem/,
    );
    assert.throws(() => validateDependabot(JSON.stringify(config([entry({ directory: value })]))), /directory/);
  }
  for (const schedule of [undefined, null, [], {}, 1, "monthly", { interval: "yearly" }, { interval: true }]) {
    assert.throws(() => validateDependabot(JSON.stringify(config([entry({ schedule })]))), /schedule/);
  }
  for (const invalid of [null, [], "entry", 1]) {
    assert.throws(() => validateDependabot(JSON.stringify(config([entry(), invalid]))), /package-ecosystem/);
  }
});

test("retains YAML 1.1 scalar types and rejects aliases, unsafe tags and timestamps", () => {
  const valid =
    "version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n    schedule: {interval: monthly}\n";
  assert.equal(validateDependabot(valid), 1);
  for (const value of ["yes", "off", "2026-09-05"]) {
    assert.throws(() => validateDependabot(valid.replace("directory: /", `directory: ${value}`)));
  }
  for (const addition of [
    "extra: !unknown value\n",
    "extra: !!set {one: null}\n",
    "extra: 2026-09-05\n",
    "extra: &value hello\nother: *value\n",
  ]) {
    assert.throws(() => validateDependabot(valid + addition));
  }
  assert.equal(validateDependabot(valid + "extra: &unused hello\n"), 1);
});

test("fails closed on syntax errors, duplicate keys and multiple YAML documents", () => {
  for (const source of [
    "version: [",
    `version: 1\nversion: 2\nupdates: ${JSON.stringify([entry()])}`,
    `${JSON.stringify(config())}\n---\nversion: 1`,
  ]) {
    assert.throws(() => validateDependabot(source));
  }
});

test("CLI reports success and fails on invalid content, missing files and extra arguments", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "dependabot-validator-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "configuration with spaces.yml");
  const cli = fileURLToPath(new URL("./check-dependabot.mjs", import.meta.url));
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: "utf8", timeout: 10_000 });
  const current = run();
  assert.equal(current.status, 0, current.stderr);
  assert.match(current.stdout, /3 update entries verified/);
  writeFileSync(path, JSON.stringify(config()));
  assert.equal(run(path).status, 0);
  writeFileSync(path, "version: 1");
  const invalid = run(path);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /version must be 2/);
  rmSync(path);
  const missing = run(path);
  assert.match(missing.stderr, /ENOENT/);
  assert.equal(missing.status, 1);
  const extra = run(path, "extra");
  assert.match(extra.stderr, /optional configuration path/);
  assert.equal(extra.status, 1);
});

test("the application gate owns configuration validation and its regressions in CI", () => {
  const commands = gateCommands("app");
  for (const command of ["policy:dependabot", "policy:dependabot:test"]) {
    assert.equal(commands.filter((args) => args.join(" ") === `run ${command}`).length, 1);
  }
  const workflow = parseDocument(
    readFileSync(new URL("../.github/workflows/gate.yml", import.meta.url), "utf8"),
  ).toJS();
  assert.ok(workflow.jobs.application.steps.some(({ run }) => run === "pnpm run gate"));
  assert.ok(!workflow.jobs["workflow-lint"].steps.some(({ run }) => run?.includes("ruby -e")));
});

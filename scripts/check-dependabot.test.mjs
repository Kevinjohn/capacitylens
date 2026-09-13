import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// The dependabot-summary workflow's shell step pipes through host `jq`, which is not
// installed by default on every contributor machine (notably macOS). Skip with a clear
// reason instead of failing on an unrelated missing-binary error.
const hasJq = spawnSync("jq", ["--version"], { stdio: "ignore" }).status === 0;

function loadDependabotSummaryRun() {
  const run = parseDocument(readFileSync(new URL("../.github/workflows/dependabot-summary.yml", import.meta.url), "utf8"))
    .toJS()
    .jobs.summary.steps.find((step) => typeof step.run === "string" && step.run.includes("set -euo pipefail"))?.run;
  assert.equal(typeof run, "string", "expected the dependabot-summary workflow's shell step");
  return run;
}

const runDependabotSummary = (pages, t) => {
  const dependabotSummaryRun = loadDependabotSummaryRun();
  const directory = mkdtempSync(join(tmpdir(), "dependabot-summary-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = join(directory, "commits.json");
  const comment = join(directory, "comment.md");
  const gh = join(directory, "gh");
  writeFileSync(fixture, JSON.stringify(pages));
  writeFileSync(
    gh,
    `#!/bin/sh
if [ "$1" = api ]; then
  case "$2" in
    */commits)
      # Real "gh api --paginate --slurp" wraps every page into one array; without
      # --slurp, --paginate just prints each page's own JSON array back-to-back with
      # no wrapper. Branching on the flag here is what makes this shim exercise the
      # production script's actual "--slurp" pipeline rather than only its jq filter.
      case " $* " in
        *" --slurp "*) cat "$DEPENDABOT_COMMITS_FIXTURE" ;;
        *) node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.env.DEPENDABOT_COMMITS_FIXTURE, 'utf8')).map((page) => JSON.stringify(page)).join(''))" ;;
      esac
      ;;
    */comments) printf '\\n' ;;
  esac
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = comment ]; then
  cat > "$DEPENDABOT_COMMENT_OUTPUT"
  exit 0
fi
exit 1
`,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", ["-euo", "pipefail", "-c", dependabotSummaryRun], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      DEPENDABOT_COMMITS_FIXTURE: fixture,
      DEPENDABOT_COMMENT_OUTPUT: comment,
      HEAD_REF: "dependabot/npm_and_yarn/example",
      PATH: `${directory}:${process.env.PATH}`,
      PR: "123",
      REPO: "example/repository",
    },
  });
  return { comment: existsSync(comment) ? readFileSync(comment, "utf8") : "", result };
};

test("summarises only the newest Dependabot commit across paginated responses", { skip: !hasJq && "jq is not installed" }, (t) => {
  const { comment, result } = runDependabotSummary(
    [
      [
        {
          author: { login: "dependabot[bot]" },
          commit: {
            message:
              "- dependency-name: old-name\n  dependency-version: 1.0.0\n  update-type: version-update:semver-patch\nBumps old-name from `0.9.0` to `1.0.0`.",
          },
        },
        { author: { login: "maintainer" }, commit: { message: "Merge branch main" } },
      ],
      [
        {
          author: { login: "dependabot[bot]" },
          commit: {
            message:
              "- dependency-name: new-name\n  dependency-version: 2.0.0\n  update-type: version-update:semver-minor\nBumps new-name from `1.0.0` to `2.0.0`.",
          },
        },
      ],
    ],
    t,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(comment, /`new-name`/);
  assert.match(comment, /moved from `1\.0\.0` to `2\.0\.0` \(a minor change\)/);
  assert.doesNotMatch(comment, /old-name|0\.9\.0/);
});

test("exits without a summary when no paginated commit is authored by Dependabot", { skip: !hasJq && "jq is not installed" }, (t) => {
  const { comment, result } = runDependabotSummary(
    [
      [{ author: { login: "maintainer" }, commit: { message: "Merge branch main" } }],
      [{ author: { login: "release-bot" }, commit: { message: "Release" } }],
    ],
    t,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /No Dependabot commit found/);
  assert.equal(comment, "");
});

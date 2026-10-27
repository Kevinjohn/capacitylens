import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { changedPaths, planChecks, ranNoTests, runStep, testCount } from "./check-changed.mjs";

const everything = () => true;
const noImporters = () => [];
const labels = (steps) => steps.map((step) => step.label);
const step = (steps, prefix) => steps.find((candidate) => candidate.label.startsWith(prefix));

test("a backend spec-only change runs each spec through its own --files flag", () => {
  const steps = planChecks(
    ["apps/backend/tests/functional/a.spec.ts", "apps/backend/tests/unit/b.spec.ts"],
    everything,
  );
  assert.deepEqual(step(steps, "test: 2 backend spec").args, [
    "--dir",
    "apps/backend",
    "test",
    "--files",
    "tests/functional/a.spec.ts",
    "--files",
    "tests/unit/b.spec.ts",
  ]);
  assert.ok(step(steps, "prepare: build @capacitylens/shared"));
  assert.equal(step(steps, "test: backend suite"), undefined);
});

test("backend source or shared package changes run the full backend suite", () => {
  for (const path of ["apps/backend/app/services/planning.ts", "packages/shared/src/domain/errors.ts"]) {
    const steps = planChecks([path, "apps/backend/tests/unit/b.spec.ts"], everything);
    assert.deepEqual(step(steps, "test: backend suite").args, ["--dir", "apps/backend", "test"], path);
    assert.equal(step(steps, "test: 1 backend spec"), undefined, path);
    assert.ok(step(steps, "prepare: build @capacitylens/shared"), path);
    assert.equal(step(steps, "prepare: build backend client types"), undefined, path);
  }
});

test("frontend and shared source run related frontend tests, lint and the type-check", () => {
  const steps = planChecks(["apps/frontend/src/App.tsx", "packages/shared/src/lib/color.ts"], everything);
  assert.deepEqual(step(steps, "test: frontend tests related").args.slice(-2), [
    "../../apps/frontend/src/App.tsx",
    "../../packages/shared/src/lib/color.ts",
  ]);
  assert.deepEqual(step(steps, "lint: frontend").args.slice(-1), ["src/App.tsx"]);
  assert.deepEqual(step(steps, "lint: 1 file").args.slice(-1), ["packages/shared/src/lib/color.ts"]);
  assert.ok(step(steps, "prepare: compile messages"));
  assert.deepEqual(step(steps, "prepare: build backend client types").args, [
    "--dir",
    "apps/backend",
    "typecheck:client",
  ]);
  assert.ok(step(steps, "typecheck"));
});

test("shared package metadata runs the full frontend suite and type-check", () => {
  for (const path of ["packages/shared/package.json", "packages/shared/tsconfig.json"]) {
    const steps = planChecks([path], everything);
    assert.deepEqual(
      step(steps, "test: frontend suite").args,
      ["--dir", "apps/frontend", "exec", "vitest", "run"],
      path,
    );
    assert.equal(step(steps, "test: frontend tests related"), undefined, path);
    assert.ok(step(steps, "typecheck"), path);
    assert.ok(step(steps, "test: backend suite"), path);
  }
});

test("deleted shared metadata runs the full frontend suite without passing deleted paths to tools", () => {
  const deleted = "packages/shared/tsconfig.json";
  const steps = planChecks([deleted], (path) => path !== deleted);
  assert.deepEqual(step(steps, "test: frontend suite").args, ["--dir", "apps/frontend", "exec", "vitest", "run"]);
  assert.ok(step(steps, "typecheck"));
  assert.ok(step(steps, "test: backend suite"));
  assert.equal(step(steps, "lint: 1 file"), undefined);
  assert.equal(step(steps, "format"), undefined);
});

test("shared metadata mixed with source uses the full frontend suite", () => {
  const steps = planChecks(["packages/shared/package.json", "packages/shared/src/lib/color.ts"], everything);
  assert.ok(step(steps, "test: frontend suite"));
  assert.equal(step(steps, "test: frontend tests related"), undefined);
  assert.deepEqual(step(steps, "lint: 1 file").args.slice(-1), ["packages/shared/src/lib/color.ts"]);
});

test("shared documentation and source-only changes do not select the full frontend suite", () => {
  const readme = planChecks(["packages/shared/README.md"], everything);
  assert.equal(step(readme, "test: frontend suite"), undefined);
  assert.equal(step(readme, "typecheck"), undefined);

  const source = planChecks(["packages/shared/src/lib/color.ts"], everything);
  assert.ok(step(source, "test: frontend tests related"));
  assert.equal(step(source, "test: frontend suite"), undefined);
});

test("frontend configuration outside src runs the whole frontend suite", () => {
  const steps = planChecks(["apps/frontend/vite.config.ts", "apps/frontend/src/App.tsx"], everything);
  assert.deepEqual(step(steps, "test: frontend suite").args, ["--dir", "apps/frontend", "exec", "vitest", "run"]);
  assert.equal(step(steps, "test: frontend tests related"), undefined);
});

test("deleted paths select checks but are never passed to file tools", () => {
  const deleted = "apps/backend/app/services/removed.ts";
  const steps = planChecks([deleted, "README.md"], (path) => path !== deleted);
  assert.ok(step(steps, "typecheck"));
  assert.ok(step(steps, "test: backend suite"));
  assert.equal(step(steps, "lint: backend"), undefined);
  assert.deepEqual(step(steps, "format").args.slice(-1), ["README.md"]);
});

test("a changed script runs its own test file when one exists", () => {
  const steps = planChecks(
    ["scripts/lanes.mjs", "scripts/bundleBudget.mjs"],
    (path) => path !== "scripts/bundleBudget.test.mjs",
    noImporters,
  );
  assert.deepEqual(step(steps, "test: 1 script test").args, ["--test", "scripts/lanes.test.mjs"]);
  assert.equal(step(steps, "test: 1 script test").command, "node");
});

test("a changed script also runs the differently named test files that import it", () => {
  const steps = planChecks(["scripts/gateCommands.mjs"], everything, (path) =>
    path === "scripts/gateCommands.mjs" ? ["scripts/run-gate.test.mjs", "scripts/check-dependabot.test.mjs"] : [],
  );
  assert.deepEqual(step(steps, "test: 3 script test").args, [
    "--test",
    "scripts/gateCommands.test.mjs",
    "scripts/run-gate.test.mjs",
    "scripts/check-dependabot.test.mjs",
  ]);
  assert.deepEqual(
    step(
      planChecks(["scripts/gateCommands.mjs"], (path) => !path.endsWith("gateCommands.test.mjs")),
      "test:",
    ).args,
    ["--test", "scripts/check-dependabot.test.mjs", "scripts/run-gate.test.mjs"],
  );
});

test("a lint or format configuration change checks the whole repository", () => {
  const lint = planChecks(["apps/backend/eslint.config.js", "apps/frontend/src/App.tsx"], everything);
  assert.deepEqual(step(lint, "lint: whole repository").args, ["run", "lint"]);
  assert.equal(step(lint, "lint: frontend"), undefined);
  assert.equal(step(lint, "lint: backend"), undefined);
  const format = planChecks([".prettierignore", "README.md"], everything);
  assert.deepEqual(step(format, "format").args, ["run", "format:check"]);
});

test("a dependency or workspace change runs the type-check and both full suites", () => {
  for (const path of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json", "package.json"]) {
    const planned = labels(planChecks([path], everything));
    for (const expected of ["typecheck", "test: frontend suite", "test: backend suite"])
      assert.ok(planned.includes(expected), `${path}: ${expected}`);
  }
});

test("backend lint allows warnings like its own lint script; the others refuse them", () => {
  const steps = planChecks(["apps/backend/app/a.ts", "apps/frontend/src/App.tsx", "scripts/lanes.mjs"], everything);
  assert.equal(step(steps, "lint: backend").args.includes("--max-warnings"), false);
  assert.ok(step(steps, "lint: frontend").args.includes("--max-warnings"));
  assert.ok(step(steps, "lint: 1 file").args.includes("--max-warnings"));
});

const staticOnly = { staticOnly: true };
const skipped = (steps) => steps.filter((candidate) => candidate.skip).map((candidate) => candidate.label);

test("--static runs changed test files on their own and skips every whole suite", () => {
  const steps = planChecks(
    [
      "pnpm-lock.yaml",
      "apps/backend/app/services/planning.ts",
      "apps/backend/tests/unit/b.spec.ts",
      "apps/frontend/src/App.test.tsx",
      "packages/shared/src/lib/color.test.ts",
    ],
    everything,
    noImporters,
    staticOnly,
  );
  assert.deepEqual(step(steps, "test: 1 backend spec").args, [
    "--dir",
    "apps/backend",
    "test",
    "--files",
    "tests/unit/b.spec.ts",
  ]);
  assert.deepEqual(step(steps, "test: 2 frontend test").args, [
    "--dir",
    "apps/frontend",
    "exec",
    "vitest",
    "run",
    "src/App.test.tsx",
    "packages/shared/src/lib/color.test.ts",
  ]);
  assert.deepEqual(skipped(steps), ["test: frontend suite", "test: backend suite"]);
  assert.ok(step(steps, "typecheck"));
  assert.ok(step(steps, "format"));
});

test("--static skips the related-test lookup for source but not the source's lint and type-check", () => {
  const steps = planChecks(["apps/frontend/src/App.tsx"], everything, noImporters, staticOnly);
  assert.deepEqual(skipped(steps), ["test: frontend tests related to changes"]);
  assert.ok(step(steps, "lint: frontend"));
  assert.ok(step(steps, "typecheck"));
  assert.equal(skipped(planChecks(["apps/frontend/src/App.test.tsx"], everything, noImporters, staticOnly)).length, 0);
});

test("backend tests build the application first when its output is missing, with CI's build environment", () => {
  const missingBuild = (path) => path !== "apps/backend/public/assets";
  for (const [paths, options] of [
    [["apps/backend/app/services/planning.ts"], {}],
    [["apps/backend/tests/unit/b.spec.ts"], staticOnly],
  ]) {
    const steps = planChecks(paths, missingBuild, noImporters, options);
    const build = step(steps, "prepare: build application");
    assert.deepEqual(build?.args, ["run", "build"], paths[0]);
    assert.equal(build.env.NODE_ENV, "production");
    assert.equal(build.env.SESSION_DRIVER, "memory");
    assert.ok(
      labels(steps).indexOf("prepare: build application") <
        labels(steps).findIndex((label) => label.startsWith("test:")),
    );
  }
  assert.equal(step(planChecks(["apps/backend/app/a.ts"], everything), "prepare: build application"), undefined);
  assert.equal(step(planChecks(["apps/frontend/src/App.tsx"], missingBuild), "prepare: build application"), undefined);
  assert.equal(
    step(planChecks(["apps/backend/app/a.ts"], missingBuild, noImporters, staticOnly), "prepare: build application"),
    undefined,
  );
});

test("a step's own environment reaches the process it starts", async () => {
  const result = await runStep({
    label: "test: environment",
    command: "node",
    args: ["-e", "process.stdout.write(process.env.CHECK_CHANGED_PROBE ?? 'missing')"],
    env: { CHECK_CHANGED_PROBE: "present" },
  });
  assert.equal(result.output, "present");
});

test("a renamed file is listed under both its old and new paths", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "check-changed-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { cwd: repo });
  git("init", "-q");
  writeFileSync(join(repo, "old.mjs"), "export const value = 1;\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  renameSync(join(repo, "old.mjs"), join(repo, "new.mjs"));
  git("add", "-A");
  git("commit", "-q", "-m", "rename");
  assert.deepEqual(changedPaths("HEAD~1", repo), ["new.mjs", "old.mjs"]);
});

test("a step that ignores SIGTERM after its time limit is killed and fails", async () => {
  const started = Date.now();
  // The child gives up after 10 seconds by itself, so a missing SIGKILL fails this test instead of hanging it.
  const result = await runStep(
    {
      label: "test: stubborn",
      command: "node",
      args: ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 10_000);"],
    },
    { timeoutMs: 300, killGraceMs: 300 },
  );
  assert.ok(Date.now() - started < 5_000, "the step was not killed");
  assert.equal(result.passed, false);
  assert.match(result.output, /stopped after 0\.3 seconds/);
});

test("documentation sources rebuild docs/ and end-to-end specs are reported as skipped", () => {
  const steps = planChecks(["docs-src/index.md", "e2e/smoke.spec.ts"], everything);
  assert.equal(step(steps, "docs").docsClean, true);
  assert.equal(typeof step(steps, "e2e").skip, "string");
  assert.deepEqual(labels(steps).slice(-2), ["docs: build and compare docs/", "e2e"]);
});

test("prepare steps run before every check", () => {
  const steps = planChecks(["apps/frontend/src/App.tsx", "apps/backend/app/a.ts"], everything);
  const firstCheck = steps.findIndex((candidate) => !candidate.prepare);
  assert.ok(steps.slice(firstCheck).every((candidate) => !candidate.prepare));
  assert.equal(steps[0].label, "prepare: stop leftover servers");
});

test("a focused test step that executes nothing fails, while related tests may find none", () => {
  const specs = step(planChecks(["apps/backend/tests/unit/b.spec.ts"], everything), "test: 1 backend spec");
  assert.equal(ranNoTests(specs, "booting application to run tests...\n\n NO TESTS EXECUTED\n"), true);
  assert.equal(ranNoTests(specs, " PASSED \nTests  4 passed (4)\n"), false);
  const scripts = step(planChecks(["scripts/lanes.mjs"], everything, noImporters), "test: 1 script test");
  assert.equal(ranNoTests(scripts, "# tests 0\n# pass 0\n"), true);
  assert.equal(ranNoTests(scripts, "ℹ tests 3\nℹ pass 3\n"), false);
  const related = step(planChecks(["apps/frontend/src/App.tsx"], everything), "test: frontend tests related");
  assert.equal(ranNoTests(related, "No test files found, exiting with code 0\n"), false);
});

test("a passing test step reports how many tests it ran", () => {
  assert.equal(testCount(" Test Files  136 passed (136)\n      Tests  1743 passed (1743)\n"), 1743);
  assert.equal(testCount(" PASSED \n\nTests  63 passed (63)\n Time  8s\n"), 63);
  assert.equal(testCount("ℹ tests 9\nℹ pass 9\n"), 9);
  assert.equal(testCount("# tests 4\n# pass 4\n"), 4);
  assert.equal(testCount("No test files found, exiting with code 0\n"), undefined);
});

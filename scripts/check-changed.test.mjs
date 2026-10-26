import assert from "node:assert/strict";
import test from "node:test";
import { planChecks, ranNoTests } from "./check-changed.mjs";

const everything = () => true;
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
  assert.ok(step(steps, "typecheck"));
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
  );
  assert.deepEqual(step(steps, "test: 1 script test").args, ["--test", "scripts/lanes.test.mjs"]);
  assert.equal(step(steps, "test: 1 script test").command, "node");
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
  const scripts = step(planChecks(["scripts/lanes.mjs"], everything), "test: 1 script test");
  assert.equal(ranNoTests(scripts, "# tests 0\n# pass 0\n"), true);
  assert.equal(ranNoTests(scripts, "ℹ tests 3\nℹ pass 3\n"), false);
  const related = step(planChecks(["apps/frontend/src/App.tsx"], everything), "test: frontend tests related");
  assert.equal(ranNoTests(related, "No test files found, exiting with code 0\n"), false);
});

// Check only what this branch changed, before the full gate:
//
//   pnpm run check:changed           changes since the merge-base with origin/platform/adonisjs
//   pnpm run check:changed <base>    changes since the merge-base with <base>
//
// Uncommitted and untracked files count as changed. `pnpm run gate:all` and `pnpm run e2e` remain
// the submission gate; this is the fast loop while implementing or reviewing a change.
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertSupportedNodeVersion } from "../apps/backend/start/node_version.ts";
import { nonColourEnvironment, spawnPnpm } from "./pnpmSpawn.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const defaultBase = "origin/platform/adonisjs";
// Japa keeps its process alive after a planner error, so a step that never exits must still fail.
const stepTimeoutMs = 20 * 60_000;
const logTailLines = 40;

const codeFile = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const typeInput = /(?:^|\/)(?:tsconfig[^/]*\.json|package\.json)$/;
const backendSpec = /^apps\/backend\/tests\/.+\.spec\.ts$/;
// A filter that matches nothing reports success; these markers turn it into a failure.
const japaNoTests = /NO TESTS EXECUTED/;
const nodeTestNoTests = /^(?:# |ℹ )tests 0$/m;
// Vitest and Japa summarise as "Tests  12 passed (12)"; node --test reports "tests 12".
const testCounts = [/^\s*Tests\s+(\d+) passed/m, /^(?:# |ℹ )tests (\d+)$/m];

const relativeTo = (prefix) => (path) => path.slice(prefix.length);

/**
 * Plan the checks for a branch's changed paths, in run order.
 *
 * Deleted paths still select suites and the type-check, but are never passed to a tool that
 * expects existing files.
 */
export function planChecks(paths, exists = (path) => existsSync(new URL(path, pathToFileURL(root)))) {
  const present = paths.filter(exists);
  const presentCode = present.filter((path) => codeFile.test(path));
  const backendPaths = paths.filter((path) => path.startsWith("apps/backend/"));
  const sharedChanged = paths.some((path) => path.startsWith("packages/shared/"));
  const backendSuite = sharedChanged || backendPaths.some((path) => !backendSpec.test(path));
  const backendSpecs = backendSuite ? [] : present.filter((path) => backendSpec.test(path));
  const frontendLint = presentCode.filter((path) => path.startsWith("apps/frontend/"));
  const rootLint = presentCode.filter((path) => /^(?:scripts|e2e|packages\/shared\/src)\//.test(path));
  const backendLint = presentCode.filter((path) => path.startsWith("apps/backend/"));
  const related = presentCode.filter((path) => /^(?:apps\/frontend\/src|packages\/shared\/src)\//.test(path));
  // Configuration outside src affects every frontend test, which `vitest related` cannot see.
  const frontendSuite = paths.some(
    (path) => path.startsWith("apps/frontend/") && !path.startsWith("apps/frontend/src/") && !path.endsWith(".md"),
  );
  const scriptTests = [
    ...new Set(
      paths
        .filter((path) => /^scripts\/[^/]+\.mjs$/.test(path))
        .map((path) => (path.endsWith(".test.mjs") ? path : path.replace(/\.mjs$/, ".test.mjs")))
        .filter(exists),
    ),
  ];

  const steps = [{ label: "prepare: stop leftover servers", args: ["run", "lanes", "--stop-orphans"], prepare: true }];
  if (backendSuite || backendSpecs.length)
    steps.push({
      label: "prepare: build @capacitylens/shared",
      args: ["--filter", "@capacitylens/shared", "build"],
      prepare: true,
    });
  if (frontendLint.length)
    steps.push({ label: "prepare: compile messages", args: ["run", "paraglide:compile"], prepare: true });

  if (present.length)
    steps.push({
      label: `format: ${present.length} file(s)`,
      args: ["exec", "prettier", "--check", "--ignore-unknown", "--no-error-on-unmatched-pattern", ...present],
    });
  const eslint = ["exec", "eslint", "--max-warnings", "0", "--no-warn-ignored"];
  if (backendLint.length)
    steps.push({
      label: `lint: backend ${backendLint.length} file(s)`,
      args: ["--dir", "apps/backend", ...eslint, ...backendLint.map(relativeTo("apps/backend/"))],
    });
  if (frontendLint.length)
    steps.push({
      label: `lint: frontend ${frontendLint.length} file(s)`,
      args: ["--dir", "apps/frontend", ...eslint, ...frontendLint.map(relativeTo("apps/frontend/"))],
    });
  if (rootLint.length) steps.push({ label: `lint: ${rootLint.length} file(s)`, args: [...eslint, ...rootLint] });
  if (paths.some((path) => codeFile.test(path) || typeInput.test(path)))
    steps.push({ label: "typecheck", args: ["run", "typecheck"] });

  if (scriptTests.length)
    steps.push({
      label: `test: ${scriptTests.length} script test file(s)`,
      command: "node",
      args: ["--test", ...scriptTests],
      noTests: nodeTestNoTests,
    });
  if (frontendSuite)
    steps.push({ label: "test: frontend suite", args: ["--dir", "apps/frontend", "exec", "vitest", "run"] });
  else if (related.length)
    // A changed file with no dependent tests is a legitimate result, unlike a filter that matches nothing.
    steps.push({
      label: `test: frontend tests related to ${related.length} file(s)`,
      args: [
        "--dir",
        "apps/frontend",
        "exec",
        "vitest",
        "related",
        "--run",
        "--passWithNoTests",
        ...related.map((path) => `../../${path}`),
      ],
    });
  if (backendSuite) steps.push({ label: "test: backend suite", args: ["--dir", "apps/backend", "test"] });
  else if (backendSpecs.length)
    steps.push({
      label: `test: ${backendSpecs.length} backend spec file(s)`,
      args: [
        "--dir",
        "apps/backend",
        "test",
        ...backendSpecs.flatMap((path) => ["--files", relativeTo("apps/backend/")(path)]),
      ],
      noTests: japaNoTests,
    });

  if (paths.some((path) => path.startsWith("docs-src/")))
    steps.push({ label: "docs: build and compare docs/", args: ["run", "docs:build"], docsClean: true });
  if (paths.some((path) => path.startsWith("e2e/")))
    steps.push({ label: "e2e", skip: "end-to-end specs run with pnpm run e2e" });
  return steps;
}

/** Report whether a test step's output shows that it executed no tests. */
export function ranNoTests(step, output) {
  return step.noTests ? step.noTests.test(output) : false;
}

/** Read how many tests a passing test step ran, so a pass shows what it covered. */
export function testCount(output) {
  for (const pattern of testCounts) {
    const match = pattern.exec(output);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function passDetail(step, output) {
  if (!step.label.startsWith("test:")) return "";
  const count = testCount(output);
  return count === undefined ? " (no test count reported)" : ` (${count} tests)`;
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function changedPaths(base) {
  const mergeBase = git(["merge-base", base, "HEAD"]).trim();
  const tracked = git(["diff", "--name-only", mergeBase]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [...new Set(`${tracked}\n${untracked}`.split("\n").filter(Boolean))].sort();
}

function stopGroup(child) {
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    // The group may already have exited between the timeout firing and the signal.
    if (error.code !== "ESRCH") throw error;
  }
}

function runStep(step) {
  return new Promise((resolve) => {
    const options = {
      cwd: root,
      env: nonColourEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    };
    const child = step.command === "node" ? spawn(process.execPath, step.args, options) : spawnPnpm(step.args, options);
    const chunks = [];
    let timedOut = false;
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroup(child);
    }, stepTimeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ passed: false, output: `could not start: ${error.message}` });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString("utf8");
      if (timedOut) resolve({ passed: false, output: `${output}\nstopped after ${stepTimeoutMs / 60_000} minutes` });
      else if (status !== 0) resolve({ passed: false, output });
      else if (ranNoTests(step, output)) resolve({ passed: false, output: `${output}\nno tests were executed` });
      else if (step.docsClean && git(["status", "--porcelain", "--", "docs"]).trim())
        resolve({ passed: false, output: `${output}\ndocs/ differs from its sources; commit the rebuilt output` });
      else resolve({ passed: true, output });
    });
  });
}

async function main() {
  try {
    assertSupportedNodeVersion();
    const [base = defaultBase, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error("Expected at most one base ref.");
    const paths = changedPaths(base);
    if (!paths.length) {
      console.log(`No changes since ${base}.`);
      return;
    }
    console.log(`check:changed: ${paths.length} changed path(s) since ${base}`);
    let failed = false;
    for (const step of planChecks(paths)) {
      if (step.skip) {
        console.log(`skip  ${step.label} (${step.skip})`);
        continue;
      }
      const result = await runStep(step);
      if (result.passed) {
        console.log(`pass  ${step.label}${passDetail(step, result.output)}`);
        continue;
      }
      console.log(`fail  ${step.label}`);
      failed = true;
      console.log(result.output.trimEnd().split("\n").slice(-logTailLines).join("\n"));
      if (step.prepare) break;
    }
    if (failed) process.exitCode = 1;
  } catch (error) {
    // Separate a broken invocation, such as an unknown base ref, from an ordinary failing check.
    console.error(`check:changed failed: ${error.message}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

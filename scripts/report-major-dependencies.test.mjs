import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseDocument } from "yaml";
import { findMajorUpdates, parseInstalledDependencies, renderReport } from "./report-major-dependencies.mjs";

const workspace = (name, path, dependencies = {}, devDependencies = {}, optionalDependencies = {}) => ({
  name,
  path,
  dependencies,
  devDependencies,
  optionalDependencies,
});

test("collects installed direct dependencies from each workspace and skips local packages", () => {
  const entries = parseInstalledDependencies(
    JSON.stringify([
      workspace(
        "capacitylens",
        "/repo",
        {
          react: { from: "react", version: "19.3.1" },
          "@capacitylens/shared": { from: "@capacitylens/shared", version: "link:packages/shared" },
        },
        {
          "adonisjs-account-kit": {
            from: "adonisjs-account-kit",
            version: "0.1.2",
            resolved: "file:vendor/adonisjs-account-kit/adonisjs-account-kit-0.1.2.tgz",
          },
        },
      ),
      workspace(
        "capacitylens-backend",
        "/repo/apps/backend",
        {},
        { "@adonisjs/core": { from: "@adonisjs/core", version: "6.20.0" } },
      ),
    ]),
    "/repo",
  );

  assert.deepEqual(entries, [
    { name: "react", workspace: ".", installed: "19.3.1" },
    { name: "@adonisjs/core", workspace: "apps/backend", installed: "6.20.0" },
  ]);
});

test("fails closed on invalid installed package lists and versions", () => {
  for (const source of ["not json", "{}", "[]"]) {
    assert.throws(() => parseInstalledDependencies(source, "/repo"));
  }
  assert.throws(
    () =>
      parseInstalledDependencies(
        JSON.stringify([workspace("app", "/repo", { react: { version: "latest" } })]),
        "/repo",
      ),
    /Invalid installed/,
  );
});

test("reports direct dependencies whose registry latest version has a higher major", () => {
  const installed = [
    { name: "zod", workspace: "packages/shared", installed: "3.25.0" },
    { name: "react", workspace: "apps/frontend", installed: "19.3.1" },
    { name: "vite", workspace: "apps/frontend", installed: "7.2.0" },
  ];
  const updates = findMajorUpdates(
    installed,
    new Map([
      ["zod", "4.0.0"],
      ["react", "19.4.0"],
      ["vite", "8.0.0"],
    ]),
  );
  assert.deepEqual(updates, [
    { name: "vite", workspace: "apps/frontend", installed: "7.2.0", latest: "8.0.0" },
    { name: "zod", workspace: "packages/shared", installed: "3.25.0", latest: "4.0.0" },
  ]);

  const report = renderReport(updates, "2026-10-01");
  assert.match(report, /Report date: 2026-10-01/);
  assert.match(report, /\| `vite` \| `apps\/frontend` \| `7\.2\.0` \| `8\.0\.0` \|/);
  assert.match(report, /\| `zod` \| `packages\/shared` \| `3\.25\.0` \| `4\.0\.0` \|/);
  assert.doesNotMatch(report, /react/);
  assert.match(renderReport([], "2026-10-01"), /No direct dependency has a newer major version available/);
});

test("rejects missing or malformed registry versions", () => {
  const installed = [{ name: "react", workspace: ".", installed: "19.3.1" }];
  assert.throws(() => findMajorUpdates(installed, new Map()), /latest version/);
  assert.throws(() => findMajorUpdates(installed, new Map([["react", "not-a-version"]])), /Invalid latest/);
});

test("runs the workflow report command through pnpm without forwarding extra arguments", () => {
  const workflow = parseDocument(
    readFileSync(new URL("../.github/workflows/major-dependency-report.yml", import.meta.url), "utf8"),
  ).toJS();
  assert.deepEqual(workflow.on.schedule, [{ cron: "17 6 1 * *" }]);
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.jobs.report.permissions, { contents: "read", issues: "write" });
  const steps = workflow.jobs.report.steps;
  const reportStep = steps.find(({ name }) => name === "Compare installed workspace versions with npm latest versions");
  assert.equal(reportStep.run, "pnpm run dependency:major-report");
  assert.equal(reportStep.env.MAJOR_DEPENDENCY_REPORT_FILE, "${{ runner.temp }}/major-dependency-report.md");

  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "major-dependency-report-"));
  try {
    const shimDirectory = path.join(temporaryDirectory, "bin");
    const outputPath = path.join(temporaryDirectory, "major-dependency-report.md");
    const workspacePath = fileURLToPath(new URL("..", import.meta.url));
    const workspaceJsonPath = path.join(temporaryDirectory, "workspace.json");
    const pnpmShimPath = path.join(shimDirectory, "pnpm");
    const reportScriptPath = fileURLToPath(new URL("./report-major-dependencies.mjs", import.meta.url));
    mkdirSync(shimDirectory);
    writeFileSync(
      workspaceJsonPath,
      JSON.stringify([{ path: workspacePath, dependencies: { react: { from: "react", version: "19.3.1" } } }]),
    );
    writeFileSync(
      pnpmShimPath,
      `#!/bin/sh\ncase "$1" in\n  run)\n    [ "$#" -eq 2 ] && [ "$2" = "dependency:major-report" ] || { echo "unexpected pnpm run arguments: $*" >&2; exit 2; }\n    exec "$NODE_BIN" "$REPORT_SCRIPT"\n    ;;\n  list) cat "$WORKSPACE_JSON" ;;\n  view) printf '"20.0.0"\\n' ;;\n  *) echo "unexpected pnpm command: $*" >&2; exit 2 ;;\nesac\n`,
    );
    chmodSync(pnpmShimPath, 0o755);
    execFileSync("bash", ["-euo", "pipefail", "-c", reportStep.run], {
      cwd: workspacePath,
      env: {
        ...process.env,
        PATH: `${shimDirectory}:${process.env.PATH}`,
        NODE_BIN: process.execPath,
        REPORT_SCRIPT: reportScriptPath,
        WORKSPACE_JSON: workspaceJsonPath,
        MAJOR_DEPENDENCY_REPORT_FILE: outputPath,
      },
      stdio: "pipe",
    });
    assert.match(readFileSync(outputPath, "utf8"), /`react`/);
    assert.match(readFileSync(outputPath, "utf8"), /`19\.3\.1` \| `20\.0\.0`/);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  const maintenance = steps.find(({ run }) => run?.includes("gh issue list"))?.run;
  const maintenanceStep = steps.find(({ run }) => run?.includes("gh issue list"));
  assert.equal(maintenanceStep.env.GH_TOKEN, "${{ github.token }}");
  assert.match(maintenance, /--state all --label/);
  assert.match(maintenance, /Expected one standing issue/);
  assert.match(maintenance, /gh issue edit/);
  assert.match(maintenance, /gh issue reopen/);
  assert.match(maintenance, /gh issue close/);
});

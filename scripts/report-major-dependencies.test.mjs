import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
          "adonisjs-account-kit": { from: "adonisjs-account-kit", version: "file:vendor/account-kit/core" },
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

test("reports only higher stable majors with package, workspace and both versions", () => {
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

test("keeps the scheduled workflow read-only for source and limited to standing issue writes", () => {
  const workflow = parseDocument(
    readFileSync(new URL("../.github/workflows/major-dependency-report.yml", import.meta.url), "utf8"),
  ).toJS();
  assert.deepEqual(workflow.on.schedule, [{ cron: "17 6 1 * *" }]);
  assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.jobs.report.permissions, { contents: "read", issues: "write" });
  const steps = workflow.jobs.report.steps;
  assert.ok(steps.some(({ run }) => run?.includes("dependency:major-report")));
  const maintenance = steps.find(({ run }) => run?.includes("gh issue list"))?.run;
  assert.match(maintenance, /--state all --label/);
  assert.match(maintenance, /Expected one standing issue/);
  assert.match(maintenance, /gh issue edit/);
  assert.match(maintenance, /gh issue reopen/);
  assert.match(maintenance, /gh issue close/);
});

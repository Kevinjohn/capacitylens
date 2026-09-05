import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";
import { collectSourceInventory } from "./source-inventory.mjs";
import { gateCommands } from "./gate-commands.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const promiseRules = ["@typescript-eslint/no-floating-promises", "@typescript-eslint/no-misused-promises"];
const eslint = new ESLint({ cwd: root });

test("every authored JavaScript, TypeScript and Vue file receives its lint baseline", async () => {
  const files = collectSourceInventory(root).filter(({ language }) =>
    ["javascript", "typescript", "vue"].includes(language),
  );
  assert.ok(files.length > 0);
  for (const { path, language } of files) {
    const config = await eslint.calculateConfigForFile(path);
    assert.ok(config, `${path}: missing configuration`);
    const rule = language === "javascript" ? "no-unused-vars" : "@typescript-eslint/no-unused-vars";
    assert.equal(config.rules[rule]?.[0], 2, `${path}: ${rule}`);
  }
});

test("production and test source retain typed promise rules while tooling is explicitly untyped", async () => {
  const typed = [
    "src/store/useStore.ts",
    "src/App.test.tsx",
    "src/future/Component.tsx",
    "src/future/component.test.tsx",
    "server/src/app.ts",
    "server/src/app.test.ts",
    "server/src/future/handler.ts",
    "server/src/future/handler.test.ts",
    "server/scripts/future-command.ts",
    "shared/src/lib/id.ts",
    "shared/src/future/domain.ts",
    "shared/src/future/domain.test.ts",
  ];
  const untyped = [
    "vite.config.ts",
    "playwright.config.ts",
    "e2e/fixtures.ts",
    "e2e/future.spec.ts",
    "server/vitest.config.ts",
    "shared/vitest.config.ts",
    "scripts/run-gate.mjs",
    "server/scripts/check-node.mjs",
    "public/offline-worker.js",
    "docs-src/.vitepress/config.mts",
    "docs-src/.vitepress/theme/Breadcrumbs.vue",
  ];
  for (const [paths, expected] of [
    [typed, true],
    [untyped, false],
  ]) {
    for (const path of paths) {
      const config = await eslint.calculateConfigForFile(path);
      assert.ok(config, path);
      const options = config.languageOptions.parserOptions;
      assert.equal(Boolean(options?.projectService || options?.project), expected, `${path}: typed project`);
      for (const rule of promiseRules) assert.equal(config.rules[rule]?.[0] === 2, expected, `${path}: ${rule}`);
    }
  }
});

test("future TypeScript tooling extensions receive the baseline without an implicit typed project", async () => {
  for (const path of ["scripts/future-command.mts", "server/future.config.cts", "e2e/future-helper.mts"]) {
    const [result] = await eslint.lintText("const unused = 1; export {};", { filePath: path });
    assert.equal(result.fatalErrorCount, 0, path);
    assert.deepEqual(
      result.messages.map(({ ruleId }) => ruleId),
      ["@typescript-eslint/no-unused-vars"],
      path,
    );
    const config = await eslint.calculateConfigForFile(path);
    assert.ok(!config.languageOptions.parserOptions.projectService, path);
    assert.ok(!config.languageOptions.parserOptions.project, path);
  }
});

test("real new production and test files reject both promise defects in each typed package", async (t) => {
  const paths = [];
  for (const directory of ["src", "server/src", "shared/src"]) {
    const fixture = mkdtempSync(`${root}${directory}/lint-coverage-`);
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    for (const suffix of [".ts", ".test.ts"]) {
      const invalid = `${fixture}/invalid${suffix}`;
      const valid = `${fixture}/valid${suffix}`;
      writeFileSync(invalid, "Promise.resolve();\nif (Promise.resolve(true)) console.log('invalid');\nexport {};\n");
      writeFileSync(valid, "await Promise.resolve();\nvoid Promise.resolve();\nexport {};\n");
      paths.push({ invalid, valid });
    }
  }
  // Create files before the parser builds projects, including its CI single-run programs.
  const fixtureLint = new ESLint({ cwd: root });
  for (const { invalid, valid } of paths) {
    const [failure] = await fixtureLint.lintFiles([invalid]);
    assert.equal(failure.fatalErrorCount, 0, invalid);
    assert.deepEqual(failure.messages.map(({ ruleId }) => ruleId).sort(), [...promiseRules].sort(), invalid);
    const [success] = await fixtureLint.lintFiles([valid]);
    assert.deepEqual(success.messages, [], valid);
  }
});

test("both gates own the lint coverage matrix and category-specific environment regressions", () => {
  for (const mode of ["app", "server"]) {
    for (const name of [
      "lint-coverage",
      "server-script-lint",
      "shared-environment",
      "script-environments",
      "docs-source-lint",
    ]) {
      assert.equal(
        gateCommands(mode).filter((args) => args.join(" ") === `run policy:${name}:test`).length,
        1,
        `${mode}: ${name}`,
      );
    }
  }
});

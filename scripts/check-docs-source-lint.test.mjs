import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";
import { collectSourceInventory } from "./source-inventory.mjs";
import { gateCommands } from "./gate-commands.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const eslint = new ESLint({ cwd: root });

test("every authored documentation script and component is linted", async () => {
  const files = collectSourceInventory(root).filter(
    ({ path, language }) => path.startsWith("docs-src/") && ["javascript", "typescript", "vue"].includes(language),
  );
  assert.ok(files.length > 0);
  for (const { path } of files) {
    assert.equal(await eslint.isPathIgnored(path), false, path);
    const [result] = await eslint.lintFiles([path]);
    assert.deepEqual(result.messages, [], path);
  }
});

test("existing and future documentation TypeScript gets the recommended rules", async () => {
  for (const filePath of [
    "docs-src/.vitepress/config.mts",
    "docs-src/.vitepress/theme/index.ts",
    "docs-src/.vitepress/new-plugin.mts",
  ]) {
    const [result] = await eslint.lintText("const unused = 1; export {};", { filePath });
    assert.ok(
      result.messages.some(({ ruleId }) => ruleId === "@typescript-eslint/no-unused-vars"),
      filePath,
    );
    assert.equal(result.fatalErrorCount, 0, filePath);
  }
});

test("Vue script setup bindings and template directives are checked together", async () => {
  const filePath = "docs-src/.vitepress/theme/Breadcrumbs.vue";
  const [valid] = await eslint.lintText(
    '<script setup lang="ts">const label: string = "Home";</script><template><nav>{{ label }}</nav></template>',
    { filePath },
  );
  assert.deepEqual(valid.messages, []);
  const [invalid] = await eslint.lintText(
    '<script setup lang="ts">const unused = 1;</script><template><nav v-if>Home</nav></template>',
    { filePath },
  );
  for (const rule of ["@typescript-eslint/no-unused-vars", "vue/valid-v-if"]) {
    assert.ok(
      invalid.messages.some(({ ruleId }) => ruleId === rule),
      rule,
    );
  }
  assert.equal(invalid.fatalErrorCount, 0);
});

test("future documentation JSX receives the JavaScript baseline and parses JSX", async () => {
  const filePath = "docs-src/.vitepress/theme/FutureComponent.jsx";
  const [valid] = await eslint.lintText("export default function Component() { return <nav />; }", { filePath });
  assert.deepEqual(valid.messages, []);
  const [invalid] = await eslint.lintText("const unused = 1; export default <nav />;", { filePath });
  assert.ok(invalid.messages.some(({ ruleId }) => ruleId === "no-unused-vars"));
  assert.equal(invalid.fatalErrorCount, 0);
});

test("documentation prose and generated output stay outside code linting", async () => {
  for (const path of ["docs-src/index.md", "docs/index.html", "docs/assets/generated.js"]) {
    assert.equal(await eslint.isPathIgnored(path), true, path);
  }
});

test("build-time docs modules and browser theme code have explicit untyped environments", async () => {
  for (const path of [
    "docs-src/.vitepress/config.mts",
    "docs-src/.vitepress/lightbox.mts",
    "docs-src/.vitepress/base.mjs",
  ]) {
    const config = await eslint.calculateConfigForFile(path);
    assert.ok(Object.hasOwn(config.languageOptions.globals, "process"), path);
    assert.ok(!Object.hasOwn(config.languageOptions.globals, "window"), path);
    assert.notEqual(config.languageOptions.parserOptions.projectService, true, path);
  }
  for (const path of [
    "docs-src/.vitepress/theme/index.ts",
    "docs-src/.vitepress/theme/Breadcrumbs.vue",
    "docs-src/.vitepress/theme/future.mjs",
  ]) {
    const config = await eslint.calculateConfigForFile(path);
    assert.ok(Object.hasOwn(config.languageOptions.globals, "window"), path);
    assert.ok(!Object.hasOwn(config.languageOptions.globals, "process"), path);
    assert.notEqual(config.languageOptions.parserOptions.projectService, true, path);
  }
});

test("both gates own documentation source lint coverage", () => {
  for (const mode of ["app", "server"]) {
    assert.equal(gateCommands(mode).filter((args) => args.join(" ") === "run policy:docs-source-lint:test").length, 1);
  }
});

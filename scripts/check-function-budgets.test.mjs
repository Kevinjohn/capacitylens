import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { evaluateFunctionBudgets, functionLimits } from "./function-budgets.mjs";
import { collectFunctionInventory, measureSourceFunctions } from "./check-function-budgets.mjs";

const taskIds = new Set(["T20"]);
const unit = (changes = {}) => ({
  path: "src/example.ts",
  symbol: "function:example",
  origin: "function",
  startLine: 3,
  endLine: 102,
  lines: 100,
  complexity: 12,
  depth: 4,
  ...changes,
});
const exception = (metric, baseline) => ({
  path: "src/example.ts",
  symbol: "function:example",
  metric,
  baseline,
  reason: "Separate the coordinator's behavior stages",
  task: "T20",
});
const check = (units, exceptions = []) => evaluateFunctionBudgets(units, exceptions, taskIds);

test("enforces each exact threshold independently, including nested test callbacks", () => {
  assert.equal(check([unit()]).valid, true);
  for (const [metric, limit] of Object.entries(functionLimits)) {
    assert.equal(check([unit({ [metric]: limit - 1 })]).valid, true);
    const result = check([unit({ [metric]: limit + 1 })]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), new RegExp(`src/example.ts:3.*function:example.*${metric}`));
    assert.equal(check([unit({ [metric]: limit + 1 })], [exception(metric, limit + 1)]).valid, true);
  }
  assert.equal(
    check([unit({ symbol: 'function:describe callback/function:it("renders") callback', lines: 101 })]).valid,
    false,
  );
});

test("exceptions cap only their exact metric, path and symbol", () => {
  const debt = [exception("lines", 120)];
  assert.equal(check([unit({ lines: 110 })], debt).valid, true);
  for (const changes of [
    { lines: 121 },
    { lines: 120, complexity: 13 },
    { lines: 120, depth: 5 },
    { lines: 120, path: "src/another.ts" },
    { lines: 120, symbol: "function:another" },
  ])
    assert.equal(check([unit(changes)], debt).valid, false);
});

test("deleted and resolved metrics make exceptions stale, including partial resolution", () => {
  assert.match(check([], [exception("lines", 120)]).errors.join("\n"), /stale.*missing/);
  for (const lines of [0, 99, 100]) {
    assert.match(check([unit({ lines })], [exception("lines", 120)]).errors.join("\n"), /stale.*resolved/);
  }
  const result = check([unit({ lines: 110 })], [exception("lines", 120), exception("complexity", 14)]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /complexity.*resolved/);
});

test("rejects malformed, broad, duplicate or unowned exceptions", () => {
  const good = exception("lines", 120);
  for (const invalid of [
    null,
    {},
    [null],
    [{ ...good, path: "src/**" }],
    [{ ...good, symbol: "*" }],
    [{ ...good, metric: "anything" }],
    [{ ...good, baseline: 100 }],
    [{ ...good, baseline: Infinity }],
    [{ ...good, baseline: 120.5 }],
    [{ ...good, reason: " " }],
    [{ ...good, task: "T99" }],
    [{ ...good, permanent: true }],
    [good, good],
  ])
    assert.equal(check([unit({ lines: 110 })], invalid).valid, false, JSON.stringify(invalid));
});

test("rejects invalid or duplicate measurements; only field initializers omit length", () => {
  const field = unit({ origin: "class-field-initializer", lines: null });
  assert.equal(check([field]).valid, true);
  assert.equal(check([{ ...field, complexity: 13 }]).valid, false);
  for (const changes of [
    { lines: null },
    { lines: NaN },
    { lines: -1 },
    { complexity: 0 },
    { complexity: Infinity },
    { depth: -1 },
    { depth: 1.5 },
    { symbol: "" },
  ])
    assert.equal(check([unit(changes)]).valid, false);
  assert.equal(check([unit(), unit()]).valid, false);
});

test("dispatches every measured language and retains path, role and independent scopes", async () => {
  for (const [path, language, content] of [
    ["new/tool.mjs", "javascript", "export const outer = () => () => 1;"],
    ["new/view.tsx", "typescript", "const View = memo(() => <div/>);"],
    ["new/view.vue", "vue", '<template><button @click="if (ready) save()">Save</button></template>'],
    ["new/tool.sh", "shell", "run() { if true; then echo ok; fi; }"],
  ]) {
    const measured = await measureSourceFunctions({ path, language, role: "test" }, content);
    assert.ok(measured.length > 0, path);
    assert.ok(
      measured.every((entry) => entry.path === path && entry.role === "test"),
      path,
    );
  }
  assert.deepEqual(await measureSourceFunctions({ path: "style.css", language: "css" }, "a {}"), []);
  assert.deepEqual(await measureSourceFunctions({ path: "index.html", language: "html" }, "<div/>"), []);
  await assert.rejects(measureSourceFunctions({ path: "new.py", language: "python" }, ""), /Unsupported/);
  await assert.rejects(
    measureSourceFunctions({ path: "bad.ts", language: "typescript" }, "function {"),
    /Cannot measure/,
  );
});

test("importing policy APIs from explicit stdin neither runs a CLI nor resolves '-' as a file", () => {
  const modules = ["source-inventory.mjs", "check-file-sizes.mjs", "check-function-budgets.mjs"];
  for (const name of modules) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-"], {
      input: `await import(${JSON.stringify(new URL(name, import.meta.url).href)}); console.log('imported');`,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "imported\n");
  }
});

test("inventories new source and nested callbacks while exposing the remaining coverage boundaries", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "function-budgets-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", root]);
  for (const directory of ["scripts", "public", "e2e", "docs", "ignored"]) mkdirSync(join(root, directory));
  writeFileSync(join(root, ".gitignore"), "ignored/\n");
  writeFileSync(join(root, "ignored/unknown.py"), "");
  writeFileSync(join(root, "docs/generated.js"), "function {");
  writeFileSync(
    join(root, "scripts/new.mjs"),
    `const outer = () => {\nreturn () => {\n${"work();\n".repeat(99)}};\n};\n`,
  );
  writeFileSync(join(root, "public/new.js"), "function start() { return 1; }");
  writeFileSync(join(root, "e2e/helper.ts"), "export const setup = () => true;");
  writeFileSync(join(root, "config.yml"), "run: node -e 'embedded()'\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { probe: "node -e 'embedded()'" } }));
  writeFileSync(join(root, "index.html"), "<script>embedded()</script>");
  const inventory = await collectFunctionInventory(root);
  assert.equal(inventory.units.length, 4);
  assert.equal(inventory.units.find(({ path }) => path === "e2e/helper.ts").role, "test");
  assert.deepEqual(
    inventory.unmeasured.map(({ path }) => path),
    [".gitignore", "config.yml", "docs/generated.js", "index.html", "package.json"],
  );
  const result = check(inventory.units);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every((error) => error.includes("scripts/new.mjs") && error.includes("lines")));
  writeFileSync(join(root, "new.py"), "");
  await assert.rejects(collectFunctionInventory(root), /Unclassified repository path/);
  rmSync(join(root, "new.py"));
  writeFileSync(join(root, "public/new.js"), "function {");
  await assert.rejects(collectFunctionInventory(root), /Cannot measure public\/new.js/);
});

test("CLI publishes the measured inventory and returns a failing status for invalid arguments", () => {
  const cli = new URL("./check-function-budgets.mjs", import.meta.url);
  const run = (...args) =>
    spawnSync(process.execPath, [fileURLToPath(cli), ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const invalid = run("--unknown");
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Expected no arguments or --json/);
  const output = run("--json");
  assert.equal(output.stderr, "");
  const report = JSON.parse(output.stdout);
  assert.deepEqual(report.limits, functionLimits);
  assert.equal(output.status, report.valid ? 0 : 1);
  assert.ok(report.files.some(({ path }) => path === "scripts/check-function-budgets.test.mjs"));
  assert.ok(report.units.some(({ path }) => path === "scripts/check-function-budgets.test.mjs"));
  assert.ok(report.unmeasured.some(({ path }) => path === "Dockerfile"));
  assert.ok(report.unmeasured.some(({ path, category }) => path === "package.json" && category === "data"));
});

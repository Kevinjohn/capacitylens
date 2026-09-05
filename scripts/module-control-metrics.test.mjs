import assert from "node:assert/strict";
import test from "node:test";
import { measureFunctions } from "./function-metrics.mjs";
import { measureShellFunctions } from "./shell-function-metrics.mjs";
import { measureVueFunctions } from "./vue-function-metrics.mjs";
import { evaluateFunctionBudgets } from "./function-budgets.mjs";

const collectors = [
  { path: "fixture.ts", collect: measureFunctions, branch: "if (ready) work();\n", open: "if (ready) {", close: "}" },
  {
    path: "fixture.sh",
    collect: measureShellFunctions,
    branch: "if ready; then work; fi\n",
    open: "if ready; then ",
    close: "fi; ",
  },
];

test("top-level branches and nesting are enforced at the exact budgets", async () => {
  for (const { path, collect, branch, open, close } of collectors) {
    for (const complexity of [11, 12, 13]) {
      const units = (await collect(branch.repeat(complexity - 1), path)).map((entry) => ({ path, ...entry }));
      const program = units.find(({ origin }) => origin === "program");
      assert.ok(program, path);
      assert.equal(program.symbol, "module");
      assert.equal(program.lines, null);
      assert.equal(program.complexity, complexity);
      assert.equal(evaluateFunctionBudgets(units, [], new Set()).valid, complexity <= 12);
    }
    for (const depth of [3, 4, 5]) {
      const units = (await collect(open.repeat(depth) + "work; " + close.repeat(depth), path)).map((entry) => ({
        path,
        ...entry,
      }));
      assert.equal(units.find(({ origin }) => origin === "program").depth, depth);
      assert.equal(evaluateFunctionBudgets(units, [], new Set()).valid, depth <= 4);
    }
  }
});

test("module metrics exclude nested functions and preserve their lexical identities", async () => {
  for (const [path, collect, source] of [
    [
      "fixture.ts",
      measureFunctions,
      "if (ready) { function outer() { if (ready) work(); const inner = () => ready ? 1 : 0; } }",
    ],
    [
      "fixture.sh",
      measureShellFunctions,
      "if ready; then outer() { if ready; then work; fi; inner() { ready && work; }; }; fi",
    ],
  ]) {
    const entries = await collect(source, path);
    assert.deepEqual(entries.map(({ symbol }) => symbol).sort(), [
      "function:outer",
      "function:outer/function:inner",
      "module",
    ]);
    assert.deepEqual(
      entries.map(({ complexity }) => complexity),
      [2, 2, 2],
    );
    assert.equal(entries.find(({ origin }) => origin === "program").depth, 1);
  }
});

test("Vue script control flow is separate from authored template regions", () => {
  const entries = measureVueFunctions(
    `<script>if (ready) work(); const run = () => ready ? 1 : 0;</script>
<script setup>if (ready) work();</script><template><button @click="if (ready) work()" /></template>`,
    "Fixture.vue",
  );
  const program = entries.find(({ origin }) => origin === "program");
  assert.ok(program);
  assert.equal(program.lines, null);
  assert.equal(program.complexity, 3);
  assert.equal(entries.find(({ origin }) => origin === "function").symbol, "function:run");
  assert.equal(entries.find(({ origin }) => origin === "embedded-region").complexity, 2);
});

test("module length stays with the physical file budget and empty scopes remain valid", async () => {
  for (const [path, collect, source] of [
    ["fixture.ts", measureFunctions, "work();\n".repeat(150)],
    ["fixture.sh", measureShellFunctions, "work\n".repeat(150)],
    ["empty.ts", measureFunctions, ""],
    ["empty.sh", measureShellFunctions, "# comment\n"],
  ]) {
    const entries = (await collect(source, path)).map((entry) => ({ path, ...entry }));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].lines, null);
    assert.equal(evaluateFunctionBudgets(entries, [], new Set()).valid, true);
  }
});

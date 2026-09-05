import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

const root = fileURLToPath(new URL("../", import.meta.url));
const eslint = new ESLint({ cwd: root });
const promiseRules = ["@typescript-eslint/no-floating-promises", "@typescript-eslint/no-misused-promises"];

test("the actual script project rejects floating and misused promises and accepts handled promises", async () => {
  const filePath = "server/scripts/reset-owner-password.ts";
  const [invalid] = await eslint.lintText(
    "Promise.resolve();\nif (Promise.resolve(true)) console.log('invalid condition');\n",
    { filePath },
  );
  assert.equal(invalid.fatalErrorCount, 0);
  assert.deepEqual(invalid.messages.map(({ ruleId }) => ruleId).sort(), [...promiseRules].sort());
  const [valid] = await eslint.lintText("await Promise.resolve();\nvoid Promise.resolve();\nexport {};\n", {
    filePath,
  });
  assert.deepEqual(valid.messages, []);
});

test("tooling outside the server TypeScript project keeps its untyped baseline", async () => {
  for (const path of ["server/vitest.config.ts", "server/scripts/check-node.mjs", "scripts/run-gate.mjs"]) {
    const config = await eslint.calculateConfigForFile(path);
    assert.notEqual(config.languageOptions.parserOptions?.projectService, true, path);
    for (const rule of promiseRules) assert.notEqual(config.rules[rule]?.[0], 2, `${path}: ${rule}`);
  }
});

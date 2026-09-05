import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

const root = fileURLToPath(new URL("../", import.meta.url));
const promiseRules = ["@typescript-eslint/no-floating-promises", "@typescript-eslint/no-misused-promises"];
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

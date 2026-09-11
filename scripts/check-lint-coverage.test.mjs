import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";
import { parseDocument } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const promiseRules = ["@typescript-eslint/no-floating-promises", "@typescript-eslint/no-misused-promises"];

const promiseRuleIds = (messages) =>
  messages.map(({ ruleId }) => ruleId).filter((ruleId) => ruleId?.includes("promise"));

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
    assert.deepEqual(promiseRuleIds(failure.messages).sort(), [...promiseRules].sort(), invalid);
    const [success] = await fixtureLint.lintFiles([valid]);
    assert.deepEqual(success.messages, [], valid);
  }
});

test("function length limits distinguish TypeScript, TSX, and test callbacks", async () => {
  const eslint = new ESLint({ cwd: root });
  const productionTypeScript = await eslint.calculateConfigForFile("src/lib/metadata.ts");
  const productionTsx = await eslint.calculateConfigForFile("src/components/resources/ResourceForm.tsx");
  const testTsx = await eslint.calculateConfigForFile("src/components/scheduler/SchedulerGrid.test.tsx");

  assert.equal(productionTypeScript.rules["max-lines-per-function"][1].max, 60);
  assert.equal(productionTsx.rules["max-lines-per-function"][1].max, 90);
  assert.equal(testTsx.rules["max-lines-per-function"][0], 0);
});

test("local hooks and pull requests run the intended static-analysis checks", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts.prepare, "simple-git-hooks");
  assert.equal(packageJson.scripts["lint:staged"], "pnpm run paraglide:compile && lint-staged");
  assert.equal(packageJson["simple-git-hooks"]["pre-commit"], "pnpm run lint:staged");
  assert.equal(packageJson["simple-git-hooks"]["pre-push"], "pnpm run lint");
  assert.equal(packageJson["lint-staged"]["*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], "eslint --max-warnings 0");

  const workflow = parseDocument(
    readFileSync(new URL("../.github/workflows/static-analysis.yml", import.meta.url), "utf8"),
  ).toJS();
  assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
  const commands = workflow.jobs.application.steps.map(({ run }) => run).filter(Boolean);
  assert.ok(commands.includes("pnpm run lint"));
  assert.ok(commands.some((command) => command.includes("pnpm exec tsc -b")));
});

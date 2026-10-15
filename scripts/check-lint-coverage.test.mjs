import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  for (const directory of ["apps/frontend/src", "server/src", "packages/shared/src"]) {
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
  const productionTypeScript = await eslint.calculateConfigForFile("apps/frontend/src/lib/metadata.ts");
  const productionTsx = await eslint.calculateConfigForFile("apps/frontend/src/components/resources/ResourceForm.tsx");
  const testTsx = await eslint.calculateConfigForFile("apps/frontend/src/components/scheduler/SchedulerGrid.test.tsx");

  assert.equal(productionTypeScript.rules["max-lines-per-function"][1].max, 60);
  assert.equal(productionTsx.rules["max-lines-per-function"][1].max, 90);
  assert.equal(testTsx.rules["max-lines-per-function"][0], 0);
});

test("local hooks and pull requests run the intended static-analysis checks", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const prePushChecks = "pnpm run format:check && pnpm run typecheck && pnpm run lint";
  assert.equal(packageJson.scripts.prepare, "simple-git-hooks");
  assert.equal(packageJson.scripts["lint:staged"], "pnpm run paraglide:compile && lint-staged");
  assert.equal(packageJson.scripts["check:push"], prePushChecks);
  assert.equal(packageJson["simple-git-hooks"]["pre-commit"], "pnpm run lint:staged");
  assert.equal(packageJson["simple-git-hooks"]["pre-push"], "pnpm run check:push");
  assert.equal(
    packageJson["lint-staged"]["*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    "eslint --max-warnings 0 --no-warn-ignored",
  );

  const workflow = parseDocument(
    readFileSync(new URL("../.github/workflows/static-analysis.yml", import.meta.url), "utf8"),
  ).toJS();
  assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
  const commands = workflow.jobs.application.steps.map(({ run }) => run).filter(Boolean);
  assert.equal(commands[0], "pnpm run check:push");
  // Check tracked and non-ignored candidate files so private exclusions do not make formatting gate local-only material.
  assert.equal(
    packageJson.scripts["format:check"],
    "git ls-files -z --cached --others --exclude-standard | xargs -0 prettier --check --ignore-unknown --no-error-on-unmatched-pattern",
  );
  assert.ok(commands.includes("pnpm run policy:lint-coverage:test"));
  // The root command delegates to workspace projects rather than invoking tsc without a project.
  assert.equal(packageJson.scripts.typecheck, "turbo typecheck && tsc -p tsconfig.e2e.json --noEmit");
});

// The staged-file hook names ignored paths explicitly, which ESLint warns about unless --no-warn-ignored is set.
// The hook must still lint the other staged source files.
test("the pre-commit lint command accepts a staged file that ESLint ignores", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const command = packageJson["lint-staged"]["*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"];
  const [binary, ...args] = command.split(" ");
  assert.equal(binary, "eslint");

  const tracked = execFileSync("git", ["ls-files", "--", "*.js", "*.mjs", "*.cjs", "*.ts", "*.mts", "*.cts"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);

  const ignored = tracked.filter((file) => file.startsWith("docs-src/") || file.startsWith("docs/"));
  assert.ok(ignored.length > 0, "expected at least one tracked, ESLint-ignored file to guard");

  // Run exactly what the hook runs, on every such file at once, and require a clean exit.
  execFileSync("pnpm", ["exec", ...[binary, ...args], ...ignored], { cwd: root, stdio: "pipe" });
});

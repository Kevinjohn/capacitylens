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
  assert.equal(
    packageJson["lint-staged"]["*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    "eslint --max-warnings 0 --no-warn-ignored",
  );

  const workflow = parseDocument(
    readFileSync(new URL("../.github/workflows/static-analysis.yml", import.meta.url), "utf8"),
  ).toJS();
  assert.deepEqual(workflow.on.pull_request.branches, ["main"]);
  const commands = workflow.jobs.application.steps.map(({ run }) => run).filter(Boolean);
  assert.ok(commands.includes("pnpm run lint"));
  assert.ok(commands.includes("pnpm run typecheck"));
  // Pin the script's BODY, not only its name. Asserting the workflow calls `pnpm run typecheck`
  // proves nothing on its own: a `typecheck` reduced to a bare root `tsc --noEmit` reads no files
  // and exits 0, and every gate would stay green while nothing was type-checked at all.
  assert.equal(packageJson.scripts.typecheck, "pnpm run paraglide:compile && tsc -b");
});

// The pre-commit hook names staged files individually, unlike `eslint .` in `pnpm run lint` and in
// CI. ESLint skips an ignored file found by a directory scan but WARNS about one named on the
// command line, and `--max-warnings 0` turns that warning into a failed commit (#798). No other
// gate can see this: every one of them scans. Without `--no-warn-ignored`, committing any of the
// files below is impossible except with `--no-verify`, which skips linting the rest of the commit
// too — so the hook silently stops linting real source whenever docs machinery is staged with it.
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

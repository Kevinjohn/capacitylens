import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";

const root = fileURLToPath(new URL("../", import.meta.url));
const promiseRules = ["@typescript-eslint/no-floating-promises", "@typescript-eslint/no-misused-promises"];

const promiseRuleIds = (messages) =>
  messages.map(({ ruleId }) => ruleId).filter((ruleId) => ruleId?.includes("promise"));

test("real new production and test files reject both promise defects in each typed package", async (t) => {
  const paths = [];
  for (const directory of ["apps/frontend/src", "apps/backend/app", "packages/shared/src"]) {
    const fixture = mkdtempSync(`${root}${directory}/typed-lint-`);
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    for (const suffix of [".ts", ".test.ts"]) {
      const invalid = `${fixture}/invalid${suffix}`;
      const valid = `${fixture}/valid${suffix}`;
      writeFileSync(invalid, "Promise.resolve();\nif (Promise.resolve(true)) console.log('invalid');\nexport {};\n");
      writeFileSync(
        valid,
        directory === "apps/backend/app"
          ? "await Promise.resolve()\nvoid Promise.resolve()\nexport {}\n"
          : "await Promise.resolve();\nvoid Promise.resolve();\nexport {};\n",
      );
      paths.push({ invalid, valid, backend: directory === "apps/backend/app" });
    }
  }
  // Create files before the parser builds projects, including its CI single-run programs.
  const fixtureLint = new ESLint({ cwd: root });
  const backendLint = new ESLint({ cwd: `${root}apps/backend` });
  for (const { invalid, valid, backend } of paths) {
    const selectedLint = backend ? backendLint : fixtureLint;
    const [failure] = await selectedLint.lintFiles([invalid]);
    assert.equal(failure.fatalErrorCount, 0, invalid);
    assert.deepEqual(promiseRuleIds(failure.messages).sort(), [...promiseRules].sort(), invalid);
    const [success] = await selectedLint.lintFiles([valid]);
    assert.deepEqual(success.messages, [], valid);
  }
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

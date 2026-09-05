import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { countLines, evaluateFileSizes } from "./check-file-sizes.mjs";

const taskIds = new Set(["T09", "T19", "T20"]);
const check = (files, policy) => evaluateFileSizes(files, policy, taskIds);

const config = { ceilings: { production: 400, test: 600, declaration: 400 }, exceptions: [] };
const exception = { path: "src/large.ts", baseline: 450, reason: "Split the coordinator", task: "T20" };
const bounded = { ...config, exceptions: [exception] };
const file = (lines, role = "production", path = "src/large.ts") => ({ path, role, content: "x\n".repeat(lines) });

test("counts physical lines including CRLF and empty lines", () => {
  for (const [content, expected] of [
    ["", 0],
    ["a\n", 1],
    ["a\nb", 2],
    ["a\r\nb\r\n", 2],
    ["\n", 1],
    ["a\n\n", 2],
  ]) {
    assert.equal(countLines(content), expected);
  }
});

test("applies exact role-specific ceilings and rejects the next line", () => {
  for (const [role, ceiling] of Object.entries(config.ceilings)) {
    for (const lines of [ceiling - 1, ceiling, ceiling + 1]) {
      const result = check([file(lines, role)], config);
      assert.equal(result.valid, lines <= ceiling, `${role}: ${lines}`);
      if (!result.valid) assert.match(result.errors.join("\n"), new RegExp(`${lines}.*${ceiling}`));
    }
  }
});

test("bounds every exception and rejects growth even by one line", () => {
  assert.equal(check([file(401)], bounded).valid, true);
  assert.equal(check([file(450)], bounded).valid, true);
  assert.match(check([file(451)], bounded).errors.join("\n"), /451.*450/);
  assert.equal(check([file(450)], config).valid, false);
});

test("rejects deleted exceptions and resolved debt at or below its role ceiling", () => {
  assert.match(check([], bounded).errors.join("\n"), /stale.*missing/);
  for (const lines of [0, 399, 400]) {
    assert.match(check([file(lines)], bounded).errors.join("\n"), /stale.*remove/);
  }
  const testBudget = { ...config, exceptions: [{ ...exception, baseline: 650 }] };
  assert.match(check([file(600, "test")], testBudget).errors.join("\n"), /stale.*remove/);
  assert.equal(check([file(601, "test")], testBudget).valid, true);
});

test("rejects duplicate entries, broad paths, and baselines below the applicable ceiling", () => {
  for (const exceptions of [
    [exception, exception],
    [{ ...exception, path: "src/**" }],
    [{ ...exception, baseline: 400 }],
  ])
    assert.equal(check([file(420)], { ...config, exceptions }).valid, false);
});

test("rejects malformed limits and exception metadata instead of silently relaxing the gate", () => {
  for (const invalid of [
    null,
    { ceiling: 400, permanent: [{ path: "src/large.ts" }], temporary: [] },
    { ...config, permanent: [exception] },
    { ...config, ceilings: { ...config.ceilings, other: 900 } },
    { ...config, ceilings: { ...config.ceilings, production: null } },
    { ...config, ceilings: { ...config.ceilings, test: Infinity } },
    { ...config, ceilings: { production: 400, test: 600 } },
    { ...config, exceptions: {} },
    ...[
      null,
      {},
      { ...exception, baseline: -1 },
      { ...exception, baseline: 450.5 },
      { ...exception, baseline: Infinity },
      { ...exception, reason: " " },
      { ...exception, task: "" },
      { ...exception, task: "no-owner" },
      { ...exception, task: "T99" },
      { ...exception, permanent: true },
    ].map((entry) => ({ ...config, exceptions: [entry] })),
  ])
    assert.equal(check([file(420)], invalid).valid, false, JSON.stringify(invalid));
  assert.equal(check([file(420, "unknown")], config).valid, false);
});

function fixture(t, entries, exceptions = config, untracked = {}) {
  const root = mkdtempSync(join(tmpdir(), "file-sizes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  for (const name of ["check-file-sizes.mjs", "source-inventory.mjs"]) {
    copyFileSync(new URL(`./${name}`, import.meta.url), join(root, "scripts", name));
  }
  writeFileSync(join(root, "scripts/file-size-exceptions.json"), JSON.stringify(exceptions));
  const put = (path, content) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  };
  put("tasks/todo.md", "### T09 — Split tests\n### T19 — Review sidebar\n### T20 — Close inventory\n");
  for (const [path, content] of Object.entries(entries)) put(path, content);
  const initialized = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const staged = spawnSync("git", ["add", "."], { cwd: root, encoding: "utf8" });
  assert.equal(staged.status, 0, staged.stderr);
  for (const [path, content] of Object.entries(untracked)) put(path, content);
  return {
    root,
    run: () =>
      spawnSync(process.execPath, [join(root, "scripts/check-file-sizes.mjs")], {
        cwd: tmpdir(),
        encoding: "utf8",
      }),
  };
}

test("CLI covers every inventoried language, new roots, scripts and declarations", (t) => {
  const paths = [
    "src/a.ts",
    "server/src/a.tsx",
    "shared/src/a.ts",
    "public/a.js",
    "scripts/a.mjs",
    "server/scripts/a.cts",
    "new/a.cjs",
    "new/a.jsx",
    "types/a.d.ts",
    "docs-src/.vitepress/a.mts",
    "docs-src/.vitepress/a.vue",
    "scripts/a.sh",
    "src/a.css",
    "index.html",
  ];
  const result = fixture(t, Object.fromEntries(paths.map((path) => [path, "x\n".repeat(401)]))).run();
  assert.equal(result.status, 1);
  for (const path of paths) assert.ok(result.stderr.includes(path), path);
});

test("CLI applies the test ceiling to colocated tests and test-support ownership", (t) => {
  const paths = [
    "src/a.test.ts",
    "server/src/a.spec.tsx",
    "scripts/a.test.mjs",
    "e2e/helper.ts",
    "src/test/helper.ts",
    "src/components/__tests__/helper.tsx",
    "server/src/fixtures/credentialOnboardingCrashFixture.ts",
  ];
  assert.equal(fixture(t, Object.fromEntries(paths.map((path) => [path, "x\n".repeat(600)]))).run().status, 0);
  const result = fixture(t, Object.fromEntries(paths.map((path) => [path, "x\n".repeat(601)]))).run();
  assert.equal(result.status, 1);
  for (const path of paths) assert.ok(result.stderr.includes(path), path);
});

test("CLI includes untracked source, excludes ignored/generated/prose/data, and rejects unknown formats", (t) => {
  const entries = {
    ".gitignore": "ignored/\n",
    "docs/a.html": "x\n".repeat(900),
    "src/paraglide/generated.ts": "x\n".repeat(900),
    "README.md": "x\n".repeat(900),
    "data.json": "{}\n".repeat(900),
  };
  const ignored = { "ignored/a.ts": "x\n".repeat(900) };
  assert.equal(fixture(t, entries, config, ignored).run().status, 0);
  const oversized = fixture(t, entries, config, { ...ignored, "new/a.ts": "x\n".repeat(401) }).run();
  assert.equal(oversized.status, 1);
  assert.match(oversized.stderr, /new\/a.ts/);
  const unknown = fixture(t, {}, config, { "new.py": "" }).run();
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unclassified.*new.py/);
});

test("CLI rejects growth in source-owned UI and stale exceptions after working-tree deletion", (t) => {
  const path = "src/components/ui/sidebar.tsx";
  const limit = { ...config, exceptions: [{ path, baseline: 735, reason: "Review compound controls", task: "T19" }] };
  const { root, run } = fixture(t, { [path]: "x\n".repeat(735) }, limit);
  assert.equal(run().status, 0);
  writeFileSync(join(root, path), "x\n".repeat(736));
  assert.match(run().stderr, /736.*735/);
  rmSync(join(root, path));
  assert.match(run().stderr, /stale.*missing/);
});

test("CLI rejects nonexistent task ownership and a missing task ledger", (t) => {
  const policy = { ...config, exceptions: [{ ...exception, task: "T99" }] };
  const { root, run } = fixture(t, { "src/large.ts": "x\n".repeat(420) }, policy);
  assert.match(run().stderr, /Unknown exception task T99/);
  rmSync(join(root, "tasks/todo.md"));
  assert.match(run().stderr, /ENOENT/);
});

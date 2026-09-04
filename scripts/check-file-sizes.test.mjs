import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { countLines, evaluateFileSizes } from "./check-file-sizes.mjs";

const config = { ceiling: 400, permanent: [], temporary: [] };
const temporary = { ...config, temporary: [{ path: "src/large.ts", baseline: 450, reason: "backlog" }] };
const files = (lines) => [{ path: "src/large.ts", content: "x\n".repeat(lines) }];

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

test("rejects an unlisted oversized file", () => {
  assert.match(evaluateFileSizes(files(401), config).errors.join("\n"), /src\/large.ts.*401.*400/);
});

test("rejects a temporary file one line above its baseline", () => {
  assert.match(evaluateFileSizes(files(451), temporary).errors.join("\n"), /raised.*451.*450/);
});

test("rejects stale entries at or below the ceiling", () => {
  for (const lines of [400, 399, 0]) {
    assert.match(evaluateFileSizes(files(lines), temporary).errors.join("\n"), /stale, remove entry/);
  }
});

test("rejects missing temporary and permanent files independently", () => {
  const result = evaluateFileSizes([], {
    ...temporary,
    permanent: [{ path: "src/generated.ts", reason: "generated" }],
  });
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors.every((error) => /stale.*missing/.test(error)));
});

test("removing an exception while its file is oversized fails", () => {
  assert.equal(evaluateFileSizes(files(450), temporary).valid, true);
  assert.equal(evaluateFileSizes(files(450), config).valid, false);
});

test("accepts compliant files and temporary files below their baseline", () => {
  assert.equal(evaluateFileSizes(files(400), config).valid, true);
  assert.equal(evaluateFileSizes(files(401), temporary).valid, true);
});

test("ignores permanent exceptions for size", () => {
  assert.equal(
    evaluateFileSizes(files(1000), { ...config, permanent: [{ path: "src/large.ts", reason: "generated" }] }).valid,
    true,
  );
});

function fixture(t, entries, exceptions = config) {
  const root = mkdtempSync(join(tmpdir(), "file-sizes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  copyFileSync(new URL("./check-file-sizes.mjs", import.meta.url), join(root, "scripts/check-file-sizes.mjs"));
  writeFileSync(join(root, "scripts/file-size-exceptions.json"), JSON.stringify(exceptions));
  for (const [path, content] of Object.entries(entries)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return () =>
    spawnSync(process.execPath, [join(root, "scripts/check-file-sizes.mjs")], { cwd: tmpdir(), encoding: "utf8" });
}

test("CLI scans all source roots from an unrelated cwd and excludes tests and generated files", (t) => {
  const large = "x\n".repeat(401);
  const run = fixture(t, {
    "src/ok.ts": "x\n",
    "server/src/ok.tsx": "x\n",
    "shared/src/ok.ts": "x\n",
    "src/a.test.ts": large,
    "server/src/a.spec.tsx": large,
    "shared/src/a.d.ts": large,
    "src/paraglide/generated.ts": large,
    "src/node_modules/pkg/index.ts": large,
    "src/e2e/example.ts": large,
    "e2e/example.ts": large,
    "src/ignored.js": large,
  });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /3 source files/);
});

test("CLI reports every oversized source file and exits 1", (t) => {
  const result = fixture(
    t,
    Object.fromEntries(["src/a.ts", "server/src/a.tsx", "shared/src/a.ts"].map((path) => [path, "x\n".repeat(401)])),
  )();
  assert.equal(result.status, 1);
  for (const path of ["src/a.ts", "server/src/a.tsx", "shared/src/a.ts"]) assert.ok(result.stderr.includes(path));
});

test("long-function diagnostics follow the verdict without enforcing a cap", (t) => {
  const result = fixture(t, {
    "src/functions.ts": `export function longFunction() {\n${"  x();\n".repeat(151)}}\nconst arrow = () => {\n${"  x();\n".repeat(151)}};\n`,
  })();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed.*\n.*diagnostic, not enforced/s);
  assert.match(result.stdout, /longFunction.*153 lines/);
  assert.match(result.stdout, /arrow.*153 lines/);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./check-import-cycles.mjs", import.meta.url));

function scan(t, sources) {
  const root = mkdtempSync(join(tmpdir(), "import-cycles-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ["src", "server/src", "shared/src"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  for (const [file, content] of Object.entries(sources)) {
    writeFileSync(join(root, "src", file), content);
  }
  return spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

test("value import cycles fail and report their paths", (t) => {
  const result = scan(t, {
    "a.ts": 'import { b } from "./b"; export const a = () => b;',
    "b.ts": 'import { a } from "./a"; export const b = () => a;',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/a.ts > src\/b.ts/);
  assert.match(result.stderr, /1 runtime cycles/);
});

test("type-only import cycles pass", (t) => {
  const result = scan(t, {
    "a.ts": 'import type { B } from "./b"; export type A = { b: B };',
    "b.ts": 'import type { A } from "./a"; export type B = { a: A };',
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /0 runtime cycles/);
});

test("acyclic value imports pass", (t) => {
  const result = scan(t, {
    "a.ts": 'import { b } from "./b"; export const a = b;',
    "b.ts": "export const b = 1;",
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /0 runtime cycles/);
});

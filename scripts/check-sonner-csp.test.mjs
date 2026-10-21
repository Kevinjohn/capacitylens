import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

const importProbe = fileURLToPath(new URL("./__tests__/sonner-import.mjs", import.meta.url));

for (const mode of ["import", "require"]) {
  test(`Sonner ${mode} entry point never injects a runtime style element`, () => {
    const result = spawnSync(process.execPath, [importProbe, mode], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  });
}

test("the application builds the matching upstream Sonner stylesheet", () => {
  const appCss = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  assert.ok(appCss.includes('@import "sonner/dist/styles.css";'));
});

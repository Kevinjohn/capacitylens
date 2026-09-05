import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

// Load each published format in a fresh process with a real DOM. Module caches in the
// component suite must not hide an import-time style injection from a dependency upgrade.
const importProbe = `
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.document = new JSDOM("<!doctype html>").window.document;
if (process.argv[1] === "require") require("sonner");
else await import("sonner");
if (document.querySelectorAll("style").length !== 0) {
  throw new Error("Sonner injected a style element forbidden by the production CSP");
}
`;

for (const mode of ["import", "require"]) {
  test(`Sonner ${mode} entry point never injects a runtime style element`, () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", importProbe, mode], {
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

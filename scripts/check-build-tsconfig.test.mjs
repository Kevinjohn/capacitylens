import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

function buildFiles() {
  const result = spawnSync(
    process.execPath,
    [resolve(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.build.json", "--listFilesOnly"],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((filePath) => relative(root, resolve(filePath)).replaceAll("\\", "/"));
}

function isExcludedTestSupport(filePath) {
  return (
    filePath.startsWith("src/test/") ||
    (filePath.startsWith("src/") && filePath.includes("/__tests__/")) ||
    filePath.endsWith(".testSupport.ts") ||
    filePath.endsWith(".testSupport.tsx")
  );
}

test("the deployment compiler graph excludes test-only support files", () => {
  const files = buildFiles();
  const testOnlyFiles = files.filter(isExcludedTestSupport);
  assert.deepEqual(testOnlyFiles, [], `test-only files entered tsconfig.build.json:\n${testOnlyFiles.join("\n")}`);

  // A floor against an over-broad exclude silently dropping production files nothing imports
  // (an entry point, a worker loaded via `new Worker(new URL(...))`): the previous assertion
  // alone would stay green even if the whole src/ tree vanished from the graph.
  const appFiles = files.filter((filePath) => filePath.startsWith("src/"));
  assert.ok(files.includes("src/main.tsx"), "expected src/main.tsx in the deployment compiler graph");
  assert.ok(appFiles.length > 350, `expected over 350 src/ files in the deployment compiler graph, got ${appFiles.length}`);
});

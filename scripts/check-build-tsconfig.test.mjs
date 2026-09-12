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
  assert.equal(result.status, 0, result.stderr);
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
  const testOnlyFiles = buildFiles().filter(isExcludedTestSupport);
  assert.deepEqual(testOnlyFiles, [], `test-only files entered tsconfig.build.json:\n${testOnlyFiles.join("\n")}`);
});

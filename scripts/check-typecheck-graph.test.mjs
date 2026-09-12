import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

function readConfig(path) {
  const filePath = `${root}${path}`;
  const result = ts.readConfigFile(filePath, ts.sys.readFile);
  assert.equal(result.error, undefined);
  return result.config;
}

test("the root solution references every typechecked project", () => {
  const references = readConfig("tsconfig.json").references.map(({ path }) => path);
  assert.deepEqual(references.sort(), [
    "./shared/tsconfig.json",
    "./shared/tsconfig.test.json",
    "./tsconfig.app.json",
    "./tsconfig.e2e.json",
    "./tsconfig.node.json",
  ]);
});

test("the referenced projects retain their distinct compiler environments", () => {
  assert.deepEqual(readConfig("tsconfig.app.json").compilerOptions.types, ["vite/client"]);
  assert.deepEqual(readConfig("tsconfig.app.json").compilerOptions.lib, ["ES2023", "DOM", "DOM.Iterable"]);
  assert.deepEqual(readConfig("tsconfig.node.json").compilerOptions.types, ["node"]);
  assert.deepEqual(readConfig("tsconfig.node.json").compilerOptions.lib, ["ES2023"]);
  assert.deepEqual(readConfig("tsconfig.e2e.json").compilerOptions.types, ["node", "@playwright/test"]);
  assert.deepEqual(readConfig("tsconfig.e2e.json").compilerOptions.lib, ["ES2023", "DOM", "DOM.Iterable"]);
  assert.deepEqual(readConfig("shared/tsconfig.json").compilerOptions.types, []);
});

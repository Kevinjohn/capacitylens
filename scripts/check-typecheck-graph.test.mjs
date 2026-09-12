import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));

function readConfig(path) {
  const filePath = `${root}${path}`;
  const result = ts.readConfigFile(filePath, ts.sys.readFile);
  assert.equal(result.error, undefined);
  return result.config;
}

function parseConfig(path) {
  const filePath = `${root}${path}`;
  const result = ts.readConfigFile(filePath, ts.sys.readFile);
  assert.equal(result.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(result.config, ts.sys, dirname(filePath), {}, filePath);
  assert.deepEqual(parsed.errors, [], path);
  return parsed;
}

const referencedProjects = [
  "./shared/tsconfig.json",
  "./shared/tsconfig.test.json",
  "./tsconfig.app.json",
  "./tsconfig.e2e.json",
  "./tsconfig.node.json",
];

test("the root solution has exactly the five intended typecheck projects", () => {
  const solution = readConfig("tsconfig.json");
  assert.deepEqual(solution.files, []);
  assert.deepEqual(
    solution.references.map(({ path }) => path),
    [
      "./shared/tsconfig.json",
      "./shared/tsconfig.test.json",
      "./tsconfig.app.json",
      "./tsconfig.e2e.json",
      "./tsconfig.node.json",
    ],
  );
});

test("each referenced project has inputs and retains its declared compiler environment", () => {
  for (const path of referencedProjects) assert.ok(parseConfig(path).fileNames.length > 0, path);
  assert.deepEqual(readConfig("tsconfig.app.json").compilerOptions.types, ["vite/client"]);
  assert.deepEqual(readConfig("tsconfig.app.json").compilerOptions.lib, ["ES2023", "DOM", "DOM.Iterable"]);
  assert.deepEqual(readConfig("tsconfig.node.json").compilerOptions.types, ["node"]);
  assert.deepEqual(readConfig("tsconfig.node.json").compilerOptions.lib, ["ES2023"]);
  assert.deepEqual(readConfig("tsconfig.e2e.json").compilerOptions.types, ["node", "@playwright/test"]);
  assert.deepEqual(readConfig("tsconfig.e2e.json").compilerOptions.lib, ["ES2023", "DOM", "DOM.Iterable"]);
  assert.deepEqual(readConfig("shared/tsconfig.json").compilerOptions.types, []);
});

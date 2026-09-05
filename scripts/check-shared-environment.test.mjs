import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";
import { ESLint } from "eslint";
import { classifyRepositoryPath } from "./source-inventory.mjs";
import { gateCommands } from "./gate-commands.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function diagnostics(program) {
  return ts.getPreEmitDiagnostics(program).map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, " "));
}

function programFor(configName, source) {
  const configPath = `${root}shared/${configName}`;
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, `${root}shared`, {}, configPath);
  assert.deepEqual(parsed.errors, []);
  const host = ts.createCompilerHost(parsed.options);
  const probe = `${root}shared/src/environmentProbe.ts`;
  if (source !== undefined) {
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (path, version, ...rest) =>
      path === probe ? ts.createSourceFile(path, source, version, true) : original(path, version, ...rest);
  }
  return ts.createProgram(source === undefined ? parsed.fileNames : [probe], parsed.options, host);
}

test("the production compiler graph contains no Node types or test files and type-checks cleanly", () => {
  const program = programFor("tsconfig.json");
  const paths = program.getSourceFiles().map(({ fileName }) => fileName);
  assert.ok(paths.some((path) => path.endsWith("/shared/src/lib/id.ts")));
  assert.deepEqual(
    paths.filter(
      (path) =>
        path.includes("/@types/node/") ||
        (path.startsWith(`${root}shared/src/`) && classifyRepositoryPath(path.slice(root.length)).role === "test"),
    ),
    [],
  );
  assert.deepEqual(diagnostics(program), []);
});

test("production rejects Node globals", () => {
  const program = programFor("tsconfig.json", "process.cwd(); Buffer.alloc(1); window.location; document.title;");
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .map(({ messageText }) => ts.flattenDiagnosticMessageText(messageText, " "));
  for (const name of ["process", "Buffer"]) {
    assert.ok(
      diagnostics.some((message) => message.includes(`'${name}'`)),
      name,
    );
  }
});

test("explicit Node imports reveal forbidden Node declarations even with automatic types disabled", () => {
  for (const source of ['import "node:fs";', 'import "fs";', 'void import("node:fs");']) {
    const program = programFor("tsconfig.json", source);
    const nodeTypes = program.getSourceFiles().some(({ fileName }) => fileName.includes("/@types/node/"));
    assert.ok(
      nodeTypes ||
        diagnostics(program).some((message) => message.includes("Cannot find") && /'(node:)?fs'/.test(message)),
      `${source}: ${JSON.stringify(diagnostics(program))}`,
    );
  }
});

test("the test project retains Node-backed filesystem checks and typed linting", async () => {
  const program = programFor("tsconfig.test.json");
  assert.ok(program.getRootFileNames().some((path) => path.endsWith("/packageExports.test.ts")));
  assert.deepEqual(diagnostics(program), []);
  const eslint = new ESLint({ cwd: root });
  const [result] = await eslint.lintText(
    'import { existsSync } from "node:fs";\nvoid existsSync(".");\nPromise.resolve();',
    {
      filePath: "shared/src/packageExports.test.ts",
    },
  );
  assert.deepEqual(
    result.messages.map(({ ruleId }) => ruleId),
    ["@typescript-eslint/no-floating-promises"],
  );
});

test("production lint rejects platform globals while retaining existing portable capabilities and types", async () => {
  const eslint = new ESLint({ cwd: root });
  const filePath = "shared/src/lib/id.ts";
  for (const source of [
    "void process;",
    "void Buffer;",
    "void window;",
    "void document;",
    "void fetch;",
    "void globalThis.document;",
    'void globalThis["process"];',
    "const platform = globalThis; void platform.document;",
    "const { document: pageDocument } = globalThis; void pageDocument;",
  ]) {
    const [result] = await eslint.lintText(source, { filePath });
    assert.ok(
      result.messages.some(({ ruleId }) => ruleId === "no-restricted-globals"),
      source,
    );
    assert.equal(result.fatalErrorCount, 0, source);
  }
  const [valid] = await eslint.lintText(
    'export type RequestHeaders = Headers;\nvoid crypto.randomUUID();\nvoid new TextEncoder().encode("ok");\nconsole.warn("warning");',
    { filePath },
  );
  assert.deepEqual(valid.messages, []);
  for (const source of ['import "node:fs";', 'export * from "fs";']) {
    const [result] = await eslint.lintText(source, { filePath });
    assert.ok(
      result.messages.some(({ ruleId }) => ruleId === "no-restricted-imports"),
      source,
    );
  }
});

test("both gates enforce the shared production environment", () => {
  for (const mode of ["app", "server"]) {
    assert.equal(
      gateCommands(mode).filter((args) => args.join(" ") === "run policy:shared-environment:test").length,
      1,
    );
  }
});

test("future test suffixes and support directories stay in the test project", async (t) => {
  const directory = mkdtempSync(`${root}shared/src/environment-fixture-`);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(`${directory}/__tests__`);
  const paths = [
    "sample.test.ts",
    "sample.spec.ts",
    "component.test.tsx",
    "module.spec.mts",
    "commonjs.spec.cts",
    "__tests__/helper.ts",
  ].map((name) => `${directory}/${name}`);
  for (const path of paths) writeFileSync(path, "export {};\n");
  const production = programFor("tsconfig.json").getRootFileNames();
  const tests = programFor("tsconfig.test.json").getRootFileNames();
  const eslint = new ESLint({ cwd: root });
  for (const path of paths) {
    assert.ok(!production.includes(path), path);
    assert.ok(tests.includes(path), path);
    const config = await eslint.calculateConfigForFile(path);
    assert.deepEqual(config.languageOptions.parserOptions.project, ["./shared/tsconfig.test.json"], path);
    assert.equal(config.rules["@typescript-eslint/no-floating-promises"][0], 2, path);
    assert.equal(config.rules["no-restricted-globals"], undefined, path);
  }
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { createDependencyParser, parseDependencies, resolveDependency } from "./dependencyScanner.mjs";

test("classifies static, inline type, re-export, dynamic and import-equals syntax", () => {
  const source = `
    import "./side-effect";
    import Default, { type Shape, value } from "./mixed";
    import type { Type } from "./type";
    import { type OnlyType } from "./inline-type";
    export { type Shape, value } from "./export-mixed";
    export type * from "./export-type";
    export * from "./export-all";
    export { type Type } from "./export-inline-type";
    const lazy = import("./lazy");
    const template = import(\`./template\`);
    type Imported = import("./import-type").Type;
    import Common = require("./common");
    import type CommonType = require("./common-type");
  `;
  assert.deepEqual(
    parseDependencies(source, "fixture.ts").map(({ specifier, kind }) => [specifier, kind]),
    [
      ["./side-effect", "runtime"],
      ["./mixed", "runtime"],
      ["./type", "type"],
      ["./inline-type", "type"],
      ["./export-mixed", "runtime"],
      ["./export-type", "type"],
      ["./export-all", "runtime"],
      ["./export-inline-type", "type"],
      ["./lazy", "runtime"],
      ["./template", "runtime"],
      ["./import-type", "type"],
      ["./common", "runtime"],
      ["./common-type", "type"],
    ],
  );
});

test("ignores strings, comments, JSX text and import.meta; reports nonliteral imports", () => {
  const source = `// import { x } from "./comment";
    const text = 'import("./string")';
    const jsx = <p>import("./jsx")</p>;
    const meta = import.meta.url;
    const lazy = import(variable);
  `;
  const edges = parseDependencies(source, "fixture.tsx");
  assert.equal(edges.length, 1);
  assert.deepEqual(edges[0], { specifier: null, kind: "runtime", line: 5, expression: "variable" });
});

test("resolves relative paths, aliases, extensions and indexes; distinguishes external and unresolved", (t) => {
  const root = mkdtempSync(join(tmpdir(), "dependency-scanner-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of [
    "apps/frontend/src/component.tsx",
    "apps/frontend/src/folder/index.mts",
    "apps/frontend/src/runtime.cts",
    "packages/shared/src/types.ts",
    "apps/frontend/src/style.css",
    "apps/backend/app/controllers/example.ts",
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  writeFileSync(
    join(root, "apps/backend/package.json"),
    JSON.stringify({ imports: { "#controllers/*": "./app/controllers/*.js" } }),
  );
  assert.deepEqual(resolveDependency("#controllers/example", join(root, "apps/backend/start/routes.ts"), root), {
    classification: "internal",
    path: join(root, "apps/backend/app/controllers/example.ts"),
  });
  const from = join(root, "apps/frontend/src/main.ts");
  for (const [specifier, target] of [
    ["./component", "apps/frontend/src/component.tsx"],
    ["./component.js", "apps/frontend/src/component.tsx"],
    ["@/folder", "apps/frontend/src/folder/index.mts"],
    ["./runtime.cjs", "apps/frontend/src/runtime.cts"],
    ["@capacitylens/shared/types", "packages/shared/src/types.ts"],
    ["./style.css", "apps/frontend/src/style.css"],
  ]) {
    assert.deepEqual(resolveDependency(specifier, from, root), {
      classification: "internal",
      path: join(root, target),
    });
  }
  assert.deepEqual(resolveDependency("react", from, root), { classification: "external" });
  assert.deepEqual(resolveDependency("node:fs", from, root), { classification: "external" });
  assert.deepEqual(resolveDependency("./missing", from, root), { classification: "unresolved" });
  assert.deepEqual(resolveDependency(null, from, root), { classification: "nonliteral" });
});

test("matches compiler emission for inline type imports and re-exports in both modes", () => {
  for (const verbatimModuleSyntax of [false, true]) {
    for (const source of [
      'import { type T } from "./types"; export type Item = T;',
      'export { type T } from "./types";',
      'import type { T } from "./types"; export type Item = T;',
      'export type { T } from "./types";',
    ]) {
      const emitted = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, verbatimModuleSyntax },
      }).outputText;
      const runtime = parseDependencies(source, "fixture.ts", { verbatimModuleSyntax }).some(
        (edge) => edge.kind === "runtime",
      );
      assert.equal(runtime, emitted.includes('from "./types"'), `${verbatimModuleSyntax}: ${source}`);
    }
  }
});

test("uses each package's compiler configuration, including inherited options, and rejects invalid config", (t) => {
  const root = mkdtempSync(join(tmpdir(), "dependency-options-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "base.json"),
    JSON.stringify({ compilerOptions: { module: "ESNext", verbatimModuleSyntax: true } }),
  );
  for (const directory of ["apps/frontend/src", "apps/backend/app", "packages/shared/src"]) {
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, directory, "main.ts"), "export {};");
  }
  writeFileSync(
    join(root, "apps/frontend/tsconfig.app.json"),
    JSON.stringify({ extends: "../../base.json", include: ["src"] }),
  );
  writeFileSync(
    join(root, "packages/shared/tsconfig.json"),
    JSON.stringify({ extends: "../../base.json", include: ["src"] }),
  );
  writeFileSync(
    join(root, "apps/backend/tsconfig.json"),
    JSON.stringify({
      extends: "../../base.json",
      compilerOptions: { verbatimModuleSyntax: false },
      include: ["app"],
    }),
  );
  const parse = createDependencyParser(root);
  const source = 'import { type T } from "./types";';
  assert.equal(parse(source, join(root, "apps/frontend/src/main.ts"))[0].kind, "runtime");
  assert.equal(parse(source, join(root, "packages/shared/src/main.ts"))[0].kind, "runtime");
  assert.equal(parse(source, join(root, "apps/backend/app/main.ts"))[0].kind, "type");
  writeFileSync(
    join(root, "apps/backend/tsconfig.json"),
    JSON.stringify({ compilerOptions: { unknownSetting: true } }),
  );
  assert.throws(() => createDependencyParser(root), /Unknown compiler option/);
  rmSync(join(root, "apps/backend/tsconfig.json"));
  assert.throws(() => createDependencyParser(root), /Cannot read file/);
});

test("identifies exact erased type names without treating namespace or runtime imports as narrow contracts", () => {
  const source = `
    import type { Db as Database } from "./db";
    import { type Db } from "./db";
    export type { Db as Database } from "./db";
    import type * as Database from "./db";
    import type Database from "./db";
    export type * from "./db";
    type Database = import("./db");
    import { Db } from "./db";
    import type { Db, Other } from "./db";
  `;
  assert.deepEqual(
    parseDependencies(source, "types.ts").map((edge) => edge.typeNames),
    [["Db"], ["Db"], ["Db"], undefined, undefined, undefined, undefined, undefined, ["Db", "Other"]],
  );
  assert.equal(
    parseDependencies('import { type Db } from "./db";', "types.ts", { verbatimModuleSyntax: true })[0].typeNames,
    undefined,
  );
});

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { parseDependencies, resolveDependency } from "./dependency-scanner.mjs";

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
    "src/component.tsx",
    "src/folder/index.mts",
    "src/runtime.cts",
    "shared/src/types.ts",
    "src/style.css",
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  const from = join(root, "src/main.ts");
  for (const [specifier, target] of [
    ["./component", "src/component.tsx"],
    ["./component.js", "src/component.tsx"],
    ["@/folder", "src/folder/index.mts"],
    ["./runtime.cjs", "src/runtime.cts"],
    ["@capacitylens/shared/types", "shared/src/types.ts"],
    ["./style.css", "src/style.css"],
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

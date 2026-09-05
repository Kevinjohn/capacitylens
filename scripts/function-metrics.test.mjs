import assert from "node:assert/strict";
import test from "node:test";
import { measureFunctions } from "./function-metrics.mjs";

function metrics(source, filename = "fixture.tsx") {
  return measureFunctions(source, filename).filter(({ origin }) => origin !== "program");
}

function named(source, symbol) {
  const result = metrics(source).find((entry) => entry.symbol === symbol);
  assert.ok(result, `Missing ${symbol}`);
  return result;
}

test("measures named functions, methods, arrows and memo components", () => {
  const source = `
export function run() { return 1; }
const Component = memo(() => <div />);
class Service { get value() { return 1; } set value(next) {} run() {} }
const actions = { run() {}, stop: () => {} };
`;
  assert.deepEqual(
    metrics(source).map(({ symbol }) => symbol),
    [
      "function:run",
      "function:Component",
      "function:Service.get value",
      "function:Service.set value",
      "function:Service.run",
      "function:actions.run",
      "function:actions.stop",
    ],
  );
  assert.ok(metrics(source).every(({ lines, complexity, depth }) => lines === 1 && complexity === 1 && depth === 0));
});

test("counts nonblank non-comment lines including JSX and nested bodies", () => {
  const source = `function render() {
  // explanation
  /* first */ /* second */

  const text = "// not a comment";
  const child = () => {
    return text;
  };
  return <div>
    {/* JSX braces remain code */}
    {child()}
  </div>;
}`;
  const result = named(source, "function:render");
  assert.equal(result.lines, 10);
  assert.equal(result.startLine, 1);
  assert.equal(result.endLine, 13);
  assert.equal(named(source, "function:render/function:child").lines, 3);
  assert.equal(named(source.replaceAll("\n", "\r\n"), "function:render").lines, 10);
});

test("retains exact threshold counts without exempting callbacks or IIFEs", () => {
  for (const length of [99, 100, 101]) {
    const body = Array.from({ length: length - 2 }, () => "  work();").join("\n");
    for (const source of [
      `function run() {\n${body}\n}`,
      `test("large", () => {\n${body}\n});`,
      `(() => {\n${body}\n})();`,
    ]) {
      assert.equal(metrics(source)[0].lines, length);
    }
  }
});

test("counts branching syntax while keeping nested complexity independent", () => {
  const source = `function run(value = 1) {
    if (value && ready) work();
    const choice = ready ? 1 : 0;
    for (;;) break;
    for (const key in value) work();
    for (const item of value) work();
    while (ready) break;
    do { work(); } while (ready);
    try { work(); } catch (error) { report(error); }
    switch(value) { case 1: break; case 2: break; default: break; }
    value ||= other;
    value &&= other;
    value ??= other;
    value?.next?.();
    const fallback = value ?? other;
    const nested = () => ready ? 1 : 0;
  }`;
  assert.equal(named(source, "function:run").complexity, 19);
  assert.equal(named(source, "function:run/function:nested").complexity, 2);
});

test("measures statement depth without counting else-if chains or nested functions", () => {
  const source = `function run() {
    if (one) {
      for (;;) {
        try {
          while (ready) {
            if (two) work();
          }
        } finally { cleanup(); }
      }
    } else if (two) { work(); }
    const child = () => { if (one) work(); };
  }`;
  assert.equal(named(source, "function:run").depth, 5);
  assert.equal(named(source, "function:run/function:child").depth, 1);
  assert.equal(
    named("function run() { if (a) work(); else if (b) work(); else if (c) work(); }", "function:run").depth,
    1,
  );
});

test("separates class initializers, callbacks and static blocks even at identical ranges", () => {
  const source = `class Service {
    value = ready ? 1 : 0;
    callback = () => ready ? 1 : 0;
    static { if (ready) { while (ready) break; } }
  }`;
  const result = metrics(source);
  assert.deepEqual(
    result.map(({ symbol, complexity, depth }) => ({ symbol, complexity, depth })),
    [
      { symbol: "class-field-initializer:Service.value", complexity: 2, depth: 0 },
      { symbol: "class-field-initializer:Service.callback", complexity: 1, depth: 0 },
      { symbol: "class-field-initializer:Service.callback/function:Service.callback", complexity: 2, depth: 0 },
      { symbol: "class-static-block:Service.static", complexity: 3, depth: 2 },
    ],
  );
  assert.equal(
    result[0].lines,
    null,
    "Field initializers have complexity budgets; their arrows retain function length budgets.",
  );
  assert.equal(result[2].lines, 1);
});

test("callback identities retain test labels and lexical owners, not line numbers", () => {
  const source = `describe("group", () => {
    it("first", () => {});
    it("second", () => {});
    values.map(() => {});
    values.map(() => {});
  });`;
  const symbols = metrics(source).map(({ symbol }) => symbol);
  assert.deepEqual(symbols, [
    'function:describe("group") callback',
    'function:describe("group") callback/function:it("first") callback',
    'function:describe("group") callback/function:it("second") callback',
    'function:describe("group") callback/function:values.map callback',
    'function:describe("group") callback/function:values.map callback#2',
  ]);
  assert.deepEqual(
    metrics("// moved\n\n" + source).map(({ symbol }) => symbol),
    symbols,
  );
});

test("ignores bodyless type declarations and rejects malformed or unsupported source", () => {
  assert.deepEqual(
    metrics("declare function run(): void; interface Port { run(): void } type Callback = () => void;"),
    [],
  );
  assert.throws(() => metrics("function broken( {"), /Cannot measure fixture.tsx/);
  assert.throws(() => metrics("echo hello", "fixture.sh"), /Unsupported function source/);
  assert.throws(() => metrics("", "fixture.vue"), /Unsupported function source/);
});

test("inline directives cannot suppress collection and every supported module suffix parses", () => {
  assert.equal(metrics("/* eslint-disable */\nfunction run() {}").length, 1);
  for (const suffix of ["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"]) {
    assert.equal(metrics("function run() {}", `fixture.${suffix}`).length, 1, suffix);
  }
});

test("uses CommonJS parsing for both JavaScript and TypeScript CommonJS modules", () => {
  for (const suffix of ["cjs", "cts"]) {
    assert.equal(metrics("return (() => 1)();", `fixture.${suffix}`).length, 1);
  }
  assert.throws(() => metrics("function run() {}", "fixture.mtsx"), /Unsupported function source/);
});

test("static and instance methods keep distinct identities when their order changes", () => {
  const first = metrics("class Service { static run() {} run() {} }")
    .map(({ symbol }) => symbol)
    .sort();
  const second = metrics("class Service { run() {} static run() {} }")
    .map(({ symbol }) => symbol)
    .sort();
  assert.deepEqual(first, ["function:Service.run", "function:Service.static run"]);
  assert.deepEqual(second, first);
});

test("retains exact complexity and depth boundary counts", () => {
  for (const complexity of [11, 12, 13]) {
    const branches = "if (ready) work();\n".repeat(complexity - 1);
    assert.equal(named(`function run() {\n${branches}}`, "function:run").complexity, complexity);
  }
  for (const depth of [3, 4, 5]) {
    const source = `function run() {${"if (ready) {".repeat(depth)}work();${"}".repeat(depth)}}`;
    assert.equal(named(source, "function:run").depth, depth);
  }
});

test("literal property keys support BigInt without serialization failures", () => {
  const result = metrics('const actions = { [1n]() {}, [2n]() {}, "named"() {} };');
  assert.deepEqual(
    result.map(({ symbol }) => symbol),
    ["function:actions.1n", "function:actions.2n", 'function:actions."named"'],
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { measureShellFunctions } from "./shell-function-metrics.mjs";

const measure = (source) => measureShellFunctions(source, "fixture.sh");

test("measures POSIX and Bash function definitions with lexical ownership", async () => {
  const result = await measure("outer() { inner() { :; }; :; }\nfunction keyword { :; }\nouter() ( : )\n");
  assert.deepEqual(
    result.map(({ symbol }) => symbol),
    ["function:outer", "function:outer/function:inner", "function:keyword", "function:outer#2"],
  );
  assert.ok(result.every(({ lines, complexity, depth }) => lines === 1 && complexity === 1 && depth === 0));
});

test("counts code lines while preserving quoted hashes and heredoc content", async () => {
  const source = `label="😀"
run() {
  # explanation

  printf '%s\\n' '# data, not a comment'
  cat <<'END'
# literal data
fake() { if true; then :; fi; }
END
  : # trailing comment
}`;
  const result = await measure(source);
  assert.equal(result.length, 1);
  assert.equal(result[0].lines, 8);
  assert.equal(result[0].startLine, 2);
  assert.equal(result[0].endLine, 11);
  assert.equal(result[0].complexity, 1);
});

test("counts branches in conditionals, loops, cases, logical tests and defaults", async () => {
  const source = `run() {
    if a; then :; elif b; then :; else :; fi
    for item in a b; do :; done
    while a; do break; done
    until a; do break; done
    for ((i=0; i<2; i++)); do :; done
    case "$value" in a|b) :;; c) :;; *) :;; esac
    a && b || c
    [[ -f a && -f b || -f c ]]
    : "$((a ? b : c))"
    : "\${value:-fallback}"
  }`;
  assert.equal((await measure(source))[0].complexity, 15);
});

test("nested functions have independent complexity and depth but remain in parent length", async () => {
  const result = await measure(`outer() {
  if a; then
    inner() {
      if b; then
        while c; do :; done
      fi
    }
  fi
}`);
  assert.deepEqual(
    result.map(({ lines, complexity, depth }) => ({ lines, complexity, depth })),
    [
      { lines: 9, complexity: 2, depth: 1 },
      { lines: 5, complexity: 3, depth: 2 },
    ],
  );
});

test("command substitutions retain real functions without parsing quoted command text", async () => {
  const result = await measure(`run() {
    value=$(nested() { if true; then :; fi; }; nested)
    printf '%s' 'fake() { if true; then :; fi; }'
  }`);
  assert.deepEqual(
    result.map(({ symbol, complexity }) => ({ symbol, complexity })),
    [
      { symbol: "function:run", complexity: 1 },
      { symbol: "function:run/function:nested", complexity: 2 },
    ],
  );
});

test("pins exact length, complexity and depth thresholds", async () => {
  for (const lines of [99, 100, 101]) {
    assert.equal((await measure(`run() {\n${"  :\n".repeat(lines - 2)}}`))[0].lines, lines);
  }
  for (const complexity of [11, 12, 13]) {
    assert.equal((await measure(`run() { ${"if a; then :; fi; ".repeat(complexity - 1)}}`))[0].complexity, complexity);
  }
  for (const depth of [3, 4, 5]) {
    assert.equal((await measure(`run() { ${"if a; then ".repeat(depth)}:; ${"fi; ".repeat(depth)}}`))[0].depth, depth);
  }
});

test("symbol identities survive comments and blank-line movement", async () => {
  const source = "run() { :; }\nother() { :; }\n";
  assert.deepEqual(
    (await measure(source)).map(({ symbol }) => symbol),
    (await measure("# moved\n\n" + source)).map(({ symbol }) => symbol),
  );
});

test("rejects malformed or unsupported input and measures empty files without invention", async () => {
  assert.deepEqual(await measure("# no functions\n"), []);
  await assert.rejects(measure("run() { if true; then"), /Cannot measure fixture.sh/);
  await assert.rejects(measureShellFunctions("function run() {}", "fixture.ts"), /Unsupported shell source/);
});

test("measures both repository shell scripts without executing their commands", async () => {
  const root = new URL("../", import.meta.url);
  const source = readFileSync(new URL("scripts/internal-tls.sh", root), "utf8");
  const result = await measureShellFunctions(source, "scripts/internal-tls.sh");
  assert.deepEqual(
    result.map(({ symbol, lines, complexity, depth }) => ({ symbol, lines, complexity, depth })),
    [
      { symbol: "function:ca_is_usable", lines: 15, complexity: 5, depth: 1 },
      { symbol: "function:certificate_set_is_usable", lines: 17, complexity: 8, depth: 1 },
      { symbol: "function:repair_certificate_permissions", lines: 6, complexity: 1, depth: 0 },
      { symbol: "function:publish_generation", lines: 8, complexity: 1, depth: 0 },
    ],
  );
  assert.deepEqual(
    await measureShellFunctions(
      readFileSync(new URL("scripts/renew-internal-tls.sh", root), "utf8"),
      "scripts/renew-internal-tls.sh",
    ),
    [],
  );
});

test("distinguishes wildcard defaults from quoted case patterns and nonbranching expansions", async () => {
  const source = `run() {
    case "$value" in '*') :;; *) :;; esac
    : "\${value: -1}" "\${value/foo/bar}" "\${#value}"
  }`;
  assert.equal((await measure(source))[0].complexity, 2);
});

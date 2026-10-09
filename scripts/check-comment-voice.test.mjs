import assert from "node:assert/strict";
import test from "node:test";
import { evaluateCommentVoice } from "./check-comment-voice.mjs";

const findings = (content, path = "src/sample.ts") =>
  evaluateCommentVoice(path, content).map(({ line, rule }) => `${line}: ${rule}`);

test("reports ticket references in comments", () => {
  const content = [
    "// Fixed in #123.",
    "// Plan task T7 owns this.",
    "/* Added in Phase 2. */",
    "// See issue 456 for context.",
    "// The P1.11 helper.",
    "// The round-1 regression.",
    "// Deferred to Stage C.",
    "// Allowed by plan exception 3.",
    "const a = 1;",
  ].join("\n");
  assert.deepEqual(findings(content), [
    "1: ticket reference",
    "2: ticket reference",
    "3: ticket reference",
    "4: ticket reference",
    "5: ticket reference",
    "6: ticket reference",
    "7: ticket reference",
    "8: ticket reference",
  ]);
});

test("reports an em-dash in line, block and JSX comments", () => {
  const content = ["// One — two.", "/** Three — four. */", "export const view = <div>{/* five — six */}</div>;"].join(
    "\n",
  );
  assert.deepEqual(findings(content, "src/sample.tsx"), ["1: em-dash", "2: em-dash", "3: em-dash"]);
});

test("reports section banners", () => {
  const content = ["// ---- Helpers ----", "// ======", "// ──── Section", "/* ****** */", "// ── Title"].join("\n");
  assert.deepEqual(findings(content), [
    "1: section banner",
    "2: section banner",
    "3: section banner",
    "4: section banner",
    "5: section banner",
  ]);
});

test("reports a hanging indent on TSDoc continuation lines", () => {
  const content = ["/** First line.", " *  continued with a hanging indent.", " * Flat line.", " */"].join("\n");
  assert.deepEqual(findings(content), ["2: hanging TSDoc indent"]);
});

test("reports an indented TSDoc tag line and an indented continuation after a tag", () => {
  const content = [
    "/** First line.",
    " *  @param a - the first.",
    " * @param b - the second, which",
    " *   wraps with a hanging indent.",
    " * @returns nothing.",
    " */",
  ].join("\n");
  assert.deepEqual(findings(content), ["2: hanging TSDoc indent", "4: hanging TSDoc indent"]);
});

test("does not apply the TSDoc indent rule to plain block comments", () => {
  assert.deepEqual(findings(["/*", " * Plain block.", " *   indented on purpose.", " */"].join("\n")), []);
});

test("reads a JSDoc comment once and never treats JSX text as a comment", () => {
  assert.deepEqual(findings('/** @type {/* \u2014 */ string} */\nconst a = "";\n'), ["1: em-dash"]);
  assert.deepEqual(findings("export const v = <p>\n  // copy \u2014 #12\n</p>;\n", "src/sample.tsx"), []);
});

test("reports a TODO or FIXME without an issue URL", () => {
  const content = [
    "// TODO: tidy this.",
    "// FIXME later.",
    "// TODO https://github.com/owner/repo/issues/12 tracks this.",
  ].join("\n");
  assert.deepEqual(findings(content), ["1: TODO without issue URL", "2: TODO without issue URL"]);
});

test("ignores strings, template literals, regex literals and JSX text", () => {
  const content = [
    'const a = "one — two #123";',
    "const b = `three — four ${a} // TODO #9`;",
    "const c = /— #1/;",
    'const colour = "#fff";',
    'const d = "// ---- not a banner ----";',
    "export const e = <p>Copy — with // slashes #12</p>;",
  ].join("\n");
  assert.deepEqual(findings(content, "src/sample.tsx"), []);
});

test("allows issue URLs, colours and indentation inside fences, examples and lists", () => {
  const content = [
    "// See https://github.com/owner/repo/issues/123 for context.",
    "// Notes live at https://example.com/P1.11/T7#12 for reference.",
    "// The surface is #161922.",
    "/**",
    " * Usage:",
    " * ```ts",
    " *   indented(code);",
    " * ```",
    " * - a list item that wraps",
    " *   onto a continuation line",
    " * 1. numbered item",
    " *    continuation",
    " * @example",
    " *   example(code);",
    " */",
  ].join("\n");
  assert.deepEqual(findings(content), []);
});

test("does not lint capitals used for emphasis", () => {
  assert.deepEqual(findings("// This must NEVER happen.\nconst a = 1;"), []);
});

test("names the path in each finding", () => {
  assert.deepEqual(evaluateCommentVoice("shared/src/x.ts", "// T7 owns this.\n"), [
    { path: "shared/src/x.ts", line: 1, rule: "ticket reference" },
  ]);
});

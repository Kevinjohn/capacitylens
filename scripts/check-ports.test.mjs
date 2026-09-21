import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GUARDED_FILES, evaluatePortUsage, stripComments } from "./check-ports.mjs";

test("every guarded file derives its ports from the lane module", () => {
  const files = GUARDED_FILES.map((path) => ({
    path,
    content: readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
  }));
  assert.deepEqual(evaluatePortUsage(files), []);
});

test("a hardcoded lane port is reported, and a file that stopped importing the module is too", () => {
  assert.deepEqual(
    evaluatePortUsage([{ path: "x.ts", content: 'import { ports } from "./ports.mjs";\nconst port = 5173;\n' }]),
    ["x.ts: hardcodes port 5173. Derive it from scripts/ports.mjs so every lane is correct, not only lane 0."],
  );
  assert.deepEqual(evaluatePortUsage([{ path: "x.ts", content: "const port = somewhereElse();\n" }]), [
    "x.ts: must import its ports from scripts/ports.mjs.",
  ]);
});

test("prose about a port is not code, so comments never fail the check", () => {
  const content =
    'import { ports } from "./ports.mjs";\n// lane 0 is the historical 5173\n/* and 8787 */\nconst port = ports().web; // was 4173\n';
  assert.deepEqual(evaluatePortUsage([{ path: "x.ts", content }]), []);
  assert.ok(!stripComments(content).includes("5173"));
});

test("a URL's scheme is not a comment, so a hardcoded origin is still caught", () => {
  const content = 'import { ports } from "./ports.mjs";\nconst api = "http://localhost:8787";\n';
  assert.deepEqual(evaluatePortUsage([{ path: "x.ts", content }]), [
    "x.ts: hardcodes port 8787. Derive it from scripts/ports.mjs so every lane is correct, not only lane 0.",
  ]);
});

test("a port that merely shares digits with a guarded one is left alone", () => {
  const content = 'import { ports } from "./ports.mjs";\nconst unrelated = 51730;\nconst other = 15173;\n';
  assert.deepEqual(evaluatePortUsage([{ path: "x.ts", content }]), []);
});

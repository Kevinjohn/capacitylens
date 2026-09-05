import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";
import { measureVueFunctions } from "./vue-function-metrics.mjs";
import { cloneMetricAst } from "./vue-metric-regions.mjs";

const measure = (source) => measureVueFunctions(source, "Example.vue");
const functions = (entries) => entries.filter(({ origin }) => origin === "function");
const regions = (entries) => entries.filter(({ origin }) => origin === "embedded-region");

test("measures script functions and typed template callbacks at original positions", () => {
  const source = `<script setup lang="ts">
const script = (value: boolean) => value ? 1 : 0;
</script>
<template><div :title="items.map((x: number) =&gt; x ? 'yes' : 'no')">
{{ items.map(x => x && x.value) }}
</div></template>`;
  const entries = measure(source);
  assert.deepEqual(
    functions(entries).map(({ startLine, lines, complexity }) => [startLine, lines, complexity]),
    [
      [2, 1, 2],
      [4, 1, 2],
      [5, 1, 2],
    ],
  );
  assert.equal(regions(entries).length, 2);
  assert.ok(functions(entries)[1].symbol.includes("bind:title"));
});

test("bounds event statements without inventing functions for handler references", () => {
  const entries = measure(`<template>
<button @click="handler" />
<button @click="event => event ? save(event) : cancel()" />
<button @click="if (ready) { if (valid) save($event); } else cancel()" />
</template>`);
  assert.equal(functions(entries).length, 1);
  assert.deepEqual(
    regions(entries).map(({ complexity, depth }) => [complexity, depth]),
    [
      [1, 0],
      [1, 0],
      [3, 2],
    ],
  );
});

test("visits dynamic arguments, loop iterables, binding defaults and slots independently", () => {
  const entries = measure(`<template><div
  :[key(function(){})]="() => value"
  v-for="({ item = () => fallback }, index) in items.filter(x => x.active)"
  v-slot="{ value = () => initial }"
>{{ (() => text)() }}</div></template>`);
  assert.equal(functions(entries).length, 6);
  assert.equal(regions(entries).length, 6);
  assert.equal(new Set(entries.map(({ symbol }) => symbol)).size, entries.length);
});

test("includes CSS bindings and rejects recovered expressions or skipped blocks", () => {
  assert.equal(functions(measure(`<style>.a { color: v-bind("items.map(x => x.color)"); }</style>`)).length, 1);
  for (const source of [
    '<template><div :x="() => { broken" /></template>',
    '<style>.a { color: v-bind("() => { broken"); }</style>',
    '<style>.a { color: v-bind("foo"; }</style>',
    "<script>const x=1</script><script>const y=()=>2</script>",
    '<script src="./external.js" />',
    '<template lang="pug">div</template>',
    '<style lang="scss">.a { color: red }</style>',
    "<custom>function hidden() {}</custom>",
    "<template></template><template setup>{{()=>1}}</template>",
    "<script>function f() {}",
    "<template>{{()=>1}}",
    "<style>.a { color: red }",
    "<script setup>const first=1</script><script setup>const second=2</script>",
    '<script lang="coffee">hidden = -> 1</script>',
    '<style src="./external.css" />',
    '<template><div v-for="{ = broken } in items" /></template>',
    '<template><div v-slot="{ broken = }" /></template>',
  ])
    assert.throws(() => measure(source), /Cannot measure/);
});

test("measures the authored documentation component", () => {
  const source = readFileSync(new URL("../docs-src/.vitepress/theme/Breadcrumbs.vue", import.meta.url), "utf8");
  const entries = measure(source);
  assert.equal(functions(entries).length, 4);
  assert.ok(entries.every(({ lines, complexity, depth }) => lines <= 100 && complexity <= 12 && depth <= 4));
});

test("keeps loop binding spans separate from their multiline iterable", () => {
  const entries = regions(
    measure(`<template><div v-for="(
{ item = fallback },
index)
in
items.filter(
x => x.active
)" /></template>`),
  );
  assert.deepEqual(
    entries.map(({ startLine, endLine, lines, complexity }) => [startLine, endLine, lines, complexity]),
    [
      [5, 7, 3, 1],
      [2, 3, 2, 2],
    ],
  );
});

test("preserves physical lines, Unicode, comments and independent nested scopes", () => {
  const entries = measure(`<!-- 🦇 -->
<template><div :value="() => {
/* 🦇 comment */
const inner = () => {
  if (yes) return 1;
  return 0;
};
return inner();
}" /></template>`);
  assert.deepEqual(
    functions(entries).map(({ startLine, endLine, lines, complexity, depth }) => [
      startLine,
      endLine,
      lines,
      complexity,
      depth,
    ]),
    [
      [2, 9, 7, 1, 0],
      [4, 7, 4, 2, 1],
    ],
  );
  const encoded = functions(
    measure('<template><div :x="() =&gt; {&#10;/* comment */&#10;return true &amp;&amp; false;&#10;}" /></template>'),
  );
  assert.deepEqual(
    encoded.map(({ lines, complexity }) => [lines, complexity]),
    [[1, 2]],
  );
});

test("retains exact region and nested-function budget boundaries", () => {
  for (const length of [99, 100, 101]) {
    const statements = Array.from({ length }, () => "run();").join("\n");
    assert.equal(regions(measure(`<template><button @click="${statements}" /></template>`))[0].lines, length);
    const body = Array.from({ length: length - 2 }, () => "run();").join("\n");
    assert.equal(functions(measure(`<template><div :x="() => {\n${body}\n}" /></template>`))[0].lines, length);
  }
  for (const complexity of [11, 12, 13]) {
    const statements = "if (ready) run();".repeat(complexity - 1);
    assert.equal(regions(measure(`<template><button @click="${statements}" /></template>`))[0].complexity, complexity);
  }
  for (const depth of [3, 4, 5]) {
    const statements = "if (ready) {".repeat(depth) + "run();" + "}".repeat(depth);
    assert.equal(regions(measure(`<template><button @click="${statements}" /></template>`))[0].depth, depth);
  }
});

test("region identities survive blank lines and comments, with distinct duplicate owners", () => {
  const source = '<template><div :x="() => 1" /><div :x="() => 2" /></template>';
  const before = measure(source).map(({ symbol }) => symbol);
  const after = measure(`<!-- moved -->\n\n${source}`).map(({ symbol }) => symbol);
  assert.deepEqual(after, before);
  assert.equal(new Set(before).size, before.length);
  assert.ok(before.some((symbol) => symbol.includes("#2")));
});

test("covers both script blocks, JSX/TSX, directives and implicit class scopes", () => {
  assert.equal(
    functions(measure("<script>export const normal=()=>1;</script><script setup>const setup=()=>2;</script>")).length,
    2,
  );
  for (const [lang, parameters] of [
    ["jsx", "x"],
    ["tsx", "x: string"],
  ]) {
    assert.equal(
      functions(measure(`<script lang="${lang}">const view=(${parameters})=> <div>{x}</div>;</script>`)).length,
      1,
    );
  }
  const directives = measure(`<template><div
    v-if="(() => true)()" v-show="() => true"
    v-model="object[(() => key)()]" v-custom="() => true"
    @[event(function(){})]="handler"
  /></template>`);
  assert.equal(functions(directives).length, 5);
  assert.equal(regions(directives).length, 6);
  const classEntries = measure(
    '<template><div :x="new class { value = a ?? b; callback = () => true; method() { return a ? b : c; } }" /></template>',
  );
  assert.deepEqual(
    classEntries.map(({ origin, complexity }) => [origin, complexity]),
    [
      ["embedded-region", 1],
      ["class-field-initializer", 2],
      ["class-field-initializer", 1],
      ["function", 1],
      ["function", 2],
    ],
  );
});

test("measures supported CSS binding forms without counting quoted or commented lookalikes", () => {
  const entries = measure(`<style>.a {
    --x: v-bind(() => 1);
    --y: v-bind('() => 2');
    --z: v-bind("() => 3");
    content: "v-bind(() => 4)";
    /* v-bind(() => 5) */
  }</style><style scoped>.b { color: v-bind("items.map(x => x.color)"); }</style>`);
  assert.equal(functions(entries).length, 4);
  assert.equal(regions(entries).length, 4);
});

test("syntax cloning preserves parser ownership and rejects unknown node kinds", () => {
  const parsed = vueParser.parseForESLint("<script>const value = () => 1;</script>", {
    parser: tseslint.parser,
    ecmaVersion: "latest",
    sourceType: "module",
    range: true,
    loc: true,
  });
  const cloned = cloneMetricAst(parsed.ast, parsed.visitorKeys);
  cloned.body[0].declarations[0].id.name = "changed";
  assert.equal(parsed.ast.body[0].declarations[0].id.name, "value");
  assert.equal(cloned.body[0].parent, undefined);
  assert.throws(() => cloneMetricAst({ type: "UnknownSyntax" }, parsed.visitorKeys), /Missing metric visitor keys/);
});

test("empty SFC regions remain empty and inline directives cannot hide functions", () => {
  assert.deepEqual(measure('<template><div :x="" /></template><style />'), []);
  assert.equal(functions(measure("<script>/* eslint-disable */ const f=()=>1;</script>")).length, 1);
  assert.throws(() => measureVueFunctions("", "Example.ts"), /Unsupported Vue source/);
});

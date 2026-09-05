// Runtime cycles use syntax-aware edges; unresolved imports fail visibly.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDependencies, resolveDependency } from "./dependency-scanner.mjs";
const root = resolve(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)));
const roots = ["src", "server/src", "shared/src"].map((d) => resolve(root, d));
function files(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(d, e.name);
    if (e.isDirectory()) return e.name === "paraglide" ? [] : files(p);
    return /\.[cm]?[jt]sx?$/.test(e.name) && !/\.(test|spec)\.|\.d\.[cm]?ts$/.test(e.name) ? [p] : [];
  });
}
// Paraglide's two generated entry points do not exist until message compilation.
// Only the owning i18n facade may omit these exact build outputs from this source graph.
const generatedImports = new Set(["@/paraglide/messages.js", "@/paraglide/runtime.js"]);
let invalidEdges = 0;
function deps(file) {
  const dependencies = [];
  for (const edge of parseDependencies(readFileSync(file, "utf8"), file)) {
    if (relative(root, file).replaceAll("\\", "/") === "src/i18n/index.ts" && generatedImports.has(edge.specifier))
      continue;
    const resolved = resolveDependency(edge.specifier, file, root);
    if (resolved.classification === "unresolved" || resolved.classification === "nonliteral") {
      console.error(
        `${relative(root, file)}:${edge.line}: ${resolved.classification} import ${edge.specifier ?? edge.expression}`,
      );
      invalidEdges++;
    } else if (resolved.classification === "internal" && edge.kind === "runtime") {
      dependencies.push(resolved.path);
    }
  }
  return dependencies;
}
const all = roots.flatMap(files);
const g = new Map(all.map((f) => [f, deps(f)]));
const cycles = new Set();
const stack = [];
const on = new Set();
const done = new Set();
function dfs(n) {
  if (done.has(n)) return;
  stack.push(n);
  on.add(n);
  for (const d of g.get(n) ?? []) {
    if (on.has(d)) {
      const c = stack.slice(stack.indexOf(d));
      const min = c.indexOf([...c].sort()[0]);
      cycles.add([...c.slice(min), ...c.slice(0, min)].map((x) => relative(root, x)).join(" > "));
    } else dfs(d);
  }
  stack.pop();
  on.delete(n);
  done.add(n);
}
for (const f of all) dfs(f);
for (const c of [...cycles].sort()) console.error(c);
console.error(`${cycles.size} runtime cycles`);

if (cycles.size > 0 || invalidEdges > 0) process.exitCode = 1;

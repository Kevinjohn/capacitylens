// Runtime (value) import cycles only: type-only imports/exports are skipped, like architecture.test.ts.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)));
const roots = ["src", "server/src", "shared/src"].map((d) => resolve(root, d));
function files(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = resolve(d, e.name);
    if (e.isDirectory()) return e.name === "paraglide" ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.|\.d\.ts$/.test(e.name) ? [p] : [];
  });
}
function mod(base) {
  for (const c of [`${base}.ts`, `${base}.tsx`, base, resolve(base, "index.ts"), resolve(base, "index.tsx")])
    if (existsSync(c) && statSync(c).isFile()) return c;
  return null;
}
function deps(f) {
  const s = readFileSync(f, "utf8");
  const specs = new Set([
    ...[...s.matchAll(/import\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...s.matchAll(/(?:import|export)\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...s.matchAll(/export\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ]);
  return [...specs]
    .map((sp) =>
      sp.startsWith(".")
        ? mod(resolve(dirname(f), sp))
        : sp.startsWith("@capacitylens/shared/")
          ? mod(resolve(root, "shared/src", sp.slice(21)))
          : sp.startsWith("@/")
            ? mod(resolve(root, "src", sp.slice(2)))
            : null,
    )
    .filter(Boolean);
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

if (cycles.size > 0) process.exitCode = 1;

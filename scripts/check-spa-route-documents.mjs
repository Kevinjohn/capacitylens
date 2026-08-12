import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const routes = [
  "resources",
  "external",
  "disciplines",
  "clients",
  "projects",
  "activities",
  "timeoff",
  "team",
  "settings",
];
const shell = await readFile(resolve("dist/index.html"));

for (const route of routes) {
  const document = await readFile(resolve("dist", route, "index.html"));
  if (!document.equals(shell)) {
    throw new Error(`SPA route document /${route}/index.html differs from dist/index.html.`);
  }
}

console.log(`SPA route documents: ${routes.length} fixed routes verified.`);

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { STATIC_SPA_ROUTES } from "./static-spa-routes.mjs";

const shell = await readFile(resolve("dist/index.html"));

for (const route of STATIC_SPA_ROUTES) {
  const document = await readFile(resolve("dist", route, "index.html"));
  if (!document.equals(shell)) {
    throw new Error(`SPA route document /${route}/index.html differs from dist/index.html.`);
  }
}

console.log(`SPA route documents: ${STATIC_SPA_ROUTES.length} fixed routes verified.`);

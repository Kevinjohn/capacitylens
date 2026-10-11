import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";
import { assertEntryBundleWithinBudget } from "./bundleBudget.mjs";

// Measure only the eagerly loaded entry chunk so the budget detects exceptional imports without penalising lazy routes.
// Inspect new imports before raising a breached ceiling.
const index = await readFile(resolve("dist/index.html"), "utf8");

const moduleEntries = [...index.matchAll(/<script\b([^>]*)>/gi)]
  .map(([, attributes]) =>
    Object.fromEntries(
      [...attributes.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(
        ([, name, doubleQuoted, singleQuoted, unquoted]) => [
          name.toLowerCase(),
          doubleQuoted ?? singleQuoted ?? unquoted,
        ],
      ),
    ),
  )
  .filter((attributes) => attributes.type?.toLowerCase() === "module")
  .map((attributes) => attributes.src)
  .filter((src) => typeof src === "string" && /\.js(?:[?#].*)?$/.test(src));

if (moduleEntries.length !== 1) {
  throw new Error(
    `Bundle budget: expected exactly one JavaScript module entry in dist/index.html, found ${moduleEntries.length}.`,
  );
}
const [entryPath] = moduleEntries;

const file = resolve("dist", entryPath.replace(/^\//, ""));
const raw = (await stat(file)).size;
const gzip = gzipSync(await readFile(file)).byteLength;
console.log(`Bundle budget: ${entryPath} — ${raw} bytes raw, ${gzip} bytes gzip.`);

assertEntryBundleWithinBudget(raw, gzip);

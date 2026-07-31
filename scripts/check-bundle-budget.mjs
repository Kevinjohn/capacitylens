import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";

// Rebased after identity-scoped account-command recovery; retain about 0.2% raw headroom while the
// compressed ceiling remains unchanged.
const RAW_LIMIT = 532_000;
const GZIP_LIMIT = 165_000;
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

if (raw > RAW_LIMIT || gzip > GZIP_LIMIT) {
  throw new Error(
    `Bundle budget exceeded (limits: ${RAW_LIMIT} raw / ${GZIP_LIMIT} gzip; actual: ${raw} raw / ${gzip} gzip).`,
  );
}

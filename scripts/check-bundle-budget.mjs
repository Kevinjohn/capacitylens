import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { resolve } from "node:path";

// This is a BLOWUP DETECTOR, not a creep ratchet. It exists to catch the single careless commit —
// a barrel import that pulls all of an icon set instead of five glyphs, a date library that doesn't
// tree-shake — which adds hundreds of KB while looking innocent in review. It is NOT here to police
// a few KB per feature.
//
// Earlier limits sat ~0.2% above the measured size, which meant essentially every feature tripped
// them and cost a rebase commit arguing over a few hundred bytes. That is toll booth, not guard.
//
// So the ceiling is deliberately far above anything a real feature reaches. CapacityLens is a
// desktop B2B app whose entry bundle is ~165 KB gzip; comparable SaaS commonly ships 1–3 MB, so 1 MB
// gzip is a generous ceiling that still catches a genuine mistake immediately. The raw limit is that
// figure at the bundle's own measured compression ratio (~3.2:1), so the two stay proportionate.
//
// Only the ENTRY chunk is measured — lazily-loaded routes cost nothing until visited. The actual
// sizes are logged on every build below, so real drift stays visible without failing anyone's build.
// If these ever trip, do not reflexively raise them: look at what was just imported.
const RAW_LIMIT = 3_200_000;
const GZIP_LIMIT = 1_000_000;
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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const assetsDir = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const manifestPath = fileURLToPath(new URL("../dist/offline-shell.json", import.meta.url));

if (!existsSync(manifestPath)) {
  throw new Error("Offline shell manifest is missing; run the production build first.");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!Array.isArray(manifest) || !manifest.every((path) => typeof path === "string" && path.startsWith("/"))) {
  throw new Error("Offline shell manifest must be an array of root-relative asset paths.");
}

const listed = new Set(manifest);
const emittedAssets = readdirSync(assetsDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => {
    const parent = relative(assetsDir, entry.parentPath).split(sep).join("/");
    return `/assets/${parent ? `${parent}/` : ""}${entry.name}`;
  });

const missing = emittedAssets.filter((path) => !listed.has(path));
const unavailable = manifest.filter((path) => !existsSync(`${dist}${path.slice(1)}`));
if (missing.length > 0 || unavailable.length > 0) {
  throw new Error(
    `Offline shell manifest is incomplete. Missing entries: ${missing.join(", ") || "none"}. Unavailable entries: ${unavailable.join(", ") || "none"}.`,
  );
}

console.log(`Offline shell manifest: ${manifest.length} assets verified.`);

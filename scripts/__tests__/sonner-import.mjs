import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Each format runs in a fresh process so module caches cannot hide import-time style injection.
const frontendRequire = createRequire(new URL("../../apps/frontend/package.json", import.meta.url));
const sonnerEntryPath = frontendRequire.resolve("sonner");
const sonnerEntry = pathToFileURL(sonnerEntryPath);
const sonnerManifest = JSON.parse(readFileSync(new URL("../package.json", sonnerEntry), "utf8"));
const sonnerImportEntry = new URL(sonnerManifest.exports["."].import.default, new URL("../", sonnerEntry));
const document = new JSDOM("<!doctype html>").window.document;
globalThis.document = document;
if (process.argv[2] === "require") frontendRequire(sonnerEntryPath);
else await import(sonnerImportEntry);
if (document.querySelectorAll("style").length !== 0) {
  throw new Error("Sonner injected a style element forbidden by the production CSP");
}

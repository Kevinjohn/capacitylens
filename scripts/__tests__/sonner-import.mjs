import { JSDOM } from "jsdom";
import { createRequire } from "node:module";

// Each format runs in a fresh process so module caches cannot hide import-time style injection.
const require = createRequire(import.meta.url);
const document = new JSDOM("<!doctype html>").window.document;
globalThis.document = document;
if (process.argv[2] === "require") require("sonner");
else await import("sonner");
if (document.querySelectorAll("style").length !== 0) {
  throw new Error("Sonner injected a style element forbidden by the production CSP");
}

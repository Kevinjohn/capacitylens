// Turn the VitePress build in docs/ (built from the docs-src/ sources) into
// standalone pages that open straight from disk (file://), with no web server
// and no JavaScript.
//
// VitePress server-renders every page's full content into its HTML, so the
// only things standing between the build and a double-clickable site are:
//   1. absolute URLs rooted at the deploy base (/capacitylens/...), which the
//      browser resolves against the filesystem root under file://
//   2. the hydration scripts, which need a server (and re-add search, the
//      mobile menu and other chrome the static pages do without)
// This script rewrites every absolute URL to a page-relative one, strips the
// scripts and the chrome that only works with them, and deletes the now-unused
// JS bundles. The same output still works when served over HTTP (GitHub
// Pages), because relative links resolve the same way there.
//
// Run via `pnpm run docs:build`, which chains it after `vitepress build`.

import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "/capacitylens/";
const siteDir = join(dirname(fileURLToPath(import.meta.url)), "..", "docs");

if (!existsSync(join(siteDir, "index.html"))) {
  console.error(`docs-standalone: no build found at ${siteDir} — run \`vitepress build docs-src\` first.`);
  process.exit(1);
}

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const files = walk(siteDir);

// Chrome that only functions with the client-side app running. Hiding it with
// CSS (rather than surgically deleting nested markup) keeps this script free
// of any HTML parsing.
const DEAD_CHROME_CSS =
  "<style>.VPNavBarSearch,.VPNavBarHamburger,.VPLocalNav,.VPBackdrop,.vp-doc [class*='language-'] button.copy{display:none !important}</style>";

// Map an absolute base-rooted URL to one relative to the page's directory.
// A trailing slash means the directory's index page.
const toRelative = (pageDir, absolutePath) => {
  let target = absolutePath.slice(BASE.length);
  if (target === "" || target.endsWith("/")) target += "index.html";
  const rel = relative(pageDir, join(siteDir, target)).split(sep).join("/");
  return rel === "" ? "index.html" : rel;
};

let pages = 0;
for (const file of files.filter((f) => f.endsWith(".html"))) {
  const pageDir = dirname(file);
  let html = readFileSync(file, "utf8");

  html = html
    // All scripts go: the module entry point, inline helpers, everything.
    .replace(/<script\b[\s\S]*?<\/script>/g, "")
    // Preloads for assets the scripts would have used.
    .replace(/<link rel="modulepreload"[^>]*>/g, "")
    .replace(/<link rel="preload"[^>]*>/g, "")
    // The stylesheet preload combo needs the plain form once scripts are gone.
    .replace(/rel="preload stylesheet"/g, 'rel="stylesheet"')
    // Absolute URLs → page-relative ones.
    .replace(/(href|src)="(\/capacitylens\/[^"]*|\/capacitylens)"/g, (_, attr, url) => {
      const [path, hash] = (url.endsWith("/capacitylens") ? url + "/" : url).split("#");
      return `${attr}="${toRelative(pageDir, path)}${hash ? "#" + hash : ""}"`;
    })
    .replace("</head>", `${DEAD_CHROME_CSS}</head>`);

  writeFileSync(file, html);
  pages++;
}

for (const file of files.filter((f) => f.endsWith(".css"))) {
  const css = readFileSync(file, "utf8");
  // Fonts sit in the same directory as the stylesheet that references them.
  writeFileSync(file, css.replaceAll(`url(${BASE}assets/`, "url("));
}

// The client-side app and its data are no longer referenced by anything.
rmSync(join(siteDir, "hashmap.json"), { force: true });
for (const file of files.filter((f) => f.endsWith(".js"))) rmSync(file);
rmSync(join(siteDir, "assets", "chunks"), { recursive: true, force: true });

// Nothing should still point at the deploy base; a leftover means a URL shape
// this script does not know about, which would 404 under file://. Match only
// attribute values and CSS url() — code blocks legitimately mention paths and
// external URLs that contain the word.
const leftoverPattern = new RegExp(`(href|src)="${BASE}|url\\(${BASE.replaceAll("/", "\\/")}`);
const leftovers = walk(siteDir)
  .filter((f) => f.endsWith(".html") || f.endsWith(".css"))
  .filter((f) => leftoverPattern.test(readFileSync(f, "utf8")))
  .map((f) => relative(siteDir, f));
if (leftovers.length > 0) {
  console.error(`docs-standalone: absolute ${BASE} URLs remain in: ${leftovers.join(", ")}`);
  process.exit(1);
}

console.log(`docs-standalone: rewrote ${pages} pages for file:// and relative serving.`);

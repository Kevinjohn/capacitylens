// Turn the VitePress build in docs/ (built from the docs-src/ sources) into
// standalone pages that open straight from disk (file://), with no web server
// and no JavaScript apart from small inline enhancements tagged with
// data-cl-keep.
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

import { readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE } from "../docs-src/.vitepress/base.mjs";

const repoDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const siteDir = join(repoDir, "docs");

// Files a page links to that VitePress does not treat as a page asset, so the
// build leaves them behind. Source path → path in the built site.
const EXTRA_ASSETS = [["docs-src/security/crypto-inventory.json", "security/crypto-inventory.json"]];

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
// The flyout is the nav bar's overflow menu, which opens on hover/focus handled
// in script; the sidebar caret toggles a group open, which nothing can do here.
// (Groups themselves are configured expanded — see config.mts — so hiding the
// caret hides a control, not any links.)
const DEAD_CHROME_CSS =
  "<style>.VPNavBarSearch,.VPNavBarHamburger,.VPLocalNav,.VPBackdrop,.VPFlyout," +
  ".VPSidebarItem .caret,.vp-doc [class*='language-'] button.copy{display:none !important}</style>";

// Hosted fallbacks use an absolute base-rooted link. The retained file:// script
// changes it to a relative link when the artifact is opened from disk.
const STANDALONE_NOT_FOUND = (hostedHomeHref) =>
  `<main class="cl-standalone-not-found"><h1>Page not found</h1>` +
  `<p>The page you’re looking for doesn’t exist or may have moved.</p>` +
  `<a href="${hostedHomeHref}">Go to the documentation home</a></main>`;

const STANDALONE_NOT_FOUND_CSS =
  "<style>body{margin:0;background:#fff;color:#2c3e50;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}" +
  ".cl-standalone-not-found{box-sizing:border-box;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center}" +
  ".cl-standalone-not-found h1{margin:0;font-size:2rem;line-height:1.25}" +
  ".cl-standalone-not-found p{margin:1rem 0;color:#5b6472}" +
  ".cl-standalone-not-found a{color:#3451b2;font-weight:600}</style>";

// Map an absolute base-rooted URL to one relative to the page's directory.
// A trailing slash means the directory's index page.
const toRelative = (pageDir, absolutePath) => {
  let target = absolutePath.slice(BASE.length);
  if (target === "" || target.endsWith("/")) target += "index.html";
  const rel = relative(pageDir, join(siteDir, target)).split(sep).join("/");
  return rel === "" ? "index.html" : rel;
};

// VitePress adds the sidebar's current-page class and aria-current attribute in
// its client-side navigation. The standalone build removes that client code, so
// mark the matching server-rendered link while the page file and its relative
// sidebar href are both available. This keeps the same semantic state in the
// static pages, including links nested below a sidebar group.
const markSidebarCurrent = (html, file) => {
  const sidebar = html.match(/<aside class="VPSidebar"[\s\S]*?<\/aside>/)?.[0];
  if (!sidebar) return html;

  const currentFile = resolve(file);
  const marked = sidebar.replace(/<a class="VPLink link link" href="([^"]+)"([^>]*)>/g, (tag, href, attributes) => {
    const target = href.split("#", 1)[0];
    if (!target || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return tag;
    if (resolve(dirname(file), target) !== currentFile) return tag;
    if (/\baria-current=/.test(attributes)) return tag;
    return `<a class="VPLink link link" href="${href}" aria-current="page"${attributes}>`;
  });

  return html.replace(sidebar, marked);
};

let pages = 0;
for (const file of files.filter((f) => f.endsWith(".html"))) {
  const pageDir = dirname(file);
  let html = readFileSync(file, "utf8");

  html = html
    // VitePress scripts go except for small inline enhancements tagged with
    // data-cl-keep. They need no bundle or network request under file://, and
    // one rewrites the hosted 404 home link for file:// access.
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/g, (tag, attrs) => (attrs.includes("data-cl-keep") ? tag : ""))
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
    .replace("</head>", `${DEAD_CHROME_CSS}</head>`)
    // Removing VitePress scripts can leave indentation on otherwise empty lines.
    // Normalise it here so a rebuild is both Prettier-clean and byte-for-byte stable.
    .replace(/[^\S\r\n]+$/gm, "");

  if (relative(siteDir, file) === "404.html") {
    const hostedHomeHref = `${BASE}index.html`;
    const notFoundContent = STANDALONE_NOT_FOUND(hostedHomeHref);
    html = html
      .replace(/<link rel="stylesheet"[^>]*>\s*/g, "")
      .replace("</head>", `${STANDALONE_NOT_FOUND_CSS}</head>`)
      .replace('<div id="app"></div>', `<div id="app">${notFoundContent}</div>`);
    if (!html.includes(notFoundContent)) {
      throw new Error("docs-standalone: 404 page is missing its visible message or hosted home link.");
    }
  }

  html = markSidebarCurrent(html, file);

  writeFileSync(file, html);
  pages++;
}

for (const file of files.filter((f) => f.endsWith(".css"))) {
  const css = readFileSync(file, "utf8");
  // Fonts sit in the same directory as the stylesheet that references them.
  writeFileSync(file, css.replaceAll(`url(${BASE}assets/`, "url("));
}

for (const [source, target] of EXTRA_ASSETS) {
  copyFileSync(join(repoDir, source), join(siteDir, target));
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
const hosted404HomeHref = `${BASE}index.html`;
const leftovers = walk(siteDir)
  .filter((f) => f.endsWith(".html") || f.endsWith(".css"))
  .filter((f) => {
    const html = readFileSync(f, "utf8");
    // The generated 404 keeps this one base-rooted link for nested hosted routes.
    const checked = relative(siteDir, f) === "404.html" ? html.replace(`href="${hosted404HomeHref}"`, "") : html;
    return leftoverPattern.test(checked);
  })
  .map((f) => relative(siteDir, f));
if (leftovers.length > 0) {
  console.error(`docs-standalone: absolute ${BASE} URLs remain in: ${leftovers.join(", ")}`);
  process.exit(1);
}

// Every local link and asset reference must resolve to a file that exists, the
// way a browser opening the page from disk would resolve it. The absolute-URL
// check above only catches URLs still carrying the deploy base; this catches the
// other ways a shipped page can point at nothing — an extensionless href that
// needs a server to rewrite it, or a file the build never copied.
const localTargets = (html) => {
  const found = [];
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]*)"/g)) found.push(url);
  for (const [, url] of html.matchAll(/url\(["']?([^"')]+)["']?\)/g)) found.push(url);
  return found
    .map((url) => url.split("#")[0].split("?")[0])
    .filter((url) => url && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url))
    .map((url) => decodeURIComponent(url));
};

const broken = [];
for (const file of walk(siteDir).filter((f) => f.endsWith(".html") || f.endsWith(".css"))) {
  for (const target of localTargets(readFileSync(file, "utf8"))) {
    // A root-relative URL has no meaning under file:// — it points at the
    // filesystem root — except the 404 home link, which its file script rewrites.
    const hosted404Home = relative(siteDir, file) === "404.html" && target === hosted404HomeHref;
    const resolved = target.startsWith("/") ? null : resolve(dirname(file), target);
    if (!hosted404Home && (!resolved || !existsSync(resolved))) {
      broken.push(`${relative(siteDir, file)} → ${target}`);
    }
  }
}
if (broken.length > 0) {
  console.error(`docs-standalone: links with no file at the other end:\n  ${broken.join("\n  ")}`);
  process.exit(1);
}

console.log(`docs-standalone: rewrote ${pages} pages for file:// and relative serving.`);

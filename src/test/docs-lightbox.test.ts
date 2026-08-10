import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// This test reads the built site off disk, so it is type-checked under
// tsconfig.node.json (which carries the node types) and excluded from the
// browser-only tsconfig.app.json — it is listed in both, like its siblings.
import { cwd } from "node:process";

// Docs screenshots open full size in a CSS-only lightbox (docs-src/.vitepress/lightbox.mts
// emits the markup, theme/custom.css drives it with a checkbox toggle).
//
// The mechanism is fragile in one way that is invisible on inspection:
// scripts/docs-standalone.mjs strips every <script> and .js file out of the shipped
// docs/, so anything JavaScript-driven silently stops working in the artifact people
// actually read. These assertions run against the committed build and fail if someone
// swaps in a JS lightbox library, or if the plugin stops wrapping some images.
//
// What this does NOT check: that docs/ is up to date with docs-src/. Rebuilding and
// diffing here would be far too slow for a unit test; AGENTS.md requires
// `pnpm run docs:build` after any docs change, and .github/workflows/docs.yml
// re-runs the build so a source change that cannot build fails CI.

const ROOT = join(cwd());
const SITE = join(ROOT, "docs");

const htmlPages = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return htmlPages(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });

const countOf = (haystack: string, needle: string) => haystack.split(needle).length - 1;

// The prose body only. VitePress renders navigation chrome around it that has no
// screenshots in it, and counting images there would make the coverage check noise.
const articleOf = (html: string) => {
  const start = html.indexOf("<main");
  const end = html.indexOf("</main>");
  return start === -1 || end === -1 ? "" : html.slice(start, end);
};

describe("docs image lightbox", () => {
  const pages = htmlPages(SITE).map((path) => {
    const html = readFileSync(path, "utf8");
    return { name: path.slice(SITE.length + 1), html, article: articleOf(html) };
  });

  const withScreenshots = pages.filter((page) => page.article.includes("<img"));

  it("has a built site with screenshots to check", () => {
    expect(pages.length).toBeGreaterThan(0);
    // The walkthrough pages carry the screenshots; if this collapses, the checks
    // below would all pass vacuously.
    expect(withScreenshots.length).toBeGreaterThan(5);
  });

  it("makes every content screenshot click-to-enlarge", () => {
    // Each wrapped screenshot is emitted twice (inline + overlay copy), so a page
    // with N images must have N/2 toggles. An image that lost its wrapper — or a
    // deliberately linked image, which the plugin skips — shows up here as a
    // mismatch and needs this expectation revisited rather than silently shipping
    // an inert screenshot.
    const uncovered = withScreenshots
      .map((page) => ({
        name: page.name,
        images: countOf(page.article, "<img"),
        toggles: countOf(page.article, 'class="cl-toggle"'),
      }))
      .filter((page) => page.images !== page.toggles * 2);

    expect(uncovered).toEqual([]);
  });

  it("pairs every toggle with the label that opens it and the overlay it opens", () => {
    const mismatched = pages
      .map((page) => ({
        name: page.name,
        toggles: countOf(page.article, 'class="cl-toggle"'),
        openers: countOf(page.article, 'class="cl-zoom"'),
        overlays: countOf(page.article, 'class="cl-lightbox"'),
      }))
      .filter((page) => page.toggles !== page.openers || page.toggles !== page.overlays);

    expect(mismatched).toEqual([]);
  });

  it("wires each label to a checkbox id that exists exactly once on the page", () => {
    // A duplicated id makes `for=` resolve to the first match, which would open a
    // different screenshot than the one clicked.
    const broken = withScreenshots.flatMap((page) => {
      const ids = [...page.article.matchAll(/class="cl-toggle" id="([^"]+)"/g)].map((m) => m[1]);
      const labelled = [...page.article.matchAll(/class="cl-(?:zoom|lightbox)" for="([^"]+)"/g)].map((m) => m[1]);
      const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
      const dangling = labelled.filter((target) => !ids.includes(target));
      return duplicated.length > 0 || dangling.length > 0 ? [{ name: page.name, duplicated, dangling }] : [];
    });

    expect(broken).toEqual([]);
  });

  it("ships no JavaScript that a lightbox could have depended on", () => {
    // docs-standalone.mjs strips these; if any come back, a script-based lightbox
    // could look like it works locally while being deleted from the real artifact.
    const withScript = pages.filter((page) => page.html.includes("<script"));
    expect(withScript.map((page) => page.name)).toEqual([]);
  });
});

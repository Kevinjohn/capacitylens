import { describe, it, expect, vi } from "vitest";
import { runInNewContext } from "node:vm";
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
// docs/ bar one allowlisted inline handler, so anything else JavaScript-driven silently
// stops working in the artifact people actually read. These assertions run against the
// committed build and fail if someone swaps in a JS lightbox library, if the allowlist
// grows, or if the plugin stops wrapping some images.
//
// What this does NOT check: that docs/ is up to date with docs-src/. Rebuilding and
// diffing here would be far too slow for a unit test — that is why
// .github/workflows/docs.yml rebuilds the site and fails on any diff against the
// committed docs/. Without that step these assertions could pass against stale HTML
// while the published pages shipped without the fix.

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

// The plugin deliberately leaves an image alone when it is already inside a
// link, because a <label> nested in an <a> is invalid. Dropping anchors before
// counting keeps that supported authoring pattern from reading as a regression
// — otherwise the coverage check below fails on a page that is entirely correct
// and the only way to get green is to weaken the check.
const withoutLinks = (html: string) => html.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, "");

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

  it("makes every unlinked content screenshot click-to-enlarge", () => {
    // Each wrapped screenshot is emitted twice (inline + overlay copy), so once
    // the images the plugin is meant to skip are removed, a page with N images
    // must have N/2 toggles. An image that lost its wrapper shows up here as a
    // surplus rather than silently shipping as an inert screenshot.
    const uncovered = withScreenshots
      .map((page) => {
        const unlinked = withoutLinks(page.article);
        return {
          name: page.name,
          images: countOf(unlinked, "<img"),
          toggles: countOf(unlinked, 'class="cl-toggle"'),
        };
      })
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

  it("ships no JavaScript beyond the one inline Escape handler", () => {
    // docs-standalone.mjs strips every script except the data-cl-keep one; if others
    // come back, a script-based lightbox could look like it works locally while being
    // deleted from the real artifact. The allowlist is checked strictly — an external
    // src would be a request the file:// build cannot make, and a second inline script
    // means the exception has quietly become a general-purpose escape hatch.
    const offenders = pages.flatMap((page) => {
      const scripts = [...page.html.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
      const unexpected = scripts.filter((attrs) => !attrs.includes("data-cl-keep") || attrs.includes("src="));
      return scripts.length > 1 || unexpected.length > 0 ? [{ name: page.name, scripts }] : [];
    });

    expect(offenders).toEqual([]);
  });

  it("embeds the same Escape handler on every page", () => {
    const mismatched = pages.filter((page) => {
      const script = page.html.match(/<script\b[^>]*data-cl-keep[^>]*>([\s\S]*?)<\/script>/)?.[1];
      return script !== publishedRuntime;
    });
    expect(mismatched.map((page) => page.name)).toEqual([]);
  });

  it("keeps generated HTML free of trailing whitespace", () => {
    const offenders = pages.filter((page) => /[^\S\r\n]+$/m.test(page.html));
    expect(offenders.map((page) => page.name)).toEqual([]);
  });
});

// Characterize the retained script independently of the build-time markup plugin.
const runtime = readFileSync(join(ROOT, "scripts/docs-lightbox.js"), "utf8");
const publishedRuntime = readFileSync(join(SITE, "index.html"), "utf8").match(
  /<script\b[^>]*data-cl-keep[^>]*>([\s\S]*?)<\/script>/,
)![1];

function keyboardFixture(source: string, open: boolean[]) {
  const toggles = open.map((checked) => ({ checked }));
  let keydown: ((event: { key: string }) => void) | undefined;
  const querySelectorAll = vi.fn((selector: string) => {
    expect(selector).toBe(".cl-toggle:checked");
    return toggles.filter((toggle) => toggle.checked);
  });
  runInNewContext(source, {
    document: {
      addEventListener(type: string, listener: typeof keydown) {
        expect(type).toBe("keydown");
        expect(keydown).toBeUndefined();
        keydown = listener;
      },
      querySelectorAll,
    },
  });
  expect(keydown).toBeTypeOf("function");
  return { toggles, querySelectorAll, press: (key: string) => keydown!({ key }) };
}

describe.each([
  { name: "authored", source: runtime },
  { name: "published", source: publishedRuntime },
])("$name docs lightbox keyboard behavior", ({ source }) => {
  it("Escape closes every open lightbox and can be used again after reopening", () => {
    const fixture = keyboardFixture(source, [true, false, true]);
    fixture.press("Escape");
    expect(fixture.toggles.map(({ checked }) => checked)).toEqual([false, false, false]);
    fixture.toggles[1].checked = true;
    fixture.press("Escape");
    expect(fixture.toggles.map(({ checked }) => checked)).toEqual([false, false, false]);
    expect(fixture.querySelectorAll).toHaveBeenCalledTimes(2);
  });

  it.each(["Enter", " ", "Tab", "Esc", "escape"])("leaves open lightboxes alone for %j", (key) => {
    const fixture = keyboardFixture(source, [true, false]);
    fixture.press(key);
    expect(fixture.toggles.map(({ checked }) => checked)).toEqual([true, false]);
    expect(fixture.querySelectorAll).not.toHaveBeenCalled();
  });

  it.each([
    { name: "no toggles", open: [] },
    { name: "only closed toggles", open: [false, false] },
  ])("Escape is safe with $name", ({ open }) => {
    const fixture = keyboardFixture(source, open);
    expect(() => fixture.press("Escape")).not.toThrow();
    expect(fixture.toggles.some(({ checked }) => checked)).toBe(false);
  });
});

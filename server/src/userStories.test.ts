import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
// jsdom 29 ships its runtime API without TypeScript declarations.
// @ts-expect-error The module is narrowed to the fragment surface below.
import * as jsdom from "jsdom";
import { createMarkdownRenderer } from "vitepress";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd(), "..");
const STORIES = resolve(ROOT, "user-stories");
const STORY_FILE = /^US-[A-Z]+-\d+.*\.md$/;
const SOURCE_PATH = /`((?:e2e|server|shared|src)\/[^`]+\.[cm]?[jt]sx?)`/g;
const DOCUMENTATION_TARGET = /^\*\*Documentation:\*\*\s+\[[^\]]+\]\(([^)]+)\)/gm;
type MarkdownRenderer = Awaited<ReturnType<typeof createMarkdownRenderer>>;
type MarkdownToken = {
  type: string;
  content: string;
  attrs?: [string, string][] | null;
  children?: MarkdownToken[] | null;
};
type HtmlElement = { getAttribute(name: string): string | null; localName: string };
type HtmlFragment = { querySelectorAll(selector: string): Iterable<HtmlElement> };
const JSDOM = (jsdom as unknown as { JSDOM: { fragment(content: string): HtmlFragment } }).JSDOM;

let markdownRenderer: MarkdownRenderer;

beforeAll(async () => {
  markdownRenderer = await createMarkdownRenderer(ROOT, { headers: true, highlight: () => "" });
});

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function rawIdsFromHtmlToken(content: string): string[] {
  const fragment = JSDOM.fragment(content);
  const ids: string[] = [];
  for (const element of fragment.querySelectorAll("*")) {
    const id = element.getAttribute("id");
    if (id) ids.push(id);
    if (element.localName === "a") {
      const name = element.getAttribute("name");
      if (name) ids.push(name);
    }
  }
  return ids;
}

function documentationFragmentIds(source: string): string[] {
  const ids = new Set<string>();
  const visit = (token: MarkdownToken): void => {
    if (token.type === "heading_open") {
      const id = token.attrs?.find(([name]) => name === "id")?.[1];
      if (id) ids.add(id);
    }
    if (token.type === "html_inline" || token.type === "html_block") {
      for (const id of rawIdsFromHtmlToken(token.content)) ids.add(id);
    }
    for (const child of token.children ?? []) visit(child);
  };
  for (const token of markdownRenderer.parse(source, {})) visit(token as MarkdownToken);
  return [...ids];
}

function documentationTargetIssues(storyFile: string, target: string): string[] {
  const separator = target.indexOf("#");
  const pageTarget = separator === -1 ? target : target.slice(0, separator);
  const fragmentTarget = separator === -1 ? undefined : decodeFragment(target.slice(separator + 1));
  const page = resolve(dirname(storyFile), pageTarget);
  const issues: string[] = [];

  if (!pageTarget || !existsSync(page)) {
    issues.push(`missing documentation page ${pageTarget || "<empty>"}`);
    return issues;
  }
  if (fragmentTarget && !documentationFragmentIds(readFileSync(page, "utf8")).includes(fragmentTarget)) {
    issues.push(`missing documentation fragment #${fragmentTarget} in ${pageTarget}`);
  }
  return issues;
}

function storyFiles(directory = STORIES): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return storyFiles(path);
    return STORY_FILE.test(entry.name) ? [path] : [];
  });
}

describe("user-story catalogue", () => {
  it("keeps the index total, links, and files in lock-step", () => {
    const readme = readFileSync(resolve(STORIES, "README.md"), "utf8");
    const declared = Number(readme.match(/\n(\d+) stories across/)?.[1]);
    const indexed = [...readme.matchAll(/\]\(([^)]+\/US-[^)]+\.md)\)/g)].map((match) => match[1]);
    const files = storyFiles();
    const indexedFiles = indexed.map((relative) => {
      if (!relative) throw new Error("Expected an indexed story path.");
      return resolve(STORIES, relative);
    });

    expect(declared).toBe(files.length);
    expect(indexed).toHaveLength(files.length);
    expect(new Set(indexed).size).toBe(files.length);
    expect(indexedFiles.sort()).toEqual(files.sort());
  });

  it.each(storyFiles())("keeps %s runnable and acceptance-led", (file) => {
    const story = readFileSync(file, "utf8");
    expect(story).toMatch(/^## Goal$/m);
    expect(story).toMatch(/^## Why$/m);
    expect(story).toMatch(/^## How(?: \([^\n]+\))?$/m);
    expect(story).toMatch(/^1\. /m);
    expect(story).toMatch(/^## Acceptance criteria$/m);
    expect(story).toMatch(/^- (?:✅ )?\S/m);
  });

  it.each(storyFiles())("keeps source references in %s resolvable", (file) => {
    const story = readFileSync(file, "utf8");
    const metadata = story.split(/^## Goal$/m, 1)[0] ?? "";
    const references = [...metadata.matchAll(SOURCE_PATH)].map((match) => match[1]);

    for (const reference of references) {
      if (!reference) throw new Error("Expected a source path from story metadata.");
      expect(existsSync(resolve(ROOT, reference)), `Missing story source reference: ${reference}`).toBe(true);
    }
  });

  it.each(storyFiles())("keeps documentation references in %s resolvable", (file) => {
    const story = readFileSync(file, "utf8");
    const targets = [...story.matchAll(DOCUMENTATION_TARGET)].map((match) => match[1]);

    for (const target of targets) {
      const issues = documentationTargetIssues(file, target ?? "");
      expect(issues, `${file}: documentation target ${JSON.stringify(target)} is invalid`).toEqual([]);
    }
  });
});

describe("documentation fragment validation", () => {
  it("rejects the original #1060 numbered-list target shape", () => {
    const source = "## Steps\n\n3. **Understand what CapacityLens plans.** Read the guide.\n";

    expect(documentationFragmentIds(source)).not.toContain("understand-what-capacitylens-plans");
  });

  it.each([
    ["Café", "cafe"],
    ["A & B", "a-b"],
    ["123 things", "_123-things"],
  ])("matches VitePress heading slugging for %s", (heading, expectedId) => {
    expect(documentationFragmentIds(`# ${heading}`)).toContain(expectedId);
  });

  it("adds numeric suffixes to duplicate heading slugs", () => {
    expect(documentationFragmentIds("# Repeat\n## Repeat\n### Repeat")).toEqual(["repeat", "repeat-1", "repeat-2"]);
  });

  it("keeps explicit heading IDs and raw HTML anchors", () => {
    const ids = documentationFragmentIds(
      '## Company details {#calendar}\n<span id="raw-anchor"></span>\n<span id=unquoted-anchor></span>',
    );

    expect(ids).toContain("calendar");
    expect(ids).not.toContain("company-details");
    expect(ids).toContain("raw-anchor");
    expect(ids).toContain("unquoted-anchor");
  });

  it("only accepts explicit IDs as trailing heading attributes", () => {
    const ids = documentationFragmentIds("Paragraph {#ghost}\n## Discuss {#ghost} syntax");

    expect(ids).not.toContain("ghost");
    expect(ids).toContain("discuss-ghost-syntax");
  });
});

describe("HTML fragment parity", () => {
  it("leaves an incomplete HTML-like tag for automatic slugging", () => {
    expect(documentationFragmentIds("## Safe <script")).toContain("safe-script");
  });

  it("removes complete tags while respecting quoted greater-than signs", () => {
    expect(documentationFragmentIds('## A <x title=">hello"> B')).toContain("a-b");
  });

  it("removes valid HTML constructs with greater-than signs in their content", () => {
    expect(documentationFragmentIds("## A <!-- > --> B")).toContain("a-b");
    expect(documentationFragmentIds("## A <? > ?> B")).toContain("a-b");
    expect(documentationFragmentIds("## A <![CDATA[ > ]]> B")).toContain("a-b");
  });

  it("does not treat anchors inside non-rendered HTML constructs as live", () => {
    const ids = documentationFragmentIds(
      [
        '<!-- <span id="comment-anchor"></span> -->',
        '<?xml <span id="processing-anchor"></span> ?>',
        '<![CDATA[ <span id="cdata-anchor"></span> ]]>',
        '<span id="live-anchor"></span>',
      ].join("\n"),
    );

    expect(ids).not.toContain("comment-anchor");
    expect(ids).not.toContain("processing-anchor");
    expect(ids).not.toContain("cdata-anchor");
    expect(ids).toContain("live-anchor");
  });

  it("ends declarations at the first greater-than sign", () => {
    expect(documentationFragmentIds('## A <!DOCTYPE ">"> B')).toContain("a-b");
  });

  it.each([
    ["Safe <not a tag?> End", "safe-not-a-tag-end"],
    ["Safe <foo =bad> End", "safe-foo-bad-end"],
    ["Safe <!broken> End", "safe-broken-end"],
    ["Safe <?broken> End", "safe-broken-end"],
    ["Safe </ broken> End", "safe-broken-end"],
  ])("keeps malformed HTML-like syntax in the slug: %s", (heading, expectedId) => {
    expect(documentationFragmentIds(`## ${heading}`)).toContain(expectedId);
  });
});

describe("Markdown token fragment parity", () => {
  it("uses code-span text for heading slugs without treating markup as HTML", () => {
    const ids = documentationFragmentIds("## `reconciliation_required`\n## `<span>` element");

    expect(ids).toContain("reconciliation-required");
    expect(ids).toContain("span-element");
    expect(ids).not.toContain("span");
  });

  it("ignores multiline comments, malformed inline HTML, and indented headings", () => {
    const ids = documentationFragmentIds(
      [
        "<!--",
        "## Ghost heading",
        '<span id="ghost-comment"></span>',
        "-->",
        "## Malformed <span id=ghost-inline",
        "    ## Indented code",
      ].join("\n"),
    );

    expect(ids).not.toContain("ghost-heading");
    expect(ids).not.toContain("ghost-comment");
    expect(ids).not.toContain("ghost-inline");
    expect(ids).not.toContain("indented-code");
  });

  it("extracts only actual raw id/name attributes, including multiline tags", () => {
    const ids = documentationFragmentIds(
      [
        '<span data-id="wrong" title="id=wrong" id="right"></span>',
        '<span title=">hello" id="quoted-anchor"></span>',
        '<span\n id=multiline-anchor\n title="hello">\n</span>',
        '<a id="modern" name="legacy"></a>',
        '<span name="ghost-name"></span>',
        '<a id="" id="later" name=""></a>',
        '<span id="a&amp;b"></span>',
        '<span id="caf&eacute;"></span>',
        '<span id="null&#0;"></span>',
        '<span id="malformed&#12abc;"></span>',
      ].join("\n"),
    );

    expect(ids).toContain("right");
    expect(ids).toContain("quoted-anchor");
    expect(ids).toContain("multiline-anchor");
    expect(ids).toContain("modern");
    expect(ids).toContain("legacy");
    expect(ids).not.toContain("later");
    expect(ids).toContain("a&b");
    expect(ids).toContain("café");
    expect(ids).toContain("null\uFFFD");
    expect(ids).toContain("malformed\fabc;");
    expect(ids).not.toContain("wrong");
    expect(ids).not.toContain("ghost-name");
  });
});

describe("Markdown fence filtering", () => {
  it("ignores raw anchors inside fences and resumes after a legitimate close", () => {
    const ids = documentationFragmentIds(
      [
        "```html",
        "## Inside heading",
        '<span id="inside-fence"></span>',
        "```",
        "## Outside heading",
        '<span id="outside-fence"></span>',
      ].join("\n"),
    );

    expect(ids).not.toContain("inside-fence");
    expect(ids).not.toContain("inside-heading");
    expect(ids).toContain("outside-fence");
    expect(ids).toContain("outside-heading");
  });

  it("does not let a mismatched tilde sequence close a backtick fence", () => {
    const ids = documentationFragmentIds(
      ["```md", "~~~", '<span id="still-inside"></span>', "```", '<span id="outside-fence"></span>'].join("\n"),
    );

    expect(ids).not.toContain("still-inside");
    expect(ids).toContain("outside-fence");
  });

  it("does not let a shorter backtick sequence close a longer fence", () => {
    const ids = documentationFragmentIds(
      [
        "````md",
        '<span id="still-inside"></span>',
        "```",
        '<span id="also-inside"></span>',
        "````",
        '<span id="outside-fence"></span>',
      ].join("\n"),
    );

    expect(ids).not.toContain("still-inside");
    expect(ids).not.toContain("also-inside");
    expect(ids).toContain("outside-fence");
  });
});

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
// jsdom 29 ships its runtime API without TypeScript declarations.
// @ts-expect-error The module is narrowed to the fragment surface below.
import * as jsdom from "jsdom";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd(), "..");
const STORIES = resolve(ROOT, "user-stories");
const DOCS_SOURCE = resolve(ROOT, "docs-src");
const DOCS = resolve(ROOT, "docs");
const STORY_FILE = /^US-[A-Z]+-\d+.*\.md$/;
const SOURCE_PATH = /`((?:e2e|server|shared|src)\/[^`]+\.[cm]?[jt]sx?)`/g;
const DOCUMENTATION_TARGET = /^\*\*Documentation:\*\*\s+\[[^\]]+\]\(([^)]+)\)/gm;
type HtmlElement = { getAttribute(name: string): string | null };
type HtmlDocument = { querySelectorAll(selector: string): Iterable<HtmlElement> };
type HtmlDom = { window: { document: HtmlDocument } };
const JSDOM = (jsdom as unknown as { JSDOM: new (content: string) => HtmlDom }).JSDOM;

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

const documentationIds = new Map<string, Set<string>>();

function documentationHtmlPage(storyFile: string, pageTarget: string): string | undefined {
  const sourcePage = resolve(dirname(storyFile), pageTarget);
  const relativePage = relative(DOCS_SOURCE, sourcePage);
  if (relativePage.startsWith("..")) return undefined;
  return resolve(DOCS, relativePage.replace(/\.md$/, ".html"));
}

function documentationFragmentIds(htmlPage: string): Set<string> {
  const cached = documentationIds.get(htmlPage);
  if (cached) return cached;

  const document = new JSDOM(readFileSync(htmlPage, "utf8")).window.document;
  const ids = new Set<string>();
  for (const element of document.querySelectorAll("[id]")) {
    const id = element.getAttribute("id");
    if (id) ids.add(id);
  }
  documentationIds.set(htmlPage, ids);
  return ids;
}

function documentationTargetIssues(storyFile: string, target: string): string[] {
  const separator = target.indexOf("#");
  const pageTarget = separator === -1 ? target : target.slice(0, separator);
  const fragmentTarget = separator === -1 ? undefined : decodeFragment(target.slice(separator + 1));
  const sourcePage = resolve(dirname(storyFile), pageTarget);
  const page = documentationHtmlPage(storyFile, pageTarget);
  const issues: string[] = [];

  if (!pageTarget || !existsSync(sourcePage) || !page || !existsSync(page)) {
    issues.push(`missing documentation page ${pageTarget || "<empty>"}`);
    return issues;
  }
  if (fragmentTarget && !documentationFragmentIds(page).has(fragmentTarget)) {
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

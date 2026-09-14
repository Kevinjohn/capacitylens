import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd(), "..");
const STORIES = resolve(ROOT, "user-stories");
const STORY_FILE = /^US-[A-Z]+-\d+.*\.md$/;
const SOURCE_PATH = /`((?:e2e|server|shared|src)\/[^`]+\.[cm]?[jt]sx?)`/g;
const DOCUMENTATION_TARGET = /^\*\*Documentation:\*\*\s+\[[^\]]+\]\(([^)]+)\)/gm;

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function headingId(text: string): string {
  return text
    .replace(/\s+\{#[^}]+\}\s*$/, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/\s+#+\s*$/, "")
    .trim()
    .toLocaleLowerCase("en-GB")
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function markdownFragmentIds(source: string): string[] {
  const ids = new Set<string>();
  const headings = new Map<string, number>();
  let inFence = false;

  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    for (const match of line.matchAll(/\{#([^\s}]+)\}/g)) {
      const id = match[1];
      if (id) ids.add(id);
    }

    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
    if (!heading?.[1]) continue;
    const id = headingId(heading[1]);
    if (!id) continue;
    const count = headings.get(id) ?? 0;
    headings.set(id, count + 1);
    ids.add(count === 0 ? id : `${id}-${count}`);
  }

  return [...ids];
}

function htmlFragmentIds(source: string): string[] {
  const ids = new Set<string>();
  for (const match of source.matchAll(/<[^>]+\b(?:id|name)=["']([^"']+)["'][^>]*>/giu)) {
    const id = match[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

function documentationFragmentIds(source: string): string[] {
  return [...new Set([...markdownFragmentIds(source), ...htmlFragmentIds(source)])];
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

  it("rejects the original #1060 numbered-list target shape", () => {
    const source = "## Steps\n\n3. **Understand what CapacityLens plans.** Read the guide.\n";

    expect(documentationFragmentIds(source)).not.toContain("understand-what-capacitylens-plans");
  });
});

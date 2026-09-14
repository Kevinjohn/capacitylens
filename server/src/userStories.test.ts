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
  // Keep this in lockstep with VitePress 1.6.4's internal slugify implementation:
  // NFKD accents, control/punctuation runs as one hyphen, and a leading numeric
  // character receives an underscore. The slugger is not a public VitePress export.
  const withoutMarkup = stripHtmlLikeTags(
    text
      .replace(/\s+\{#[^}]+\}\s*$/, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[`*_~]/g, "")
      .replace(/\s+#+\s*$/, "")
      .trim(),
  );
  return withoutMarkup
    .normalize("NFKD")
    .replace(/[\u0300-\u036F]/g, "")
    .replace(/\p{Cc}/gu, "")
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();
}

function trailingHeadingFragmentId(headingText: string): string | undefined {
  return headingText.match(/\s+\{#([^\s}]+)\}\s*$/)?.[1];
}

type Fence = { kind: "`" | "~"; length: number };

function stripHtmlLikeTags(text: string): string {
  const output: string[] = [];
  const characters = [...text];
  let inTag = false;

  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    if (character === undefined) continue;
    if (inTag) {
      if (character === ">") inTag = false;
      continue;
    }
    if (character === "<" && /[A-Za-z/!?]/.test(characters[index + 1] ?? "")) {
      inTag = true;
      continue;
    }
    output.push(character);
  }
  return output.join("");
}

function nonFencedLines(source: string): string[] {
  const lines: string[] = [];
  let fence: Fence | undefined;

  for (const line of source.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        marker &&
        marker[1]?.[0] === fence.kind &&
        marker[1].length >= fence.length &&
        /^\s*$/.test(marker[2] ?? "")
      ) {
        fence = undefined;
      }
      continue;
    }
    if (marker?.[1]) {
      fence = { kind: marker[1][0] as Fence["kind"], length: marker[1].length };
      continue;
    }
    lines.push(line);
  }

  return lines;
}

function markdownFragmentIds(source: string): string[] {
  const ids = new Set<string>();

  for (const line of nonFencedLines(source)) {
    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
    if (!heading?.[1]) continue;
    const explicitId = trailingHeadingFragmentId(heading[1]);
    if (explicitId) {
      ids.add(explicitId);
      continue;
    }
    const id = headingId(heading[1]);
    if (!id) continue;
    let uniqueId = id;
    let suffix = 1;
    while (ids.has(uniqueId)) uniqueId = `${id}-${suffix++}`;
    ids.add(uniqueId);
  }

  return [...ids];
}

function htmlFragmentIds(source: string): string[] {
  const ids = new Set<string>();
  for (const line of nonFencedLines(source)) {
    for (const match of line.matchAll(/<[^>]+\b(?:id|name)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))[^>]*>/giu)) {
      const id = match[1] ?? match[2] ?? match[3];
      if (id) ids.add(id);
    }
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

  it("does not leave an incomplete HTML-like tag in the automatic slug", () => {
    expect(documentationFragmentIds("## Safe <script")).toContain("safe");
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

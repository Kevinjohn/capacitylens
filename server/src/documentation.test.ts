import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(process.cwd(), "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

function headingSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

describe("standing documentation contracts", () => {
  it("keeps every changelog release linked and compares Unreleased from the newest release", () => {
    const changelog = read("CHANGELOG.md");
    const headings = [...changelog.matchAll(/^## \[([^\]]+)\]/gm)].map((match) => match[1]);
    const references = new Map([...changelog.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)].map((match) => [match[1], match[2]]));
    const releases = headings.filter((heading) => heading !== "Unreleased");

    expect([...references.keys()].filter((label) => headings.includes(label))).toEqual(headings);
    expect(references.get("Unreleased")).toContain(`/compare/v${releases[0]}...HEAD`);
  });

  it("resolves local Markdown fragments linked from the public README", () => {
    const readme = read("README.md");
    const links = [...readme.matchAll(/\]\(([^)#]+\.md)#([^)]+)\)/g)];
    expect(links.length).toBeGreaterThan(0);

    for (const [, path, fragment] of links) {
      const slugs = [...read(path).matchAll(/^#{1,6} (.+)$/gm)].map((match) => headingSlug(match[1]));
      expect(slugs, `${path} has no #${fragment} heading`).toContain(fragment);
    }
  });

  it.each([
    ["docs/reference/development.md", /`(scripts\/[^`]+\.(?:mjs|js|ts))`/g],
    ["DEFENSIVE-CODING.md", /`((?:shared|server|src)\/[^`]+\.ts)`/g],
  ] as const)("keeps repository paths in %s resolvable", (document, pattern) => {
    const paths = [...read(document).matchAll(pattern)].map((match) => match[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) expect(existsSync(resolve(ROOT, path)), path).toBe(true);
  });

  it("keeps the literal product name out of the localization catalogue", () => {
    const brand = read("shared/src/brand.ts").match(/export const APP_NAME = "([^"]+)"/)?.[1];
    expect(brand).toBeTruthy();
    const messages = Object.values(JSON.parse(read("messages/en.json")) as Record<string, string>);
    expect(messages.filter((message) => message.includes(brand!))).toEqual([]);
    expect(messages.filter((message) => message.includes("(s)"))).toEqual([]);
  });
});

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/** The repository root when the backend test runner starts in apps/backend. */
export const repositoryRoot = resolve(process.cwd(), '../..');
const storyPattern = /^US-[A-Z]+-\d+.*\.md$/;

/**
 * Reads a UTF-8 repository file by its path relative to the repository root.
 *
 * @throws If the file cannot be read.
 */
export function readRepositoryFile(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

/**
 * Lists the absolute paths of user-story Markdown files under the given directory.
 *
 * @throws If the starting directory or a descendant directory cannot be read.
 */
export function listStoryFiles(directory = resolve(repositoryRoot, 'user-stories')): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listStoryFiles(path);
    return storyPattern.test(entry.name) ? [path] : [];
  });
}

/**
 * Lists sorted story paths relative to the user-story directory.
 *
 * @throws If the user-story directory or a descendant directory cannot be read.
 */
export function listStoryPaths(): string[] {
  return listStoryFiles()
    .map((file) => relative(resolve(repositoryRoot, 'user-stories'), file))
    .sort();
}

function buildHeadingSlug(heading: string): string {
  return heading
    .replace(/\s+\{#[^}]+\}\s*$/, '')
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Collects Markdown heading anchors and explicit HTML element IDs. */
export function buildMarkdownAnchorIds(source: string): Set<string> {
  const ids = new Set<string>();
  for (const [, heading] of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    if (!heading) continue;
    const explicit = heading.match(/\{#([^}]+)\}\s*$/)?.[1];
    ids.add(explicit ?? buildHeadingSlug(heading));
  }
  for (const [, id] of source.matchAll(/<[^>]+\bid=["']([^"']+)["'][^>]*>/g)) {
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Resolves a story link to an absolute path inside the documentation source directory.
 *
 * @returns The absolute path, or undefined if the link has no path or resolves to docs-src itself
 * or outside it.
 */
export function resolveDocumentationPage(story: string, target: string): string | undefined {
  const path = target.split('#', 1)[0];
  if (!path) return;
  const absolute = resolve(dirname(story), path);
  const relativeToDocs = relative(resolve(repositoryRoot, 'docs-src'), absolute);
  if (relativeToDocs.startsWith('..') || relativeToDocs === '') return;
  return absolute;
}

/** Normalises a Markdown heading to a fragment identifier. */
export function buildMarkdownSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

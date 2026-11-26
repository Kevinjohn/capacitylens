import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

/** The repository root when the backend test runner starts in apps/backend. */
export const repositoryRoot = resolve(process.cwd(), '../..');
const storyPattern = /^US-[A-Z]+-\d+.*\.md$/;

/** Reads a UTF-8 repository file by its path relative to the repository root. */
export function readRepositoryFile(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8');
}

/** Lists the absolute paths of user-story Markdown files under the given directory. */
export function storyFiles(directory = resolve(repositoryRoot, 'user-stories')): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return storyFiles(path);
    return storyPattern.test(entry.name) ? [path] : [];
  });
}

/** Lists sorted story paths relative to the user-story directory. */
export function storyPaths(): string[] {
  return storyFiles()
    .map((file) => relative(resolve(repositoryRoot, 'user-stories'), file))
    .sort();
}

function slug(heading: string): string {
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
export function markdownHeadings(source: string): Set<string> {
  const ids = new Set<string>();
  for (const [, heading] of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    if (!heading) continue;
    const explicit = heading.match(/\{#([^}]+)\}\s*$/)?.[1];
    ids.add(explicit ?? slug(heading));
  }
  for (const [, id] of source.matchAll(/<[^>]+\bid=["']([^"']+)["'][^>]*>/g)) {
    if (id) ids.add(id);
  }
  return ids;
}

/** Resolves a story link to an absolute path inside the documentation source directory. */
export function sourcePage(story: string, target: string): string | undefined {
  const path = target.split('#', 1)[0];
  if (!path) return;
  const absolute = resolve(dirname(story), path);
  const relativeToDocs = relative(resolve(repositoryRoot, 'docs-src'), absolute);
  if (relativeToDocs.startsWith('..') || relativeToDocs === '') return;
  return absolute;
}

/** Normalises a Markdown heading to a fragment identifier. */
export function markdownSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

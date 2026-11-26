import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { createMarkdownRenderer, disposeMdItInstance, type MarkdownRenderer } from 'vitepress';

/** The repository root when the backend test runner starts in apps/backend. */
export const repositoryRoot = resolve(process.cwd(), '../..');
const storyPattern = /^US-[A-Z]+-\d+.*\.md$/;
const documentationRoot = resolve(repositoryRoot, 'docs-src');
const readmePath = resolve(repositoryRoot, 'README.md');
// The tests only inspect anchors, so Markdown's normal escaping is enough for code fences.
const markdownOptions = { highlight: () => '' };
const guideMarkdown = await createMarkdownRenderer(documentationRoot, markdownOptions);
// VitePress caches its renderer. The repository files need GitHub heading slugs and no attrs plugin.
disposeMdItInstance();
const repositoryMarkdown = await createMarkdownRenderer(repositoryRoot, {
  ...markdownOptions,
  attrs: { disable: true },
  anchor: { slugify: buildMarkdownSlug, permalink: undefined },
});
disposeMdItInstance();

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

function buildMarkdownSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
}

function buildMarkdownAnchorIds(
  renderer: MarkdownRenderer,
  source: string,
  path: string
): Set<string> {
  const html = renderer.render(source, { path, relativePath: relative(repositoryRoot, path) });
  return new Set(
    Array.from(JSDOM.fragment(html).querySelectorAll('[id]'), (element) => element.id)
  );
}

function listMarkdownLinkTargets(source: string): string[] {
  return repositoryMarkdown.parse(source, {}).flatMap((token) =>
    (token.children ?? []).flatMap((child) => {
      const target = child.type === 'link_open' ? child.attrGet('href') : null;
      return target ? [target] : [];
    })
  );
}

/**
 * Lists missing local targets and fragments for the public README.
 *
 * @throws If an existing Markdown target cannot be read or has an invalid encoded fragment.
 */
export function listReadmeLinkFailures(readme: string): string[] {
  const targets = listMarkdownLinkTargets(readme).filter(
    (target) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)
  );
  if (targets.length === 0) return ['No local links in README'];

  const failures: string[] = [];
  for (const target of targets) {
    const [path, fragment] = target.split('#', 2);
    const absolute = path ? resolve(repositoryRoot, path) : readmePath;
    if (!existsSync(absolute)) {
      failures.push(`Missing README target ${target}`);
      continue;
    }
    if (!fragment || (path && !/\.md$/i.test(path))) continue;
    const source = absolute === readmePath ? readme : readFileSync(absolute, 'utf8');
    const anchors = buildMarkdownAnchorIds(repositoryMarkdown, source, absolute);
    if (!anchors.has(decodeURIComponent(fragment)))
      failures.push(`Missing README fragment ${target}`);
  }
  return failures;
}

function listDocumentationTargets(metadata: string): string[] {
  return [...metadata.matchAll(/^\*\*Documentation:\*\*[ \t]+(.+)$/gm)].flatMap(([, links]) =>
    links ? listMarkdownLinkTargets(links) : []
  );
}

/**
 * Lists invalid, missing and unmatched documentation targets in a story's metadata.
 *
 * @throws If an existing documentation target cannot be read or has an invalid encoded fragment.
 */
export function listDocumentationLinkFailures(story: string, metadata: string): string[] {
  const targets = listDocumentationTargets(metadata);
  if (targets.length === 0) return ['No documentation links in story metadata'];

  const failures: string[] = [];
  for (const target of targets) {
    const page = resolveDocumentationPage(story, target);
    if (!page) {
      failures.push(`Documentation target must resolve inside docs-src: ${target}`);
      continue;
    }
    if (!existsSync(page)) {
      failures.push(`Missing documentation page ${target}`);
      continue;
    }
    const fragment = target.split('#', 2)[1];
    if (!fragment) continue;
    const anchors = buildMarkdownAnchorIds(guideMarkdown, readFileSync(page, 'utf8'), page);
    if (!anchors.has(decodeURIComponent(fragment)))
      failures.push(`Missing documentation fragment ${target}`);
  }
  return failures;
}

/**
 * Resolves a story link to an absolute path inside the documentation source directory.
 *
 * @returns The absolute path, or undefined if the link has no path or resolves to docs-src itself
 * or outside it.
 */
function resolveDocumentationPage(story: string, target: string): string | undefined {
  const path = target.split('#', 1)[0];
  if (!path) return;
  const absolute = resolve(dirname(story), path);
  const relativeToDocs = relative(documentationRoot, absolute);
  if (relativeToDocs.startsWith('..') || relativeToDocs === '') return;
  return absolute;
}

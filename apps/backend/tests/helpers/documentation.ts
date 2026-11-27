import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import { createMarkdownRenderer, disposeMdItInstance, type MarkdownRenderer } from 'vitepress'

/** The repository root when the backend test runner starts in apps/backend. */
export const repositoryRoot = resolve(process.cwd(), '../..')
const storyPattern = /^US-[A-Z]+-\d+.*\.md$/
const documentationRoot = resolve(repositoryRoot, 'docs-src')
const readmePath = resolve(repositoryRoot, 'README.md')
// The tests only inspect anchors, so Markdown's normal escaping is enough for code fences.
const markdownOptions = { highlight: () => '' }
const guideMarkdown = await createMarkdownRenderer(documentationRoot, markdownOptions)
// VitePress caches its renderer. The repository files need GitHub heading slugs and no attrs plugin.
disposeMdItInstance()
const repositoryMarkdown = await createMarkdownRenderer(repositoryRoot, {
  ...markdownOptions,
  attrs: { disable: true },
  anchor: { slugify: buildMarkdownSlug, permalink: undefined },
})
disposeMdItInstance()

/**
 * Reads a UTF-8 repository file by its path relative to the repository root.
 *
 * @throws If the file cannot be read.
 */
export function readRepositoryFile(path: string): string {
  return readFileSync(resolve(repositoryRoot, path), 'utf8')
}

/**
 * Lists the absolute paths of user-story Markdown files under the given directory.
 *
 * @throws If the starting directory or a descendant directory cannot be read.
 */
export function listStoryFiles(directory = resolve(repositoryRoot, 'user-stories')): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return listStoryFiles(path)
    return storyPattern.test(entry.name) ? [path] : []
  })
}

/**
 * Lists sorted story paths relative to the user-story directory.
 *
 * @throws If the user-story directory or a descendant directory cannot be read.
 */
export function listStoryPaths(): string[] {
  return listStoryFiles()
    .map((file) => relative(resolve(repositoryRoot, 'user-stories'), file))
    .sort()
}

function buildMarkdownSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, '')
    .replace(/ /g, '-')
}

function buildMarkdownAnchorIds(
  renderer: MarkdownRenderer,
  source: string,
  path: string
): Set<string> {
  const html = renderer.render(source, { path, relativePath: relative(repositoryRoot, path) })
  return new Set(Array.from(JSDOM.fragment(html).querySelectorAll('[id]'), (element) => element.id))
}

function listMarkdownLinkTargets(
  source: string,
  include: 'links-only' | 'with-images' = 'links-only'
): string[] {
  return repositoryMarkdown.parse(source, {}).flatMap((token) =>
    (token.children ?? []).flatMap((child) => {
      let target = null
      if (child.type === 'link_open') target = child.attrGet('href')
      if (include === 'with-images' && child.type === 'image') target = child.attrGet('src')
      return target ? [target] : []
    })
  )
}

/**
 * Resolves a local Markdown link relative to the source file.
 *
 * @returns Its decoded filesystem path and encoded fragment, or undefined for an external link.
 * @throws If the target cannot be converted to a local filesystem path.
 */
function resolveLocalMarkdownTarget(
  sourceFile: string,
  target: string
): { path: string; fragment: string } | undefined {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return
  const url = new URL(target, pathToFileURL(sourceFile))
  try {
    return { path: fileURLToPath(url), fragment: url.hash.slice(1) }
  } catch (cause) {
    // Keep the link text in the error from the filesystem path conversion.
    throw new Error(`Invalid local Markdown target ${target}`, { cause })
  }
}

/**
 * Lists missing local targets and fragments for the public README.
 *
 * @throws If an existing Markdown target cannot be read or a target has invalid encoding.
 */
export function listReadmeLinkFailures(readme: string): string[] {
  const failures: string[] = []
  let hasLocalTargets = false
  for (const target of listMarkdownLinkTargets(readme)) {
    const link = resolveLocalMarkdownTarget(readmePath, target)
    if (!link) continue
    hasLocalTargets = true
    if (!existsSync(link.path)) {
      failures.push(`Missing README target ${target}`)
      continue
    }
    if (!link.fragment || !/\.md$/i.test(link.path)) continue
    const source = link.path === readmePath ? readme : readFileSync(link.path, 'utf8')
    const anchors = buildMarkdownAnchorIds(repositoryMarkdown, source, link.path)
    if (!anchors.has(decodeURIComponent(link.fragment)))
      failures.push(`Missing README fragment ${target}`)
  }
  return hasLocalTargets ? failures : ['No local links in README']
}

/**
 * Lists missing local Markdown link and image targets in a user story.
 *
 * @throws If a target cannot be converted to a local filesystem path.
 */
export function listStoryLinkFailures(story: string, content: string): string[] {
  const failures: string[] = []
  for (const target of listMarkdownLinkTargets(content, 'with-images')) {
    const link = resolveLocalMarkdownTarget(story, target)
    if (link && !existsSync(link.path)) failures.push(`Missing story link ${target}`)
  }
  return failures
}

function listDocumentationTargets(metadata: string): string[] {
  return [...metadata.matchAll(/^\*\*Documentation:\*\*[ \t]+(.+)$/gm)].flatMap(([, links]) =>
    links ? listMarkdownLinkTargets(links) : []
  )
}

/**
 * Lists invalid, missing and unmatched documentation targets in a story's metadata.
 *
 * @throws If an existing documentation target cannot be read or a target has invalid encoding.
 */
export function listDocumentationLinkFailures(story: string, metadata: string): string[] {
  const targets = listDocumentationTargets(metadata)
  if (targets.length === 0) return ['No documentation links in story metadata']

  const failures: string[] = []
  for (const target of targets) {
    const page = resolveDocumentationPage(story, target)
    if (!page) {
      failures.push(`Documentation target must resolve inside docs-src: ${target}`)
      continue
    }
    if (!existsSync(page.path)) {
      failures.push(`Missing documentation page ${target}`)
      continue
    }
    if (!page.fragment) continue
    const anchors = buildMarkdownAnchorIds(
      guideMarkdown,
      readFileSync(page.path, 'utf8'),
      page.path
    )
    if (!anchors.has(decodeURIComponent(page.fragment)))
      failures.push(`Missing documentation fragment ${target}`)
  }
  return failures
}

/**
 * Resolves a story link to a page inside the documentation source directory.
 *
 * @returns The resolved link, or undefined if the target is external or is outside docs-src.
 * @throws If the target cannot be converted to a local filesystem path.
 */
function resolveDocumentationPage(story: string, target: string) {
  const link = resolveLocalMarkdownTarget(story, target)
  if (!link) return
  const relativeToDocs = relative(documentationRoot, link.path)
  if (relativeToDocs.startsWith('..') || relativeToDocs === '') return
  return link
}

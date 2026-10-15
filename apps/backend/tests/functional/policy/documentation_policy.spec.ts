import { test } from '@japa/runner'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { assertDateRange, remapAndValidateImport } from '@capacitylens/shared/domain/mutations'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData } from '@capacitylens/shared/types/entities'

const ROOT = resolve(process.cwd(), '../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')
const storyPattern = /^US-[A-Z]+-\d+.*\.md$/
const sourceReferences =
  /`((?:apps\/backend|apps\/frontend|packages\/shared|e2e)\/[^`]+\.[cm]?[jt]sx?)`/g
const documentationTarget = /^\*\*Documentation:\*\*\s+\[[^\]]+\]\(([^)]+)\)/gm

function storyFiles(directory = resolve(ROOT, 'user-stories')): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return storyFiles(path)
    return storyPattern.test(entry.name) ? [path] : []
  })
}

function storyPaths(): string[] {
  return storyFiles()
    .map((file) => relative(resolve(ROOT, 'user-stories'), file).replaceAll('\\', '/'))
    .sort()
}

function slug(heading: string): string {
  return heading
    .replace(/\s+\{#[^}]+\}\s*$/, '')
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function markdownHeadings(source: string): Set<string> {
  const ids = new Set<string>()
  for (const [, heading] of source.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    if (!heading) continue
    const explicit = heading.match(/\{#([^}]+)\}\s*$/)?.[1]
    ids.add(explicit ?? slug(heading))
  }
  for (const [, id] of source.matchAll(/<[^>]+\bid=["']([^"']+)["'][^>]*>/g)) {
    if (id) ids.add(id)
  }
  return ids
}

function sourcePage(story: string, target: string): string | undefined {
  const path = target.split('#', 1)[0]
  if (!path) return
  const absolute = resolve(dirname(story), path)
  const relativeToDocs = relative(resolve(ROOT, 'docs-src'), absolute)
  if (relativeToDocs.startsWith('..') || relativeToDocs === '') return
  return absolute
}

function markdownSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

test.group('M5 documentation and policy contracts', () => {
  test('keeps current and archived changelog releases linked in heading order', ({ assert }) => {
    const changelog = read('CHANGELOG.md')
    const headings = [...changelog.matchAll(/^## \[([^\]]+)\]/gm)].map((match) => match[1])
    const references = new Map(
      [...changelog.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)].map((match) => [match[1], match[2]])
    )
    const releases = headings.filter((heading) => heading !== 'Unreleased')
    const version = (JSON.parse(read('package.json')) as { version: string }).version

    assert.deepEqual(
      [...references.keys()].filter((label) => headings.includes(label)),
      headings
    )
    assert.equal(releases[0], version)
    assert.include(references.get('Unreleased') ?? '', `/compare/v${version}...HEAD`)

    const archive = read('CHANGELOG-ARCHIVE.md')
    const archivedHeadings = [...archive.matchAll(/^## \[([^\]]+)\]/gm)].map((match) => match[1])
    const archivedRefs = [...archive.matchAll(/^\[([^\]]+)\]: \S+$/gm)].map((match) => match[1])
    assert.isAbove(archivedHeadings.length, 0)
    assert.deepEqual(
      archivedRefs.filter((label) => archivedHeadings.includes(label)),
      archivedHeadings
    )
  })

  test('keeps local Markdown links from the public README resolvable', ({ assert }) => {
    const links = [...read('README.md').matchAll(/\]\(([^)]+)\)/g)]
      .map((match) => match[1])
      .filter(
        (target): target is string =>
          Boolean(target) && !target!.includes('://') && !target!.startsWith('#')
      )
    assert.isAbove(links.length, 0)

    for (const target of links) {
      const [path, fragment] = target.split('#', 2)
      const absolute = resolve(ROOT, path ?? '')
      assert.isTrue(existsSync(absolute), `Missing README target ${target}`)
      if (!fragment || !/\.md$/i.test(path ?? '')) continue
      const headings = markdownHeadings(readFileSync(absolute, 'utf8'))
      const slugs = new Set([...headings].map(markdownSlug))
      assert.isTrue(slugs.has(decodeURIComponent(fragment)), `Missing README fragment ${target}`)
    }
  })

  test('documents the native Adonis commands and health routes without legacy server entry points', ({
    assert,
  }) => {
    const install = read('docs-src/self-hosting/install-without-docker.md')
    const operations = read('docs-src/self-hosting/upgrades.md')
    const backups = read('docs-src/self-hosting/backups-and-restore.md')
    const monitoring = read('docs-src/self-hosting/monitoring.md')
    const operatorDocs = [install, operations, backups, monitoring].join('\n')

    for (const command of [
      'node ace.js app:upgrade',
      'node ace.js db:backup',
      'node ace.js owner:reset-password',
      'node ace.js app:reset',
    ])
      assert.include(operatorDocs, command)
    assert.include(monitoring, '/health/live')
    assert.include(monitoring, '/health/ready')
    assert.notMatch(
      operatorDocs,
      /server\/dist|capacitylens-server|recover:audit-outbox|cutover:repair/
    )
  })

  test('keeps current operator configuration tied to the packaged environment sample', ({
    assert,
  }) => {
    const configuration = read('docs-src/self-hosting/configuration.md')
    const example = read('packaging/release/capacitylens.env.example')
    for (const key of [
      'APP_KEY',
      'APP_URL',
      'SESSION_DRIVER',
      'CAPACITYLENS_MODE',
      'CAPACITYLENS_SECRET',
      'CAPACITYLENS_SETUP_TOKEN',
      'CAPACITYLENS_PUBLIC_URL',
      'CAPACITYLENS_DB',
      'CAPACITYLENS_BACKUP_DIR',
    ]) {
      assert.include(example, `${key}=`)
      assert.include(configuration, `\`${key}\``)
    }
    assert.include(configuration, 'Google')
    assert.include(configuration, 'Microsoft sign-in is deferred')
    assert.include(configuration, 'GitHub sign-in is retired')
  })

  test('keeps backup bounds, flooring, and warning fallbacks documented', ({ assert }) => {
    const configuration = read('docs-src/self-hosting/configuration.md').replace(/\s+/g, ' ')
    assert.match(configuration, /default interval is 60 minutes and retention is 48 snapshots/)
    assert.match(
      configuration,
      /positive fractional retention values are floored to whole snapshots/i
    )
    assert.match(
      configuration,
      /invalid or nonpositive values use the 48-snapshot default with a startup warning/
    )
    assert.match(configuration, /values above 10,000 clamp to 10,000 with a startup warning/)
    assert.match(
      configuration,
      /invalid interval values use the 60-minute default with a startup warning/i
    )
    assert.match(configuration, /values above 35,000 clamp to 35,000 with a startup warning/)
  })

  test('limits sole-owner password recovery to an existing local password', ({ assert }) => {
    for (const path of [
      'docs-src/self-hosting/backups-and-restore.md',
      'docs-src/self-hosting/incidents.md',
      'docs-src/self-hosting/faq.md',
    ]) {
      const document = read(path).replace(/\s+/g, ' ')
      assert.include(document, '`password-only`')
      assert.include(document, '`password-and-sso`')
      assert.include(document, 'already has a local password')
      assert.include(document, 'A Google-only')
      assert.include(document, 'cannot use')
      assert.include(document, 'to create local password credentials')
    }
  })

  test('states that Docker deployment mechanics remain deferred and unvalidated', ({ assert }) => {
    const dockerGuide = read('docs-src/self-hosting/install-with-docker.md')
    assert.match(dockerGuide, /not (?:yet )?available|not validated|not supported/i)
    assert.match(dockerGuide, /native (?:release )?archive/i)
    assert.notMatch(dockerGuide, /^\s*(?:docker|docker-compose)\s+/m)
  })

  test('ignores runtime databases while tracking the released migration manifest', ({ assert }) => {
    const ignored = (path: string) => {
      try {
        execFileSync('git', ['check-ignore', '--no-index', '--quiet', path], {
          cwd: ROOT,
          stdio: 'ignore',
        })
        return true
      } catch {
        return false
      }
    }
    assert.isTrue(ignored('capacitylens-local.db'))
    assert.isTrue(ignored('apps/backend/tmp/operator.db'))
    assert.isFalse(ignored('apps/backend/database/released.json'))
  })

  test('keeps the shared domain core executable from the backend Node runtime', ({ assert }) => {
    assert.doesNotThrow(() => assertDateRange('2026-01-01', '2026-01-05'))
    assert.throws(() => assertDateRange('2026-01-05', '2026-01-01'))
    const base: AppData = {
      ...emptyAppData(),
      accounts: [
        {
          id: 'a-studio',
          name: 'Wayne Enterprises',
          color: '#3b82f6',
          schedulingMode: null,
          timezone: null,
          weekStartsOn: null,
          workingDays: null,
          language: null,
          disciplinesEnabled: null,
          placeholdersEnabled: null,
          externalEnabled: null,
          inlineActivityCreateEnabled: null,
          showTaskFieldInSchedule: null,
          capacityOverviewAccess: null,
          dateStyle: null,
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    }
    const incoming: AppData = {
      ...emptyAppData(),
      clients: [
        {
          id: 'c',
          accountId: 'a-loft',
          name: 'Stark Industries',
          color: '#3b82f6',
          isPrivate: null,
          codeName: null,
          builtin: null,
          archivedAt: null,
          deletedAt: null,
          createdAt: 't',
          updatedAt: 't',
        },
      ],
    }
    const result = remapAndValidateImport(base, 'a-studio', incoming, '2026-01-01T00:00:00.000Z')
    assert.equal(result.imported, 1)
    assert.notEqual(result.data.clients[0]?.id, 'c')
    assert.equal(result.data.clients[0]?.accountId, 'a-studio')
    assert.equal(result.data.clients[0]?.createdAt, '2026-01-01T00:00:00.000Z')
  })

  test('keeps user-story source and documentation references resolvable', ({ assert }) => {
    const files = storyFiles()
    const catalogue = read('user-stories/README.md')
    const indexed = [...catalogue.matchAll(/\]\(([^)]+\/US-[^)]+\.md)\)/g)].map((match) => match[1])
    assert.equal(Number(catalogue.match(/\n(\d+) stories across/)?.[1]), files.length)
    assert.equal(indexed.length, files.length)
    assert.equal(new Set(indexed).size, files.length)
    assert.deepEqual(indexed.toSorted(), storyPaths())

    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      assert.match(content, /^## Goal$/m)
      assert.match(content, /^## Why$/m)
      assert.match(content, /^## How(?: \([^\n]+\))?$/m)
      assert.match(content, /^1\. /m)
      assert.match(content, /^## Acceptance criteria$/m)
      assert.match(content, /^- (?:✅ )?\S/m)
      const metadata = content.split(/^## Goal$/m, 1)[0] ?? ''
      for (const [, path] of metadata.matchAll(sourceReferences)) {
        if (path) assert.isTrue(existsSync(resolve(ROOT, path)), `Missing source ${path}`)
      }
      for (const [, target] of content.matchAll(documentationTarget)) {
        if (!target) continue
        const page = sourcePage(file, target)
        assert.isDefined(page, `Documentation target must resolve inside docs-src: ${target}`)
        assert.isTrue(existsSync(page!), `Missing documentation page ${target}`)
        const fragment = target.split('#')[1]
        if (fragment) {
          const decoded = decodeURIComponent(fragment)
          assert.include(
            markdownHeadings(readFileSync(page!, 'utf8')),
            decoded,
            `Missing #${decoded}`
          )
        }
      }
    }
  })

  test('keeps permanent deletion guidance on the entity view', ({ assert }) => {
    assert.notMatch(
      read('docs-src/using/resources.md'),
      /permanent deletion[^.]*\]\(\/using\/settings\)/i
    )
  })

  test('keeps the product name and literal plural marker out of localized copy', ({ assert }) => {
    const brand = read('packages/shared/src/brand.ts').match(
      /export const APP_NAME = "([^"]+)"/
    )?.[1]
    assert.isDefined(brand, 'Expected the shared brand module to export APP_NAME')
    const messages = Object.values(
      JSON.parse(read('apps/frontend/messages/en.json')) as Record<string, string>
    )
    assert.deepEqual(
      messages.filter((message) => message.includes(brand!)),
      []
    )
    assert.deepEqual(
      messages.filter((message) => message.includes('(s)')),
      []
    )
  })

  test('keeps operational execution and resource boundaries in current runbooks', ({ assert }) => {
    const install = read('docs-src/self-hosting/install.md').replace(/\s+/g, ' ')
    const managedHost = read('docs-src/self-hosting/managed-vps/index.md')
    const monitoring = read('docs-src/self-hosting/monitoring.md').replace(/\s+/g, ' ')
    const managedSiteUser = /^-\s+run as the dedicated site user from\b/im
    assert.match(install, /background process runs as a dedicated site user/i)
    assert.match(managedHost, managedSiteUser)
    assert.isTrue(managedSiteUser.test('- run as the dedicated site user from current/backend'))
    assert.isFalse(
      managedSiteUser.test('- do not run as the dedicated site user from current/backend')
    )
    assert.isFalse(managedSiteUser.test('- run as root from current/backend'))
    assert.isFalse(
      managedSiteUser.test('- no longer run as the dedicated site user from current/backend')
    )
    assert.isFalse(
      managedSiteUser.test('- do not run under the dedicated site user from current/backend')
    )
    assert.match(
      monitoring,
      /Authentication and request-work safeguards are process-wide, not per-company reservations/
    )
    assert.match(monitoring, /Authentication is identity-global before company selection/)
    assert.match(
      monitoring,
      /Use edge\/global quotas or separate CapacityLens instances when installations require resource isolation/
    )
    assert.include(monitoring, 'journalctl -u capacitylens --since "30 min ago"')
  })
})

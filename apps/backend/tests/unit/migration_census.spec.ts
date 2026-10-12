import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

interface Disposition {
  source_path: string
  plan_identity: string
  milestone: string
  disposition: string
  proposed_package?: string
  proposed_test_path?: string
  reason: string
  subdispositions?: Disposition[]
}
interface Ledger {
  source_revision: string
  test_census: {
    paths: string[]
    manifest_sha256: string
    total_plan_census: number
    difference: number
    unmapped: string[]
  }
  test_dispositions: Disposition[]
  route_inventory: {
    main_route_contracts: Array<{ method: string; path: string; source: string; response: string }>
    static_fallback_contract: { tested_distinctions: unknown[] }
    caller_inventory: {
      factual_gaps: unknown[]
      status_note: string
      normalization: {
        source_inventory_counts: { spa_call_patterns: number; e2e_call_patterns: number }
        expanded_call_records: number
        expansion: string
        path_parameters: string
      }
      calls: Array<{
        method: string
        path: string
        path_expansion?: { variant: string; source: string; meaning: string }
        source: string
        source_kind: string
        request_body_contract: {
          kind: string
          shape: string | null
          source: string
          verification: string
        }
        legacy_response_status_contract: { status: string; source: string }
        implementation: { status: string; package: string | null }
      }>
    }
  }
  m1_port_evidence: {
    entries: Array<{
      source_path: string
      guarantee: string
      target: string
      cases: string[]
      fixture_routes?: Array<{ method: string; path: string }>
      later_splits?: Array<{ reason: string; milestone: string; package: string }>
    }>
    additional_contracts: Array<{ target: string; cases: string[]; reason: string }>
  }
}

const LEGACY_MANIFEST_SHA256 = '09543bf29eeabba7548d77a23853fbec4d3cdc9113a776cd7eb37eaf4fecb73c'
const ledger = JSON.parse(
  await readFile(new URL('../m1-test-census.json', import.meta.url), 'utf8')
) as Ledger

function validateDispositions(paths: string[], dispositions: Disposition[]) {
  const dispositionPaths = dispositions.map(({ source_path }) => source_path)
  const duplicates = dispositionPaths.filter(
    (path, index) => dispositionPaths.indexOf(path) !== index
  )
  const missing = paths.filter((path) => !dispositionPaths.includes(path))
  const extra = dispositionPaths.filter((path) => !paths.includes(path))
  if (duplicates.length || missing.length || extra.length)
    throw new Error(JSON.stringify({ duplicates, missing, extra }))
  for (const row of dispositions) {
    if (!row.plan_identity || !row.milestone || !row.disposition || !row.reason)
      throw new Error(`Incomplete disposition for ${row.source_path}`)
    for (const split of row.subdispositions ?? []) {
      if (
        !split.milestone ||
        !split.disposition ||
        !split.proposed_package ||
        !split.proposed_test_path ||
        !split.reason
      )
        throw new Error(`Incomplete split disposition for ${row.source_path}`)
    }
  }
}

async function collectTestFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relative = join(directory, entry.name)
      if (entry.isDirectory()) return collectTestFiles(root, relative)
      return entry.isFile() && entry.name.endsWith('.test.ts') ? [relative] : []
    })
  )
  return files.flat()
}

async function collectTypeScriptFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const relative = join(directory, entry.name)
      if (entry.isDirectory()) return collectTypeScriptFiles(root, relative)
      return entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [relative]
        : []
    })
  )
  return files.flat()
}

async function discoverFrontendCallerModules(projectRoot: string): Promise<string[]> {
  const sourceRoot = 'apps/frontend/src'
  const files = await collectTypeScriptFiles(projectRoot, sourceRoot)
  const routeRequest = /\b(?:apiFetch|apiFetchReauth|fetch|state\.request)\s*\(/
  const authAction = /\bauthClient\.(?:signIn\.(?:email|social)|signUp\.email|changePassword)\s*\(/
  const modules: string[] = []
  for (const path of files) {
    const source = await readFile(join(projectRoot, path), 'utf8')
    if ((source.includes('/api/') && routeRequest.test(source)) || authAction.test(source))
      modules.push(path.slice(sourceRoot.length + 1))
  }
  return modules.map((path) => path.split(sep).join('/')).sort()
}

async function discoverLegacyTests(projectRoot: string): Promise<string[]> {
  const sourceRoot = join(projectRoot, 'server', 'src')
  const scriptTest = join(projectRoot, 'server', 'scripts', 'check-node.test.mjs')
  const sourceRootStats = await stat(sourceRoot)
  const scriptTestStats = await stat(scriptTest)
  if (!sourceRootStats.isDirectory())
    throw new Error('Legacy server/src is missing before the explicit M7a source transition.')
  if (!scriptTestStats.isFile())
    throw new Error(
      'Legacy server/scripts/check-node.test.mjs is missing before the explicit M7a source transition.'
    )

  const sourceFiles = await collectTestFiles(projectRoot, join('server', 'src'))
  const paths = [...sourceFiles, join('server', 'scripts', 'check-node.test.mjs')]
  return paths.map((path) => path.split(sep).join('/')).sort()
}

function manifestDigest(paths: string[]): string {
  return createHash('sha256')
    .update(`${paths.join('\n')}\n`)
    .digest('hex')
}

test('pins every legacy server test to exactly one explicit migration disposition', async ({
  assert,
}) => {
  assert.equal(ledger.source_revision, '3cd9d94a')
  assert.equal(ledger.test_census.paths.length, 186)
  assert.equal(new Set(ledger.test_census.paths).size, 186)
  assert.equal(ledger.test_census.manifest_sha256, LEGACY_MANIFEST_SHA256)
  assert.equal(manifestDigest(ledger.test_census.paths), ledger.test_census.manifest_sha256)
  assert.equal(ledger.test_census.total_plan_census, 186)
  assert.equal(ledger.test_census.difference, 0)
  assert.deepEqual(ledger.test_census.unmapped, [])
  const discovered = await discoverLegacyTests(resolve(process.cwd(), '..', '..'))
  assert.deepEqual(discovered, ledger.test_census.paths)
  validateDispositions(discovered, ledger.test_dispositions)
  assert.isNotEmpty(ledger.route_inventory.main_route_contracts)
  assert.isNotEmpty(ledger.route_inventory.static_fallback_contract.tested_distinctions)
  assert.isNotEmpty(ledger.route_inventory.caller_inventory.calls)
  const callerNormalization = ledger.route_inventory.caller_inventory.normalization
  assert.equal(callerNormalization.source_inventory_counts.spa_call_patterns, 76)
  assert.equal(callerNormalization.source_inventory_counts.e2e_call_patterns, 35)
  assert.equal(callerNormalization.expanded_call_records, 109)
  assert.equal(ledger.route_inventory.caller_inventory.calls.length, 109)
  assert.deepEqual(ledger.route_inventory.caller_inventory.factual_gaps, [])
  assert.notMatch(
    ledger.route_inventory.caller_inventory.status_note,
    /unverified|not yet traced|status pending|placeholder|next_read/i
  )
  assert.include(callerNormalization.expansion, 'POST step and DELETE cancel')
  const callerKinds = new Set<string>()
  for (const call of ledger.route_inventory.caller_inventory.calls) {
    assert.isNotEmpty(call.method)
    assert.isNotEmpty(call.path)
    if (call.path_expansion) {
      assert.isNotEmpty(call.path_expansion.variant)
      assert.match(call.path_expansion.source, /:\d+/)
      assert.isNotEmpty(call.path_expansion.meaning)
    }
    assert.isNotEmpty(call.source)
    callerKinds.add(call.source_kind)
    if (call.method === 'GET') {
      assert.equal(call.request_body_contract.kind, 'none')
      assert.isNull(call.request_body_contract.shape)
    }
    if (call.request_body_contract.kind === 'none') assert.isNull(call.request_body_contract.shape)
    else assert.isNotEmpty(call.request_body_contract.shape)
    assert.isNotEmpty(call.request_body_contract.kind)
    assert.isNotEmpty(call.request_body_contract.source)
    assert.isNotEmpty(call.request_body_contract.verification)
    assert.notMatch(call.request_body_contract.kind, /unverified|json-or-empty/i)
    assert.notMatch(call.request_body_contract.verification, /unverified|next_read/i)
    assert.match(call.request_body_contract.source, /:\d+/)
    assert.isNotEmpty(call.legacy_response_status_contract.status)
    assert.isNotEmpty(call.legacy_response_status_contract.source)
    assert.notMatch(
      call.legacy_response_status_contract.status,
      /not yet traced|status pending|placeholder|next_read/i
    )
    assert.match(call.legacy_response_status_contract.source, /:\d+/)
    assert.isNotEmpty(call.implementation.status)
  }
  assert.deepEqual([...callerKinds].sort(), ['E2E caller', 'SPA caller'])
  const sourceModules = new Set(
    ledger.route_inventory.caller_inventory.calls
      .filter((call) => call.source_kind === 'SPA caller')
      .flatMap((call) =>
        [...call.source.matchAll(/(?:^|;\s*)src\/([^:;\s]+)/g)].map((match) => match[1])
      )
  )
  const discoveredModules = await discoverFrontendCallerModules(resolve(process.cwd(), '..', '..'))
  for (const modulePath of discoveredModules)
    assert.include(
      sourceModules,
      modulePath,
      `route-bearing caller module missing from inventory: ${modulePath}`
    )
  const citedLinesByModule = new Map<string, Set<number>>()
  for (const call of ledger.route_inventory.caller_inventory.calls) {
    if (call.source_kind !== 'SPA caller') continue
    for (const citationText of [call.source, call.request_body_contract.source]) {
      for (const [, modulePath, ranges] of citationText.matchAll(/src\/([^:;\s]+):([\d,-]+)/g)) {
        const citedLines = citedLinesByModule.get(modulePath) ?? new Set<number>()
        for (const range of ranges.split(',')) {
          const [, first, last] = range.match(/^(\d+)(?:-(\d+))?$/) ?? []
          if (!first) continue
          for (let line = Number(first); line <= Number(last ?? first); line++) citedLines.add(line)
        }
        citedLinesByModule.set(modulePath, citedLines)
      }
    }
  }
  const sourceRoot = resolve(process.cwd(), '..', '..', 'apps/frontend/src')
  for (const modulePath of discoveredModules) {
    const source = await readFile(join(sourceRoot, modulePath), 'utf8')
    const sourceLines = source.split(/\r?\n/)
    for (const [index, line] of sourceLines.entries()) {
      const directRoute =
        /["'`]\/api\//.test(line) ||
        (/\/api\//.test(line) &&
          /API_BASE|baseUrl/.test(line) &&
          !line.trimStart().startsWith('//'))
      const authAction =
        /\bauthClient\.(?:signIn\.(?:email|social)|signUp\.email|changePassword)\s*\(/.test(line)
      if (directRoute || authAction)
        assert.include(
          citedLinesByModule.get(modulePath),
          index + 1,
          `route-bearing source line missing from caller inventory: ${modulePath}:${index + 1}`
        )
    }
  }
})

test('the census validator rejects a missing disposition', ({ assert }) => {
  assert.throws(
    () => validateDispositions(ledger.test_census.paths, ledger.test_dispositions.slice(1)),
    /missing/
  )
})

test('source discovery catches an extra legacy test with no disposition', async ({ assert }) => {
  const scratch = await mkdtemp(join(tmpdir(), 'capacitylens-census-'))
  try {
    await mkdir(join(scratch, 'server', 'src'), { recursive: true })
    await mkdir(join(scratch, 'server', 'scripts'), { recursive: true })
    await writeFile(join(scratch, 'server', 'src', 'known.test.ts'), '')
    await writeFile(join(scratch, 'server', 'src', 'undispositioned.test.ts'), '')
    await writeFile(join(scratch, 'server', 'scripts', 'check-node.test.mjs'), '')
    const discovered = await discoverLegacyTests(scratch)
    const dispositions = [
      { source_path: 'server/src/known.test.ts' },
      { source_path: 'server/scripts/check-node.test.mjs' },
    ] as Disposition[]
    assert.throws(
      () => validateDispositions(discovered, dispositions),
      /server\/src\/undispositioned\.test\.ts/
    )
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
})

test('M1 migration coverage points to concrete cases and separates later route slices', async ({
  assert,
}) => {
  const root = resolve(process.cwd(), '..', '..')
  for (const evidence of ledger.m1_port_evidence.entries) {
    assert.include(ledger.test_census.paths, evidence.source_path)
    assert.isNotEmpty(evidence.guarantee, evidence.source_path)
    const source = await readFile(resolve(root, evidence.target), 'utf8')
    assert.isNotEmpty(evidence.cases, evidence.source_path)
    for (const caseTitle of evidence.cases) assert.include(source, caseTitle, evidence.source_path)
    if (evidence.fixture_routes) {
      const fixture = JSON.parse(
        await readFile(resolve(root, 'apps/backend/tests/fixtures-main-responses.json'), 'utf8')
      ) as { responses: Array<{ method: string; path: string }> }
      for (const route of evidence.fixture_routes)
        assert.include(
          fixture.responses.map(({ method, path }) => `${method} ${path}`),
          `${route.method} ${route.path}`,
          evidence.source_path
        )
    }
    for (const split of evidence.later_splits ?? []) {
      assert.isNotEmpty(split.milestone)
      assert.isNotEmpty(split.package)
      assert.isNotEmpty(split.reason)
    }
  }
  for (const evidence of ledger.m1_port_evidence.additional_contracts) {
    const source = await readFile(resolve(root, evidence.target), 'utf8')
    assert.isNotEmpty(evidence.cases)
    assert.isNotEmpty(evidence.reason)
    for (const caseTitle of evidence.cases) assert.include(source, caseTitle, evidence.target)
  }
})

import { test } from '@japa/runner'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import {
  M2B_TARGET_PATHS,
  assertNamedTargetCases,
  parseTestTitles,
  validateM2bAdditionalContracts,
  validateM2bEvidence,
  validateNoStaleM2bSplits,
  type M2bPortEvidence,
} from './migration_census_support.js'

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
        current_source?: string
        source_kind: string
        request_body_contract: {
          kind: string
          shape: string | null
          source: string
          verification: string
        }
        legacy_response_status_contract: { status: string; source: string }
        implementation: {
          status: string
          package: string | null
          source?: string
          milestone?: string
          method?: string
          path?: string
        }
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
  m2a_port_evidence: {
    source_maps: string[]
    entries: Array<{
      source_path: string
      guarantee: string
      targets: Array<{ path: string; cases: string[] }>
      uncovered_guarantees: string[]
      later_splits: Array<{
        milestone: string
        package: string
        reason: string
        targets?: Array<{ path: string; cases: string[] }>
      }>
    }>
    additional_contracts: Array<{
      source_path: string
      scope: string
      targets: Array<{ path: string; cases: string[] }>
      uncovered_guarantees: string[]
      later_splits: Array<{ milestone: string; package: string; reason: string }>
    }>
    native_batch_client: {
      source: string
      test: string
      case: string
      route: string
      contract: string
    }
    e2e_write_rebindings: Array<{
      legacy_source: string
      path: string
      expected_batch_calls: number
      target: string
      implementation_source: string
      status: string
    }>
    legacy_caller_identity_sha256: string
  }
  m2b_port_evidence: M2bPortEvidence
}

const LEGACY_MANIFEST_SHA256 = '09543bf29eeabba7548d77a23853fbec4d3cdc9113a776cd7eb37eaf4fecb73c'
const M2A_NAMED_SOURCES = [
  'server/src/BatchStateProjection.test.ts',
  'server/src/app.authz.test.ts',
  'server/src/app.batch-attribution.test.ts',
  'server/src/app.batch-validation.test.ts',
  'server/src/app.concurrency-ordered.test.ts',
  'server/src/app.crud-round-trip.test.ts',
  'server/src/app.frozen-fields-errors.test.ts',
  'server/src/app.input-contract.test.ts',
  'server/src/app.lifecycle.test.ts',
  'server/src/app.projections-guards.test.ts',
  'server/src/app.request-guards.test.ts',
  'server/src/app.resourceLimits.test.ts',
  'server/src/app.sanitization.test.ts',
  'server/src/app.singleCompanyCap.test.ts',
  'server/src/app.syncOrdering.integration.test.ts',
  'server/src/app.write-validation.test.ts',
  'server/src/audit.test.ts',
  'server/src/auditOutbox.test.ts',
  'server/src/batchAttribution.model.test.ts',
  'server/src/fieldPolicy.test.ts',
  'server/src/resolveEntitlements.test.ts',
  'server/src/revision.test.ts',
  'server/src/validate.allocationProject.test.ts',
  'server/src/validate.resourceAvailability.test.ts',
  'server/src/validate.timeOff.test.ts',
  'server/src/writePipeline.test.ts',
]
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

function validateM2aEvidence(entries: Ledger['m2a_port_evidence']['entries']) {
  const sources = entries.map(({ source_path }) => source_path)
  const duplicates = sources.filter((path, index) => sources.indexOf(path) !== index)
  const missing = M2A_NAMED_SOURCES.filter((path) => !sources.includes(path))
  const extra = sources.filter((path) => !M2A_NAMED_SOURCES.includes(path))
  if (duplicates.length || missing.length || extra.length)
    throw new Error(JSON.stringify({ duplicates, missing, extra }))
  for (const entry of entries) {
    if (!entry.guarantee || !entry.targets.length)
      throw new Error(`Missing concrete M2a mapping for ${entry.source_path}`)
    if (entry.uncovered_guarantees.length)
      throw new Error(
        `Uncovered M2a guarantees for ${entry.source_path}: ${entry.uncovered_guarantees.join('; ')}`
      )
    for (const target of entry.targets) {
      if (!target.path || !target.cases.length)
        throw new Error(`Missing concrete target case for ${entry.source_path}`)
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
        [...(call.current_source ?? call.source).matchAll(/(?:^|;\s*)src\/([^:;\s]+)/g)].map(
          (match) => match[1]
        )
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
    for (const citationText of call.current_source
      ? [call.current_source]
      : [call.source, call.request_body_contract.source]) {
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

test('M2a maps every named source guarantee to real target cases without unresolved gaps', async ({
  assert,
}) => {
  const root = resolve(process.cwd(), '..', '..')
  const evidence = ledger.m2a_port_evidence
  validateM2aEvidence(evidence.entries)
  assert.isNotEmpty(evidence.source_maps)
  for (const entry of evidence.entries) {
    assert.include(ledger.test_census.paths, entry.source_path)
    const disposition = ledger.test_dispositions.find(
      ({ source_path }) => source_path === entry.source_path
    )
    assert.isDefined(disposition, `missing pinned disposition for ${entry.source_path}`)
    assert.isTrue(
      disposition!.milestone === 'M2a' ||
        disposition!.subdispositions?.some((split) => split.milestone === 'M2a'),
      `${entry.source_path} is not assigned to M2a in the pinned census`
    )
    for (const target of entry.targets) {
      const source = await readFile(resolve(root, target.path), 'utf8')
      for (const caseTitle of target.cases)
        assert.include(source, caseTitle, `${entry.source_path} -> ${target.path}`)
    }
    for (const split of entry.later_splits) {
      assert.isNotEmpty(split.milestone)
      assert.isNotEmpty(split.package)
      assert.isNotEmpty(split.reason)
      for (const target of split.targets ?? []) {
        const source = await readFile(resolve(root, target.path), 'utf8')
        for (const caseTitle of target.cases)
          assert.include(source, caseTitle, `${entry.source_path} -> ${target.path}`)
      }
    }
  }

  const expectedAdditionalSources = [
    'packages/shared/src/data/strictJson.test.ts',
    'server/src/db.accountStore.test.ts',
    'server/src/db.writeAtomicity.test.ts',
  ]
  assert.deepEqual(
    evidence.additional_contracts.map(({ source_path }) => source_path).sort(),
    expectedAdditionalSources.sort()
  )
  for (const contract of evidence.additional_contracts) {
    assert.deepEqual(
      contract.uncovered_guarantees,
      [],
      `uncovered M2a write-scope guarantees for ${contract.source_path}`
    )
    assert.isNotEmpty(contract.targets, `missing target coverage for ${contract.source_path}`)
    for (const target of contract.targets) {
      const source = await readFile(resolve(root, target.path), 'utf8')
      for (const caseTitle of target.cases)
        assert.include(source, caseTitle, `${contract.source_path} -> ${target.path}`)
    }
    for (const split of contract.later_splits) {
      assert.isNotEmpty(split.milestone)
      assert.isNotEmpty(split.package)
      assert.isNotEmpty(split.reason)
    }
  }

  const identity = `${ledger.route_inventory.caller_inventory.calls
    .map(({ method, path, source }) => `${method} ${path} ${source}`)
    .join('\n')}\n`
  assert.equal(
    createHash('sha256').update(identity).digest('hex'),
    evidence.legacy_caller_identity_sha256,
    'M2a rebindings retain the original 109 caller identities'
  )

  const batchClient = evidence.native_batch_client
  const clientSource = await readFile(resolve(root, batchClient.source), 'utf8')
  const clientTest = await readFile(resolve(root, batchClient.test), 'utf8')
  assert.include(clientSource, 'client.request("api.batch"')
  assert.include(clientTest, batchClient.case)
  assert.equal(batchClient.route, 'POST /api/batch')
  assert.include(batchClient.contract, 'PUT/DELETE/ARCHIVE')

  assert.deepEqual(
    evidence.e2e_write_rebindings.map(({ path }) => path).sort(),
    [
      'e2e/company-closures.auth.spec.ts',
      'e2e/person-schedule.auth.spec.ts',
      'e2e/private-name-permissions.auth.spec.ts',
      'e2e/viewer.auth.spec.ts',
    ].sort()
  )
  assert.equal(
    evidence.e2e_write_rebindings.reduce((count, item) => count + item.expected_batch_calls, 0),
    7
  )
  for (const rebinding of evidence.e2e_write_rebindings) {
    assert.equal(rebinding.target, 'POST /api/batch')
    assert.equal(rebinding.status, 'implemented-in-M2a')
    const source = await readFile(resolve(root, rebinding.path), 'utf8')
    const calls = source.match(/request\.post\(\s*`[^`]*\/api\/batch`/g) ?? []
    assert.equal(calls.length, rebinding.expected_batch_calls, rebinding.path)
    const expandReferences = (value: string) =>
      value.split(';').flatMap((reference) => {
        const [file, lines] = reference.trim().split(':')
        return (lines ?? '').split(',').map((line) => `${file}:${line}`)
      })
    const legacyRefs = expandReferences(rebinding.legacy_source)
    const inventoryEntries = ledger.route_inventory.caller_inventory.calls.filter((call) =>
      legacyRefs.some((legacyRef) => expandReferences(call.source).includes(legacyRef))
    )
    assert.isNotEmpty(
      inventoryEntries,
      `legacy caller identity missing: ${rebinding.legacy_source}`
    )
    for (const inventoryEntry of inventoryEntries) {
      assert.equal(inventoryEntry.implementation.status, 'implemented-in-M2a')
      assert.equal(inventoryEntry.implementation.method, 'POST')
      assert.equal(inventoryEntry.implementation.path, '/api/batch')
      assert.include(inventoryEntry.implementation.source ?? '', rebinding.implementation_source)
    }
  }
})

test('the M2a census rejects a missing named-file mapping or a target without a concrete case', ({
  assert,
}) => {
  assert.throws(() => validateM2aEvidence(ledger.m2a_port_evidence.entries.slice(1)), /missing/)
  const uncovered = ledger.m2a_port_evidence.entries.map((entry, index) =>
    index === 0 ? { ...entry, uncovered_guarantees: ['fixture gap'] } : entry
  )
  assert.throws(() => validateM2aEvidence(uncovered), /Uncovered M2a guarantees/)
  const noCases = ledger.m2a_port_evidence.entries.map((entry) =>
    entry.targets.length > 0
      ? { ...entry, targets: [{ path: entry.targets[0]!.path, cases: [] }] }
      : entry
  )
  assert.throws(() => validateM2aEvidence(noCases), /Missing concrete target case/)
})

test('M2b accounts for every named source case and names concrete target cases', async ({
  assert,
}) => {
  const root = resolve(process.cwd(), '..', '..')
  const evidence = ledger.m2b_port_evidence
  validateM2bEvidence(evidence.entries)
  validateM2bAdditionalContracts(evidence.additional_contracts)
  const assertTargetCases = async (path: string, cases: string[], context: string) => {
    const source = await readFile(resolve(root, path), 'utf8')
    if (path === 'apps/backend/tests/functional/state/read_path.spec.ts') {
      const fixture = JSON.parse(
        await readFile(resolve(root, 'apps/backend/tests/fixtures-main-responses.json'), 'utf8')
      ) as { responses: Array<{ method: string; path: string }> }
      const titles = fixture.responses.map(
        ({ method, path: route }) => `${method} ${route} matches the main response`
      )
      assertNamedTargetCases(titles, cases, context)
      return
    }
    assertNamedTargetCases(parseTestTitles(source), cases, context)
  }

  for (const entry of evidence.entries) {
    assert.include(ledger.test_census.paths, entry.source_path)
    for (const target of entry.targets)
      await assertTargetCases(target.path, target.cases, `${entry.source_path} -> ${target.path}`)
    for (const split of entry.later_splits) {
      assert.isNotEmpty(split.milestone)
      assert.isNotEmpty(split.package)
      assert.isNotEmpty(split.reason)
      for (const target of split.targets)
        await assertTargetCases(target.path, target.cases, `${entry.source_path} -> ${target.path}`)
    }
  }

  for (const contract of evidence.additional_contracts) {
    if (contract.source_path) assert.include(ledger.test_census.paths, contract.source_path)
    await assertTargetCases(contract.target.path, [contract.target.case], contract.id)
  }

  const joining = evidence.joining_lifecycle
  assert.equal(joining.source_path, 'server/src/db.joiningLifecycle.test.ts')
  assert.equal(joining.source_case_count, 2)
  assert.include(ledger.test_census.paths, joining.source_path)
  assert.include(M2B_TARGET_PATHS, joining.target.path)
  await assertTargetCases(joining.target.path, [joining.target.case], joining.source_path)
  assert.equal(joining.later_split.milestone, 'M4')
  assert.equal(joining.later_split.case_count, 1)
  assert.isNotEmpty(joining.later_split.package)
  assert.isNotEmpty(joining.later_split.reason)
})

test('the M2b census rejects incomplete case accounting and malformed target names', ({
  assert,
}) => {
  const missingSource = ledger.m2b_port_evidence.entries.slice(1)
  assert.throws(() => validateM2bEvidence(missingSource), /missing/)

  const malformed = JSON.parse(
    JSON.stringify(ledger.m2b_port_evidence.entries)
  ) as Ledger['m2b_port_evidence']['entries']
  malformed[0]!.targets[0]!.path = 'apps/backend/tests/functional/missing.spec.ts'
  assert.throws(() => validateM2bEvidence(malformed), /M2b/)
  assert.throws(
    () => assertNamedTargetCases([], ['missing target title'], 'negative control'),
    /Missing named M2b target case/
  )
  const staleM2aCarryForward = JSON.parse(
    JSON.stringify(ledger.m2b_port_evidence.entries)
  ) as Ledger['m2b_port_evidence']['entries']
  staleM2aCarryForward[0]!.later_splits.push({
    milestone: 'M2a carry-forward',
    package: 'apps/backend/tests/functional/batch',
    case_count: 1,
    reason: 'generic write guard follow-up',
    targets: [],
  })
  assert.throws(() => validateNoStaleM2bSplits(staleM2aCarryForward), /Unresolved M2b follow-up/)

  const missingCoverage = JSON.parse(
    JSON.stringify(ledger.m2b_port_evidence.entries)
  ) as Ledger['m2b_port_evidence']['entries']
  missingCoverage[0]!.targets[0]!.covered_case_count = 0
  assert.throws(() => validateM2bEvidence(missingCoverage), /counts do not match targets/)

  const uncovered = JSON.parse(
    JSON.stringify(ledger.m2b_port_evidence.entries)
  ) as Ledger['m2b_port_evidence']['entries']
  uncovered[0]!.covered_case_count -= 1
  uncovered[0]!.uncovered_case_count += 1
  uncovered[0]!.targets[0]!.covered_case_count -= 1
  uncovered[0]!.uncovered_guarantees.push('unmapped source guarantee')
  assert.throws(() => validateM2bEvidence(uncovered), /Uncovered M2b guarantees/)
})

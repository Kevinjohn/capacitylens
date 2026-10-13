export interface M2bPortEvidence {
  entries: Array<{
    source_path: string
    source_case_count: number
    covered_case_count: number
    partially_covered_case_count: number
    uncovered_case_count: number
    targets: Array<{
      path: string
      covered_case_count: number
      partially_covered_case_count: number
      cases: string[]
    }>
    uncovered_guarantees: string[]
    coverage_notes?: string[]
    later_splits: Array<{
      milestone: string
      package: string
      case_count: number
      reason: string
      targets: Array<{ path: string; cases: string[] }>
    }>
  }>
  additional_contracts: Array<{
    id: string
    source_path?: string
    source_case_count: 0
    guarantee: string
    target: { path: string; case: string }
  }>
  joining_lifecycle: {
    source_path: string
    source_case_count: number
    target: { path: string; case: string }
    later_split: { milestone: string; package: string; case_count: number; reason: string }
  }
}

export const M2B_SOURCE_CASE_COUNTS: Record<string, number> = {
  'server/src/app.export.test.ts': 4,
  'server/src/app.internal-client-import.test.ts': 17,
  'server/src/app.importMemberResources.test.ts': 3,
  'server/src/routes/importRoutes.race.test.ts': 3,
  'server/src/routes/exampleDataRoutes.test.ts': 7,
  'server/src/app.gettingStarted.test.ts': 3,
  'server/src/app.retire-open-dataset.test.ts': 25,
  'server/src/app.full-fixtures.test.ts': 13,
  'server/src/app.resource-availability.test.ts': 16,
}

export const M2B_TARGET_PATHS = [
  'apps/backend/tests/functional/data_routes.spec.ts',
  'apps/backend/tests/functional/import_routes.spec.ts',
  'apps/backend/tests/functional/data_internal_client.spec.ts',
  'apps/backend/tests/functional/data_availability_ordering.spec.ts',
  'apps/backend/tests/functional/data_full_fixtures.spec.ts',
  'apps/backend/tests/functional/state/database_contract.spec.ts',
  'apps/backend/tests/functional/state/read_path.spec.ts',
  'apps/backend/tests/functional/batch/input_contract.spec.ts',
  'apps/backend/tests/functional/batch/policies_crud.spec.ts',
  'apps/backend/tests/functional/batch/company_batches.spec.ts',
  'apps/backend/tests/functional/batch/lifecycle_contract.spec.ts',
  'apps/backend/tests/functional/batch/validation.spec.ts',
]

export function validateM2bEvidence(entries: M2bPortEvidence['entries']) {
  const sources = entries.map(({ source_path }) => source_path)
  const duplicates = sources.filter((path, index) => sources.indexOf(path) !== index)
  const expected = Object.keys(M2B_SOURCE_CASE_COUNTS)
  const missing = expected.filter((path) => !sources.includes(path))
  const extra = sources.filter((path) => !expected.includes(path))
  if (duplicates.length || missing.length || extra.length)
    throw new Error(JSON.stringify({ duplicates, missing, extra }))
  validateNoStaleM2bSplits(entries)

  for (const entry of entries) {
    const expectedCount = M2B_SOURCE_CASE_COUNTS[entry.source_path]
    if (entry.source_case_count !== expectedCount)
      throw new Error(`Wrong source case count for ${entry.source_path}`)
    if (
      entry.covered_case_count +
        entry.partially_covered_case_count +
        entry.uncovered_case_count +
        entry.later_splits.reduce((count, split) => count + split.case_count, 0) !==
      entry.source_case_count
    )
      throw new Error(`Incomplete M2b case accounting for ${entry.source_path}`)
    if (
      entry.targets.reduce((count, target) => count + target.covered_case_count, 0) !==
        entry.covered_case_count ||
      entry.targets.reduce((count, target) => count + target.partially_covered_case_count, 0) !==
        entry.partially_covered_case_count
    )
      throw new Error(`M2b case counts do not match targets for ${entry.source_path}`)
    if (entry.uncovered_case_count !== 0 || entry.uncovered_guarantees.length > 0)
      throw new Error(`Uncovered M2b guarantees remain for ${entry.source_path}`)
    if (entry.partially_covered_case_count > 0 && !entry.coverage_notes?.length)
      throw new Error(`Explain partial coverage for ${entry.source_path}`)

    for (const target of entry.targets) {
      if (
        !M2B_TARGET_PATHS.includes(target.path) ||
        target.covered_case_count + target.partially_covered_case_count === 0 ||
        !target.cases.length
      )
        throw new Error(`Missing concrete M2b target for ${entry.source_path}`)
    }
    for (const guarantee of entry.uncovered_guarantees)
      if (!guarantee.trim()) throw new Error(`Blank remaining case for ${entry.source_path}`)
    for (const split of entry.later_splits) {
      if (!split.milestone || !split.package || !split.case_count || !split.reason)
        throw new Error(`Incomplete later split for ${entry.source_path}`)
      for (const target of split.targets)
        if (!M2B_TARGET_PATHS.includes(target.path) || !target.cases.length)
          throw new Error(`Malformed later-split target for ${entry.source_path}`)
    }
  }
}

export function validateNoStaleM2bSplits(entries: M2bPortEvidence['entries']) {
  for (const entry of entries)
    for (const split of entry.later_splits)
      if (split.milestone === 'M2a carry-forward' || /\bfollow[- ]up\b/i.test(split.reason))
        throw new Error(`Unresolved M2b follow-up for ${entry.source_path}: ${split.reason}`)
}

export function validateM2bAdditionalContracts(contracts: M2bPortEvidence['additional_contracts']) {
  for (const contract of contracts)
    if (
      contract.source_case_count !== 0 ||
      !contract.id ||
      !contract.guarantee ||
      !M2B_TARGET_PATHS.includes(contract.target.path) ||
      !contract.target.case
    )
      throw new Error(`Malformed additional M2b contract: ${contract.id}`)
}

export function parseTestTitles(source: string) {
  return Array.from(source.matchAll(/\btest\(\s*(['"])(.*?)\1/g), (match) => match[2]!)
}

export function assertNamedTargetCases(titles: string[], cases: string[], context: string) {
  const missing = cases.filter((caseTitle) => !titles.includes(caseTitle))
  if (missing.length)
    throw new Error(`Missing named M2b target case for ${context}: ${missing.join(', ')}`)
}

import type { AppDataKey } from '../types/entities.js'
import { ENTITY_FIELDS } from '../types/entityFields.js'
import type { FieldSpec } from '../types/entityFields.js'
import { findFieldProblem } from '../types/entityFieldRules.js'
import type { RowRuleContext } from '../types/entityFieldRules.js'
import { NEUTRAL_COLOR } from '../lib/color.js'
import { validateDateRange } from '../lib/integrity.js'
import { parseResourceAvatarUrl } from '../domain/resourceAvatarUrl.js'
import { areHalfDaysWithinWorkingDays, isSameWeekdays } from '../domain/resourceWorkingPattern.js'
import {
  buildExternalCapacityDefaults,
  buildPlaceholderCapacityDefaults,
} from '../types/entities.js'
import type { Weekday } from '../types/entities.js'
import { isRecord } from '../lib/isRecord.js'
import { assert, fail, hasOwn } from './companyExport.errors.js'
import type { Row } from './companyExport.fields.js'

// Each field's own rule comes from the entity field table (`findFieldProblem`). This module keeps
// only the rules that join fields of one row: kind-dependent resource fields, the Internal client's
// privacy, activity references and date ranges.

function assertResourceRow(row: Row, path: string): void {
  const workingDays = row.workingDays as Weekday[]
  const halfDays = row.halfDays as Weekday[]
  assert(
    areHalfDaysWithinWorkingDays(workingDays, halfDays),
    `${path}.halfDays`,
    'must be a subset of workingDays'
  )
  if (row.kind !== 'placeholder') {
    assert(row.name !== null, `${path}.name`, 'is required')
    assert(
      row.projectId === null,
      `${path}.projectId`,
      'only a placeholder may be bound to a project'
    )
  }
  if (row.kind !== 'person') {
    assert(row.avatarUrl === null, `${path}.avatarUrl`, 'only a person may have an avatar URL')
    for (const field of ['firstAvailableDate', 'lastAvailableDate']) {
      assert(row[field] === null, `${path}.${field}`, 'only a person may have availability dates')
    }
  }
  if (row.kind === 'person' && row.avatarUrl !== null) {
    assert(
      parseResourceAvatarUrl(row.avatarUrl) === row.avatarUrl,
      `${path}.avatarUrl`,
      'must be a canonical credential-free HTTPS URL'
    )
  }
  if (row.kind === 'placeholder') {
    assert(row.engagement === 'studio', `${path}.engagement`, 'must be studio for a placeholder')
    const defaults = buildPlaceholderCapacityDefaults()
    assert(
      isSameWeekdays(workingDays, defaults.workingDays) &&
        isSameWeekdays(halfDays, defaults.halfDays),
      path,
      'placeholder working pattern must use its canonical default'
    )
  }
  if (row.kind === 'external') {
    assert(row.disciplineId === null, `${path}.disciplineId`, 'is not used by external resources')
    const defaults = buildExternalCapacityDefaults()
    assert(
      row.color === NEUTRAL_COLOR &&
        row.employmentType === defaults.employmentType &&
        row.engagement === defaults.engagement &&
        row.workingHoursPerDay === defaults.workingHoursPerDay &&
        isSameWeekdays(workingDays, defaults.workingDays) &&
        isSameWeekdays(halfDays, defaults.halfDays),
      path,
      'external resource must use its canonical capacity defaults'
    )
  }
}

function assertClientRow(row: Row, path: string): void {
  if (row.builtin === true) {
    assert(
      (row.isPrivate === null || row.isPrivate === false) && row.codeName === null,
      path,
      'Internal must remain public and have no code name'
    )
  }
}

function assertActivityRow(row: Row, path: string): void {
  assert(
    row.kind === 'project'
      ? row.projectId !== null
      : row.projectId === null && row.phaseId === null,
    path,
    'activity kind and project/phase references do not agree'
  )
}

const assertDateRange = (label: string) => (row: Row, path: string) => {
  assert(
    validateDateRange(row.startDate as never, row.endDate as never).ok,
    path,
    `${label} date range is invalid`
  )
}

/** The rules that join fields of one row, for the tables that have any. */
const rowRules: Partial<Record<AppDataKey, (row: Row, path: string) => void>> = {
  resources: assertResourceRow,
  clients: assertClientRow,
  activities: assertActivityRow,
  allocations: assertDateRange('allocation'),
  timeOff: assertDateRange('time-off'),
  closures: assertDateRange('closure'),
}

/**
 * Checks every field of one row against the entity field table, then the rules that join its
 * fields, without coercing or mutating the row.
 *
 * @throws CompanyExportError naming the first invalid field.
 */
export function assertRow(
  key: AppDataKey,
  input: unknown,
  path: string,
  options: { redacted: boolean }
): asserts input is Row {
  assert(isRecord(input), path, 'must be an object')
  const row = input
  const specs: Record<string, FieldSpec> = ENTITY_FIELDS[key]
  for (const field of Object.keys(specs)) {
    assert(hasOwn(row, field) && row[field] !== undefined, `${path}.${field}`, 'is required')
  }
  const context: RowRuleContext = {
    externalResource: key === 'resources' && row.kind === 'external',
    builtinClient: key === 'clients' && row.builtin === true,
    quotedCodeName: options.redacted && row.isPrivate === true,
  }
  for (const [field, spec] of Object.entries(specs)) {
    const problem = findFieldProblem(field, spec, row[field], context)
    if (problem) fail(`${path}.${field}`, problem.message)
  }
  rowRules[key]?.(row, path)
}

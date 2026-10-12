import {
  INTERNAL_CLIENT_COLOR,
  INTERNAL_CLIENT_NAME,
} from '@capacitylens/shared/data/internalClient'
import {
  inspectLifecycleAncestry,
  isLifecycleEntityKey,
} from '@capacitylens/shared/domain/lifecycle'
import {
  assertActivityProjectAllowsDependents,
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
  assertScopedRefs,
  validateResourceAvailabilityPair,
} from '@capacitylens/shared/domain/mutations'
import { assertAllocationPlacement } from '@capacitylens/shared/domain/placement'
import type {
  Activity,
  Allocation,
  AppData,
  AppDataKey,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities'
import { BatchRequestError } from '#services/batch/errors'
import type { ValidationDataLookup } from '@capacitylens/shared/domain/mutations'

/** Enforce relational and lifecycle rules against the transaction's evolving projection. */
export function assertEntityDomain(
  table: AppDataKey,
  row: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  state: AppData,
  lookup: ValidationDataLookup,
  hasOtherBuiltinClient: (accountId: string, clientId: string, excludedId?: string) => boolean,
  generatedBuiltinReplacementId?: string
) {
  const id = row.id as string
  const accountId = (table === 'accounts' ? id : row.accountId) as string
  if (isLifecycleEntityKey(table)) {
    if (
      table === 'clients' &&
      row.builtin === true &&
      [row.archivedAt, row.deletedAt, existing?.archivedAt, existing?.deletedAt].some(
        (value) => typeof value === 'string'
      )
    )
      throw new BatchRequestError('The built-in Internal client must remain active.')
    if (typeof existing?.deletedAt === 'string')
      throw new BatchRequestError(
        'Soft-deleted records can only be changed through lifecycle endpoints.'
      )
  }
  const ancestry = inspectLifecycleAncestry(
    table,
    row as never,
    (parentTable, parentId) => lookup.row(parentTable, parentId) as never
  )
  if (ancestry.kind === 'hidden')
    throw new BatchRequestError(
      'Records beneath an archived or soft-deleted ancestor cannot be changed through generic endpoints.'
    )
  if (table === 'clients') {
    if (existing?.builtin === true)
      throw new BatchRequestError('The built-in Internal client cannot be modified.')
    if (row.builtin === true && !existing && !generatedBuiltinReplacementId)
      throw new BatchRequestError('The built-in Internal client is managed by the server.')
    if (
      row.builtin === true &&
      (row.name !== INTERNAL_CLIENT_NAME || row.color !== INTERNAL_CLIENT_COLOR)
    )
      throw new BatchRequestError('The built-in Internal client has a fixed name and colour.')
    if (row.builtin === true && hasOtherBuiltinClient(accountId, id, generatedBuiltinReplacementId))
      throw new BatchRequestError('This company already has its built-in Internal client.')
    return
  }
  if (table === 'accounts' || table === 'disciplines') return
  if (table !== 'allocations' && table !== 'timeOff' && table !== 'closures')
    assertScopedRefs(state, accountId, table, row, existing, lookup, { fullRow: true })
  if (table === 'resources') {
    const resource = row as unknown as Resource
    const previous = existing as unknown as Resource | undefined
    assertResourceProjectAllowsDependents(state, accountId, id, resource, previous, lookup)
    assertResourceKindAllowsDependents(state, accountId, id, resource.kind, lookup)
    const availability = validateResourceAvailabilityPair(
      resource.firstAvailableDate,
      resource.lastAvailableDate
    )
    if (!availability.ok)
      throw new BatchRequestError(
        availability.codes[0] === 'date_reversed'
          ? 'First available date cannot be after last available date.'
          : 'Availability dates must be valid calendar dates (YYYY-MM-DD).'
      )
  } else if (table === 'activities') {
    assertActivityProjectAllowsDependents(
      state,
      accountId,
      id,
      row as unknown as Activity,
      existing as unknown as Activity | undefined,
      lookup
    )
  } else if (table === 'allocations') {
    const allocation = row as unknown as Allocation
    assertAllocationRefs(
      state,
      accountId,
      allocation.resourceId,
      allocation.activityId,
      allocation.hoursPerDay,
      allocation.projectId,
      existing as Pick<Allocation, 'resourceId' | 'activityId' | 'projectId'> | undefined,
      lookup
    )
    assertDateRange(allocation.startDate, allocation.endDate)
    const resource = lookup.row('resources', allocation.resourceId) as Resource | undefined
    if (resource)
      assertAllocationPlacement({
        allocation,
        existing: existing as unknown as Allocation | undefined,
        resource,
        accountWorkingDays: lookup.accountWorkingDays(accountId),
      })
  } else if (table === 'timeOff') {
    const timeOff = row as unknown as TimeOff
    assertResourceExists(
      state,
      accountId,
      timeOff.resourceId,
      existing as Pick<TimeOff, 'resourceId'> | undefined,
      lookup
    )
    assertDateRange(timeOff.startDate, timeOff.endDate)
  } else if (table === 'closures') {
    assertDateRange(row.startDate as string, row.endDate as string)
  }
}

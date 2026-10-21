import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { AppData, AppDataKey, Resource, Weekday } from '@capacitylens/shared/types/entities'
import { normalizeAccountWorkingDays } from '@capacitylens/shared/lib/accountWorkingDays'
import type { ValidationDataLookup } from '@capacitylens/shared/domain/mutations'
import { weekdayOf } from '@capacitylens/shared/lib/dateMath'
import {
  effectiveWorkingWeek,
  effectiveWeekIncludes,
} from '@capacitylens/shared/lib/effectiveWorkingWeek'
import { cleanText } from '@capacitylens/shared/lib/strings'
import { encodeRow } from '#services/state_repository'
import { prepareEntityWrite, TABLE_NAMES } from '#services/batch/entity_policy'
import { createServerRevision } from '#services/batch/revision'
import { validateEntityRow } from '#validators/entities/index'
import type { BatchCapabilities } from '#services/batch/data_policy'

/** A safe refusal whose caller must roll back the enclosing planning transaction. */
export class PlanningOperationError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

type Row = Record<string, unknown> & { id: string }

function lookupFor(data: AppData): ValidationDataLookup {
  const rows = (table: AppDataKey) => data[table] as unknown as Row[]
  return {
    row: (table, id) => rows(table).find((row) => row.id === id),
    allocationsForResource: (accountId, resourceId) =>
      data.allocations.filter(
        (row) => row.accountId === accountId && row.resourceId === resourceId
      ),
    allocationsForActivity: (accountId, activityId) =>
      data.allocations.filter(
        (row) => row.accountId === accountId && row.activityId === activityId
      ),
    resourceHasLoadedAllocation: (accountId, resourceId) =>
      data.allocations.some(
        (row) =>
          row.accountId === accountId && row.resourceId === resourceId && row.hoursPerDay !== 0
      ),
    resourceHasTimeOff: (accountId, resourceId) =>
      data.timeOff.some((row) => row.accountId === accountId && row.resourceId === resourceId),
    accountWorkingDays: (accountId): Weekday[] => {
      const account = data.accounts.find((row) => row.id === accountId)
      return normalizeAccountWorkingDays(account?.workingDays, account?.weekStartsOn === 0 ? 0 : 1)
    },
  }
}

/** Resolves a stored row from the complete company snapshot, refusing missing targets. */
export function existingRow(data: AppData, table: AppDataKey, id: string): Row {
  const row = (data[table] as unknown as Row[]).find((item) => item.id === id)
  if (!row) throw new PlanningOperationError(404, 'validation_error', 'The record was not found.')
  return row
}

function requirePrivacyPermission(
  table: AppDataKey,
  fields: Record<string, unknown>,
  capabilities: BatchCapabilities,
  mode: 'create' | 'update'
) {
  if (
    (table === 'clients' || table === 'projects') &&
    capabilities.role !== 'owner' &&
    ((mode === 'create' &&
      (fields.isPrivate === true || (fields.codeName !== null && fields.codeName !== undefined))) ||
      (mode === 'update' &&
        (Object.hasOwn(fields, 'isPrivate') || Object.hasOwn(fields, 'codeName'))))
  )
    throw new PlanningOperationError(
      403,
      'authorization_denied',
      'Only an owner can change private names.'
    )
  if (table === 'timeOff' && !capabilities.canSeeTimeOffNote && Object.hasOwn(fields, 'note'))
    throw new PlanningOperationError(
      403,
      'authorization_denied',
      'The time-off note is restricted.'
    )
}

/**
 * Validates and writes one row in the caller's transaction, then mutates its unprojected company state.
 * Later compound entries validate against those changes. The caller owns rollback and atomic
 * revision, audit and commitment recording. Only later allocation-repeat occurrences may use
 * permissiveRepeatStart; creates, duplicates and the first repeat retain the working-day gate.
 */
export async function writeRow(
  trx: TransactionClientContract,
  data: AppData,
  accountId: string,
  table: AppDataKey,
  id: string,
  fields: Record<string, unknown>,
  capabilities: BatchCapabilities,
  mode: 'create' | 'update',
  options: { permissiveRepeatStart?: boolean } = {}
) {
  const existing = (data[table] as unknown as Row[]).find((row) => row.id === id)
  requirePrivacyPermission(table, fields, capabilities, mode)
  if (mode === 'create' && existing)
    throw new PlanningOperationError(409, 'validation_error', 'The record already exists.')
  if (
    mode === 'create' &&
    (await trx.from(TABLE_NAMES[table]).select('id').where('id', id).first())
  )
    throw new PlanningOperationError(409, 'validation_error', 'The record already exists.')
  if (mode === 'update' && !existing)
    throw new PlanningOperationError(404, 'validation_error', 'The record was not found.')
  const candidate: Record<string, unknown> = {
    ...(existing ?? {}),
    ...fields,
    id,
    accountId,
  }
  if (!existing && ['clients', 'projects', 'resources', 'activities'].includes(table)) {
    candidate.archivedAt = null
    candidate.deletedAt = null
  }
  if (!existing && table === 'clients') candidate.builtin = null
  if (!existing && table === 'allocations') candidate.seriesId ??= null
  if (!existing && table === 'resources') {
    candidate.avatarUrl ??= null
    candidate.halfDays ??= []
    candidate.engagement ??= 'studio'
  }
  const lookup = lookupFor(data)
  const clean = await prepareEntityWrite(table, candidate, existing, data, capabilities, {
    lookup,
    hasOtherBuiltinClient: (companyId, clientId) =>
      data.clients.some(
        (row) => row.accountId === companyId && row.id !== clientId && row.builtin === true
      ),
  })
  if (
    table === 'allocations' &&
    !options.permissiveRepeatStart &&
    (!existing || existing.resourceId !== clean.resourceId)
  ) {
    const resource = lookup.row('resources', String(clean.resourceId)) as Resource | undefined
    if (resource && typeof clean.startDate === 'string') {
      const effectiveWeek = effectiveWorkingWeek(resource, lookup.accountWorkingDays(accountId))
      if (!effectiveWeekIncludes(effectiveWeek, weekdayOf(clean.startDate)))
        throw new PlanningOperationError(
          400,
          'validation_error',
          'The allocation must start on a working day.'
        )
    }
  }
  if (mode === 'create') {
    await trx.table(TABLE_NAMES[table]).insert(encodeRow(TABLE_NAMES[table], clean))
    ;(data[table] as unknown as Row[]).push(clean as Row)
  } else {
    await trx
      .from(TABLE_NAMES[table])
      .where({ id, account_id: accountId })
      .update(encodeRow(TABLE_NAMES[table], clean))
    Object.assign(existing!, clean)
  }
  return clean
}

/**
 * Validates allowed settings and mutates the supplied complete company state after writing.
 * The caller owns rollback, no-change detection and the refetch/history-clear acknowledgement.
 */
export async function updateSettings(
  trx: TransactionClientContract,
  data: AppData,
  accountId: string,
  changes: Record<string, unknown>,
  capabilities: BatchCapabilities
) {
  if (
    Object.hasOwn(changes, 'capacityOverviewAccess') &&
    !['owner', 'admin'].includes(capabilities.role)
  )
    throw new PlanningOperationError(
      403,
      'authorization_denied',
      'This setting requires an administrator.'
    )
  const existing = existingRow(data, 'accounts', accountId)
  const now = createServerRevision(existing.updatedAt)
  const candidate = { ...existing, ...changes, updatedAt: now }
  const validated = await validateEntityRow('accounts', candidate)
  if (typeof validated.name === 'string') validated.name = cleanText(validated.name)
  await trx.from('accounts').where('id', accountId).update(encodeRow('accounts', validated))
  Object.assign(existing, validated)
}

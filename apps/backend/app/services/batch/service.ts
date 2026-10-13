import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { archive } from '@capacitylens/shared/domain/lifecycle'
import { encodeRow, readStateWithClient } from '#services/state_repository'
import { writeAudit } from '#services/audit'
import { BatchRequestError } from '#services/batch/errors'
import {
  isLifecycle,
  isScoped,
  prepareEntityWrite,
  TABLE_NAMES,
} from '#services/batch/entity_policy'
import { isSameSessionSuccessor, isSuperseded, recordSync } from '#services/batch/sync_ordering'
import type { BatchOp, BatchRevision, SyncOrder } from '#services/batch/types'
import type { BatchDataContext } from '#services/batch/data_policy'
import { SINGLE_COMPANY_CAP_MESSAGE } from '@capacitylens/shared/account/policy'
import { createServerRevision } from '#services/batch/revision'
import { BatchStateProjection } from '#services/batch/projection'
import { allocationAttributionAllowed } from '@capacitylens/shared/lib/integrity'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import { redactPrivateName } from '@capacitylens/shared/domain/privateNames'
import type { BatchCapabilities } from '#services/batch/data_policy'
import { APP_DATA_KEYS, emptyAppData } from '@capacitylens/shared/types/entities'
import type { AppData } from '@capacitylens/shared/types/entities'
import {
  generatedBuiltinReplacementId,
  matchesMintedInternal,
  replaceGeneratedBuiltin,
} from '#services/batch/internal_client'

export interface BatchResult {
  ok: true
  applied: number
  changed: number
  revisions: BatchRevision[]
  archives?: Array<{ table: string; id: string; archived: boolean }>
  superseded?: true
  auditWarning: boolean
}

function appliedRequestedFields(
  requested: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  applied: Record<string, unknown>
) {
  return Object.keys(requested).filter(
    (field) =>
      Object.hasOwn(applied, field) &&
      (existing === undefined || JSON.stringify(existing[field]) !== JSON.stringify(applied[field]))
  )
}

function redactCurrent(
  table: string,
  row: Record<string, unknown>,
  capabilities: BatchCapabilities
) {
  if (table === 'timeOff' && !capabilities.canSeeTimeOffNote) {
    return { ...row, note: null }
  }
  if ((table === 'clients' || table === 'projects') && !capabilities.canSeePrivateNames)
    return redactPrivateName(row as never) as unknown as Record<string, unknown>
  return row
}

function isStaleRevision(existing: Record<string, unknown>, updatedAt: unknown) {
  if (typeof existing.updatedAt !== 'string' || !Number.isFinite(Date.parse(existing.updatedAt)))
    return false
  return (
    typeof updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    Date.parse(updatedAt) < Date.parse(existing.updatedAt)
  )
}

function affectedAccountIds(ops: readonly BatchOp[]) {
  const ids = new Set<string>()
  for (const op of ops) {
    const accountId =
      op.table === 'accounts' ? op.id : op.method === 'PUT' ? op.row.accountId : op.accountId
    if (typeof accountId === 'string' && accountId.length > 0) ids.add(accountId)
  }
  return [...ids]
}

async function readBatchState(trx: TransactionClientContract, ops: readonly BatchOp[]) {
  const data = emptyAppData()
  for (const accountId of affectedAccountIds(ops)) {
    const slice = await readStateWithClient(trx, accountId, true)
    for (const table of APP_DATA_KEYS) data[table].push(...(slice[table] as never[]))
  }
  return data as AppData
}

export async function applyBatch(
  trx: TransactionClientContract,
  ops: BatchOp[],
  syncOrder: SyncOrder | null,
  context: BatchDataContext
): Promise<BatchResult> {
  if (ops.some((op) => op.method === 'DELETE' && op.table === 'accounts'))
    throw new BatchRequestError('Use the dedicated company deletion endpoint.')
  if (ops.length === 0 && syncOrder === null)
    return { ok: true, applied: 0, changed: 0, revisions: [], auditWarning: false }
  if (syncOrder && (await isSuperseded(trx, syncOrder)))
    return {
      ok: true,
      applied: ops.length,
      changed: 0,
      revisions: [],
      archives: [],
      superseded: true,
      auditWarning: false,
    }
  const state = await readBatchState(trx, ops)
  const projection = new BatchStateProjection(state)
  const createdAccountIds = ops
    .filter(
      (op) => op.method === 'PUT' && op.table === 'accounts' && !projection.row('accounts', op.id)
    )
    .map((op) => op.id)
  let persistedAccountIds: string[] = []
  if (createdAccountIds.length > 0 && !context.multiAccount) {
    const persistedAccounts = await trx.from(TABLE_NAMES.accounts).select('id')
    persistedAccountIds = persistedAccounts.map((account) => String(account.id))
  }
  if (
    createdAccountIds.length > 0 &&
    !context.multiAccount &&
    new Set([...persistedAccountIds, ...createdAccountIds]).size > 1
  )
    throw new BatchRequestError(SINGLE_COMPANY_CAP_MESSAGE, 403)
  const revisions: BatchRevision[] = []
  const archives: Array<{ table: string; id: string; archived: boolean }> = []
  const mintedInternalIds = new Set<string>()
  let changed = 0
  for (const op of ops) {
    const existing = projection.row(op.table, op.id)
    const accountId =
      op.table === 'accounts'
        ? op.id
        : String(op.method === 'PUT' ? op.row.accountId : op.accountId)
    const operationContext = { ...context, ...context.capabilitiesFor(accountId) }
    if (!(await context.authorize(accountId, 'write', operationContext)))
      throw new BatchRequestError('Forbidden.', 403)
    if (existing === undefined && isScoped(op.table)) {
      const persisted = await trx
        .from(TABLE_NAMES[op.table])
        .select('account_id')
        .where('id', op.id)
        .first()
      if (persisted && persisted.account_id !== accountId)
        throw new BatchRequestError('Not found.', 404)
    }
    if (op.method === 'PUT') {
      if (op.row.id !== op.id)
        throw new BatchRequestError('Each PUT op needs a row whose id matches the op id.')
      if (op.table === 'clients' && existing?.builtin === true && mintedInternalIds.has(op.id)) {
        if (!matchesMintedInternal(existing, op.row))
          throw new BatchRequestError(
            'The client echoed beside a new company must match its generated Internal client.'
          )
        revisions.push({
          table: op.table,
          id: op.id,
          createdAt: String(existing.createdAt),
          updatedAt: String(existing.updatedAt),
        })
        continue
      }
      if (existing && isStaleRevision(existing, op.row.updatedAt)) {
        const rawCurrent = await trx.from(TABLE_NAMES[op.table]).where('id', op.id).first()
        if (
          !rawCurrent ||
          !syncOrder ||
          !(await isSameSessionSuccessor(trx, syncOrder, op.table, op.id, rawCurrent))
        )
          throw new BatchRequestError(
            'The record was modified more recently on the server.',
            409,
            redactCurrent(op.table, existing, operationContext)
          )
      }
      const generatedReplacementId = generatedBuiltinReplacementId(
        projection,
        op.table,
        op.id,
        op.row,
        existing
      )
      const clean = await prepareEntityWrite(op.table, op.row, existing, state, operationContext, {
        lookup: projection,
        hasOtherBuiltinClient: (companyId, clientId, excludedId) =>
          projection.hasOtherBuiltinClient(companyId, clientId, excludedId),
        ...(generatedReplacementId
          ? { generatedBuiltinReplacementId: generatedReplacementId }
          : {}),
      })
      if (generatedReplacementId)
        await replaceGeneratedBuiltin(trx, projection, generatedReplacementId, clean)
      else {
        await trx
          .table(TABLE_NAMES[op.table])
          .insert(encodeRow(TABLE_NAMES[op.table], clean))
          .onConflict('id')
          .merge()
        projection.upsert(op.table, clean)
      }
      if (op.table === 'accounts' && !existing) {
        const internal = buildInternalClient(op.id, String(clean.createdAt)) as unknown as Record<
          string,
          unknown
        >
        await trx.table(TABLE_NAMES.clients).insert(encodeRow(TABLE_NAMES.clients, internal))
        projection.upsert('clients', internal)
        mintedInternalIds.add(String(internal.id))
      }
      if (op.table === 'activities') {
        projection.reconcileAllocationAttributionForActivity({
          activityId: op.id,
          attributionAllowed: allocationAttributionAllowed(clean.kind),
        })
      }
      revisions.push({
        table: op.table,
        id: op.id,
        createdAt: String(clean.createdAt),
        updatedAt: String(clean.updatedAt),
      })
      await writeAudit(trx, {
        accountId: op.table === 'accounts' ? op.id : String(clean.accountId),
        actorId: context.actorId,
        action: existing ? 'update' : 'create',
        entity: op.table,
        entityId: op.id,
        fields: appliedRequestedFields(op.row, existing, clean),
      })
      changed++
    } else if (op.method === 'ARCHIVE') {
      if (!isLifecycle(op.table))
        throw new BatchRequestError('ARCHIVE is supported only for lifecycle entities.')
      if (existing && existing.accountId !== op.accountId)
        throw new BatchRequestError('Not found.', 404)
      if (!existing) {
        archives.push({ table: op.table, id: op.id, archived: false })
        continue
      }
      if (syncOrder && isStaleRevision(existing, op.updatedAt)) {
        const rawCurrent = await trx.from(TABLE_NAMES[op.table]).where('id', op.id).first()
        if (
          !rawCurrent ||
          !(await isSameSessionSuccessor(trx, syncOrder, op.table, op.id, rawCurrent))
        )
          throw new BatchRequestError(
            'The record was modified more recently on the server.',
            409,
            redactCurrent(op.table, existing, operationContext)
          )
      }
      if (existing.archivedAt || existing.deletedAt) {
        archives.push({ table: op.table, id: op.id, archived: Boolean(existing.archivedAt) })
        continue
      }
      const updatedAt = createServerRevision(existing.updatedAt)
      const row = {
        ...(archive(existing as never, updatedAt) as unknown as Record<string, unknown>),
        updatedAt,
      }
      await trx
        .from(TABLE_NAMES[op.table])
        .where({ id: op.id, account_id: op.accountId })
        .update(encodeRow(TABLE_NAMES[op.table], row))
      projection.upsert(op.table, row)
      archives.push({ table: op.table, id: op.id, archived: true })
      await writeAudit(trx, {
        accountId: op.accountId,
        actorId: context.actorId,
        action: 'archive',
        entity: op.table,
        entityId: op.id,
        fields: ['archivedAt'],
      })
      changed++
    } else {
      if (isLifecycle(op.table))
        throw new BatchRequestError('Use the dedicated lifecycle endpoints for lifecycle entities.')
      if (isScoped(op.table) && typeof op.accountId !== 'string')
        throw new BatchRequestError('A scoped DELETE op needs a string accountId.')
      if (existing && isScoped(op.table) && existing.accountId !== op.accountId)
        throw new BatchRequestError('Not found.', 404)
      if (!existing) continue
      if (isStaleRevision(existing, op.updatedAt)) {
        const rawCurrent = await trx.from(TABLE_NAMES[op.table]).where('id', op.id).first()
        if (
          !rawCurrent ||
          !syncOrder ||
          !(await isSameSessionSuccessor(trx, syncOrder, op.table, op.id, rawCurrent))
        )
          throw new BatchRequestError(
            'The record was modified more recently on the server.',
            409,
            redactCurrent(op.table, existing, operationContext)
          )
      }
      const query = trx.from(TABLE_NAMES[op.table]).where('id', op.id)
      if (isScoped(op.table)) query.where('account_id', op.accountId!)
      await query.delete()
      projection.delete(op.table, op.id)
      await writeAudit(trx, {
        accountId: op.accountId ?? op.id,
        actorId: context.actorId,
        action: 'delete',
        entity: op.table,
        entityId: op.id,
        fields: [],
      })
      changed++
    }
  }
  for (const revision of projection.listRewrittenAllocationRevisions()) {
    const allocation = projection.row('allocations', revision.id)
    if (!allocation) throw new Error('Projected allocation rewrite is missing its final row.')
    await trx
      .from(TABLE_NAMES.allocations)
      .where('id', revision.id)
      .update({ ...encodeRow(TABLE_NAMES.allocations, allocation), project_id: null })
    revisions.push({ ...revision, table: 'allocations', rewrite: true })
  }
  if (syncOrder) await recordSync(trx, syncOrder, ops)
  const result: BatchResult = {
    ok: true,
    applied: ops.length,
    changed,
    revisions,
    archives,
    auditWarning: false,
  }
  trx.after('commit', async () => {
    try {
      await context.logCommitted({ applied: ops.length, changed })
    } catch {
      // Product data is already committed; logging is deliberately best-effort.
      result.auditWarning = true
    }
  })
  return result
}

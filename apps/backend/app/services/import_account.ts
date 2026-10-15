import { createHash } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { AppData } from '@capacitylens/shared/types/entities'
import { APP_DATA_KEYS, SCOPED_KEYS } from '@capacitylens/shared/types/entities'
import { remapAndValidateImport } from '@capacitylens/shared/domain/importFold'
import { MAX_IMPORT_RECORDS } from '@capacitylens/shared/data/transfer'
import { encodeRow, readState, readStateWithClient } from '#services/state_repository'
import { TABLE_NAMES } from '#services/batch/entity_policy'
import { validateEntityRow } from '#validators/entities/index'
import { writeAudit } from '#services/audit'
import { BatchRequestError } from '#services/batch/errors'

const INSERT_ORDER = [
  'clients',
  'disciplines',
  'projects',
  'phases',
  'resources',
  'activities',
  'allocations',
  'timeOff',
  'closures',
] as const
const INSERT_CHUNK_SIZE = 32

const canonical = (value: unknown): string => {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
    .join(',')}}`
}

function fingerprint(data: AppData) {
  const rows = APP_DATA_KEYS.map((key) => [
    key,
    [...data[key]].sort((left, right) => left.id.localeCompare(right.id)),
  ])
  return createHash('sha256').update(canonical(rows)).digest('base64url')
}

async function validatePrepared(data: AppData, accountId: string) {
  for (const key of SCOPED_KEYS) {
    for (const entity of data[key]) {
      const row = entity as unknown as Record<string, unknown>
      if (row.accountId !== accountId) throw new Error('Imported company scope changed')
      await validateEntityRow(key, row)
    }
  }
}

/** Prepare outside the write transaction so an intervening same-company write can be detected. */
export async function prepareAccountImport(accountId: string, incoming: AppData) {
  const current = await readState(accountId, true)
  if (current.accounts.length === 0) throw new BatchRequestError('Company not found.', 404)
  const expectedFingerprint = fingerprint(current)
  const prepared = remapAndValidateImport(current, accountId, incoming, new Date().toISOString())
  if (prepared.imported === 0)
    throw new BatchRequestError(
      'The import contained no usable records, so the company data was left unchanged.',
      400,
      { imported: 0, skipped: prepared.skipped, maxRecords: MAX_IMPORT_RECORDS }
    )
  await validatePrepared(prepared.data, accountId)
  return { accountId, expectedFingerprint, prepared }
}

/** Replace only scheduling rows; control-plane company, membership and joining rows survive. */
export async function commitAccountImport(
  trx: TransactionClientContract,
  { accountId, expectedFingerprint, prepared }: Awaited<ReturnType<typeof prepareAccountImport>>,
  actorId: string
) {
  const latest = await readStateWithClient(trx, accountId, true)
  if (fingerprint(latest) !== expectedFingerprint)
    throw new BatchRequestError(
      'The company data changed while the import was being prepared. Retry the import from the latest data.',
      409,
      undefined,
      'IMPORT_SNAPSHOT_STALE'
    )
  // The association table deliberately has no resource FK, so cleanup belongs to this transaction.
  await trx.from('account_member_resources').where('account_id', accountId).delete()
  for (const key of [...INSERT_ORDER].reverse())
    await trx.from(TABLE_NAMES[key]).where('account_id', accountId).delete()
  for (const key of INSERT_ORDER) {
    const rows = prepared.data[key].filter((row) => row.accountId === accountId)
    for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE)
      await trx
        .table(TABLE_NAMES[key])
        .multiInsert(
          rows
            .slice(offset, offset + INSERT_CHUNK_SIZE)
            .map((row) => encodeRow(TABLE_NAMES[key], row as unknown as Record<string, unknown>))
        )
  }
  await writeAudit(trx, {
    accountId,
    actorId,
    action: 'import',
    entity: 'account',
    entityId: accountId,
    fields: [],
  })
  return {
    imported: prepared.imported,
    skipped: prepared.skipped,
    maxRecords: MAX_IMPORT_RECORDS,
  }
}

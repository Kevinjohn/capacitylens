import { createHash } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import {
  buildBetaExport,
  prepareBetaImport,
  type BetaExportDocument,
} from '@capacitylens/shared/data/betaTransfer'
import { APP_DATA_KEYS, type AppData } from '@capacitylens/shared/types/entities'
import { encodeRow, readStateWithClient } from '#services/state_repository'
import { TABLE_NAMES } from '#services/planning_operations/entity_policy'
import { BatchRequestError } from '#services/planning_operations/errors'
import { getPlanningRevision, advancePlanningRevision } from '#services/planning_revision'
import { writeAudit } from '#services/audit'

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

function fingerprint(data: AppData) {
  const rows = APP_DATA_KEYS.map((key) => [
    key,
    [...data[key]].sort((a, b) => a.id.localeCompare(b.id)),
  ])
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

function portableFingerprint(data: AppData, accountId: string) {
  return fingerprint(buildBetaExport(data, { accountId, completeness: 'full' }).data)
}

async function context(trx: TransactionClientContract, accountId: string) {
  const links = await trx
    .from('account_member_resources')
    .where('account_id', accountId)
    .select('user_id', 'resource_id')
  return {
    accountId,
    memberResourceLinks: links.map((link) => ({
      memberId: String(link.user_id),
      resourceId: String(link.resource_id),
    })),
  }
}

/** Validates one full document against current company links and returns its visible impact. */
export async function previewBetaAccountTransfer(
  trx: TransactionClientContract,
  accountId: string,
  document: BetaExportDocument
) {
  const current = await readStateWithClient(trx, accountId, true)
  if (current.accounts.length !== 1) throw new BatchRequestError('Company not found.', 404)
  const prepared = prepareBetaImport(document, await context(trx, accountId))
  const changed = portableFingerprint(current, accountId) !== fingerprint(prepared.data)
  const baseRevision = await getPlanningRevision(trx, accountId)
  return { baseRevision, imported: prepared.imported, changed }
}

/** Replaces the company slice with stable IDs; the caller owns authorization and proof consumption. */
export async function applyBetaAccountTransfer(
  trx: TransactionClientContract,
  accountId: string,
  document: BetaExportDocument,
  baseRevision: number,
  actorId: string
) {
  const current = await readStateWithClient(trx, accountId, true)
  if (current.accounts.length !== 1) throw new BatchRequestError('Company not found.', 404)
  const revision = await getPlanningRevision(trx, accountId)
  if (revision !== baseRevision)
    throw new BatchRequestError(
      'The company changed. Preview the current data again.',
      409,
      { revision },
      'IMPORT_SNAPSHOT_STALE'
    )
  const prepared = prepareBetaImport(document, await context(trx, accountId))
  if (portableFingerprint(current, accountId) === fingerprint(prepared.data))
    return { imported: prepared.imported, changed: false, revision }

  // Deleting resources sets every pending invitation proposal's resource_id to NULL, and
  // reinserting the same ids does not undo that, so the proposals are restored afterwards.
  const proposals: { id: string; resource_id: string }[] = await trx
    .from('invitation_proposals')
    .join('invitations', 'invitations.id', 'invitation_proposals.invitation_id')
    .where('invitations.account_id', accountId)
    .whereNotNull('invitation_proposals.resource_id')
    .select('invitation_proposals.id as id', 'invitation_proposals.resource_id as resource_id')
  for (const key of [...INSERT_ORDER].reverse())
    await trx.from(TABLE_NAMES[key]).where('account_id', accountId).delete()
  const account = prepared.data.accounts[0]!
  await trx
    .from('accounts')
    .where('id', accountId)
    .update(encodeRow('accounts', account as unknown as Record<string, unknown>))
  for (const key of INSERT_ORDER) {
    const rows = prepared.data[key]
    for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE)
      await trx
        .table(TABLE_NAMES[key])
        .multiInsert(
          rows
            .slice(offset, offset + INSERT_CHUNK_SIZE)
            .map((row) => encodeRow(TABLE_NAMES[key], row as unknown as Record<string, unknown>))
        )
  }
  const importedResourceIds = new Set(prepared.data.resources.map((row) => row.id))
  for (const proposal of proposals)
    if (importedResourceIds.has(proposal.resource_id))
      await trx
        .from('invitation_proposals')
        .where('id', proposal.id)
        .update({ resource_id: proposal.resource_id })
  await trx.from('deleted_groups').where('account_id', accountId).delete()
  await writeAudit(trx, {
    accountId,
    actorId,
    action: 'import',
    entity: 'account',
    entityId: accountId,
    fields: [],
  })
  const nextRevision = await advancePlanningRevision(trx, accountId)
  return { imported: prepared.imported, changed: true, revision: nextRevision }
}

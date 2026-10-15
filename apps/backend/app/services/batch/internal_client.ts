import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { encodeRow } from '#services/state_repository'
import { TABLE_NAMES } from '#services/batch/entity_policy'
import type { BatchStateProjection } from '#services/batch/projection'

export function matchesMintedInternal(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
) {
  const normalized: Record<string, unknown> = {
    ...incoming,
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  }
  const fields = new Set([...Object.keys(existing), ...Object.keys(normalized)])
  return [...fields].every((field) => normalized[field] === existing[field])
}

export function generatedBuiltinReplacementId(
  projection: BatchStateProjection,
  table: string,
  id: string,
  row: Record<string, unknown>,
  existing: Record<string, unknown> | undefined
) {
  if (
    table !== 'clients' ||
    existing !== undefined ||
    row.builtin !== true ||
    typeof row.accountId !== 'string'
  )
    return undefined
  const generatedId = `internal:${row.accountId}`
  if (id === generatedId) return undefined
  return projection.row('clients', generatedId)?.builtin === true ? generatedId : undefined
}

function mutationCount(result: number | unknown[]) {
  return typeof result === 'number' ? result : result.length
}

export async function replaceGeneratedBuiltin(
  trx: TransactionClientContract,
  projection: BatchStateProjection,
  generatedId: string,
  row: Record<string, unknown>
) {
  const accountId = String(row.accountId)
  const unflagged = await trx
    .from(TABLE_NAMES.clients)
    .where({ id: generatedId, account_id: accountId, builtin: JSON.stringify(true) })
    .update({ builtin: null }, ['id'])
  if (mutationCount(unflagged) !== 1)
    throw new Error('Generated Internal client changed during replacement.')
  await trx.table(TABLE_NAMES.clients).insert(encodeRow(TABLE_NAMES.clients, row))
  const projectIds = projection.data.projects
    .filter((project) => project.clientId === generatedId)
    .map((project) => project.id)
  projection.replaceGeneratedBuiltin(generatedId, row)
  for (const projectId of projectIds) {
    const project = projection.row('projects', projectId)
    if (!project) throw new Error('Projected Internal-client project is missing.')
    const reparented = await trx
      .from(TABLE_NAMES.projects)
      .where({ id: projectId, account_id: accountId, client_id: generatedId })
      .update({ client_id: row.id, updated_at: project.updatedAt }, ['id'])
    if (mutationCount(reparented) !== 1)
      throw new Error('Internal-client project changed during replacement.')
  }
  const removed = await trx
    .from(TABLE_NAMES.clients)
    .where({ id: generatedId, account_id: accountId })
    .delete(['id'])
  if (mutationCount(removed) !== 1)
    throw new Error('Generated Internal client changed during replacement.')
}

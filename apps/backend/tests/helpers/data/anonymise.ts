import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import type User from '#models/user'
import { asActor, asDataOwner } from '#tests/helpers/authenticated_data_fixture'
import { fixtureSession } from '#tests/helpers/identities'
import { readPlanningRevision } from '#tests/helpers/data/planning_revision'

const companyId = 'a-studio'

export async function proof(client: ApiClient, cookie: string) {
  const issued = await asDataOwner(client.visit('api.password_confirmations.store'), cookie)
    .json({ action: 'anonymise', companyId, intent: {}, password: 'fixture-password-2026' })
    .send()
  issued.assertStatus(200)
  return (issued.body().data as { confirmationId: string }).confirmationId
}

export async function deleteAllocation(
  client: ApiClient,
  actor: string | User,
  resourceId: string
) {
  const allocation = await db
    .from('allocations')
    .where({ company_id: companyId, resource_id: resourceId })
    .first()
  if (!allocation) throw new Error(`Missing allocation for resource ${resourceId}`)
  const baseRevision = await readPlanningRevision(companyId)
  const mutationId = randomUUID()
  const request = client.visit('api.planning_mutations.store', { companyId })
  const removed = await asActor(request, actor)
    .json({
      mutationId,
      baseRevision,
      // Naming a history makes the delete undoable, so the company holds a history to clear.
      historyId: randomUUID(),
      intent: { operation: 'allocation.delete', id: allocation.id },
    })
    .send()
  removed.assertStatus(200)
  const groupId = (removed.body().data as { restoration: { replacementGroupId: string } })
    .restoration.replacementGroupId
  return { allocation, groupId, mutationId }
}

export async function restoreAllocation(client: ApiClient, cookie: string, groupId: string) {
  const baseRevision = await readPlanningRevision(companyId)
  return asDataOwner(client.visit('api.planning_mutations.store', { companyId }), cookie)
    .json({
      mutationId: randomUUID(),
      baseRevision,
      intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
    })
    .send()
}

export async function insertOtherCompanyRestoration(actorId: string) {
  const groupId = randomUUID()
  const mutationId = randomUUID()
  const sessionId = await fixtureSession(actorId)
  const createdAt = new Date().toISOString()
  const revision = (await readPlanningRevision('a-loft')) + 1
  await db.table('deleted_batches').insert({
    id: groupId,
    company_id: 'a-loft',
    actor_id: actorId,
    account_session_id: sessionId,
    mutation_id: mutationId,
    created_at: createdAt,
    consumed_at: null,
  })
  await db.table('deleted_rows').insert({
    deleted_batch_id: groupId,
    entity: 'allocations',
    row_id: 'fixture-other-company-allocation',
    payload_json: JSON.stringify({ kind: 'row' }),
  })
  await db.table('planning_mutations').insert({
    company_id: 'a-loft',
    mutation_id: mutationId,
    actor_id: actorId,
    revision,
    restoration_group_id: groupId,
    origin_session_id: sessionId,
  })
  await db.from('company_planning_revisions').where('company_id', 'a-loft').update({ revision })
  await db.table('audit_entries').insert({
    id: randomUUID(),
    company_id: 'a-loft',
    actor_id: actorId,
    operation: 'allocation.delete',
    entity: 'planning',
    entity_id: mutationId,
    details: JSON.stringify({ changedFields: ['allocations'] }),
    created_at: createdAt,
    updated_at: createdAt,
  })
  return { groupId, mutationId, revision }
}

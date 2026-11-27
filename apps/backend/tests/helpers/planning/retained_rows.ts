import { randomUUID } from 'node:crypto'
import type { ApiClient, ApiResponse } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import Allocation from '#models/allocation'
import Closure from '#models/closure'
import Discipline from '#models/discipline'
import Phase from '#models/phase'
import TimeOff from '#models/time_off'
import type { PlanningIntent, PlanningMutationSuccess } from '#validators/planning/contracts'
import { readState } from '#tests/helpers/state_fixture'
import { companyId, newAllocation, session } from '#tests/functional/planning/helpers'

export interface SendPlanningOptions {
  client: ApiClient
  cookie: string
  baseRevision: number
  intent: PlanningIntent
}

export async function sendPlanning({ client, cookie, baseRevision, intent }: SendPlanningOptions) {
  const response = await session(
    client.visit('api.planning_mutations.store', { companyId }),
    cookie
  )
    .json({ mutationId: randomUUID(), baseRevision, intent })
    .send()
  // Callers assert 200 before reading success fields; refusal bodies are compared as whole values.
  return response as ApiResponse<{ data: PlanningMutationSuccess }>
}

export async function readPlanningStorage() {
  return {
    allocations: await db.from('allocations').orderBy('id'),
    groups: await db.from('deleted_batches').orderBy('id'),
    rows: await db.from('deleted_rows').orderBy('deleted_batch_id').orderBy('row_id'),
    revisions: await db.from('company_planning_revisions').orderBy('company_id'),
    receipts: await db.from('planning_mutations').orderBy('mutation_id'),
    audit: await db.from('audit_entries').where('entity', 'planning').orderBy('id'),
  }
}

export async function revision() {
  const row = await db.from('company_planning_revisions').where('company_id', companyId).first()
  return Number(row?.revision ?? 0)
}

export async function deleteAllocation(client: ApiClient, cookie: string) {
  const data = await readState(companyId, true)
  const allocation = newAllocation(data)
  const baseRevision = await revision()
  const created = await session(client.visit('api.planning_mutations.store', { companyId }), cookie)
    .json({
      mutationId: randomUUID(),
      baseRevision,
      intent: { operation: 'allocation.create', allocation },
    })
    .send()
  created.assertStatus(200)
  const deleted = await session(client.visit('api.planning_mutations.store', { companyId }), cookie)
    .json({
      mutationId: randomUUID(),
      baseRevision: baseRevision + 1,
      intent: { operation: 'allocation.delete', id: allocation.id },
    })
    .send()
  deleted.assertStatus(200)
  return {
    allocationId: allocation.id,
    groupId: (deleted.body().data as { restoration: { replacementGroupId: string } }).restoration
      .replacementGroupId,
  }
}

export async function deleteExistingAllocation(
  client: ApiClient,
  cookie: string,
  allocationId: string
) {
  const deleted = await session(client.visit('api.planning_mutations.store', { companyId }), cookie)
    .json({
      mutationId: randomUUID(),
      baseRevision: await revision(),
      intent: { operation: 'allocation.delete', id: allocationId },
    })
    .send()
  deleted.assertStatus(200)
  return {
    allocationId,
    groupId: (deleted.body().data as { restoration: { replacementGroupId: string } }).restoration
      .replacementGroupId,
  }
}

export async function restoreAllocation(client: ApiClient, cookie: string, groupId: string) {
  return session(client.visit('api.planning_mutations.store', { companyId }), cookie)
    .json({
      mutationId: randomUUID(),
      baseRevision: await revision(),
      intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
    })
    .send()
}

export async function createActiveAllocation(client: ApiClient, cookie: string) {
  const data = await readState(companyId, true)
  const allocation = newAllocation(data)
  const baseRevision = await revision()
  const created = await session(client.visit('api.planning_mutations.store', { companyId }), cookie)
    .json({
      mutationId: randomUUID(),
      baseRevision,
      intent: { operation: 'allocation.create', allocation },
    })
    .send()
  created.assertStatus(200)
  return allocation.id
}

export const targetTables = {
  allocations: 'allocations',
  timeOff: 'time_off',
  closures: 'closures',
  phases: 'phases',
  disciplines: 'disciplines',
} as const

export type Target = keyof typeof targetTables

export async function deleteTarget(
  client: ApiClient,
  cookie: string,
  target: Target,
  id: string,
  baseRevision: number
) {
  const intents: Record<Target, Record<string, unknown>> = {
    allocations: { operation: 'allocation.delete', id },
    timeOff: { operation: 'timeOff.delete', id },
    closures: { operation: 'closure.delete', id },
    phases: { operation: 'catalogue.delete', entity: { entity: target, id } },
    disciplines: { operation: 'catalogue.delete', entity: { entity: target, id } },
  }
  return session(client.visit('api.planning_mutations.store', { companyId }), cookie)
    .json({ mutationId: randomUUID(), baseRevision, intent: intents[target] } as never)
    .send()
}

export const retainedModels = {
  allocations: Allocation,
  closures: Closure,
  disciplines: Discipline,
  phases: Phase,
  time_off: TimeOff,
} as const

/** Inserts one pending deletion group of `company`, owned by Bruce's session `sessionId`. */
export async function createDeletionGroup(company: string, sessionId: number) {
  const groupId = randomUUID()
  await db.table('deleted_batches').insert({
    id: groupId,
    company_id: company,
    actor_id: 'u-bruce',
    account_session_id: sessionId,
    mutation_id: randomUUID(),
    created_at: new Date().toISOString(),
  })
  return groupId
}

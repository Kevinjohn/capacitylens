import type { ApiClient } from '@japa/api-client'
import { randomUUID } from 'node:crypto'
import { buildCompanyExport, type CompanyExport } from '@capacitylens/shared/data/companyExport'
import { asDataOwner } from '#tests/helpers/authenticated_data_fixture'
import { fixturePassword } from '#tests/helpers/identities'
import { readState } from '#tests/helpers/state_fixture'
import { readPlanningRevision } from '#tests/helpers/data/planning_revision'

const companyId = 'a-studio'

export async function document() {
  return buildCompanyExport(await readState(companyId, true), { companyId, completeness: 'full' })
}

export async function revision() {
  return readPlanningRevision(companyId)
}

export async function deleteForRestoration(
  client: ApiClient,
  cookie: string,
  targetCompanyId = companyId
) {
  const state = await readState(targetCompanyId, true)
  const allocation = state.allocations[0]
  if (!allocation) throw new Error('The restoration fixture has no allocation.')
  const baseRevision = await readPlanningRevision(targetCompanyId)
  const mutationId = randomUUID()
  const response = await asDataOwner(
    client.visit('api.planning_mutations.store', { companyId: targetCompanyId }),
    cookie
  )
    .json({
      mutationId,
      baseRevision,
      // Naming a history makes the delete undoable, so the company holds a history to clear.
      historyId: randomUUID(),
      intent: { operation: 'allocation.delete', id: allocation.id },
    })
    .send()
  response.assertStatus(200)
  const body = response.body().data as {
    restoration: { replacementGroupId: string }
  }
  return { groupId: body.restoration.replacementGroupId, mutationId, allocationId: allocation.id }
}

export async function proof(client: ApiClient, cookie: string, intent: unknown, action = 'import') {
  const result = await asDataOwner(client.visit('api.password_confirmations.store'), cookie)
    // The helper takes any action and intent; each test supplies a valid pair.
    .json({ action, companyId, intent, password: fixturePassword } as never)
    .send()
  result.assertStatus(200)
  return (result.body().data as { confirmationId: string }).confirmationId
}

export async function apply(
  client: ApiClient,
  cookie: string,
  documentValue: CompanyExport,
  baseRevision: number,
  confirmationId?: string
) {
  return asDataOwner(client.visit('api.imports.store'), cookie)
    .json({
      companyId,
      document: documentValue,
      baseRevision,
      ...(confirmationId ? { confirmationId } : {}),
    })
    .send()
}

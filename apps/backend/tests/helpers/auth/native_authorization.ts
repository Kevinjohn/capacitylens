import { randomUUID } from 'node:crypto'
import db from '@adonisjs/lucid/services/db'
import type { ApiClient } from '@japa/api-client'
import env from '#start/env'
import { seed } from '@capacitylens/shared/data/seed'
import { buildCompanyExport } from '@capacitylens/shared/data/companyExport'
import { readState } from '#tests/helpers/state_fixture'
import { createIdentity } from '#tests/helpers/identities'
import { asLoggedInDataOwner } from '#tests/helpers/authenticated_data_fixture'
import User from '#models/user'

export const companyId = 'a-studio'
export const otherCompanyId = 'a-loft'
export const password = 'batman-secret-2026'
export const privateClientName = 'SENTINEL_PRIVATE_CLIENT_NAME'
export const privateProjectName = 'SENTINEL_PRIVATE_PROJECT_NAME'
export const privateTimeOffNote = 'SENTINEL_PRIVATE_TIME_OFF_NOTE'
export const roles = ['viewer', 'editor', 'admin', 'owner'] as const
export const input = (baseRevision: number, intent: Record<string, unknown>) => ({
  mutationId: randomUUID(),
  baseRevision,
  intent,
})
export type Role = (typeof roles)[number]

export function trusted<T extends { header(name: string, value: string): T }>(request: T) {
  return request.header('sec-fetch-site', 'same-origin')
}

export function configureAuth(cleanup: (callback: () => void) => void) {
  const prior = {
    openSignUp: env.get('CAPACITYLENS_ALLOW_OPEN_SIGN_UP'),
    rateLimit: env.get('CAPACITYLENS_RATE_LIMIT'),
  }
  env.set('CAPACITYLENS_ALLOW_OPEN_SIGN_UP', false)
  env.set('CAPACITYLENS_RATE_LIMIT', '0')
  cleanup(() => {
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGN_UP', prior.openSignUp)
    env.set('CAPACITYLENS_RATE_LIMIT', prior.rateLimit ?? '')
  })
}

export async function createMember(role: Role) {
  const email = `wayne-${randomUUID()}@example.test`
  const userId = await createIdentity(email, { password, name: 'Bruce Wayne' })
  const timestamp = new Date().toISOString()
  await db.table('memberships').insert({
    scope_id: companyId,
    user_id: userId,
    role,
    status: 'active',
    created_at: timestamp,
    updated_at: timestamp,
  })
  return { user: await User.findOrFail(userId), userId }
}

export async function setRole(userId: string, role: Role) {
  await db.from('memberships').where({ scope_id: companyId, user_id: userId }).update({ role })
}

export async function stateFor(client: ApiClient, user: User, targetCompanyId = companyId) {
  return asLoggedInDataOwner(
    trusted(client.visit('api.company_state.show').qs({ companyId: targetCompanyId })),
    user
  ).send()
}

export async function currentUser(client: ApiClient, user: User) {
  return asLoggedInDataOwner(trusted(client.visit('api.session.show')), user).send()
}

export async function writeDismissal(
  client: ApiClient,
  user: User,
  body: Record<string, unknown> = { dismissed: true }
) {
  return asLoggedInDataOwner(
    trusted(client.visit('api.getting_started.update', { companyId })),
    user
  )
    .json(body as never)
    .send()
}

export async function importSeed(client: ApiClient, user: User) {
  const document = buildCompanyExport(await readState(companyId, true), {
    companyId,
    completeness: 'full',
  })
  return asLoggedInDataOwner(trusted(client.visit('api.imports.store')), user)
    .json({ companyId, document, baseRevision: 0 })
    .send()
}

export async function anonymiseResource(client: ApiClient, user: User, id: string) {
  return asLoggedInDataOwner(
    trusted(client.visit('api.resource_anonymisations.store', { companyId, id })),
    user
  )
    .json({})
    .send()
}

export async function preparePrivateProjection() {
  const fixture = seed()
  const client = fixture.clients.find((row) => row.companyId === companyId && row.builtin !== true)
  const project = fixture.projects.find((row) => row.companyId === companyId)
  const resource = fixture.resources.find((row) => row.companyId === companyId)
  const timeOff = fixture.timeOff.find((row) => row.companyId === companyId)
  if (!client || !project || !resource || !timeOff)
    throw new Error('Seed data is missing the authorization projection fixture')
  await db
    .from('clients')
    .where({ id: client.id })
    .update({ name: privateClientName, is_private: true, code_name: 'Nightwing' })
  await db
    .from('projects')
    .where({ id: project.id })
    .update({ name: privateProjectName, is_private: true, code_name: 'Aurora' })
  await db.from('time_off').where({ id: timeOff.id }).update({ note: privateTimeOffNote })
  return {
    clientId: client.id,
    projectId: project.id,
    resourceId: resource.id,
    timeOffId: timeOff.id,
  }
}

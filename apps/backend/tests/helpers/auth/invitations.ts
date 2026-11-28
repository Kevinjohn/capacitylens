import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import type User from '#models/user'
import {
  asLoggedInDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture'
import { createIdentity } from '#tests/helpers/identities'

export const companyId = 'a-studio'
export const owner = 'bruce.wayne@wayne.example'
export const invitee = 'clark.kent@wayne.example'
export const password = 'invitation-password-2026'

export async function company() {
  const ownerId = await createIdentity(owner, { name: 'Bruce Wayne' })
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', companyId)
  return ownerId
}

export async function member(email: string, role: 'admin' | 'editor' | 'viewer') {
  const userId = await createIdentity(email)
  const now = new Date().toISOString()
  await db.table('memberships').insert({
    scope_id: companyId,
    user_id: userId,
    role,
    status: 'active',
    created_at: now,
    updated_at: now,
  })
  return userId
}

export const invite = (client: ApiClient, user: User, email: string, role = 'editor') =>
  asLoggedInDataOwner(client.visit('api.invitations.store'), user)
    .timeout({ response: 10000, deadline: 15000 })
    // The role is deliberately untyped so a test can send `owner` and reach the refusal.
    .json({ companyId, email, role } as never)
    .send()

export const accept = (client: ApiClient, token: string, name = 'Clark Kent') =>
  client
    .visit('api.invitation_acceptances.store', { token })
    .header('sec-fetch-site', 'same-origin')
    .json({ name, password })
    .send()

/** The field each error of a framework validation failure names. */
export const failedFields = (body: unknown) =>
  (body as { errors: Array<{ field: string }> }).errors.map(({ field }) => field)

export async function revision() {
  const row = await db.from('company_planning_revisions').where('company_id', companyId).first()
  return Number(row?.revision)
}

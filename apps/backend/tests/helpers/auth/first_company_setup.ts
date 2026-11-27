import type { ApiClient } from '@japa/api-client'
import User from '#models/user'
import { asDataOwner } from '#tests/helpers/authenticated_data_fixture'
import { bootstrapInvitation, rememberSessionCookie } from '#tests/helpers/identities'

export const email = 'bruce.wayne@wayne.example'
export const password = 'company-setup-password-2026'
export const companyTables = [
  'companies',
  'clients',
  'memberships',
  'company_planning_revisions',
  'audit_entries',
]

/** The fresh-install journey: the printed bootstrap link, accepted with a password. */
export async function acceptBootstrap(client: ApiClient) {
  const token = await bootstrapInvitation(email)
  const preview = await client.visit('api.invitation_links.show', { token }).send()
  preview.assertStatus(200)
  const oversized = await client
    .visit('api.invitation_acceptances.store', { token })
    .header('sec-fetch-site', 'same-origin')
    .json({ name: '𐐀'.repeat(101), password })
    .send()
  oversized.assertStatus(422)
  const accepted = await client
    .visit('api.invitation_acceptances.store', { token })
    .header('sec-fetch-site', 'same-origin')
    .json({ name: '𐐀'.repeat(100), password })
    .send()
  accepted.assertStatus(201)
  rememberSessionCookie(accepted)
  const user = await User.findOrFail((accepted.body().data as { user: { id: string } }).user.id)
  return { token, cookie: accepted.cookie('adonis-session')!.value, accepted, user }
}

export async function setUp(client: ApiClient, cookie: string, name = 'Wayne Enterprises') {
  return asDataOwner(client.visit('api.first_company_setup.store'), cookie)
    .json({ name, weekStartsOn: 1, timeZone: 'Etc/GMT' })
    .send()
}

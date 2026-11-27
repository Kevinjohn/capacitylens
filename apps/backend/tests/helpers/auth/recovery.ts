import type { ApiClient, ApiRequest } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import { createFixtureCompanyForOwner } from '#tests/helpers/authenticated_data_fixture'
import { createIdentity } from '#tests/helpers/identities'

export const companyId = 'a-studio'
export const owner = 'bruce.wayne@wayne.example'
export const editor = 'clark.kent@wayne.example'
export const newPassword = 'recovered-password-2026'

export const post = (request: ApiRequest, body: object) =>
  request.header('sec-fetch-site', 'same-origin').json(body).send()

export const requestReset = (client: ApiClient, email: string) =>
  post(client.visit('api.password_reset_requests.store'), { email })

export const inspect = async (client: ApiClient, token: string) => {
  const response = await post(client.visit('api.password_resets.show'), { token })
  response.assertStatus(200)
  return ((response.body() as { data: unknown }).data as { valid: boolean }).valid
}

export async function company() {
  const ownerId = await createIdentity(owner, { name: 'Bruce Wayne' })
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', companyId)
  const editorId = await createIdentity(editor, { name: 'Clark Kent' })
  const now = new Date().toISOString()
  await db.table('memberships').insert({
    scope_id: companyId,
    user_id: editorId,
    role: 'editor',
    status: 'active',
    created_at: now,
    updated_at: now,
  })
  return { ownerId, editorId }
}

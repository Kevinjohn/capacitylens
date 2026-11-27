import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture'
import { signUpAndIn } from '#tests/helpers/identities'
import { password, userIdByEmail } from '#tests/helpers/membership/members'

/** The field each error of a framework validation failure names. */
export const failedFields = (body: unknown) =>
  (body as { errors: Array<{ field: string }> }).errors.map(({ field }) => field)

/** Signs up an Owner of `a-studio` and an Admin in it, each with a real sign-in cookie. */
export async function ownershipFixture(client: ApiClient) {
  const owner = await signUpAndIn(client, {
    email: 'bruce.wayne@wayne.example',
    password,
    name: 'Bruce Wayne',
  })
  owner.assertStatus(200)
  const ownerCookie = owner.cookie('adonis-session')!.value
  const ownerId = await userIdByEmail('bruce.wayne@wayne.example')
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio')
  const admin = await signUpAndIn(client, {
    email: 'clark.kent@wayne.example',
    password,
    name: 'Clark Kent',
  })
  admin.assertStatus(200)
  const adminCookie = admin.cookie('adonis-session')!.value
  const adminId = await userIdByEmail('clark.kent@wayne.example')
  const now = new Date().toISOString()
  await db.table('memberships').insert({
    scope_id: 'a-studio',
    user_id: adminId,
    role: 'admin',
    status: 'active',
    created_at: now,
    updated_at: now,
  })
  return { ownerId, adminId, ownerCookie, adminCookie, now }
}

/** Confirms the password for a transfer of `a-studio` to `toUserId` and returns the proof id. */
export async function transferProof(client: ApiClient, cookie: string, toUserId: string) {
  const result = await asDataOwner(client.visit('api.password_confirmations.store'), cookie)
    .header('sec-fetch-site', 'same-origin')
    .json({ action: 'transfer-ownership', companyId: 'a-studio', intent: { toUserId }, password })
    .send()
  result.assertStatus(200)
  return (result.body().data as { confirmationId: string }).confirmationId
}

import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import type { Role } from '@capacitylens/shared/domain/access'
import {
  authenticatedDataClient,
  resetAuthenticatedData,
  seedDataOwner,
} from '#tests/helpers/authenticated_data_fixture'
import { loggedInDataClient } from '#tests/helpers/data/logged_in_client'

/** Every company role, from most to least access. */
export const roles: Role[] = ['owner', 'admin', 'editor', 'viewer']

/** Marks a request as coming from the app's own origin. */
export const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

/** Resets the data and returns a client carrying the Owner's real sign-in cookie. */
export async function resetCookieDataOwner(client: ApiClient, seeded = true) {
  const session = await resetAuthenticatedData(client, seeded)
  return {
    client: authenticatedDataClient(client, session.cookie),
    userId: session.userId,
    cookie: session.cookie,
  }
}

/** Resets the seeded data and returns a client signed in as the Owner with `loginAs`. */
export async function resetLoggedInDataOwner(client: ApiClient, seeded: boolean | 'single' = true) {
  const user = await seedDataOwner(seeded)
  return { client: loggedInDataClient(client, user), userId: user.id }
}

/** Archives one a-studio resource so that only an Owner or Admin export carries it. */
export async function archiveResource() {
  const candidate = await db.from('resources').where('company_id', 'a-studio').first()
  await db
    .from('resources')
    .where('id', candidate.id)
    .update({ archived_at: new Date().toISOString() })
  return String(candidate.id)
}

/** Gives `userId` the role `role` in a company. */
export async function setRole(userId: string, role: Role, companyId = 'a-studio') {
  await db.from('memberships').where({ user_id: userId, scope_id: companyId }).update({ role })
}

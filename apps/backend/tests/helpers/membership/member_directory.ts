import db from '@adonisjs/lucid/services/db'
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture'
import { createIdentity, signUpAndIn } from '#tests/helpers/identities'
import { password, userIdByEmail } from '#tests/helpers/membership/members'

export const directoryCompanyId = 'member-directory-storage'
const ownerEmail = 'bruce.wayne@wayne.example'
const memberEmail = 'clark.kent@wayne.example'
export const directoryStamp = '2026-10-20T12:00:00.000Z'

export interface CorruptionCase {
  label: string
  invalidValue: string
  checkMessage: string
  column: 'role' | 'status'
  validValue: string
}

export const corruptions: CorruptionCase[] = [
  {
    label: 'membership role',
    invalidValue: 'invalid-role-sentinel',
    checkMessage: 'Membership has an invalid role.',
    column: 'role',
    validValue: 'editor',
  },
  {
    label: 'membership status',
    invalidValue: 'invalid-status-sentinel',
    checkMessage: 'Membership has an invalid status.',
    column: 'status',
    validValue: 'active',
  },
]

export function readDirectoryMemberEntry(body: unknown, userId: string) {
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    !('members' in body) ||
    !Array.isArray(body.members)
  ) {
    throw new Error('Member directory response is missing its member list.')
  }
  return body.members.find(
    (member: unknown): member is Record<string, unknown> =>
      typeof member === 'object' &&
      member !== null &&
      !Array.isArray(member) &&
      'userId' in member &&
      member.userId === userId
  )
}

export async function memberDirectoryFixture(client: Parameters<typeof signUpAndIn>[0]) {
  const owner = await signUpAndIn(client, { email: ownerEmail, password, name: 'Bruce Wayne' })
  owner.assertStatus(200)
  const ownerCookie = owner.cookie('adonis-session')?.value
  if (!ownerCookie) throw new Error('Owner sign-in did not create a session cookie.')
  const ownerId = await userIdByEmail(ownerEmail)
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', directoryCompanyId)
  const memberId = await createIdentity(memberEmail, { name: 'Clark Kent', password })
  await db.transaction(async (trx) => {
    await trx.table('memberships').insert({
      scope_id: directoryCompanyId,
      user_id: memberId,
      role: 'editor',
      status: 'active',
      created_at: directoryStamp,
      updated_at: directoryStamp,
    })
  })
  const contextResponse = await asDataOwner(client.visit('api.masquerade.show'), ownerCookie).send()
  contextResponse.assertStatus(200)
  const contextBody: unknown = contextResponse.body()!.data
  const masqueradeToken =
    typeof contextBody === 'object' &&
    contextBody !== null &&
    !Array.isArray(contextBody) &&
    'masqueradeToken' in contextBody
      ? contextBody.masqueradeToken
      : undefined
  if (typeof masqueradeToken !== 'string' || !masqueradeToken) {
    throw new Error('Owner masquerade context did not include a request token.')
  }
  return { ownerCookie, ownerId, memberId, masqueradeToken }
}

export interface OwnerGetInput {
  client: Parameters<typeof signUpAndIn>[0]
  ownerCookie: string
  masqueradeToken: string
}

export function ownerGet({ client, ownerCookie, masqueradeToken }: OwnerGetInput) {
  return client
    .visit('api.members.index', { companyId: directoryCompanyId })
    .setup((prepared) => {
      prepared.withCookie('adonis-session', ownerCookie)
    })
    .header('sec-fetch-site', 'same-origin')
    .header('X-Masquerade-Context', masqueradeToken)
}

export async function writeCorruption(corruption: CorruptionCase, memberId: string) {
  await db.transaction(async (trx) => {
    await trx
      .from('memberships')
      .where({ scope_id: directoryCompanyId, user_id: memberId })
      .update({ [corruption.column]: corruption.invalidValue })
  })
}

export async function readProductState() {
  return {
    memberships: await db.from('memberships').where('scope_id', directoryCompanyId).orderBy('id'),
    settings: await db
      .from('company_settings')
      .where('company_id', directoryCompanyId)
      .orderBy('key'),
    revision: await db
      .from('company_planning_revisions')
      .where('company_id', directoryCompanyId)
      .orderBy('company_id'),
    audit: await db.from('audit_entries').where('company_id', directoryCompanyId).orderBy('id'),
    receipts: await db.from('request_receipts').where('scope_id', directoryCompanyId).orderBy('id'),
  }
}

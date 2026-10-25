import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { createFixtureCompanyForOwner } from '../../helpers/authenticated_data_fixture.js'
import { resetState } from '#services/state_repository'
import { signUpAndIn } from '../../helpers/identities.js'

const password = 'batman-secret-2026'
const withSession = <
  T extends {
    setup(callback: (request: T) => void): T
    withCookie(name: string, value: string): T
  },
>(
  request: T,
  cookie: string
) =>
  request.setup((prepared) => {
    prepared.withCookie('adonis-session', cookie)
  })

test.group('direct member resource association', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('account_admissions').delete()
    await db.from('account_invitations').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('direct links enforce company, person, occupancy and current-revision constraints', async ({
    client,
  }) => {
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      name: 'Bruce Wayne',
      password,
    })
    owner.assertStatus(200)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const ownerId = (owner.body() as { user: { id: string } }).user.id
    await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio')
    const now = new Date().toISOString()
    await db.table('accounts').insert({
      id: 'a-loft',
      name: 'Stark Industries',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    })
    const person = (id: string, accountId: string, kind = 'person') => ({
      id,
      account_id: accountId,
      kind,
      name: id,
      role: 'Designer',
      employment_type: 'permanent',
      engagement: 'studio',
      working_hours_per_day: 8,
      working_days: '[1,2,3,4,5]',
      half_days: '[]',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    })
    await db
      .table('resources')
      .insert([
        person('r-clark', 'a-studio'),
        person('r-barry', 'a-studio'),
        person('r-external', 'a-studio', 'external'),
        person('r-stark', 'a-loft'),
      ])
    const put = (userId: string, resourceId: string, expectedRevision: string | null) =>
      withSession(
        client
          .put(`/api/accounts/a-studio/members/${userId}/resource-link`)
          .header('sec-fetch-site', 'same-origin'),
        ownerCookie
      )
        .json({ resourceId, expectedRevision })
        .send()
    const outside = await put(ownerId, 'r-stark', null)
    outside.assertStatus(409)
    const wrongKind = await put(ownerId, 'r-external', null)
    wrongKind.assertStatus(409)
    const linked = await put(ownerId, 'r-clark', null)
    linked.assertStatus(200)
    const revision = (linked.body() as { revision: string }).revision
    const stale = await put(ownerId, 'r-barry', null)
    stale.assertStatus(409)
    await db.from('resources').where('id', 'r-clark').update({ archived_at: now })
    const archivedCurrent = await put(ownerId, 'r-barry', revision)
    archivedCurrent.assertStatus(409)
    const cleared = await withSession(
      client
        .delete(`/api/accounts/a-studio/members/${ownerId}/resource-link`)
        .header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ expectedRevision: revision })
      .send()
    cleared.assertStatus(204)
    const second = await put(ownerId, 'r-barry', null)
    second.assertStatus(200)
    const otherId = crypto.randomUUID()
    await db.table('users').insert({
      id: otherId,
      email: 'barry.allen@wayne.example',
      email_verified_at: new Date().toISOString(),
      display_name: 'Barry Allen',
      created_at: now,
      updated_at: now,
    })
    await db.table('memberships').insert({
      id: crypto.randomUUID(),
      account_id: 'a-studio',
      user_id: otherId,
      role: 'viewer',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const occupied = await put(otherId, 'r-barry', null)
    occupied.assertStatus(409)
  })
})

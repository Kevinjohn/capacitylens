import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import {
  accountId,
  planningUrl,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  signIn,
} from './helpers.js'

function commandHeaders() {
  return {
    'x-account-command-id': randomUUID(),
    'idempotency-key': randomUUID(),
  }
}

test.group('admission changes and planning revisions', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('policy and pending invitation changes preserve an in-progress planning draft', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await signIn(client)
    const before = await session(client.get(planningUrl), cookie).send()
    before.assertStatus(200)
    assert.equal(before.body().revision, 0)
    const allocation = newAllocation(before.body().data)
    const draft = {
      mutationId: randomUUID(),
      baseRevision: before.body().revision,
      intent: { operation: 'allocation.create', allocation },
    }

    const policy = await session(client.put(`/api/accounts/${accountId}/joining-policy`), cookie)
      .headers(commandHeaders())
      .json({ policy: 'open', approvedDomains: [] })
      .send()
    policy.assertStatus(200)

    const created = await session(client.post('/api/invites'), cookie)
      .headers(commandHeaders())
      .json({
        accountId,
        role: 'viewer',
        preauthEmail: 'clark.kent@wayne.example',
      })
      .send()
    created.assertStatus(201)
    const invitationId = (created.body() as { id: string }).id

    const revoked = await session(
      client.delete(`/api/accounts/${accountId}/invites/${invitationId}`),
      cookie
    )
      .headers(commandHeaders())
      .send()
    revoked.assertStatus(204)

    const afterAdmissionChanges = await session(client.get(planningUrl), cookie).send()
    afterAdmissionChanges.assertStatus(200)
    assert.equal(afterAdmissionChanges.body().revision, 0)
    assert.equal(afterAdmissionChanges.body().authority.actorId, userId)
    assert.deepEqual(afterAdmissionChanges.body().authority, before.body().authority)
    assert.deepEqual(afterAdmissionChanges.body().data, before.body().data)

    const committed = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
      .json(draft)
      .send()
    committed.assertStatus(200)
    assert.equal(committed.body().revision, 1)
    assert.equal(committed.body().status, 'committed')
  })

  test('accepting an invitation still advances the planning revision', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const created = await session(client.post('/api/invites'), cookie)
      .headers(commandHeaders())
      .json({
        accountId,
        role: 'viewer',
        preauthEmail: 'clark.kent@wayne.example',
      })
      .send()
    created.assertStatus(201)

    const accepted = await client
      .post(`/api/invites/${(created.body() as { token: string }).token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .headers(commandHeaders())
      .json({
        name: 'Clark Kent',
        email: 'clark.kent@wayne.example',
        password: 'superman-secret-2026',
      })
      .send()
    accepted.assertStatus(201)

    const planning = await session(client.get(planningUrl), cookie).send()
    planning.assertStatus(200)
    assert.equal(planning.body().revision, 1)
    assert.equal(
      await db
        .from('memberships')
        .where({ account_id: accountId })
        .count('* as total')
        .first()
        .then((row) => Number(row?.total)),
      2
    )
  })
})

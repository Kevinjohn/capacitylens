import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { readState } from '#services/state_repository'
import { accountId, configureAuth, resetPlanningFixture, session, signIn } from './helpers.js'

test.group('typed company calendar settings', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('initialises each frozen field once and refuses later changes without advancing revision', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    let revision = 0
    for (const [field, initial, replacement] of [
      ['weekStartsOn', 0, 1],
      ['timezone', 'Europe/London', 'UTC'],
    ] as const) {
      const path = `/api/accounts/${accountId}/settings`
      const first = await session(client.patch(path), cookie)
        .json({
          mutationId: randomUUID(),
          baseRevision: revision,
          intent: { operation: 'settings.update', changes: { [field]: initial } },
        })
        .send()
      first.assertStatus(200)
      revision += 1
      const before = await readState(accountId, true)
      const refused = await session(client.patch(path), cookie)
        .json({
          mutationId: randomUUID(),
          baseRevision: revision,
          intent: { operation: 'settings.update', changes: { [field]: replacement } },
        })
        .send()
      refused.assertStatus(409)
      assert.deepEqual(await readState(accountId, true), before)
      const planning = await session(
        client.get(`/api/accounts/${accountId}/planning`),
        cookie
      ).send()
      planning.assertStatus(200)
      assert.equal(planning.body().revision, revision)
    }
  })
})

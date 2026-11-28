import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { readState } from '#tests/helpers/state_fixture'
import {
  companyId,
  configureAuth,
  resetPlanningFixture,
  session,
  loginAsMember,
} from '#tests/helpers/planning/functional_helpers'

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
    const { cookie } = await loginAsMember()
    let revision = 0
    for (const [field, initial, replacement] of [
      ['weekStartsOn', 0, 1],
      ['timezone', 'Europe/London', 'UTC'],
    ] as const) {
      const first = await session(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json({
          mutationId: randomUUID(),
          baseRevision: revision,
          intent: { operation: 'settings.update', changes: { [field]: initial } },
        })
        .send()
      first.assertStatus(200)
      revision += 1
      const before = await readState(companyId, true)
      const refused = await session(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json({
          mutationId: randomUUID(),
          baseRevision: revision,
          intent: { operation: 'settings.update', changes: { [field]: replacement } },
        })
        .send()
      refused.assertStatus(409)
      assert.deepEqual(await readState(companyId, true), before)
      const planning = await session(
        client.visit('api.planning.show', { companyId }),
        cookie
      ).send()
      planning.assertStatus(200)
      assert.equal(planning.body().data.revision, revision)
    }
  })
})

import { test } from '@japa/runner'
import { seed } from '@capacitylens/shared/data/seed'
import Resource from '#models/resource'
import { rowAttributes } from '#services/models/row_attributes'
import { insertProductRows } from '#tests/helpers/product_rows'
import { readState } from '#tests/helpers/state_fixture'
import { transactionalDatabase } from '#tests/helpers/transactional_database'

test.group('data contract', (group) => {
  transactionalDatabase(group)
  test('returns explicit null from a persisted optional column', async ({ assert }) => {
    const data = seed()
    const company = data.companies[0]!
    await insertProductRows('companies', [company])
    const state = await readState(company.id, true)
    assert.property(state.companies[0], 'timezone')
    assert.isNull(state.companies[0]?.timezone)
  })
  test('writes explicit null for a cleared optional field', ({ assert }) => {
    const data = seed()
    const resource = data.resources[0]!
    const attributes = rowAttributes(Resource, { ...resource, avatarUrl: null })
    assert.property(attributes, 'avatarUrl')
    assert.isNull(attributes.avatarUrl)
  })
})

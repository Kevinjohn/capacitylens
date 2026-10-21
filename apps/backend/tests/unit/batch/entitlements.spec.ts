import { test } from '@japa/runner'
import { resolveEntitlements } from '#services/entitlements'

test.group('M2a entitlements', () => {
  test('keeps every company unlimited under the current product contract', ({ assert }) => {
    assert.deepEqual(resolveEntitlements('a-studio'), { unlimited: true })
    assert.deepEqual(resolveEntitlements('arbitrary-company'), { unlimited: true })
  })
})

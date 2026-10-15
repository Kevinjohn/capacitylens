import { test } from '@japa/runner'
import { createServerRevision } from '#services/batch/revision'

test.group('batch server revisions', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z')

  test('advances a canonical timestamp by one millisecond when the clock is behind', ({
    assert,
  }) => {
    assert.equal(createServerRevision('2098-01-01T00:00:00.000Z', now), '2098-01-01T00:00:00.001Z')
  })

  test('advances non-canonical ISO timestamps by chronology', ({ assert }) => {
    assert.equal(createServerRevision('2098-01-01T01:00:00+01:00', now), '2098-01-01T00:00:00.001Z')
    assert.equal(createServerRevision('2098-01-01T00:00:00Z', now), '2098-01-01T00:00:00.001Z')
  })

  test('uses the bounded clock after malformed or out-of-domain revisions', ({ assert }) => {
    const expected = new Date(now).toISOString()
    for (const value of [
      undefined,
      null,
      'yesterday',
      '9999-12-31T23:59:59.999Z',
      '+010000-01-01T00:00:00.000Z',
      '+275760-09-13T00:00:00.000Z',
      '2026-02-30T12:00:00.000Z',
      '2026-04-31T00:00:00.000Z',
    ]) {
      assert.equal(createServerRevision(value, now), expected)
    }
  })
})

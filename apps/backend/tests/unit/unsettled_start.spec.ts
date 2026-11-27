import { test } from '@japa/runner'
import { runUnsettledEntry } from '#tests/helpers/unit/entry_points'

test.group('unsettled start', () => {
  test('a start that never settles ends the process with exit 1 and says why', ({ assert }) => {
    const result = runUnsettledEntry('new Promise(() => {})')
    assert.isNull(result.signal, result.stderr)
    assert.equal(result.status, 1, result.stderr)
    assert.include(result.stderr, 'The probe stopped before the application started')
  })

  test('a start that settles keeps its own exit code', ({ assert }) => {
    const result = runUnsettledEntry('Promise.resolve()')
    assert.isNull(result.signal, result.stderr)
    assert.equal(result.status, 0, result.stderr)
    assert.notInclude(result.stderr, 'stopped before the application started')
  })
})

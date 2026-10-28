import { test } from '@japa/runner'
import { resolveCorsOrigins, isTrustedUnsafeOrigin } from '#services/cors_policy'

test('CORS uses finite development origins and no production cross-origin defaults', ({
  assert,
}) => {
  assert.lengthOf(resolveCorsOrigins(undefined, 'development'), 4)
  assert.deepEqual(resolveCorsOrigins(undefined, 'production'), [])
  assert.deepEqual(resolveCorsOrigins('https://wayne.example', 'production'), [
    'https://wayne.example',
  ])
  for (const invalid of ['*', 'https://wayne.example/path', 'https://user@wayne.example'])
    assert.throws(() => resolveCorsOrigins(invalid, 'production'))
  assert.isTrue(
    isTrustedUnsafeOrigin({
      origin: 'https://wayne.example',
      host: 'wayne.example',
      protocol: 'https',
    })
  )
  assert.isFalse(
    isTrustedUnsafeOrigin({
      origin: 'https://evil.example',
      host: 'wayne.example',
      protocol: 'https',
    })
  )
})

import { test } from '@japa/runner'
import hash from '@adonisjs/core/services/hash'

test.group('password hash configuration', () => {
  test('creates hashes with at least the OWASP minimum scrypt profile', async ({ assert }) => {
    const encoded = await hash.make('batman-secret-2026')
    const parameters = encoded.match(/^\$scrypt\$n=(\d+),r=(\d+),p=(\d+)\$/)

    assert.isNotNull(parameters)
    assert.isAtLeast(Number(parameters?.[1]), 2 ** 14)
    assert.equal(Number(parameters?.[2]), 8)
    assert.isAtLeast(Number(parameters?.[3]), 5)
    assert.isFalse(hash.needsReHash(encoded))
  })
})

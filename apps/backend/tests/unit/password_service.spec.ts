import { test } from '@japa/runner'
import {
  hashPassword,
  PasswordProcessingUnavailableError,
  verifyPassword,
} from '#services/password_service'
import { runWithPasswordAbortSignal } from '#services/password_work_queue'

test('password hashes use the product scrypt profile and preserve the exact password bytes', async ({
  assert,
}) => {
  const password = '🔐'.repeat(128)
  const encoded = await hashPassword(password)

  assert.match(encoded, /^scrypt\$N=131072,r=8,p=1\$/)
  assert.isTrue(await verifyPassword(encoded, password))
  assert.isFalse(await verifyPassword(encoded, `${password} `))
  assert.isFalse(await verifyPassword(encoded, '🔐'.repeat(127) + 'e\u0301'))
})

test('malformed and over-ceiling stored hashes are credential non-matches', async ({ assert }) => {
  const cases = [
    '',
    'not-a-hash',
    'scrypt$N=268435456,r=8,p=1$c2FsdA$' + 'AA'.repeat(64),
    'scrypt$N=131072,r=16,p=1$c2FsdA$' + 'AA'.repeat(64),
    'scrypt$N=131072,r=8,p=2$c2FsdA$' + 'AA'.repeat(64),
    'scrypt$N=131072,r=8,p=1$c2FsdA$AA',
    `scrypt$N=${'9'.repeat(300)},r=8,p=1$c2FsdA$${'A'.repeat(86)}`,
  ]

  for (const encoded of cases) assert.isFalse(await verifyPassword(encoded, 'a valid password'))
})

test('password derivation admits two active and sixteen queued operations', async ({ assert }) => {
  const admitted = Array.from({ length: 18 }, (_, index) => hashPassword(`admitted-${index}`))
  await assert.rejects(() => hashPassword('overflow'), PasswordProcessingUnavailableError)
  await Promise.all(admitted)
})

test('cancelling a queued derivation removes it while active work remains bounded', async ({
  assert,
}) => {
  const active = [hashPassword('active-one'), hashPassword('active-two')]
  const controller = new AbortController()
  const queued = runWithPasswordAbortSignal(controller.signal, () => hashPassword('cancelled'))
  controller.abort()

  await assert.rejects(() => queued, PasswordProcessingUnavailableError)
  await Promise.all(active)
})

import { test } from '@japa/runner'
import { signInValidator, signUpValidator } from '#validators/auth_requests'
import { admissionQueryValidator } from '#validators/admission_query'

test.group('ordinary request validator normalization', () => {
  test('normalizes account email without adding password transformations', async ({ assert }) => {
    const password = '  krypton-password-2026  '
    assert.deepEqual(
      await signInValidator.validate({ email: ' Clark.Kent@Wayne.example ', password }),
      {
        email: 'clark.kent@wayne.example',
        password,
      }
    )
    assert.deepEqual(
      await signUpValidator.validate({
        email: ' Clark.Kent@Wayne.example ',
        password,
        name: '  Clark Kent  ',
      }),
      {
        email: 'clark.kent@wayne.example',
        password,
        name: 'Clark Kent',
      }
    )
  })

  test('retains the email-shape policy instead of adopting deliverability validation', async ({
    assert,
  }) => {
    const input = { email: 'CLARK@WAYNE', password: '' }
    assert.deepEqual(await signInValidator.validate(input), { email: 'clark@wayne', password: '' })
    await assert.rejects(() =>
      signInValidator.validate({ email: 'clark\u0000@wayne', password: '' })
    )
  })

  test('bounds names and opaque cursors by code units', async ({ assert }) => {
    const credentials = { email: 'clark@wayne.example', password: '😀'.repeat(15) }
    const allowed = await signUpValidator.validate({ ...credentials, name: '😀'.repeat(50) })
    assert.equal(allowed.name.length, 100)
    await assert.rejects(() => signUpValidator.validate({ ...credentials, name: '😀'.repeat(51) }))
    assert.deepEqual(
      await admissionQueryValidator.validate({ cursor: '😀'.repeat(256), extra: true }),
      { cursor: '😀'.repeat(256) }
    )
    await assert.rejects(() => admissionQueryValidator.validate({ cursor: '😀'.repeat(257) }))
  })
})

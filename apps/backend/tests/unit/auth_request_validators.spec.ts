import { test } from '@japa/runner'
import { signInValidator, signUpValidator } from '#validators/auth_requests'
import { admissionQueryValidator } from '#validators/admission_query'

test.group('ordinary request validator normalization', () => {
  test('normalizes account email without adding password transformations', async ({ assert }) => {
    const password = '  krypton-password-2026  '
    assert.deepEqual(
      await signInValidator.validate({
        email: ' Clark.Kent@Wayne.example ',
        password,
        headers: {},
      }),
      {
        email: 'clark.kent@wayne.example',
        password,
        headers: {},
      }
    )
    assert.deepEqual(
      await signUpValidator.validate({
        email: ' Clark.Kent@Wayne.example ',
        password,
        name: '  Clark Kent  ',
        headers: {},
      }),
      {
        email: 'clark.kent@wayne.example',
        password,
        name: 'Clark Kent',
        headers: {},
      }
    )
  })

  test('retains the email-shape rules instead of adopting deliverability validation', async ({
    assert,
  }) => {
    const input = { email: 'CLARK@WAYNE', password: '', headers: {} }
    assert.deepEqual(await signInValidator.validate(input), {
      email: 'clark@wayne',
      password: '',
      headers: {},
    })
    await assert.rejects(() =>
      signInValidator.validate({ email: 'clark\u0000@wayne', password: '', headers: {} })
    )
  })

  test('bounds names by code points and opaque cursors by code units', async ({ assert }) => {
    const credentials = { email: 'clark@wayne.example', password: '😀'.repeat(15), headers: {} }
    const allowed = await signUpValidator.validate({ ...credentials, name: '😀'.repeat(100) })
    assert.equal([...allowed.name].length, 100)
    await assert.rejects(() => signUpValidator.validate({ ...credentials, name: '😀'.repeat(101) }))
    assert.deepEqual(
      await admissionQueryValidator.validate({ cursor: '😀'.repeat(256), extra: true }),
      { cursor: '😀'.repeat(256) }
    )
    await assert.rejects(() => admissionQueryValidator.validate({ cursor: '😀'.repeat(257) }))
  })
})

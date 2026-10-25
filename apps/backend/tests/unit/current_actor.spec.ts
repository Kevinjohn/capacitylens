import { test } from '@japa/runner'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import { InvalidSessionError } from 'adonisjs-account-kit/errors'
import { accountInput } from '#services/auth/current_actor'

function contextWhoseGuardThrows(error: Error) {
  return {
    auth: {
      use: () => ({
        authenticate: async () => {
          throw error
        },
      }),
    },
    session: { get: () => undefined },
  } as unknown as HttpContext
}

test.group('accountInput', () => {
  test('a rejected session is a sign-out', async ({ assert }) => {
    const rejected = new authErrors.E_UNAUTHORIZED_ACCESS('Unauthorized access', {
      guardDriverName: 'session',
    })
    await assert.rejects(() => accountInput(contextWhoseGuardThrows(rejected)), InvalidSessionError)
  })

  test('a database fault while reading the session surfaces unchanged', async ({ assert }) => {
    const fault = new Error('SQLITE_BUSY: database is locked')
    await assert.rejects(
      () => accountInput(contextWhoseGuardThrows(fault)),
      'SQLITE_BUSY: database is locked'
    )
  })
})

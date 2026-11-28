import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import db from '@adonisjs/lucid/services/db'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { resetState } from '#tests/helpers/state_fixture'
import { outsider, refusals } from '#tests/helpers/auth/company_scope'

test.group('company scope middleware', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('account_admissions').delete()
    await db.from('adonis_sessions').delete()
    await db.from('memberships').delete()
    await db.from('users').delete()
  })

  test('refuses a non-member and a suspended member with the route’s usual refusal', async ({
    client,
    assert,
    db: dbAssert,
  }) => {
    const { user, userId } = await outsider(client)
    const expectRefused = async () => {
      const { company, planning } = await refusals(client, user)
      company.assertStatus(403)
      assert.deepEqual(company.body(), {
        error: 'Forbidden.',
        code: 'E_IDENTITY_AUTHORIZATION_DENIED',
      })
      planning.assertStatus(403)
      assert.deepEqual(planning.body(), {
        error: 'Company membership is unavailable.',
        code: 'E_ACCOUNT_MEMBERSHIP_LOST',
      })
    }
    await expectRefused()

    const now = new Date().toISOString()
    await db.table('memberships').insert({
      scope_id: 'a-studio',
      user_id: userId,
      role: 'admin',
      status: 'suspended',
      created_at: now,
      updated_at: now,
    })
    await expectRefused()
    await dbAssert.assertMissing('company_getting_started_dismissals', { company_id: 'a-studio' })
  })

  test('every route with a company id in its path carries the company scope', ({ assert }) => {
    const unscoped = Object.values(router.toJSON())
      .flat()
      .filter((route) => route.pattern.includes(':companyId'))
      .filter(
        (route) =>
          ![...route.middleware.all()].some(
            (entry) => typeof entry === 'object' && 'name' in entry && entry.name === 'companyScope'
          )
      )
      .map((route) => `${route.methods.join(',')} ${route.pattern}`)
    assert.deepEqual(unscoped, [])
  })
})

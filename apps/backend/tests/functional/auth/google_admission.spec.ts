/* eslint-disable @unicorn/no-await-expression-member -- Keep each row lookup beside its assertion. */
import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { googleSignInUser, type VerifiedGoogleProfile } from '#services/auth/google_identity'
import { withTransaction } from '#services/with_transaction'

const profile: VerifiedGoogleProfile = {
  subject: 'google-subject-bruce',
  email: 'bruce.wayne@wayne.example',
  name: 'Bruce Wayne',
}

test.group('Google identity admission', (group) => {
  group.setup(() => freshDatabase())
  group.setup(() => {
    const previous = env.get('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS')
    env.set('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS', profile.email)
    return () => env.set('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS', previous || '')
  })
  group.each.setup(async () => {
    await db.from('user_session_index').delete()
    await db.from('provider_identities').delete()
    await db.from('email_proofs').delete()
    await db.from('users').delete()
  })

  test('admits exactly the first allowlisted subject without creating a company or membership', async ({
    assert,
  }) => {
    const first = await withTransaction((trx) => googleSignInUser(trx, profile))
    assert.isNotEmpty(first.userId)
    assert.equal((await db.from('provider_identities').first())?.subject, profile.subject)
    assert.equal((await db.from('email_proofs').first())?.email, profile.email)
    assert.isNull(await db.from('accounts').first())
    assert.isNull(await db.from('memberships').first())
    const returning = await withTransaction((trx) =>
      googleSignInUser(trx, { ...profile, email: 'renamed@wayne.example' })
    )
    assert.equal(returning.userId, first.userId)
    assert.equal(returning.user.email, profile.email)
    assert.isNull(await db.from('email_proofs').where('email', 'renamed@wayne.example').first())
  })

  test('refuses a non-allowlisted first subject and never merges a new subject by email', async ({
    assert,
  }) => {
    await assert.rejects(() =>
      withTransaction((trx) =>
        googleSignInUser(trx, { ...profile, email: 'clark.kent@wayne.example' })
      )
    )
    assert.isNull(await db.from('users').first())
    await withTransaction((trx) => googleSignInUser(trx, profile))
    await assert.rejects(() =>
      withTransaction((trx) => googleSignInUser(trx, { ...profile, subject: 'different-subject' }))
    )
    assert.lengthOf(await db.from('provider_identities'), 1)
    assert.lengthOf(await db.from('users'), 1)
  })

  test('concurrent allowlisted bootstrap attempts create only one principal', async ({
    assert,
    cleanup,
  }) => {
    const prior = env.get('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS')
    env.set('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS', `${profile.email},diana.prince@wayne.example`)
    cleanup(() => env.set('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS', prior || ''))
    const outcomes = await Promise.allSettled([
      withTransaction((trx) => googleSignInUser(trx, profile)),
      withTransaction((trx) =>
        googleSignInUser(trx, {
          subject: 'google-subject-diana',
          email: 'diana.prince@wayne.example',
          name: 'Diana Prince',
        })
      ),
    ])
    assert.lengthOf(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
      1
    )
    assert.lengthOf(await db.from('users'), 1)
    assert.lengthOf(await db.from('provider_identities'), 1)
    assert.lengthOf(await db.from('email_proofs'), 1)
    assert.lengthOf(await db.from('memberships'), 0)
  })
})

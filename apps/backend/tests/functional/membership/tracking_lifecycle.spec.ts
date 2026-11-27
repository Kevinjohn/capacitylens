import { test } from '@japa/runner'
import { password, signInObservation, userIdByEmail } from '#tests/helpers/membership/members'
import { freshDatabase } from '#tests/helpers/fresh_database'
import db from '@adonisjs/lucid/services/db'
import { resetState } from '#tests/helpers/state_fixture'
import { signUpAndIn } from '#tests/helpers/identities'
import { asDataOwner } from '#tests/helpers/authenticated_data_fixture'
import { CompanyFactory } from '#database/factories/company_factory'

test.group('member sign-in tracking lifecycle', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('account_admissions').delete()
    await db.from('account_invitations').delete()
    await db.from('adonis_sessions').delete()
    await db.from('memberships').delete()
    await db.from('users').delete()
  })

  test('keeps observations off by default, and scopes fresh windows by company', async ({
    client,
    assert,
  }) => {
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      password,
      name: 'Bruce Wayne',
    })
    owner.assertStatus(200)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const now = new Date().toISOString()
    await CompanyFactory.merge([
      { id: 'a-studio', name: 'Wayne Enterprises', color: '#6366f1' },
      { id: 'a-loft', name: 'Stark Industries', color: '#6366f1' },
    ]).createMany(2)
    await db.table('memberships').insert([
      {
        scope_id: 'a-studio',
        user_id: await userIdByEmail('bruce.wayne@wayne.example'),
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        scope_id: 'a-loft',
        user_id: await userIdByEmail('bruce.wayne@wayne.example'),
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ])

    const member = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    })
    member.assertStatus(200)
    const memberId = await userIdByEmail('clark.kent@wayne.example')
    await db.table('memberships').insert([
      {
        scope_id: 'a-studio',
        user_id: memberId,
        role: 'viewer',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        scope_id: 'a-loft',
        user_id: memberId,
        role: 'viewer',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ])

    const signIn = () =>
      client
        .visit('api.session.store')
        .header('sec-fetch-site', 'same-origin')
        .json({ email: 'clark.kent@wayne.example', password })
        .send()
    const offSignIn = await signIn()
    offSignIn.assertStatus(200)
    assert.isNull(await signInObservation('a-studio', memberId))
    assert.isNull(await signInObservation('a-loft', memberId))

    const tracking = (companyId: string) =>
      client.visit('api.member_sign_in_tracking.update', { companyId })
    const enableStudio = await asDataOwner(tracking('a-studio'), ownerCookie)
      .json({ enabled: true })
      .send()
    enableStudio.assertStatus(200)
    const firstWindow = await db
      .from('company_settings')
      .where({ company_id: 'a-studio', key: 'member-sign-in-tracking' })
      .first()
    assert.isNotNull(
      await signInObservation('a-studio', await userIdByEmail('bruce.wayne@wayne.example'))
    )
    assert.isNull(await signInObservation('a-loft', memberId))

    const observedStudio = await signIn()
    observedStudio.assertStatus(200)
    assert.isNotNull(await signInObservation('a-studio', memberId))
    assert.isNull(await signInObservation('a-loft', memberId))
    const repeatedEnable = await asDataOwner(tracking('a-studio'), ownerCookie)
      .json({ enabled: true })
      .send()
    repeatedEnable.assertStatus(200)
    const repeatedWindow = await db
      .from('company_settings')
      .where({ company_id: 'a-studio', key: 'member-sign-in-tracking' })
      .first()
    assert.equal(repeatedWindow.created_at, firstWindow.created_at)
    assert.isNotNull(await signInObservation('a-studio', memberId))

    const enableLoft = await asDataOwner(tracking('a-loft'), ownerCookie)
      .json({ enabled: true })
      .send()
    enableLoft.assertStatus(200)
    const observedBoth = await signIn()
    observedBoth.assertStatus(200)
    assert.isNotNull(await signInObservation('a-studio', memberId))
    assert.isNotNull(await signInObservation('a-loft', memberId))

    const disableStudio = await asDataOwner(tracking('a-studio'), ownerCookie)
      .json({ enabled: false })
      .send()
    disableStudio.assertStatus(200)
    assert.isNull(await signInObservation('a-studio', memberId))
    assert.isNull(
      await db
        .from('company_settings')
        .where({ company_id: 'a-studio', key: 'member-sign-in-tracking' })
        .first()
    )
    assert.isNotNull(await signInObservation('a-loft', memberId))
    const disabledSignIn = await signIn()
    disabledSignIn.assertStatus(200)
    assert.isNull(await signInObservation('a-studio', memberId))
    assert.isNotNull(await signInObservation('a-loft', memberId))

    const reenabledStudio = await asDataOwner(tracking('a-studio'), ownerCookie)
      .json({ enabled: true })
      .send()
    reenabledStudio.assertStatus(200)
    assert.isNull(await signInObservation('a-studio', memberId))
    assert.isNotNull(
      await signInObservation('a-studio', await userIdByEmail('bruce.wayne@wayne.example'))
    )
    assert.isNotNull(await signInObservation('a-loft', memberId))
    const beforeRevoke = await signIn()
    beforeRevoke.assertStatus(200)
    assert.isNotNull(await signInObservation('a-studio', memberId))
    assert.isNotNull(await signInObservation('a-loft', memberId))
  })
})

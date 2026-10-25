import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'
import { resetAuthenticatedClient } from '../../helpers/authenticated_data_fixture.js'

test.group('membership control-data isolation', (group) => {
  group.setup(() => freshDatabase())

  test('keeps representative admission and membership controls out of export and retired CRUD', async ({
    client,
    assert,
  }) => {
    client = await resetAuthenticatedClient(client, true)
    const stamp = '2026-10-15T00:00:00.000Z'
    await db.from('account_invitations').where('email', 'diana.prince@wayne.example').delete()
    await db.from('account_member_resources').where('id', 'link-control-isolation').delete()
    await db.from('memberships').where('id', 'm-control-isolation').delete()
    await db.from('users').where('id', 'u-control-isolation').delete()
    const resource = seed().resources.find((row) => row.id === 'r-tyler')!
    await db.table('users').insert({
      id: 'u-control-isolation',
      email: 'clark.kent@wayne.example',
      email_verified_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('memberships').insert({
      id: 'm-control-isolation',
      account_id: 'a-studio',
      user_id: 'u-control-isolation',
      role: 'viewer',
      status: 'active',
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('account_member_resources').insert({
      id: 'link-control-isolation',
      account_id: 'a-studio',
      user_id: 'u-control-isolation',
      resource_id: resource.id,
      revision: stamp,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('account_invitations').insert({
      email: 'diana.prince@wayne.example',
      role: 'viewer',
      token_hash: 'secret-control-token-hash',
      expires_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('account_admissions').insert({
      user_id: 'u-control-isolation',
      invited_email: 'clark.kent@wayne.example',
      invited_role: 'viewer',
      invitation_source: 'operator',
      invitation_recorded_at: stamp,
      approval_status: 'approved',
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('password_reset_tokens').insert({
      tokenable_id: 'u-control-isolation',
      email: 'clark.kent@wayne.example',
      hash: 'secret-reset-token-hash',
      expires_at: stamp,
      created_at: stamp,
    })

    const exported = await client.get('/api/state?accountId=a-studio&includeInactive=1').send()
    exported.assertStatus(200)
    for (const property of [
      'memberships',
      'accountMemberResources',
      'accountInvitations',
      'accountAdmissions',
      'passwordResetTokens',
    ])
      assert.notProperty(exported.body(), property)
    const serialized = JSON.stringify(exported.body())
    for (const secret of [
      'u-control-isolation',
      'clark.kent@wayne.example',
      'diana.prince@wayne.example',
      'secret-control-token-hash',
      'secret-reset-token-hash',
    ])
      assert.notInclude(serialized, secret)

    const attempted = await client
      .post('/api/batch')
      .header('sec-fetch-site', 'same-origin')
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'memberships',
            id: 'attempt-control',
            row: { id: 'attempt-control' },
          },
        ],
      })
      .send()
    assert.equal(attempted.status(), 404)

    assert.isNotNull(
      await db.from('account_member_resources').where('id', 'link-control-isolation').first()
    )
    assert.isNotNull(
      await db.from('account_invitations').where('email', 'diana.prince@wayne.example').first()
    )
  })
})

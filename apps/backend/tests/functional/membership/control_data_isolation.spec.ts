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
    await db.from('invitation_proposals').where('id', 'proposal-control-isolation').delete()
    await db.from('invitations').where('id', 'invite-control-isolation').delete()
    await db.from('account_member_resources').where('id', 'link-control-isolation').delete()
    await db.from('memberships').where('id', 'm-control-isolation').delete()
    await db.from('company_join_intents').where('id', 'intent-control-isolation').delete()
    await db.from('users').where('id', 'u-control-isolation').delete()
    const resource = seed().resources.find((row) => row.id === 'r-tyler')!
    await db.table('users').insert({
      id: 'u-control-isolation',
      email: 'clark.kent@wayne.example',
      email_verified: 1,
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
    await db.table('invitations').insert({
      id: 'invite-control-isolation',
      account_id: 'a-studio',
      token_hash: 'secret-control-token-hash',
      email: 'diana.prince@wayne.example',
      role: 'viewer',
      expires_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('invitation_proposals').insert({
      id: 'proposal-control-isolation',
      invitation_id: 'invite-control-isolation',
      resource_id: resource.id,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('company_join_intents').insert({
      id: 'intent-control-isolation',
      nonce_hash: 'secret-control-nonce-hash',
      browser_hash: 'secret-control-browser-hash',
      purpose: 'policy',
      account_id: 'a-studio',
      invitation_id: null,
      email: 'clark.kent@wayne.example',
      principal_id: 'u-control-isolation',
      provider_id: 'password',
      state: 'started',
      token_hash: 'secret-control-proof-hash',
      delivery_generation: 1,
      expires_at: Date.now() + 60_000,
      sent_count: 1,
      last_sent_at: Date.now(),
      source_ip_hash: 'secret-control-ip-hash',
      provider_state_hash: null,
      created_at: stamp,
      updated_at: stamp,
    })

    await db.table('login_link_tokens').insert({
      tokenable_id: 'u-control-isolation',
      email: 'clark.kent@wayne.example',
      hash: 'secret-login-link-hash',
      client_challenge: 'secret-login-client-challenge',
      expires_at: stamp,
      created_at: stamp,
    })

    const exported = await client.get('/api/state?accountId=a-studio&includeInactive=1').send()
    exported.assertStatus(200)
    assert.notProperty(exported.body(), 'loginLinkTokens')
    assert.notProperty(exported.body(), 'memberships')
    assert.notProperty(exported.body(), 'accountMemberResources')
    assert.notProperty(exported.body(), 'invitations')
    assert.notProperty(exported.body(), 'invitationProposals')
    assert.notProperty(exported.body(), 'companyJoinIntents')
    const serialized = JSON.stringify(exported.body())
    for (const secret of [
      'u-control-isolation',
      'clark.kent@wayne.example',
      'secret-login-link-hash',
      'secret-login-client-challenge',
      'secret-control-token-hash',
      'secret-control-nonce-hash',
      'secret-control-browser-hash',
      'secret-control-proof-hash',
      'secret-control-ip-hash',
      'proposal-control-isolation',
      'intent-control-isolation',
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
    assert.isNotNull(await db.from('invitations').where('id', 'invite-control-isolation').first())
    assert.isNotNull(
      await db.from('invitation_proposals').where('id', 'proposal-control-isolation').first()
    )
    assert.isNotNull(
      await db.from('company_join_intents').where('id', 'intent-control-isolation').first()
    )
  })
})

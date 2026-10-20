import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'
import { encodeRow, readState } from '#services/state_repository'

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

test.group('M2b data routes', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await db.from('account_member_resources').delete()
    await db.from('audit_entries').delete()
    await db.from('member_resource_link_exceptions').delete()
    await db.from('account_access_restrictions').delete()
    await db.from('company_join_intents').delete()
    await db.from('account_joining_policies').delete()
    await db.from('account_getting_started_dismissals').delete()
  })

  test('inactive export includes archived and deleted rows but stays in one company', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const candidates = await db
      .from('resources')
      .select('id')
      .where('account_id', 'a-studio')
      .limit(2)
    assert.lengthOf(candidates, 2)
    await db
      .from('resources')
      .where('id', candidates[0]!.id)
      .update({ archived_at: '2026-10-13T00:00:00.000Z' })
    await db
      .from('resources')
      .where('id', candidates[1]!.id)
      .update({ deleted_at: '2026-10-13T00:00:00.000Z' })
    const inactive = await client.get('/api/state?accountId=a-studio&includeInactive=1').send()
    inactive.assertStatus(200)
    const body = inactive.body() as ReturnType<typeof seed>
    assert.isTrue(body.resources.every((row) => row.accountId === 'a-studio'))
    assert.isTrue(body.accounts.every((row) => row.id === 'a-studio'))
    assert.includeMembers(
      body.resources.map((row) => row.id),
      candidates.map((row) => row.id)
    )
    assert.notProperty(body, 'memberships')
    assert.notProperty(body, 'invitations')
    assert.notProperty(body, 'companyJoinIntents')
  })

  test('default export excludes inactive rows', async ({ client, assert }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const candidate = await db
      .from('resources')
      .select('id')
      .where('account_id', 'a-studio')
      .first()
    await db
      .from('resources')
      .where('id', candidate.id)
      .update({ archived_at: '2026-10-13T00:00:00.000Z' })
    const fullResponse = await client.get('/api/state?accountId=a-studio&includeInactive=1').send()
    const activeResponse = await client.get('/api/state?accountId=a-studio').send()
    const full = fullResponse.body() as ReturnType<typeof seed>
    const active = activeResponse.body() as ReturnType<typeof seed>
    assert.isAtMost(active.resources.length, full.resources.length)
    assert.include(
      full.resources.map((row) => row.id),
      candidate.id
    )
    assert.notInclude(
      active.resources.map((row) => row.id),
      candidate.id
    )
    assert.isTrue(
      active.resources.every((row) => row.archivedAt === null && row.deletedAt === null)
    )
  })

  test('export excludes membership, invitation and session secrets', async ({ client, assert }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const stamp = '2026-10-13T00:00:00.000Z'
    await db.table('users').insert({
      id: 'u-export',
      email: 'secret.person@wayne.com',
      email_verified: 1,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('memberships').insert({
      id: 'm-export',
      account_id: 'a-studio',
      user_id: 'u-export',
      role: 'viewer',
      status: 'active',
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('invitations').insert({
      id: 'invite-export',
      account_id: 'a-studio',
      token_hash: 'secret-invite-token-hash',
      email: 'secret.invited@wayne.com',
      role: 'viewer',
      expires_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('sessions').insert({
      id: 'session-export',
      user_id: 'u-export',
      payload: 'secret-session-payload',
      expires_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('invitation_proposals').insert({
      id: 'proposal-export-secret',
      invitation_id: 'invite-export',
      resource_id: null,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('member_resource_link_exceptions').insert({
      id: 'exception-export',
      account_id: 'a-studio',
      user_id: 'u-export',
      proposed_resource_id: 'secret-proposed-resource',
      reason: 'resource_unavailable',
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('account_access_restrictions').insert({
      id: 'restriction-export',
      account_id: 'a-studio',
      principal_id: 'u-export',
      verified_email: 'restricted.secret@wayne.com',
      role: 'viewer',
      created_at: stamp,
    })
    const result = await client.get('/api/state?accountId=a-studio&includeInactive=1').send()
    result.assertStatus(200)
    assert.isAbove((result.body() as ReturnType<typeof seed>).resources.length, 0)
    const serialized = JSON.stringify(result.body())
    for (const secret of [
      'secret.person@wayne.com',
      'secret-invite-token-hash',
      'secret.invited@wayne.com',
      'secret-session-payload',
      'u-export',
      'proposal-export-secret',
      'secret-proposed-resource',
      'restricted.secret@wayne.com',
    ])
      assert.notInclude(serialized, secret)
  })

  test('getting-started dismissal is monotonic, shared by company and isolated from another', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const route = '/api/accounts/a-studio/getting-started'
    const before = await client.get(route).send()
    before.assertBodyContains({ dismissed: false })
    const written = await trusted(client.put(route)).json({ dismissed: true }).send()
    assert.equal(written.status(), 200, JSON.stringify(written.body()))
    const shared = await client.get(route).send()
    const other = await client.get('/api/accounts/a-loft/getting-started').send()
    assert.deepEqual(shared.body(), { dismissed: true })
    assert.deepEqual(other.body(), {
      dismissed: false,
    })
    const reverse = await trusted(client.put(route)).json({ dismissed: false }).send()
    reverse.assertStatus(400)
    const stillDismissed = await client.get(route).send()
    assert.deepEqual(stillDismissed.body(), { dismissed: true })
  })

  test('getting-started strips extra fields and reports missing companies', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const route = '/api/accounts/a-studio/getting-started'
    const malformed = await trusted(client.put(route))
      .json({ dismissed: true, extra: 'value' })
      .send()
    malformed.assertStatus(200)
    const saved = await client.get(route).send()
    assert.deepEqual(saved.body(), { dismissed: true })
    const invalid = await trusted(client.put(route)).json({ dismissed: null }).send()
    invalid.assertStatus(400)
    const stillDismissed = await client.get(route).send()
    assert.deepEqual(stillDismissed.body(), { dismissed: true })
    const missing = await client.get('/api/accounts/unknown/getting-started').send()
    missing.assertStatus(404)
  })

  test('example data inserts once and refuses a second request', async ({ client, assert }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const account = { ...seed().accounts[0]!, id: 'a-example' }
    await db.table('accounts').insert(encodeRow('accounts', account))
    const route = '/api/accounts/a-example/example-data'
    const first = await trusted(client.post(route)).json({}).send()
    assert.equal(first.status(), 201, JSON.stringify(first.body()))
    assert.isAbove((first.body() as { added: number }).added, 0)
    const second = await trusted(client.post(route)).json({}).send()
    second.assertStatus(409)
    const audit = await db
      .from('audit_entries')
      .where({ account_id: account.id, action: 'exampleData' })
    assert.lengthOf(audit, 1)
  })

  test('example data refuses an existing active resource without changing it', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const account = { ...seed().accounts[0]!, id: 'a-example' }
    await db.table('accounts').insert(encodeRow('accounts', account))
    const resource = {
      ...seed().resources[0]!,
      id: 'r-existing',
      accountId: account.id,
      disciplineId: null,
    }
    await db.table('resources').insert(encodeRow('resources', resource))
    const before = await readState(account.id, true)
    const response = await trusted(client.post('/api/accounts/a-example/example-data'))
      .json({})
      .send()
    response.assertStatus(409)
    assert.deepEqual(await readState(account.id, true), before)
  })

  test('example data rejects archived-only work and unknown company', async ({ client }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const account = { ...seed().accounts[0]!, id: 'a-example' }
    await db.table('accounts').insert(encodeRow('accounts', account))
    const resource = {
      ...seed().resources[0]!,
      id: 'r-archived',
      accountId: account.id,
      disciplineId: null,
      archivedAt: new Date().toISOString(),
    }
    await db.table('resources').insert(encodeRow('resources', resource))
    const existing = await trusted(client.post('/api/accounts/a-example/example-data'))
      .json({})
      .send()
    existing.assertStatus(409)
    const missing = await trusted(client.post('/api/accounts/unknown/example-data')).json({}).send()
    missing.assertStatus(404)
  })

  test('example data refuses existing client and project work', async ({ client }) => {
    for (const kind of ['client', 'project'] as const) {
      await client.post('/api/test/reset').json({ seed: false }).send()
      const account = { ...seed().accounts[0]!, id: 'a-example' }
      await db.table('accounts').insert(encodeRow('accounts', account))
      const clientRow = {
        ...seed().clients.find((row) => row.builtin !== true)!,
        id: 'c-example',
        accountId: account.id,
      }
      await db.table('clients').insert(encodeRow('clients', clientRow))
      if (kind === 'project') {
        const project = {
          ...seed().projects[0]!,
          id: 'p-example',
          accountId: account.id,
          clientId: clientRow.id,
        }
        await db.table('projects').insert(encodeRow('projects', project))
      }
      const result = await trusted(client.post('/api/accounts/a-example/example-data'))
        .json({})
        .send()
      result.assertStatus(409)
    }
  })

  test('off-mode creation is limited to the first company but deletion permits later setup', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const first = await trusted(client.post('/api/accounts'))
      .json({ ...seed().accounts[0]!, id: 'a-new' })
      .send()
    first.assertStatus(201)
    const second = await trusted(client.post('/api/orgs'))
      .json({ ...seed().accounts[1]!, id: 'a-second' })
      .send()
    second.assertStatus(403)
    const deleted = await trusted(client.delete('/api/accounts/a-new')).send()
    deleted.assertStatus(204)
    const remaining = await readState()
    assert.lengthOf(remaining.accounts, 0)
  })

  test('off-mode company patch sets an initially null frozen setting once', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const account = { ...seed().accounts[0]!, id: 'a-patch', timezone: null }
    await db.table('accounts').insert(encodeRow('accounts', account))
    const first = await trusted(client.patch('/api/accounts/a-patch'))
      .json({ timezone: 'Europe/London' })
      .send()
    first.assertStatus(200)
    const patched = await readState('a-patch', true)
    assert.equal(patched.accounts[0]?.timezone, 'Europe/London')
    const second = await trusted(client.patch('/api/accounts/a-patch'))
      .json({ timezone: 'America/New_York' })
      .send()
    second.assertStatus(409)
    const missing = await trusted(client.patch('/api/accounts/unknown'))
      .json({ name: 'Other' })
      .send()
    missing.assertStatus(404)
  })
})

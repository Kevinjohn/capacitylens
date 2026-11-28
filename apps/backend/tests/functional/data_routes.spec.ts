import { test } from '@japa/runner'
import {
  createFixtureCompanyForOwner,
  grantDataOwner,
} from '#tests/helpers/authenticated_data_fixture'
import { resetLoggedInDataOwner, trusted } from '#tests/helpers/data/data_owner'
import { freshDatabase } from '#tests/helpers/fresh_database'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'
import { insertProductRows } from '#tests/helpers/product_rows'
import { readState } from '#tests/helpers/state_fixture'
import { UserFactory } from '#database/factories/user_factory'
import { DateTime } from 'luxon'

test.group('data routes', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await db.from('account_member_resources').delete()
    await db.from('audit_entries').delete()
    await db.from('company_getting_started_dismissals').delete()
  })

  test('inactive export follows effective member role and a default read stays active-only', async ({
    client,
    assert,
    db: rows,
  }) => {
    const dataOwner = await resetLoggedInDataOwner(client, true)
    client = dataOwner.client
    await rows.assertHas('memberships', {
      user_id: dataOwner.userId,
      scope_id: 'a-studio',
      role: 'owner',
      status: 'active',
    })
    const candidate = await db.from('resources').where('company_id', 'a-studio').first()
    await db
      .from('resources')
      .where('id', candidate.id)
      .update({ archived_at: new Date().toISOString() })
    for (const role of ['viewer', 'editor', 'admin', 'owner']) {
      await db
        .from('memberships')
        .where({ user_id: dataOwner.userId, scope_id: 'a-studio' })
        .update({ role })
      const explicit = await client
        .visit('api.company_state.show')
        .qs({ companyId: 'a-studio', includeInactive: '1' })
        .send()
      explicit.assertStatus(['viewer', 'editor'].includes(role) ? 403 : 200)
      const active = await client
        .visit('api.company_state.show')
        .qs({ companyId: 'a-studio' })
        .send()
      active.assertStatus(200)
      const ids = active.body().data.resources.map((row: { id: string }) => row.id)
      assert.isFalse(ids.includes(candidate.id), role)
    }
  })

  test('example data requires Admin access', async ({ client }) => {
    const dataOwner = await resetLoggedInDataOwner(client, false)
    client = dataOwner.client
    const company = { ...seed().companies[0]!, id: 'a-example' }
    await insertProductRows('companies', [company])
    await grantDataOwner(dataOwner.userId, company.id)
    for (const role of ['editor', 'admin']) {
      await db
        .from('memberships')
        .where({ user_id: dataOwner.userId, scope_id: company.id })
        .update({ role })
      const response = await trusted(
        client.visit('api.example_data.store', { companyId: company.id })
      )
        .json({})
        .send()
      response.assertStatus(role === 'editor' ? 403 : 201)
    }
  })

  test('inactive export includes archived rows but stays in one company', async ({
    client,
    assert,
  }) => {
    const dataOwner = await resetLoggedInDataOwner(client, true)
    client = dataOwner.client
    const candidates = await db
      .from('resources')
      .select('id')
      .where('company_id', 'a-studio')
      .limit(2)
    assert.lengthOf(candidates, 2)
    await db
      .from('resources')
      .whereIn(
        'id',
        candidates.map((row) => row.id)
      )
      .update({ archived_at: '2026-10-13T00:00:00.000Z' })
    const inactive = await client
      .visit('api.company_state.show')
      .qs({ companyId: 'a-studio', includeInactive: '1' })
      .send()
    inactive.assertStatus(200)
    const body = inactive.body().data as ReturnType<typeof seed>
    assert.isTrue(body.resources.every((row) => row.companyId === 'a-studio'))
    assert.isTrue(body.companies.every((row) => row.id === 'a-studio'))
    assert.includeMembers(
      body.resources.map((row) => row.id),
      candidates.map((row) => row.id)
    )
    assert.notProperty(body, 'memberships')
    assert.notProperty(body, 'invitations')
    assert.notProperty(body, 'companyJoinIntents')
  })

  test('default export excludes inactive rows', async ({ client, assert }) => {
    const dataOwner = await resetLoggedInDataOwner(client, true)
    client = dataOwner.client
    const candidate = await db
      .from('resources')
      .select('id')
      .where('company_id', 'a-studio')
      .first()
    await db
      .from('resources')
      .where('id', candidate.id)
      .update({ archived_at: '2026-10-13T00:00:00.000Z' })
    const fullResponse = await client
      .visit('api.company_state.show')
      .qs({ companyId: 'a-studio', includeInactive: '1' })
      .send()
    const activeResponse = await client
      .visit('api.company_state.show')
      .qs({ companyId: 'a-studio' })
      .send()
    const full = fullResponse.body().data as ReturnType<typeof seed>
    const active = activeResponse.body().data as ReturnType<typeof seed>
    assert.isAtMost(active.resources.length, full.resources.length)
    assert.include(
      full.resources.map((row) => row.id),
      candidate.id
    )
    assert.notInclude(
      active.resources.map((row) => row.id),
      candidate.id
    )
    assert.isTrue(active.resources.every((row) => row.archivedAt === null))
  })

  test('export excludes membership, invitation and session secrets', async ({ client, assert }) => {
    const dataOwner = await resetLoggedInDataOwner(client, true)
    client = dataOwner.client
    const stamp = '2026-10-13T00:00:00.000Z'
    await db.transaction((trx) =>
      UserFactory.client(trx)
        .merge({
          id: 'u-export',
          email: 'secret.person@wayne.com',
          displayName: null,
          emailVerifiedAt: DateTime.fromISO(stamp),
        })
        .create()
    )
    await db.table('memberships').insert({
      scope_id: 'a-studio',
      user_id: 'u-export',
      role: 'viewer',
      status: 'active',
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('account_invitations').insert({
      email: 'secret.invited@wayne.com',
      role: 'viewer',
      token_hash: 'secret-invite-token-hash',
      expires_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('account_sessions').insert({
      user_id: 'u-export',
      handle_hash: 'secret-session-handle-hash',
      created_at: stamp,
      last_seen_at: stamp,
      expires_at: stamp,
    })
    const result = await client
      .visit('api.company_state.show')
      .qs({ companyId: 'a-studio', includeInactive: '1' })
      .send()
    result.assertStatus(200)
    assert.isAbove((result.body().data as ReturnType<typeof seed>).resources.length, 0)
    const serialized = JSON.stringify(result.body().data)
    for (const secret of [
      'secret.person@wayne.com',
      'secret-invite-token-hash',
      'secret.invited@wayne.com',
      'secret-session-handle-hash',
      'u-export',
    ])
      assert.notInclude(serialized, secret)
  })

  test('getting-started dismissal is monotonic, shared by company and isolated from another', async ({
    client,
    assert,
  }) => {
    const dataOwner = await resetLoggedInDataOwner(client, true)
    client = dataOwner.client
    const params = { companyId: 'a-studio' }
    const before = await client.visit('api.getting_started.show', params).send()
    before.assertBodyContains({ data: { dismissed: false } })
    const written = await trusted(client.visit('api.getting_started.update', params))
      .json({ dismissed: true })
      .send()
    assert.equal(written.status(), 200, JSON.stringify(written.body().data))
    const shared = await client.visit('api.getting_started.show', params).send()
    const other = await client.visit('api.getting_started.show', { companyId: 'a-loft' }).send()
    assert.equal(shared.body().data.dismissed, true)
    assert.equal(other.body().data.dismissed, false)
    const reverse = await trusted(client.visit('api.getting_started.update', params))
      // Deliberately outside the generated body type, to reach the server's refusal.
      .json({ dismissed: false } as never)
      .send()
    reverse.assertStatus(422)
    const stillDismissed = await client.visit('api.getting_started.show', params).send()
    assert.equal(stillDismissed.body().data.dismissed, true)
  })

  test('getting-started reports each milestone from the active company rows', async ({
    client,
    assert,
  }) => {
    const dataOwner = await resetLoggedInDataOwner(client, true)
    client = dataOwner.client
    const now = new Date().toISOString()
    const studio = (table: string) => db.from(table).where('company_id', 'a-studio')
    const read = async (companyId = 'a-studio') => {
      const reply = await client.visit('api.getting_started.show', { companyId }).send()
      reply.assertStatus(200)
      // The generated reply type omits the nested steps interface; the route returns it.
      return (
        (reply.body() as { data: unknown }).data as {
          dismissed: boolean
          steps?: Record<string, boolean>
        }
      ).steps
    }
    const all = { person: true, client: true, project: true, activity: true, scheduled: true }
    const loft = await read('a-loft')
    assert.deepEqual(await read(), all)

    await studio('projects').update({ archived_at: now })
    assert.deepEqual(await read(), { ...all, project: false })
    await studio('projects').update({ archived_at: null })

    // A project under an archived client no longer counts, though the project itself is active.
    await studio('clients').update({ archived_at: now })
    assert.deepEqual(await read(), { ...all, client: false, project: false })
    await studio('clients').update({ archived_at: null })

    await studio('allocations').delete()
    assert.deepEqual(await read(), { ...all, scheduled: false })

    await studio('activities').update({ archived_at: now })
    assert.deepEqual(await read(), { ...all, scheduled: false, activity: false })

    await studio('resources').where('kind', 'person').update({ archived_at: now })
    assert.deepEqual(await read(), {
      ...all,
      scheduled: false,
      activity: false,
      person: false,
    })
    assert.deepEqual(await read('a-loft'), loft)
  })

  test('getting-started strips extra fields and reports missing companies', async ({
    client,
    assert,
  }) => {
    const dataOwner = await resetLoggedInDataOwner(client, true)
    client = dataOwner.client
    const params = { companyId: 'a-studio' }
    const extraFields = await trusted(client.visit('api.getting_started.update', params))
      // Deliberately outside the generated body type, to reach the server's refusal.
      .json({ dismissed: true, extra: 'value' } as never)
      .send()
    extraFields.assertStatus(200)
    const saved = await client.visit('api.getting_started.show', params).send()
    assert.equal(saved.body().data.dismissed, true)
    const invalid = await trusted(client.visit('api.getting_started.update', params))
      // Deliberately outside the generated body type, to reach the server's refusal.
      .json({ dismissed: null } as never)
      .send()
    invalid.assertStatus(422)
    const stillDismissed = await client.visit('api.getting_started.show', params).send()
    assert.equal(stillDismissed.body().data.dismissed, true)
    const missing = await client.visit('api.getting_started.show', { companyId: 'unknown' }).send()
    missing.assertStatus(403)
  })

  test('example data inserts once and refuses a second request', async ({ client, assert }) => {
    const dataOwner = await resetLoggedInDataOwner(client, false)
    client = dataOwner.client
    const company = { ...seed().companies[0]!, id: 'a-example' }
    await insertProductRows('companies', [company])
    await grantDataOwner(dataOwner.userId, company.id)
    const otherCompanyId = await createFixtureCompanyForOwner(
      dataOwner.userId,
      'Stark Industries',
      'a-example-other'
    )
    const person = seed().resources.find((row) => row.kind === 'person')!
    await insertProductRows('resources', [
      { ...person, id: 'r-example-other', companyId: otherCompanyId, disciplineId: null },
    ])
    const otherBefore = await readState(otherCompanyId, true)
    const params = { companyId: 'a-example' }
    const first = await trusted(client.visit('api.example_data.store', params)).json({}).send()
    assert.equal(first.status(), 201, JSON.stringify(first.body().data))
    assert.isAbove((first.body().data as { added: number }).added, 0)
    assert.deepEqual(await readState(otherCompanyId, true), otherBefore)
    const second = await trusted(client.visit('api.example_data.store', params)).json({}).send()
    second.assertStatus(409)
    const audit = await db
      .from('audit_entries')
      .where({ company_id: company.id, action: 'exampleData' })
    assert.lengthOf(audit, 1)
  })

  test('example data refuses an existing active resource without changing it', async ({
    client,
    assert,
  }) => {
    const dataOwner = await resetLoggedInDataOwner(client, false)
    client = dataOwner.client
    const company = { ...seed().companies[0]!, id: 'a-example' }
    await insertProductRows('companies', [company])
    await grantDataOwner(dataOwner.userId, company.id)
    const resource = {
      ...seed().resources[0]!,
      id: 'r-existing',
      companyId: company.id,
      disciplineId: null,
    }
    await insertProductRows('resources', [resource])
    const before = await readState(company.id, true)
    const response = await trusted(
      client.visit('api.example_data.store', { companyId: 'a-example' })
    )
      .json({})
      .send()
    response.assertStatus(409)
    assert.deepEqual(await readState(company.id, true), before)
  })

  test('example data rejects archived-only work and unknown company', async ({ client }) => {
    const dataOwner = await resetLoggedInDataOwner(client, false)
    client = dataOwner.client
    const company = { ...seed().companies[0]!, id: 'a-example' }
    await insertProductRows('companies', [company])
    await grantDataOwner(dataOwner.userId, company.id)
    const resource = {
      ...seed().resources[0]!,
      id: 'r-archived',
      companyId: company.id,
      disciplineId: null,
      archivedAt: new Date().toISOString(),
    }
    await insertProductRows('resources', [resource])
    const existing = await trusted(
      client.visit('api.example_data.store', { companyId: 'a-example' })
    )
      .json({})
      .send()
    existing.assertStatus(409)
    const missing = await trusted(client.visit('api.example_data.store', { companyId: 'unknown' }))
      .json({})
      .send()
    missing.assertStatus(403)
  })

  test('example data refuses existing client and project work', async ({ client }) => {
    for (const kind of ['client', 'project'] as const) {
      const dataOwner = await resetLoggedInDataOwner(client, false)
      client = dataOwner.client
      const company = { ...seed().companies[0]!, id: 'a-example' }
      await insertProductRows('companies', [company])
      await grantDataOwner(dataOwner.userId, company.id)
      const clientRow = {
        ...seed().clients.find((row) => row.builtin !== true)!,
        id: 'c-example',
        companyId: company.id,
      }
      await insertProductRows('clients', [clientRow])
      if (kind === 'project') {
        const project = {
          ...seed().projects[0]!,
          id: 'p-example',
          companyId: company.id,
          clientId: clientRow.id,
        }
        await insertProductRows('projects', [project])
      }
      const result = await trusted(
        client.visit('api.example_data.store', { companyId: 'a-example' })
      )
        .json({})
        .send()
      result.assertStatus(409)
    }
  })
})

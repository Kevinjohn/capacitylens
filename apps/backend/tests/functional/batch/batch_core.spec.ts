import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import {
  authenticatedDataClient,
  resetAuthenticatedData,
} from '../../helpers/authenticated_data_fixture.js'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { seed } from '@capacitylens/shared/data/seed'
import db from '@adonisjs/lucid/services/db'
import { withTransaction } from '#services/with_transaction'
import { applyBatch } from '#services/batch/service'
import { initialCompanyDataContext } from '#services/planning_operations/data_policy'
import { readState } from '#services/state_repository'

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

async function reset(client: ApiClient, seeded = true) {
  const session = await resetAuthenticatedData(client, seeded)
  return authenticatedDataClient(client, session.cookie)
}

test.group('M2a atomic batch', (group) => {
  group.setup(() => freshDatabase())

  test('applies a valid write and returns its server revision', async ({ client, assert }) => {
    client = await reset(client, true)
    const state = seed()
    const current = state.disciplines[0]
    const response = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'disciplines',
            id: current.id,
            row: { ...current, name: 'Updated discipline' },
          },
        ],
      })
      .send()

    response.assertStatus(200)
    response.assertBodyContains({ ok: true, applied: 1, changed: 1, auditWarning: false })
    const body = response.body() as unknown as { revisions: Array<Record<string, unknown>> }
    assert.equal(body.revisions[0]?.table, 'disciplines')
    assert.equal(body.revisions[0]?.id, current.id)
  })

  test('advances one company revision for a multi-row batch and none for a semantic no-op', async ({
    client,
    assert,
  }) => {
    client = await reset(client, true)
    const state = seed()
    const [first, second] = state.disciplines
    const updated = await trusted(client.post('/api/batch'))
      .json({
        ops: [first, second].map((row) => ({
          method: 'PUT',
          table: 'disciplines',
          id: row.id,
          row: { ...row, name: `${row.name} updated` },
        })),
      })
      .send()
    updated.assertStatus(200)
    updated.assertBodyContains({ changed: 2 })
    const committedRevision = await db
      .from('company_planning_revisions')
      .where('account_id', first.accountId)
      .first()
    assert.equal(Number(committedRevision?.revision), 1)

    const snapshot = await readState(first.accountId, true)
    const unchanged = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'disciplines',
            id: first.id,
            row: snapshot.disciplines.find((row) => row.id === first.id)! as unknown as Record<
              string,
              unknown
            >,
          },
        ],
      })
      .send()
    unchanged.assertStatus(200)
    unchanged.assertBodyContains({ applied: 1, changed: 0 })
    assert.lengthOf(
      await db
        .from('audit_entries')
        .where({ account_id: first.accountId, entity: 'disciplines', entity_id: first.id }),
      1
    )
    const unchangedRevision = await db
      .from('company_planning_revisions')
      .where('account_id', first.accountId)
      .first()
    assert.equal(Number(unchangedRevision?.revision), 1)
  })

  test('rolls back preceding writes and their audit row when a later operation fails', async ({
    client,
    assert,
  }) => {
    client = await reset(client, true)
    const current = seed().disciplines[0]
    const response = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'disciplines',
            id: current.id,
            row: { ...current, name: 'Must roll back' },
          },
          {
            method: 'PUT',
            table: 'disciplines',
            id: 'wrong-id',
            row: { ...current, id: 'different-id' },
          },
        ],
      })
      .send()
    response.assertStatus(400)

    const stateResponse = await client.get(`/api/state?accountId=${current.accountId}`).send()
    stateResponse.assertStatus(200)
    stateResponse.assertBodyContains({ disciplines: [{ id: current.id, name: current.name }] })
    assert.lengthOf(
      await db.from('audit_entries').where({ entity: 'disciplines', entity_id: current.id }),
      0
    )
  })

  test('records audit and rejects an already applied sync sequence', async ({ client, assert }) => {
    client = await reset(client, true)
    const current = seed().disciplines[0]
    const request = () =>
      trusted(client.post('/api/batch'))
        .header('x-capacitylens-sync-session', '0123456789abcdef')
        .header('x-capacitylens-sync-sequence', '1')
        .json({
          ops: [
            {
              method: 'PUT',
              table: 'disciplines',
              id: current.id,
              row: { ...current, name: 'Ordered name' },
            },
          ],
        })
        .send()
    const applied = await request()
    applied.assertStatus(200)
    applied.assertBodyContains({ applied: 1, changed: 1 })
    const superseded = await request()
    superseded.assertStatus(200)
    superseded.assertBodyContains({ applied: 1, changed: 0, superseded: true })
    const audit = await db
      .from('audit_entries')
      .where({ entity: 'disciplines', entity_id: current.id })
    assert.lengthOf(audit, 1)
    const owner = await db
      .from('memberships')
      .where('account_id', current.accountId)
      .select('user_id')
      .first()
    assert.equal(audit[0].actor_id, owner.user_id)
  })

  test('preserves omitted resource bounds and clears explicit null markers', async ({
    client,
    assert,
  }) => {
    client = await reset(client, true)
    const source = seed().resources.find((row) => row.id === 'r-tyler')!
    const bounded = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'resources',
            id: source.id,
            row: {
              ...source,
              firstAvailableDate: '2026-02-01',
              lastAvailableDate: '2026-02-28',
            },
          },
        ],
      })
      .send()
    bounded.assertStatus(200)

    const state = await client.get(`/api/state?accountId=${source.accountId}`).send()
    state.assertStatus(200)
    const current = (state.body() as { resources: Array<Record<string, unknown>> }).resources.find(
      (row) => row.id === source.id
    )!
    const cleared = { ...current }
    delete cleared.firstAvailableDate
    delete cleared.lastAvailableDate
    const omitted = await trusted(client.post('/api/batch'))
      .json({ ops: [{ method: 'PUT', table: 'resources', id: source.id, row: cleared }] })
      .send()
    omitted.assertStatus(200)

    const retained = await db.from('resources').where('id', source.id).first()
    assert.equal(retained.first_available_date, '2026-02-01')
    assert.equal(retained.last_available_date, '2026-02-28')

    const refreshedState = await client.get(`/api/state?accountId=${source.accountId}`).send()
    refreshedState.assertStatus(200)
    const refreshed = (
      refreshedState.body() as { resources: Array<Record<string, unknown>> }
    ).resources.find((row) => row.id === source.id)!
    const explicitNull = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'resources',
            id: source.id,
            row: { ...refreshed, firstAvailableDate: null, lastAvailableDate: null },
          },
        ],
      })
      .send()
    explicitNull.assertStatus(200)

    const stored = await db.from('resources').where('id', source.id).first()
    assert.isNull(stored.first_available_date)
    assert.isNull(stored.last_available_date)
  })

  test('rechecks provider-independent write capability for every affected company', async ({
    client,
    assert,
  }) => {
    client = await reset(client, true)
    const [allowed, denied] = seed().disciplines.filter(
      (row, index, rows) =>
        index === rows.findIndex((candidate) => candidate.accountId === row.accountId)
    )
    if (!allowed || !denied) throw new Error('Expected fixture disciplines for both companies')
    const base = initialCompanyDataContext('policy-actor')
    const context = {
      ...base,
      capabilitiesFor: (accountId: string) => ({
        ...base.capabilitiesFor(accountId),
        canWrite: accountId === allowed.accountId,
      }),
    }
    await assert.rejects(() =>
      withTransaction((trx) =>
        applyBatch(
          trx,
          [
            {
              method: 'PUT',
              table: 'disciplines',
              id: allowed.id,
              row: { ...allowed, name: 'Must roll back' },
            },
            {
              method: 'PUT',
              table: 'disciplines',
              id: denied.id,
              row: { ...denied, name: 'Denied' },
            },
          ],
          null,
          context
        )
      )
    )
    const stored = await db.from('disciplines').where('id', allowed.id).first()
    assert.equal(stored.name, allowed.name)
    assert.lengthOf(await db.from('audit_entries').where('actor_id', 'policy-actor'), 0)
  })

  test('keeps a committed write successful when the after-commit log fails', async ({
    client,
    assert,
  }) => {
    client = await reset(client, true)
    const current = seed().disciplines[0]
    const context = initialCompanyDataContext('log-failure-actor', () => {
      throw new Error('log unavailable')
    })
    const result = await withTransaction((trx) =>
      applyBatch(
        trx,
        [
          {
            method: 'PUT',
            table: 'disciplines',
            id: current.id,
            row: { ...current, name: 'Committed' },
          },
        ],
        null,
        context
      )
    )
    assert.isTrue(result.auditWarning)
    const stored = await db.from('disciplines').where('id', current.id).first()
    assert.equal(stored.name, 'Committed')
  })

  test('redacts a hidden time-off note from an optimistic conflict', async ({ client, assert }) => {
    client = await reset(client, true)
    const current = seed().timeOff.find((row) => typeof row.note === 'string')!
    const base = initialCompanyDataContext('note-blind')
    const capabilities = {
      ...base.capabilitiesFor(current.accountId),
      canSeeTimeOffNote: false,
    }
    const context = {
      ...base,
      ...capabilities,
      capabilitiesFor: () => capabilities,
    }
    let failure: unknown
    try {
      await withTransaction((trx) =>
        applyBatch(
          trx,
          [
            {
              method: 'PUT',
              table: 'timeOff',
              id: current.id,
              row: { ...current, updatedAt: '2000-01-01T00:00:00.000Z' },
            },
          ],
          null,
          context
        )
      )
    } catch (error) {
      failure = error
    }
    assert.equal((failure as { status?: unknown }).status, 409)
    assert.propertyVal((failure as { current?: Record<string, unknown> }).current!, 'note', null)
  })

  test('accepts a current or newer optimistic revision', async ({ client }) => {
    client = await reset(client, true)
    const current = seed().disciplines[0]
    const response = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'disciplines',
            id: current.id,
            row: { ...current, name: 'Newer revision', updatedAt: '2099-01-01T00:00:00.000Z' },
          },
        ],
      })
      .send()
    response.assertStatus(200)
    response.assertBodyContains({ ok: true, applied: 1, changed: 1 })
  })

  test('rejects lifecycle and unscoped deletes atomically before retaining earlier writes', async ({
    client,
    assert,
  }) => {
    client = await reset(client, true)
    const discipline = seed().disciplines.find((row) => row.accountId === 'a-studio')!
    const clientRow = seed().clients.find(
      (row) => row.accountId === 'a-studio' && row.builtin !== true
    )!
    for (const invalidDelete of [
      { method: 'DELETE', table: 'clients', id: clientRow.id, accountId: clientRow.accountId },
      { method: 'DELETE', table: 'disciplines', id: discipline.id },
    ]) {
      const response = await trusted(client.post('/api/batch'))
        .json({
          ops: [
            {
              method: 'PUT',
              table: 'disciplines',
              id: discipline.id,
              row: { ...discipline, name: 'Must roll back' },
            },
            invalidDelete,
          ],
        } as never)
        .send()
      response.assertStatus(invalidDelete.table === 'clients' ? 400 : 403)
      const stored = await db.from('disciplines').where('id', discipline.id).first()
      assert.equal(stored.name, discipline.name)
    }
  })

  test('refuses a cross-company delete and rolls back its valid sibling', async ({
    client,
    assert,
  }) => {
    client = await reset(client, true)
    const studio = seed().disciplines.find((row) => row.accountId === 'a-studio')!
    const loft = seed().disciplines.find((row) => row.accountId === 'a-loft')!
    const response = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'disciplines',
            id: studio.id,
            row: { ...studio, name: 'Must roll back' },
          },
          { method: 'DELETE', table: 'disciplines', id: loft.id, accountId: 'a-studio' },
        ],
      })
      .send()
    response.assertStatus(404)
    const storedStudio = await db.from('disciplines').where('id', studio.id).first()
    assert.equal(storedStudio.name, studio.name)
    assert.exists(await db.from('disciplines').where('id', loft.id).first())
  })

  test('rolls back valid repeated allocation and time-off prefixes when a sibling is invalid', async ({
    client,
    assert,
  }) => {
    client = await reset(client, true)
    const allocation = seed().allocations.find((row) => row.accountId === 'a-studio')!
    const timeOff = seed().timeOff.find((row) => row.accountId === 'a-studio')!
    const cases = [
      {
        table: 'allocations',
        good: { ...allocation, id: 'repeat-allocation-good' },
        bad: { ...allocation, id: 'repeat-allocation-bad', resourceId: 'missing-resource' },
      },
      {
        table: 'timeOff',
        good: { ...timeOff, id: 'repeat-time-off-good' },
        bad: { ...timeOff, id: 'repeat-time-off-bad', resourceId: 'missing-resource' },
      },
    ] as const
    for (const item of cases) {
      const response = await trusted(client.post('/api/batch'))
        .json({
          ops: [
            { method: 'PUT', table: item.table, id: item.good.id, row: item.good },
            { method: 'PUT', table: item.table, id: item.bad.id, row: item.bad },
          ],
        })
        .send()
      response.assertStatus(400)
      const sqlTable = item.table === 'timeOff' ? 'time_off' : item.table
      assert.isNull(await db.from(sqlTable).where('id', item.good.id).first())
      assert.isNull(await db.from(sqlTable).where('id', item.bad.id).first())
    }
  })

  test('distinguishes accepted operations from changes and ignores a repeated archive', async ({
    client,
  }) => {
    client = await reset(client, true)
    const source = seed().allocations.find((row) => row.accountId === 'a-studio')!
    const receipt = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'allocations',
            id: 'changed-allocation',
            row: { ...source, id: 'changed-allocation' },
          },
          {
            method: 'DELETE',
            table: 'allocations',
            id: 'missing-allocation',
            accountId: source.accountId,
          },
          {
            method: 'DELETE',
            table: 'timeOff',
            id: 'missing-time-off',
            accountId: source.accountId,
          },
        ],
      })
      .send()
    receipt.assertStatus(200)
    receipt.assertBodyContains({ applied: 3, changed: 1 })

    const clientRow = seed().clients.find(
      (row) => row.accountId === 'a-studio' && row.builtin !== true
    )!
    const archive = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          { method: 'ARCHIVE', table: 'clients', id: clientRow.id, accountId: clientRow.accountId },
          { method: 'ARCHIVE', table: 'clients', id: clientRow.id, accountId: clientRow.accountId },
        ],
      })
      .send()
    archive.assertStatus(200)
    archive.assertBodyContains({ applied: 2, changed: 1 })
  })

  test('returns stable resource domain codes through the real HTTP contract', async ({
    client,
    assert,
  }) => {
    client = await reset(client, true)
    const person = seed().resources.find((row) => row.id === 'r-tyler')!
    const external = seed().resources.find((row) => row.kind === 'external')!
    const attempts = [
      {
        row: { ...person, kind: 'placeholder' },
        code: 'resource_kind_immutable',
      },
      {
        row: { ...person, avatarUrl: 'not-a-url' },
        code: 'resource_avatar_url_invalid',
      },
      {
        row: { ...external, avatarUrl: 'https://images.example/external.png' },
        code: 'resource_avatar_url_forbidden',
      },
    ]
    for (const attempt of attempts) {
      const response = await trusted(client.post('/api/batch'))
        .json({
          ops: [
            {
              method: 'PUT',
              table: 'resources',
              id: String(attempt.row.id),
              row: attempt.row,
            },
          ],
        })
        .send()
      response.assertStatus(400)
      assert.equal((response.body() as { code?: unknown }).code, attempt.code)
    }
  })

  test('preserves a flat 404 for a native unknown API route', async ({ client, assert }) => {
    const response = await trusted(client.post('/api/unknown-command')).json({}).send()
    response.assertStatus(404)
    assert.deepEqual(response.body(), { error: 'Not found.', code: 'NOT_FOUND' })
  })
})

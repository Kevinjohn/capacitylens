import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { ClientFactory } from '#database/factories/client_factory'
import { TIME_OFF_REPEAT_RULES } from '@capacitylens/shared/lib/repeatingDates'
import { freshDatabase } from '#tests/helpers/fresh_database'
import db from '@adonisjs/lucid/services/db'
import { readState } from '#tests/helpers/state_fixture'
import { buildActiveData } from '@capacitylens/shared/domain/lifecycle'
import {
  companyId,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  intentSession,
  loginAsMember,
  trusted,
  validationSentence,
} from '#tests/functional/planning/helpers'
import { mutationInput, replyBody, validationErrors } from '#tests/helpers/planning/mutations'

test.group('independent typed planning operations', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('creates one allocation series from a pattern and permits a later Sunday occurrence', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(companyId, true)
    const { cookie } = await loginAsMember()
    // Thursday 1 October repeats on the first of each month; 1 November is a Sunday.
    const first = { ...newAllocation(data), startDate: '2026-10-01', endDate: '2026-10-01' }
    const committed = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'allocation.createGroup',
          allocation: first,
          repeat: { pattern: { kind: 'monthly-date' }, until: '2026-11-01' },
        })
      )
      .send()

    committed.assertStatus(200)
    assert.equal(replyBody(committed).revision, 1)
    const saved = await readState(companyId, true)
    const firstRow = saved.allocations.find((row) => row.id === first.id)
    // The server minted the later occurrence's id.
    const created = [
      firstRow,
      saved.allocations.find((row) => row.seriesId === firstRow?.seriesId && row !== firstRow),
    ]
    assert.isDefined(created[0])
    assert.isDefined(created[1])
    assert.isNotEmpty(created[0]!.seriesId)
    assert.equal(created[1]!.seriesId, created[0]!.seriesId)
    assert.equal(created[1]!.startDate, '2026-11-01')
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 1)
  })

  test('refuses time-off occurrence ids past the ceiling, repeated, or reusing the first id', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const before = await readState(companyId, true)
    const timeOff = {
      id: randomUUID(),
      resourceId: before.resources.find((row) => row.kind === 'person')!.id,
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      type: 'holiday',
    }
    const repeated = randomUUID()
    for (const [occurrenceIds, error] of [
      [
        Array.from({ length: TIME_OFF_REPEAT_RULES.maxOccurrences }, () => randomUUID()),
        'occurrenceIds',
      ],
      [[repeated, repeated], 'Entity IDs must be unique.'],
      [[timeOff.id, randomUUID()], 'Entity IDs must be unique.'],
    ] as const) {
      const refused = await intentSession(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json(
          mutationInput(0, {
            operation: 'timeOff.repeat',
            timeOff,
            repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-16' },
            occurrenceIds,
          })
        )
        .send()
      refused.assertStatus(422)
      assert.include(validationErrors(refused)?.[0]?.message, error)
    }
    assert.deepEqual(await readState(companyId, true), before)
  })

  test('refuses a repeat that yields a single occurrence before persisting it', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(companyId, true)
    const { cookie } = await loginAsMember()
    const first = newAllocation(data)
    const before = await readState(companyId, true)
    const refused = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'allocation.createGroup',
          allocation: first,
          repeat: { pattern: { kind: 'weeks', interval: 1 }, until: first.startDate },
        })
      )
      .send()

    refused.assertStatus(422)
    assert.equal(
      validationSentence(refused),
      'Repeat until must include at least one repeated occurrence.'
    )
    assert.deepEqual(await readState(companyId, true), before)
    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(snapshot.body().data.revision, 0)
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0)
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      0
    )
  })

  test('archives and restores catalogue and resource rows by their same stable IDs', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(companyId, true)
    const { cookie } = await loginAsMember()
    const clientId = data.clients.find((row) => row.companyId === companyId && !row.builtin)!.id
    const resourceId = data.resources.find(
      (row) => row.companyId === companyId && row.kind === 'person' && !row.archivedAt
    )!.id
    const transitions = [
      {
        operation: 'catalogue.archive',
        entity: { entity: 'clients', id: clientId },
        entityTable: 'clients',
        id: clientId,
      },
      {
        operation: 'catalogue.restore',
        entity: { entity: 'clients', id: clientId },
        entityTable: 'clients',
        id: clientId,
      },
      {
        operation: 'resource.archive',
        id: resourceId,
        entityTable: 'resources',
      },
      {
        operation: 'resource.restore',
        id: resourceId,
        entityTable: 'resources',
      },
    ] as const

    for (const [index, transition] of transitions.entries()) {
      const mutationId = randomUUID()
      const response = await intentSession(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json({
          mutationId,
          baseRevision: index,
          intent: {
            operation: transition.operation,
            ...('entity' in transition ? { entity: transition.entity } : { id: transition.id }),
          },
        })
        .send()
      response.assertStatus(200)
      assert.equal(replyBody(response).revision, index + 1)
      // Only a catalogue archive reports what it hid.
      if (transition.operation !== 'catalogue.archive')
        assert.notProperty((response.body() as { data: unknown }).data as object, 'archived')
      const row = await db.from(transition.entityTable).where({ id: transition.id }).first()
      assert.isDefined(row)
      assert.equal(row!.id, transition.id)
      assert.equal(Boolean(row!.archived_at), index === 0 || index === 2)
      const marker = await db
        .from('planning_mutations')
        .where({ company_id: companyId, mutation_id: mutationId })
        .first()
      assert.equal(Number(marker?.revision), index + 1)
      const audit = await db
        .from('audit_entries')
        .where({ company_id: companyId, entity: 'planning', entity_id: marker!.mutation_id })
        .first()
      assert.equal(audit?.action, transition.operation)
    }

    const final = await readState(companyId, true)
    assert.isNull(final.clients.find((row) => row.id === clientId)!.archivedAt)
    assert.isNull(final.resources.find((row) => row.id === resourceId)!.archivedAt)
    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(snapshot.body().data.revision, 4)
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 4)
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      4
    )
  })

  test('missing targets and same-state lifecycle transitions keep their flat refusal codes', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(companyId, true)
    const { cookie } = await loginAsMember()
    const clientId = data.clients.find((row) => row.companyId === companyId && !row.builtin)!.id
    const missingId = randomUUID()

    const alreadyActive = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.restore',
          entity: { entity: 'clients', id: clientId },
        })
      )
      .send()
    alreadyActive.assertStatus(400)
    assert.equal(replyBody(alreadyActive).code, 'NO_CHANGE')
    assert.deepEqual(Object.keys(alreadyActive.body() as object).sort(), ['code', 'error'])

    const missing = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.archive',
          entity: { entity: 'clients', id: missingId },
        })
      )
      .send()
    missing.assertStatus(422)
    assert.isString(validationSentence(missing))
    assert.deepEqual(Object.keys(missing.body() as object), ['errors'])

    const archived = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.archive',
          entity: { entity: 'clients', id: clientId },
        })
      )
      .send()
    archived.assertStatus(200)
    const repeated = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'catalogue.archive',
          entity: { entity: 'clients', id: clientId },
        })
      )
      .send()
    repeated.assertStatus(400)
    assert.equal(replyBody(repeated).code, 'NO_CHANGE')
    assert.deepEqual(Object.keys(repeated.body() as object).sort(), ['code', 'error'])

    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(snapshot.body().data.revision, 1)
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 1)
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      1
    )
  })

  test('a client archive reports the active rows it hid', async ({ client, assert, cleanup }) => {
    configureAuth(cleanup)
    const before = await readState(companyId, true)
    const { cookie } = await loginAsMember()
    const target = before.clients.find(
      (row) =>
        row.companyId === companyId &&
        !row.builtin &&
        before.projects.some((project) => project.clientId === row.id)
    )!
    const archived = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.archive',
          entity: { entity: 'clients', id: target.id },
        })
      )
      .send()
    archived.assertStatus(200)
    const after = await readState(companyId, true)
    const hidden = (key: 'projects' | 'phases' | 'activities' | 'allocations' | 'timeOff') =>
      buildActiveData(before)[key].filter((row) => row.companyId === companyId).length -
      buildActiveData(after)[key].filter((row) => row.companyId === companyId).length
    const reported = (
      (archived.body() as { data: unknown }).data as { archived?: Record<string, number> }
    ).archived
    assert.deepEqual(reported, {
      projects: hidden('projects'),
      phases: hidden('phases'),
      activities: hidden('activities'),
      allocations: hidden('allocations'),
      timeOff: hidden('timeOff'),
    })
    assert.isAbove(reported!.projects, 0)
    assert.isAbove(reported!.activities, 0)
    assert.isAbove(reported!.allocations, 0)
  })

  test('the built-in Internal client rejects both lifecycle verbs without mutation', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(companyId, true)
    const { cookie } = await loginAsMember()
    const internal = data.clients.find((row) => row.companyId === companyId && row.builtin)!
    const before = await db.from('clients').where({ id: internal.id }).first()
    assert.isDefined(before)

    for (const operation of ['catalogue.archive', 'catalogue.restore'] as const) {
      const response = await intentSession(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json(
          mutationInput(0, {
            operation,
            entity: { entity: 'clients', id: internal.id },
          })
        )
        .send()
      response.assertStatus(409)
      assert.deepEqual(await db.from('clients').where({ id: internal.id }).first(), before)
    }

    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(snapshot.body().data.revision, 0)
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0)
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      0
    )
  })

  test('the built-in Internal client rejects rename and strips client-supplied flags', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(companyId, true)
    const { cookie } = await loginAsMember()
    const internal = data.clients.find((row) => row.companyId === companyId && row.builtin)!
    const before = await db.from('clients').where({ id: internal.id }).first()
    assert.isDefined(before)

    const renamed = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.update',
          entity: { entity: 'clients', id: internal.id, changes: { name: 'Renamed Internal' } },
        })
      )
      .send()
    renamed.assertStatus(422)
    assert.isString(validationSentence(renamed))
    assert.deepEqual(await db.from('clients').where({ id: internal.id }).first(), before)
    const refusedSnapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(refusedSnapshot.body().data.revision, 0)
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0)
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      0
    )

    const spoofedId = randomUUID()
    const createInput = mutationInput(0, {
      operation: 'catalogue.create',
      entity: {
        entity: 'clients',
        id: spoofedId,
        fields: { name: 'Second Internal', color: internal.color, builtin: true },
      },
    })
    const spoofed = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(createInput)
      .send()
    spoofed.assertStatus(200)
    assert.equal(replyBody(spoofed).status, 'committed')
    assert.equal(replyBody(spoofed).mutationId, createInput.mutationId)
    assert.equal(replyBody(spoofed).revision, 1)
    const ordinary = await db.from('clients').where({ id: spoofedId }).first()
    assert.deepInclude(ordinary!, {
      id: spoofedId,
      name: 'Second Internal',
      color: internal.color,
      builtin: null,
    })
    assert.deepEqual(await db.from('clients').where({ id: internal.id }).first(), before)
    const createdSnapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(createdSnapshot.body().data.revision, 1)
    const createdClients = createdSnapshot.body().data.data.clients as Array<{
      id: string
      name: string
      builtin?: boolean
    }>
    assert.equal(createdClients.find((row) => row.id === spoofedId)?.name, 'Second Internal')
    assert.notEqual(createdClients.find((row) => row.id === spoofedId)?.builtin, true)
    assert.deepEqual(
      createdClients.filter((row) => row.builtin).map((row) => row.id),
      [internal.id]
    )
    const createdMarker = await db.from('planning_mutations').where('company_id', companyId)
    assert.lengthOf(createdMarker, 1)
    assert.equal(createdMarker[0].mutation_id, createInput.mutationId)
    assert.equal(Number(createdMarker[0].revision), 1)
    const createdAudit = await db
      .from('audit_entries')
      .where({ company_id: companyId, entity: 'planning' })
    assert.lengthOf(createdAudit, 1)
    assert.equal(createdAudit[0].entity_id, createInput.mutationId)
    assert.equal(createdAudit[0].action, 'catalogue.create')

    const renameInput = mutationInput(1, {
      operation: 'catalogue.update',
      entity: {
        entity: 'clients',
        id: spoofedId,
        changes: { name: 'Ordinary renamed', builtin: true },
      },
    })
    const normalRename = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(renameInput)
      .send()
    normalRename.assertStatus(200)
    assert.equal(replyBody(normalRename).status, 'committed')
    assert.equal(replyBody(normalRename).mutationId, renameInput.mutationId)
    assert.equal(replyBody(normalRename).revision, 2)
    const ordinaryRenamed = await db.from('clients').where({ id: spoofedId }).first()
    assert.equal(ordinaryRenamed!.name, 'Ordinary renamed')
    assert.isNull(ordinaryRenamed!.builtin)

    const flagOnlyInput = mutationInput(2, {
      operation: 'catalogue.update',
      entity: { entity: 'clients', id: spoofedId, changes: { builtin: true } },
    })
    const flagOnly = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(flagOnlyInput)
      .send()
    flagOnly.assertStatus(422)
    assert.isNotEmpty(validationErrors(flagOnly))
    assert.deepEqual(await db.from('clients').where({ id: spoofedId }).first(), ordinaryRenamed)
    assert.deepEqual(await db.from('clients').where({ id: internal.id }).first(), before)

    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(snapshot.body().data.revision, 2)
    const canonicalClients = snapshot.body().data.data.clients as typeof createdClients
    assert.equal(canonicalClients.find((row) => row.id === spoofedId)?.name, 'Ordinary renamed')
    assert.notEqual(canonicalClients.find((row) => row.id === spoofedId)?.builtin, true)
    assert.deepEqual(
      canonicalClients.filter((row) => row.builtin).map((row) => row.id),
      [internal.id]
    )
    const markers = await db.from('planning_mutations').where('company_id', companyId)
    assert.lengthOf(markers, 2)
    assert.sameMembers(
      markers.map((row) => row.mutation_id),
      [createInput.mutationId, renameInput.mutationId]
    )
    const renamedMarker = markers.find((row) => row.mutation_id === renameInput.mutationId)
    assert.equal(Number(renamedMarker!.revision), 2)
    const audits = await db
      .from('audit_entries')
      .where({ company_id: companyId, entity: 'planning' })
    assert.lengthOf(audits, 2)
    assert.deepInclude(
      audits.find((row) => row.entity_id === renameInput.mutationId)!,
      {
        action: 'catalogue.update',
      }
    )
  })

  test('refuses to archive a row owned by another company without changing it', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const allCompanies = await readState()
    const foreignProject = allCompanies.projects.find((row) => row.companyId === 'a-loft')!
    const before = await db.from('projects').where({ id: foreignProject.id }).first()
    assert.isDefined(before)

    const refused = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.archive',
          entity: { entity: 'projects', id: foreignProject.id },
        })
      )
      .send()

    refused.assertStatus(422)
    assert.isString(validationSentence(refused))
    assert.deepEqual(await db.from('projects').where({ id: foreignProject.id }).first(), before)
    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(snapshot.body().data.revision, 0)
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0)
  })

  test('anonymous planning cannot read or write persisted allocations', async ({
    client,
    assert,
  }) => {
    const snapshot = await trusted(client.visit('api.planning.show', { companyId })).send()
    snapshot.assertStatus(401)

    const allocation = newAllocation(await readState(companyId, true))
    const before = await readState(companyId, true)
    const write = await trusted(client.visit('api.planning_mutations.store', { companyId }))
      .json({
        mutationId: randomUUID(),
        baseRevision: 0,
        intent: { operation: 'allocation.create', allocation },
      })
      .send()
    write.assertStatus(401)
    assert.deepEqual(write.body(), { error: 'Sign-in required.', code: 'SIGN_IN_REQUIRED' })
    assert.deepEqual(await readState(companyId, true), before)
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0)
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      0
    )
  })

  test('updates a row whose id contains a colon, as imported and Internal client ids can', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(companyId, true)
    const template = data.clients.find((row) => row.companyId === companyId && !row.builtin)!
    const id = `client:${randomUUID()}`
    await ClientFactory.merge({
      id,
      companyId,
      name: 'Daily Planet',
      color: template.color,
    }).create()
    const { cookie } = await loginAsMember()
    const response = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.update',
          entity: { entity: 'clients', id, changes: { name: 'Daily Planet Press' } },
        })
      )
      .send()
    response.assertStatus(200)
    assert.equal(replyBody(response).status, 'committed')
    const stored = await db.from('clients').where({ id }).first()
    assert.equal(stored?.name, 'Daily Planet Press')
  })
})

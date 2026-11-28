import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { freshDatabase } from '#tests/helpers/fresh_database'
import db from '@adonisjs/lucid/services/db'
import { readState } from '#tests/helpers/state_fixture'
import {
  companyId,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  intentSession,
  loginAsMember,
} from '#tests/helpers/planning/functional_helpers'
import { mutationInput, replyBody, validationErrors } from '#tests/helpers/planning/mutations'

test.group('planning request rule boundaries', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('refuses private clients and projects without a usable code name atomically', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const initial = await readState(companyId, true)
    const clientId = randomUUID()
    const validClient = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.create',
          entity: {
            entity: 'clients',
            id: clientId,
            fields: {
              name: 'Private client',
              color: initial.clients[0]!.color,
              isPrivate: true,
              codeName: 'Nightwing',
            },
          },
        })
      )
      .send()
    validClient.assertStatus(200)
    assert.equal(replyBody(validClient).revision, 1)
    const validProject = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'catalogue.create',
          entity: {
            entity: 'projects',
            id: randomUUID(),
            fields: {
              name: 'Private project',
              color: initial.clients[0]!.color,
              clientId,
              isPrivate: true,
              codeName: 'Bluebird',
            },
          },
        })
      )
      .send()
    validProject.assertStatus(200)
    assert.equal(replyBody(validProject).revision, 2)
    const paddedPreset = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(2, {
          operation: 'catalogue.create',
          entity: {
            entity: 'clients',
            id: randomUUID(),
            fields: { name: 'Padded preset', color: '  #E02727  ' },
          },
        })
      )
      .send()
    paddedPreset.assertStatus(200)
    assert.equal(replyBody(paddedPreset).revision, 3)
    const before = await readState(companyId, true)
    assert.equal(before.clients.find((row) => row.name === 'Padded preset')?.color, '#E02727')
    const auditsBefore = await db.from('audit_entries').where('company_id', companyId)
    const mutationsBefore = await db.from('planning_mutations').where('company_id', companyId)

    for (const entity of ['clients', 'projects'] as const) {
      const fields =
        entity === 'clients'
          ? {
              name: 'Invalid private client',
              color: before.clients[0]!.color,
              isPrivate: true,
              codeName: '""',
            }
          : {
              name: 'Invalid private project',
              color: before.clients[0]!.color,
              clientId,
              isPrivate: true,
              codeName: '""',
            }
      const refused = await intentSession(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json(
          mutationInput(3, {
            operation: 'catalogue.create',
            entity: { entity, id: randomUUID(), fields },
          })
        )
        .send()
      refused.assertStatus(422)
      assert.isNotEmpty(validationErrors(refused))
    }

    for (const color of ['#7cd9e4']) {
      const refused = await intentSession(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json(
          mutationInput(3, {
            operation: 'catalogue.create',
            entity: {
              entity: 'clients',
              id: randomUUID(),
              fields: { name: 'Invalid colour', color },
            },
          })
        )
        .send()
      refused.assertStatus(422)
      assert.isNotEmpty(validationErrors(refused))
    }

    assert.deepEqual(await readState(companyId, true), before)
    assert.deepEqual(await db.from('audit_entries').where('company_id', companyId), auditsBefore)
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId),
      mutationsBefore
    )
    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(replyBody(snapshot).revision, 3)
  })

  test('rejects incoherent activity project and phase requests at the route boundary', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const initial = await readState(companyId, true)
    const activity = initial.activities.find((row) => row.phaseId !== null)!
    const otherProject = initial.projects.find((row) => row.id !== activity.projectId)!
    const valid = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.update',
          entity: { entity: 'activities', id: activity.id, changes: { name: 'Survey work' } },
        })
      )
      .send()
    valid.assertStatus(200)
    assert.equal(replyBody(valid).revision, 1)
    const before = await readState(companyId, true)
    const auditsBefore = await db.from('audit_entries').where('company_id', companyId)
    const mutationsBefore = await db.from('planning_mutations').where('company_id', companyId)

    const wrongProject = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activity.id,
            changes: { projectId: otherProject.id },
          },
        })
      )
      .send()
    wrongProject.assertStatus(422)
    assert.isNotEmpty(validationErrors(wrongProject))

    const unassignedProjectActivity = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activity.id,
            changes: { projectId: null },
          },
        })
      )
      .send()
    unassignedProjectActivity.assertStatus(422)
    assert.isNotEmpty(validationErrors(unassignedProjectActivity))

    const wrongKind = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'catalogue.create',
          entity: {
            entity: 'activities',
            id: randomUUID(),
            fields: {
              name: 'Internal project activity',
              kind: 'internal',
              projectId: otherProject.id,
              phaseId: null,
            },
          },
        })
      )
      .send()
    wrongKind.assertStatus(422)
    assert.isNotEmpty(validationErrors(wrongKind))
    assert.deepEqual(await readState(companyId, true), before)
    assert.deepEqual(await db.from('audit_entries').where('company_id', companyId), auditsBefore)
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId),
      mutationsBefore
    )
    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(replyBody(snapshot).revision, 1)
  })

  test('rejects invalid person and placeholder working patterns and placeholder engagement', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const before = await readState(companyId, true)
    const person = before.resources.find((row) => row.kind === 'person')!
    const placeholder = before.resources.find((row) => row.kind === 'placeholder')!
    const priorUpdatedAt = '2098-01-01T00:00:00.000Z'
    await db
      .from('resources')
      .where({ id: person.id, company_id: companyId })
      .update({ updated_at: priorUpdatedAt })
    const valid = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'resource.update',
          id: person.id,
          changes: { jobTitle: 'Lead' },
        })
      )
      .send()
    valid.assertStatus(200)
    assert.equal(replyBody(valid).revision, 1)
    const canonicalBeforeRefusals = await readState(companyId, true)
    const updatedPerson = canonicalBeforeRefusals.resources.find((row) => row.id === person.id)!
    assert.isAbove(Date.parse(updatedPerson.updatedAt), Date.parse(priorUpdatedAt))
    const auditsBefore = await db.from('audit_entries').where('company_id', companyId)
    const mutationsBefore = await db.from('planning_mutations').where('company_id', companyId)

    // Request validation and the planning rules both refuse with 422.
    const invalidCases = [
      { id: person.id, changes: { workingDays: [] } },
      { id: person.id, changes: { workingDays: [1, 2], halfDays: [3] } },
      { id: person.id, changes: { halfDays: [1, 1] } },
      { id: person.id, changes: { workingHoursPerDay: 0 } },
      { id: placeholder.id, changes: { engagement: 'supplementary' } },
      { id: placeholder.id, changes: { workingDays: [0, 6], halfDays: [6] } },
    ]
    for (const { id, changes } of invalidCases) {
      const refused = await intentSession(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json(mutationInput(1, { operation: 'resource.update', id, changes }))
        .send()
      refused.assertStatus(422)
      assert.isNotEmpty(validationErrors(refused))
    }

    const changedKind = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'resource.update',
          id: person.id,
          changes: { kind: 'placeholder' },
        })
      )
      .send()
    changedKind.assertStatus(422)
    assert.isNotEmpty(validationErrors(changedKind))

    assert.deepEqual(await readState(companyId, true), canonicalBeforeRefusals)
    assert.deepEqual(await db.from('audit_entries').where('company_id', companyId), auditsBefore)
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId),
      mutationsBefore
    )
    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(replyBody(snapshot).revision, 1)
  })

  test('refuses converting a resource with loaded allocation or time off to external atomically', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const initial = await readState(companyId, true)
    const allocatedPerson = initial.resources.find(
      (resource) =>
        resource.kind === 'person' &&
        initial.allocations.some(
          (allocation) => allocation.resourceId === resource.id && allocation.hoursPerDay !== 0
        ) &&
        !initial.timeOff.some((entry) => entry.resourceId === resource.id)
    )
    assert.isDefined(allocatedPerson)
    const initialAudits = await db.from('audit_entries').where('company_id', companyId)
    const initialMutations = await db.from('planning_mutations').where('company_id', companyId)

    const allocationRefusal = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'resource.update',
          id: allocatedPerson!.id,
          changes: { kind: 'external' },
        })
      )
      .send()
    allocationRefusal.assertStatus(422)
    assert.isNotEmpty(validationErrors(allocationRefusal))
    assert.deepEqual(await readState(companyId, true), initial)
    assert.deepEqual(await db.from('audit_entries').where('company_id', companyId), initialAudits)
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId),
      initialMutations
    )
    const initialSnapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(replyBody(initialSnapshot).revision, 0)

    const timeOffOnlyPersonId = randomUUID()
    const timeOffOnlyPerson = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'resource.create',
          id: timeOffOnlyPersonId,
          fields: {
            kind: 'person',
            name: 'Test resource',
            avatarUrl: allocatedPerson!.avatarUrl,
            jobTitle: 'Designer',
            disciplineId: allocatedPerson!.disciplineId,
            employmentType: 'permanent',
            engagement: 'studio',
            workingHoursPerDay: 8,
            workingDays: [1, 2, 3, 4, 5],
            halfDays: [],
            projectId: null,
            color: allocatedPerson!.color,
            isFavourite: null,
            firstAvailableDate: null,
            lastAvailableDate: null,
          },
        })
      )
      .send()
    timeOffOnlyPerson.assertStatus(200)
    assert.equal(replyBody(timeOffOnlyPerson).revision, 1)
    const createdTimeOff = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'timeOff.create',
          timeOff: {
            id: randomUUID(),
            resourceId: timeOffOnlyPersonId,
            startDate: '2026-11-09',
            endDate: '2026-11-09',
            type: 'holiday',
          },
        })
      )
      .send()
    createdTimeOff.assertStatus(200)
    assert.equal(replyBody(createdTimeOff).revision, 2)
    const beforeTimeOffRefusal = await readState(companyId, true)
    assert.equal(
      beforeTimeOffRefusal.allocations.some(
        (allocation) => allocation.resourceId === timeOffOnlyPersonId
      ),
      false
    )
    assert.equal(
      beforeTimeOffRefusal.timeOff.some((entry) => entry.resourceId === timeOffOnlyPersonId),
      true
    )
    const timeOffAudits = await db.from('audit_entries').where('company_id', companyId)
    const timeOffMutations = await db.from('planning_mutations').where('company_id', companyId)

    const timeOffRefusal = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(2, {
          operation: 'resource.update',
          id: timeOffOnlyPersonId,
          changes: { kind: 'external' },
        })
      )
      .send()
    timeOffRefusal.assertStatus(422)
    assert.isNotEmpty(validationErrors(timeOffRefusal))
    assert.deepEqual(await readState(companyId, true), beforeTimeOffRefusal)
    assert.deepEqual(await db.from('audit_entries').where('company_id', companyId), timeOffAudits)
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId),
      timeOffMutations
    )
    const timeOffSnapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(replyBody(timeOffSnapshot).revision, 2)
  })

  test('rejects invalid allocation hours, dates, external work and external time off atomically', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const before = await readState(companyId, true)
    const baseAllocation = newAllocation(before)
    const external = before.resources.find((row) => row.kind === 'external')!
    const placeholder = before.resources.find((row) => row.kind === 'placeholder')!
    const otherProjectActivity = before.activities.find(
      (row) => row.kind === 'project' && row.projectId !== placeholder.projectId
    )
    assert.isDefined(otherProjectActivity)
    const validAllocation = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(mutationInput(0, { operation: 'allocation.create', allocation: baseAllocation }))
      .send()
    validAllocation.assertStatus(200)
    assert.equal(replyBody(validAllocation).revision, 1)
    const validTimeOff = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'timeOff.create',
          timeOff: {
            id: randomUUID(),
            resourceId: baseAllocation.resourceId,
            startDate: '2026-11-09',
            endDate: '2026-11-09',
            type: 'holiday',
          },
        })
      )
      .send()
    validTimeOff.assertStatus(200)
    assert.equal(replyBody(validTimeOff).revision, 2)
    const canonicalBeforeRefusals = await readState(companyId, true)
    const auditsBefore = await db.from('audit_entries').where('company_id', companyId)
    const mutationsBefore = await db.from('planning_mutations').where('company_id', companyId)

    // Request validation and the planning rules both refuse a malformed allocation with 422.
    const invalidAllocations = [
      { ...baseAllocation, hoursPerDay: 25 },
      { ...baseAllocation, startDate: '2026-11-06', endDate: '2026-11-02' },
      { ...baseAllocation, startDate: '', endDate: '' },
      { ...baseAllocation, resourceId: external.id },
      { ...baseAllocation, resourceId: randomUUID() },
      { ...baseAllocation, activityId: randomUUID() },
      { ...baseAllocation, resourceId: placeholder.id, activityId: otherProjectActivity!.id },
    ]
    for (const allocation of invalidAllocations) {
      const refused = await intentSession(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json(mutationInput(2, { operation: 'allocation.create', allocation }))
        .send()
      refused.assertStatus(422)
      assert.isNotEmpty(validationErrors(refused))
    }

    const storedAllocation = canonicalBeforeRefusals.allocations.find(
      (row) => row.id === baseAllocation.id
    )!
    const excessiveUpdate = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(2, {
          operation: 'allocation.update',
          id: storedAllocation.id,
          changes: { hoursPerDay: 99 },
        })
      )
      .send()
    excessiveUpdate.assertStatus(422)
    assert.isNotEmpty(validationErrors(excessiveUpdate))

    const refusedUpdate = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(2, {
          operation: 'allocation.update',
          id: storedAllocation.id,
          changes: { endDate: '2026-11-01' },
        })
      )
      .send()
    refusedUpdate.assertStatus(422)
    assert.isNotEmpty(validationErrors(refusedUpdate))

    const invalidTimeOff = [
      {
        id: randomUUID(),
        resourceId: baseAllocation.resourceId,
        startDate: '2026-11-06',
        endDate: '2026-11-02',
        type: 'holiday',
      },
      {
        id: randomUUID(),
        resourceId: external.id,
        startDate: '2026-11-02',
        endDate: '2026-11-02',
        type: 'holiday',
      },
      {
        id: randomUUID(),
        resourceId: 'missing-resource',
        startDate: '2026-11-02',
        endDate: '2026-11-02',
        type: 'holiday',
      },
    ]
    // The reversed range is refused by request validation, the others by planning rules; all 422.
    for (const timeOff of invalidTimeOff) {
      const refused = await intentSession(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json(mutationInput(2, { operation: 'timeOff.create', timeOff }))
        .send()
      refused.assertStatus(422)
      assert.isNotEmpty(validationErrors(refused))
    }

    assert.deepEqual(await readState(companyId, true), canonicalBeforeRefusals)
    assert.deepEqual(await db.from('audit_entries').where('company_id', companyId), auditsBefore)
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId),
      mutationsBefore
    )
    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(replyBody(snapshot).revision, 2)
  })

  test('refuses empty company working days without changing settings', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const before = await readState(companyId, true)
    const auditsBefore = await db.from('audit_entries').where('company_id', companyId)
    const mutationsBefore = await db.from('planning_mutations').where('company_id', companyId)

    const invalidSettings = [{ workingDays: [] }, { workingDays: [1, 9] }, { color: '#7cd9e4' }]
    for (const changes of invalidSettings) {
      const refused = await intentSession(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json(mutationInput(0, { operation: 'settings.update', changes }))
        .send()
      refused.assertStatus(422)
      assert.isNotEmpty(validationErrors(refused))
    }

    assert.deepEqual(await readState(companyId, true), before)
    assert.deepEqual(await db.from('audit_entries').where('company_id', companyId), auditsBefore)
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId),
      mutationsBefore
    )
    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(replyBody(snapshot).revision, 0)
  })

  test('refuses blank closure names without changing the stored closure', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const created = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'closure.create',
          id: randomUUID(),
          fields: { name: 'Winter break', startDate: '2026-12-24', endDate: '2026-12-25' },
        })
      )
      .send()
    created.assertStatus(200)
    const before = await readState(companyId, true)
    const closure = before.closures[0]!
    const auditsBefore = await db.from('audit_entries').where('company_id', companyId)
    const mutationsBefore = await db.from('planning_mutations').where('company_id', companyId)

    const refusedUpdate = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'closure.update',
          id: closure.id,
          changes: { name: '  ' },
        })
      )
      .send()
    refusedUpdate.assertStatus(422)
    assert.isNotEmpty(validationErrors(refusedUpdate))
    assert.deepEqual(await readState(companyId, true), before)
    assert.deepEqual(await db.from('audit_entries').where('company_id', companyId), auditsBefore)
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId),
      mutationsBefore
    )
    const snapshot = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    assert.equal(replyBody(snapshot).revision, 1)
  })

  test('ignores a display name sent on a write', async ({ client, assert, cleanup }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const initial = await readState(companyId, true)
    const color = initial.clients.find((row) => row.companyId === companyId)!.color
    const id = randomUUID()
    const created = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'catalogue.create',
          entity: {
            entity: 'clients',
            id,
            fields: { name: 'Daily Planet', color, displayName: 'Injected' },
          },
        })
      )
      .send()
    created.assertStatus(200)
    const read = await intentSession(
      client.visit('api.planning.show', { companyId }),
      cookie
    ).send()
    read.assertStatus(200)
    const row = (
      read.body().data as { data: { clients: Array<{ id: string; displayName?: string }> } }
    ).data.clients.find((candidate) => candidate.id === id)
    assert.equal(row?.displayName, 'Daily Planet')
    assert.notInclude(read.text(), 'Injected')
    const after = await readState(companyId, true)
    const stored = after.clients.find((candidate) => candidate.id === id)
    assert.notProperty(stored!, 'displayName')
  })
})

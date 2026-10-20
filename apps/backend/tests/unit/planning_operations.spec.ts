import { test } from '@japa/runner'
import {
  externalCapacityDefaults,
  placeholderCapacityDefaults,
} from '@capacitylens/shared/types/entities'
import {
  planningMutationValidator,
  allocationMutationValidator,
  catalogueMutationValidator,
  resourceMutationValidator,
  timeOffMutationValidator,
  closureMutationValidator,
  settingsMutationValidator,
  mutationLookupValidator,
  mutationLookupReplyValidator,
  planningMutationFailureValidator,
  assertPlanningBaseRevision,
  StalePlanningRevisionError,
  type PlanningMutationInput,
  type PlanningMutationSuccess,
} from '#validators/planning_operations'

const uuid = '782b6098-3560-4d96-a2b6-5c8b271c57b3'
const otherUuid = '86ca2a77-a2e8-4a13-bfa5-7c01f13fd4f5'

async function operationOf<T extends { intent: { operation: string } }>(validation: Promise<T>) {
  const result = await validation
  return result.intent.operation
}

test.group('planning operation contracts', () => {
  test('validates allocation creation and strips server-owned and unknown fields', async ({
    assert,
  }) => {
    const input = await planningMutationValidator.validate({
      mutationId: uuid,
      baseRevision: 0,
      intent: {
        operation: 'allocation.create',
        allocation: {
          id: otherUuid,
          resourceId: uuid,
          activityId: otherUuid,
          startDate: '2026-10-19',
          endDate: '2026-10-23',
          hoursPerDay: 7.5,
          status: 'confirmed',
          accountId: uuid,
          createdAt: '2026-10-19T00:00:00.000Z',
          seriesId: uuid,
          clientOnlyField: 'ignored',
        },
      },
    })

    assert.deepEqual(input.intent, {
      operation: 'allocation.create',
      allocation: {
        id: otherUuid,
        resourceId: uuid,
        activityId: otherUuid,
        startDate: '2026-10-19',
        endDate: '2026-10-23',
        hoursPerDay: 7.5,
        status: 'confirmed',
      },
    })
  })

  test('rejects malformed UUIDs, revisions and calendar dates', async ({ assert }) => {
    const base: PlanningMutationInput = {
      mutationId: uuid,
      baseRevision: 0,
      intent: {
        operation: 'allocation.create',
        allocation: {
          id: otherUuid,
          resourceId: uuid,
          activityId: otherUuid,
          startDate: '2026-02-30',
          endDate: '2026-03-02',
          hoursPerDay: 7.5,
          status: 'confirmed',
        },
      },
    }
    const validInput = {
      mutationId: uuid,
      baseRevision: 0,
      intent: {
        operation: 'allocation.create',
        allocation: {
          id: otherUuid,
          resourceId: uuid,
          activityId: otherUuid,
          startDate: '2026-03-02',
          endDate: '2026-03-06',
          hoursPerDay: 7.5,
          status: 'confirmed',
        },
      },
    } as const
    await assert.rejects(() => planningMutationValidator.validate(base))
    await assert.rejects(() =>
      planningMutationValidator.validate({ ...validInput, baseRevision: -1 })
    )
    await assert.rejects(() =>
      planningMutationValidator.validate({ ...validInput, baseRevision: '0' })
    )
    await assert.rejects(() =>
      planningMutationValidator.validate({ ...validInput, mutationId: 'not-a-uuid' })
    )
    await assert.rejects(() =>
      planningMutationValidator.validate({
        ...validInput,
        intent: {
          ...validInput.intent,
          allocation: { ...validInput.intent.allocation, hoursPerDay: '7.5' },
        },
      })
    )
    await assert.rejects(() =>
      planningMutationValidator.validate({
        ...validInput,
        intent: {
          ...validInput.intent,
          allocation: { ...validInput.intent.allocation, ignoreWeekends: 'true' },
        },
      })
    )
    await assert.rejects(() =>
      planningMutationValidator.validate({
        ...base,
        intent: {
          operation: 'allocation.create',
          allocation: {
            id: otherUuid,
            resourceId: uuid,
            activityId: otherUuid,
            startDate: '2026-03-03',
            endDate: '2026-03-02',
            hoursPerDay: 7.5,
            status: 'confirmed',
          },
        },
      })
    )
  })

  test('requires a writable update and preserves omission separately from null', async ({
    assert,
  }) => {
    await assert.rejects(() =>
      planningMutationValidator.validate({
        mutationId: uuid,
        baseRevision: 3,
        intent: { operation: 'allocation.update', id: uuid, changes: { unknown: true } },
      })
    )

    const omitted = await planningMutationValidator.validate({
      mutationId: uuid,
      baseRevision: 3,
      intent: {
        operation: 'allocation.update',
        id: uuid,
        changes: { status: 'tentative' },
      },
    })
    const cleared = await planningMutationValidator.validate({
      mutationId: otherUuid,
      baseRevision: 3,
      intent: {
        operation: 'allocation.update',
        id: uuid,
        changes: { note: null },
      },
    })

    assert.deepEqual(omitted.intent, {
      operation: 'allocation.update',
      id: uuid,
      changes: { status: 'tentative' },
    })
    assert.deepEqual(cleared.intent, {
      operation: 'allocation.update',
      id: uuid,
      changes: { note: null },
    })
  })

  test('requires distinct client-minted IDs for atomic repeated allocations', async ({
    assert,
  }) => {
    const valid = await planningMutationValidator.validate({
      mutationId: uuid,
      baseRevision: 5,
      intent: {
        operation: 'allocation.repeat',
        sourceAllocationId: uuid,
        occurrences: [
          { id: otherUuid, startDate: '2026-10-26', endDate: '2026-10-30' },
          {
            id: 'eb149a79-2581-40bd-8b7e-82f540243d2c',
            startDate: '2026-11-02',
            endDate: '2026-11-06',
          },
        ],
      },
    })
    assert.equal(valid.intent.operation, 'allocation.repeat')

    const duplicate = await planningMutationValidator.validate({
      mutationId: otherUuid,
      baseRevision: 5,
      intent: {
        operation: 'allocation.duplicate',
        sourceAllocationId: uuid,
        occurrence: {
          id: 'eb149a79-2581-40bd-8b7e-82f540243d2c',
          startDate: '2026-10-26',
          endDate: '2026-10-30',
        },
      },
    })
    assert.equal(duplicate.intent.operation, 'allocation.duplicate')

    await assert.rejects(() =>
      planningMutationValidator.validate({
        mutationId: otherUuid,
        baseRevision: 5,
        intent: {
          operation: 'allocation.duplicate',
          sourceAllocationId: uuid,
          occurrence: { id: uuid, startDate: '2026-10-26', endDate: '2026-10-30' },
        },
      })
    )

    await assert.rejects(() =>
      planningMutationValidator.validate({
        mutationId: uuid,
        baseRevision: 5,
        intent: {
          operation: 'allocation.repeat',
          sourceAllocationId: uuid,
          occurrences: [
            { id: otherUuid, startDate: '2026-10-26', endDate: '2026-10-30' },
            { id: otherUuid, startDate: '2026-11-02', endDate: '2026-11-06' },
          ],
        },
      })
    )
  })

  test('validates named catalogue, resource, time-off, closure and settings operations', async ({
    assert,
  }) => {
    assert.equal(
      await operationOf(
        catalogueMutationValidator.validate({
          mutationId: uuid,
          baseRevision: 8,
          intent: { operation: 'catalogue.delete', entity: { entity: 'phases', id: uuid } },
        })
      ),
      'catalogue.delete'
    )
    assert.equal(
      await operationOf(
        resourceMutationValidator.validate({
          mutationId: uuid,
          baseRevision: 8,
          intent: { operation: 'resource.update', id: uuid, changes: { role: 'Designer' } },
        })
      ),
      'resource.update'
    )
    assert.equal(
      await operationOf(
        timeOffMutationValidator.validate({
          mutationId: uuid,
          baseRevision: 8,
          intent: { operation: 'timeOff.delete', id: uuid },
        })
      ),
      'timeOff.delete'
    )
    assert.equal(
      await operationOf(
        closureMutationValidator.validate({
          mutationId: uuid,
          baseRevision: 8,
          intent: { operation: 'closure.delete', id: uuid },
        })
      ),
      'closure.delete'
    )
    assert.equal(
      await operationOf(
        settingsMutationValidator.validate({
          mutationId: uuid,
          baseRevision: 8,
          intent: { operation: 'settings.update', changes: { weekStartsOn: 0 } },
        })
      ),
      'settings.update'
    )
    assert.equal(
      await operationOf(
        allocationMutationValidator.validate({
          mutationId: uuid,
          baseRevision: 8,
          intent: { operation: 'allocation.delete', id: uuid },
        })
      ),
      'allocation.delete'
    )

    const catalogue = await planningMutationValidator.validate({
      mutationId: uuid,
      baseRevision: 8,
      intent: {
        operation: 'catalogue.create',
        entity: {
          entity: 'clients',
          id: otherUuid,
          fields: {
            name: 'Wayne Enterprises',
            color: '#f5bcbc',
            isPrivate: false,
            codeName: null,
            builtin: true,
          },
        },
      },
    })
    const catalogueDelete = await planningMutationValidator.validate({
      mutationId: 'f6498a84-8ed9-4a25-901a-f7e5ca435c39',
      baseRevision: 8,
      intent: { operation: 'catalogue.delete', entity: { entity: 'phases', id: uuid } },
    })
    const resource = await planningMutationValidator.validate({
      mutationId: otherUuid,
      baseRevision: 8,
      intent: {
        operation: 'resource.update',
        id: uuid,
        changes: { workingDays: [1, 2, 3, 4, 5], kind: 'external', archivedAt: '2026-10-20' },
      },
    })
    const timeOff = await planningMutationValidator.validate({
      mutationId: 'f0b7fcba-0566-4170-b018-c300c10e3ea1',
      baseRevision: 8,
      intent: {
        operation: 'timeOff.repeat',
        entries: [
          {
            id: '97710863-4328-4a8f-b2b1-dae930003cdb',
            resourceId: uuid,
            startDate: '2026-10-26',
            endDate: '2026-10-26',
            type: 'holiday',
          },
          {
            id: 'afc8a820-43fd-4a84-b98c-d42a8a46eb41',
            resourceId: uuid,
            startDate: '2026-11-02',
            endDate: '2026-11-02',
            type: 'holiday',
          },
        ],
      },
    })
    const closure = await planningMutationValidator.validate({
      mutationId: '0066854a-9ec8-4854-8fe4-4d29c7210a32',
      baseRevision: 8,
      intent: {
        operation: 'closure.create',
        id: '1ffb7b6e-4a16-44e1-9fa5-796869d8c1a5',
        fields: { name: 'Studio closed', startDate: '2026-12-25', endDate: '2026-12-25' },
      },
    })
    const settings = await planningMutationValidator.validate({
      mutationId: '3790048c-8926-47b1-ac3f-88722ee43bb6',
      baseRevision: 8,
      intent: {
        operation: 'settings.update',
        changes: {
          dateStyle: 'day-month',
          timezone: 'Etc/GMT',
          weekStartsOn: 0,
          createdAt: '2026-10-20T00:00:00.000Z',
        },
      },
    })

    assert.equal(catalogue.intent.operation, 'catalogue.create')
    assert.equal(catalogueDelete.intent.operation, 'catalogue.delete')
    if (resource.intent.operation === 'resource.update') {
      assert.deepEqual(resource.intent.changes, { workingDays: [1, 2, 3, 4, 5] })
    }
    if (timeOff.intent.operation === 'timeOff.repeat')
      assert.equal(timeOff.intent.entries.length, 2)
    assert.equal(closure.intent.operation, 'closure.create')
    await assert.rejects(() =>
      planningMutationValidator.validate({
        mutationId: otherUuid,
        baseRevision: 8,
        intent: {
          operation: 'closure.create',
          id: otherUuid,
          fields: { name: '   ', startDate: '2026-12-25', endDate: '2026-12-25' },
        },
      })
    )
    if (settings.intent.operation === 'settings.update') {
      assert.deepEqual(settings.intent.changes, {
        dateStyle: 'day-month',
        timezone: 'Etc/GMT',
        weekStartsOn: 0,
      })
    }
  })

  test('uses a fresh mutation ID and captured revision for each Undo and Redo execution', async ({
    assert,
  }) => {
    const create = await planningMutationValidator.validate({
      mutationId: uuid,
      baseRevision: 10,
      intent: {
        operation: 'allocation.create',
        allocation: {
          id: otherUuid,
          resourceId: uuid,
          activityId: otherUuid,
          startDate: '2026-10-26',
          endDate: '2026-10-30',
          hoursPerDay: 7.5,
          status: 'confirmed',
        },
      },
    })
    const undo = await planningMutationValidator.validate({
      mutationId: 'f0b7fcba-0566-4170-b018-c300c10e3ea1',
      baseRevision: 11,
      intent: { operation: 'allocation.delete', id: otherUuid },
    })
    const redo = await planningMutationValidator.validate({
      mutationId: '97710863-4328-4a8f-b2b1-dae930003cdb',
      baseRevision: 12,
      intent: { operation: 'planning.restoreGroup', restorationGroupId: uuid },
    })
    const undoAgain = await planningMutationValidator.validate({
      mutationId: 'afc8a820-43fd-4a84-b98c-d42a8a46eb41',
      baseRevision: 13,
      intent: { operation: 'allocation.delete', id: otherUuid },
    })

    assert.equal(
      new Set([create.mutationId, undo.mutationId, redo.mutationId, undoAgain.mutationId]).size,
      4
    )
    assert.deepEqual(
      [create.baseRevision, undo.baseRevision, redo.baseRevision, undoAgain.baseRevision],
      [10, 11, 12, 13]
    )
  })

  test('models committed and unknown mutation lookup separately', async ({ assert }) => {
    assert.deepEqual(await mutationLookupValidator.validate({ mutationId: uuid }), {
      mutationId: uuid,
    })
    const committed = await mutationLookupReplyValidator.validate({
      status: 'committed',
      mutationId: uuid,
      revision: 6,
      restorationGroupId: otherUuid,
    })
    const unknown = await mutationLookupReplyValidator.validate({
      status: 'unknown',
      mutationId: uuid,
    })
    assert.equal(committed.status, 'committed')
    assert.equal(unknown.status, 'unknown')

    const stale = await planningMutationFailureValidator.validate({
      error: 'The planning revision changed.',
      code: 'stale_revision',
    })
    const refused = await planningMutationFailureValidator.validate({
      error: 'This action is not allowed.',
      code: 'authorization_denied',
    })
    const noChange = await planningMutationFailureValidator.validate({
      error: 'The requested values are unchanged.',
      code: 'no_change',
    })
    assert.equal(stale.code, 'stale_revision')
    assert.equal(refused.code, 'authorization_denied')
    assert.equal(noChange.code, 'no_change')
  })

  test('types delete-created restore handles and explicit refetch responses', ({ assert }) => {
    const deletion: PlanningMutationSuccess = {
      status: 'committed',
      mutationId: uuid,
      revision: 18,
      restoration: { consumedGroupId: null, replacementGroupId: otherUuid },
      projection: {
        mode: 'patch',
        history: 'retain',
        changed: { upserts: [], removed: [{ entity: 'allocations', id: uuid }] },
      },
    }
    const restoration: PlanningMutationSuccess = {
      ...deletion,
      mutationId: otherUuid,
      revision: 19,
      restoration: { consumedGroupId: otherUuid, replacementGroupId: null },
    }
    const refetch: PlanningMutationSuccess = {
      ...deletion,
      projection: { mode: 'refetch', history: 'clear' },
    }

    assert.deepEqual(deletion.restoration, {
      consumedGroupId: null,
      replacementGroupId: otherUuid,
    })
    assert.deepEqual(restoration.restoration, {
      consumedGroupId: otherUuid,
      replacementGroupId: null,
    })
    assert.deepEqual(refetch.projection, { mode: 'refetch', history: 'clear' })
  })

  test('malformed repeat entries fail as validation errors, not rule exceptions', async ({
    assert,
  }) => {
    for (const intent of [
      { operation: 'allocation.repeat', sourceAllocationId: uuid, occurrences: [null] },
      { operation: 'timeOff.repeat', entries: [null] },
    ]) {
      let error: unknown
      try {
        await planningMutationValidator.validate({ mutationId: otherUuid, baseRevision: 0, intent })
      } catch (caught) {
        error = caught
      }
      assert.equal((error as { code?: string })?.code, 'E_VALIDATION_ERROR')
    }
  })

  test('retains resource-kind defaults and scalar validity', async ({ assert }) => {
    const external = {
      kind: 'external',
      name: 'Wayne Partners',
      role: 'Consultant',
      avatarUrl: null,
      disciplineId: null,
      ...externalCapacityDefaults(),
      projectId: null,
      color: '#9ca3af',
      isFavourite: false,
      firstAvailableDate: null,
      lastAvailableDate: null,
    }
    const valid = await resourceMutationValidator.validate({
      mutationId: uuid,
      baseRevision: 1,
      intent: { operation: 'resource.create', id: otherUuid, fields: external },
    })
    assert.equal(valid.intent.operation, 'resource.create')

    for (const fields of [
      { ...external, color: '#f5bcbc' },
      { ...external, workingDays: [1, 1, 2] },
      { ...external, workingHoursPerDay: 0 },
      { ...external, avatarUrl: 'https://user:secret@example.test/avatar.png' },
      { ...external, name: 'x'.repeat(300) },
    ]) {
      await assert.rejects(() =>
        resourceMutationValidator.validate({
          mutationId: uuid,
          baseRevision: 1,
          intent: { operation: 'resource.create', id: otherUuid, fields },
        })
      )
    }
  })

  test('accepts placeholder defaults and rejects invalid person and partial weekday sets', async ({
    assert,
  }) => {
    const placeholder = {
      kind: 'placeholder',
      name: 'Wayne Enterprises capacity',
      role: 'Design support',
      avatarUrl: null,
      disciplineId: otherUuid,
      employmentType: 'contractor',
      engagement: 'studio',
      workingHoursPerDay: 6,
      ...placeholderCapacityDefaults(),
      projectId: otherUuid,
      color: '#3ace6b',
      isFavourite: false,
      firstAvailableDate: null,
      lastAvailableDate: null,
    }
    const validPlaceholder = await resourceMutationValidator.validate({
      mutationId: uuid,
      baseRevision: 1,
      intent: { operation: 'resource.create', id: otherUuid, fields: placeholder },
    })
    assert.equal(validPlaceholder.intent.operation, 'resource.create')

    const person = {
      ...placeholder,
      kind: 'person',
      name: 'Diana Prince',
      disciplineId: otherUuid,
      employmentType: 'permanent',
      workingDays: [1, 2],
      halfDays: [2],
      projectId: null,
    }
    await assert.rejects(() =>
      resourceMutationValidator.validate({
        mutationId: uuid,
        baseRevision: 1,
        intent: {
          operation: 'resource.create',
          id: otherUuid,
          fields: { ...person, workingDays: [] },
        },
      })
    )
    await assert.rejects(() =>
      resourceMutationValidator.validate({
        mutationId: uuid,
        baseRevision: 1,
        intent: {
          operation: 'resource.update',
          id: otherUuid,
          changes: { workingDays: [1], halfDays: [2] },
        },
      })
    )
  })

  test('returns a typed stale-revision conflict without implying transactional enforcement', ({
    assert,
  }) => {
    let conflict: unknown
    try {
      assertPlanningBaseRevision(4, 5, uuid)
    } catch (error) {
      conflict = error
    }
    assert.instanceOf(conflict, StalePlanningRevisionError)
    assert.equal((conflict as StalePlanningRevisionError).statusCode, 409)
    assert.equal((conflict as StalePlanningRevisionError).code, 'stale_revision')
    assert.doesNotThrow(() => assertPlanningBaseRevision(5, 5, uuid))
  })
})

import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import { readState } from '#tests/helpers/state_fixture';
import {
  accountId,
  configureAuth,
  newAllocation,
  planningUrl,
  resetPlanningFixture,
  session,
  signIn,
} from './helpers.js';

const body = (response: { body(): unknown }) =>
  response.body() as { code: string; revision: number; message?: string };
const route = (path: string) => `/api/accounts/${accountId}/${path}`;
const input = (baseRevision: number, intent: Record<string, unknown>) => ({
  mutationId: randomUUID(),
  baseRevision,
  intent,
});

test.group('planning request rule boundaries', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('refuses private clients and projects without a usable code name atomically', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const initial = await readState(accountId, true);
    const clientId = randomUUID();
    const validClient = await session(client.post(route('clients')), cookie)
      .json(
        input(0, {
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
      .send();
    validClient.assertStatus(200);
    assert.equal(body(validClient).revision, 1);
    const validProject = await session(client.post(route('projects')), cookie)
      .json(
        input(1, {
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
      .send();
    validProject.assertStatus(200);
    assert.equal(body(validProject).revision, 2);
    const paddedPreset = await session(client.post(route('clients')), cookie)
      .json(
        input(2, {
          operation: 'catalogue.create',
          entity: {
            entity: 'clients',
            id: randomUUID(),
            fields: { name: 'Padded preset', color: '  #E02727  ' },
          },
        })
      )
      .send();
    paddedPreset.assertStatus(200);
    assert.equal(body(paddedPreset).revision, 3);
    const before = await readState(accountId, true);
    assert.equal(before.clients.find((row) => row.name === 'Padded preset')?.color, '#E02727');
    const auditsBefore = await db.from('audit_entries').where('account_id', accountId);
    const mutationsBefore = await db.from('planning_mutations').where('account_id', accountId);

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
            };
      const refused = await session(client.post(route(entity)), cookie)
        .json(
          input(3, {
            operation: 'catalogue.create',
            entity: { entity, id: randomUUID(), fields },
          })
        )
        .send();
      refused.assertStatus(400);
      assert.equal(body(refused).code, 'VALIDATION_ERROR');
    }

    for (const color of ['#7cd9e4']) {
      const refused = await session(client.post(route('clients')), cookie)
        .json(
          input(3, {
            operation: 'catalogue.create',
            entity: {
              entity: 'clients',
              id: randomUUID(),
              fields: { name: 'Invalid colour', color },
            },
          })
        )
        .send();
      refused.assertStatus(400);
      assert.equal(body(refused).code, 'VALIDATION_ERROR');
    }

    assert.deepEqual(await readState(accountId, true), before);
    assert.deepEqual(await db.from('audit_entries').where('account_id', accountId), auditsBefore);
    assert.deepEqual(
      await db.from('planning_mutations').where('account_id', accountId),
      mutationsBefore
    );
    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(body(snapshot).revision, 3);
  });

  test('rejects incoherent activity project and phase requests at the route boundary', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const initial = await readState(accountId, true);
    const activity = initial.activities.find((row) => row.phaseId !== null)!;
    const otherProject = initial.projects.find((row) => row.id !== activity.projectId)!;
    const valid = await session(client.patch(route(`activities/${activity.id}`)), cookie)
      .json(
        input(0, {
          operation: 'catalogue.update',
          entity: { entity: 'activities', id: activity.id, changes: { name: 'Survey work' } },
        })
      )
      .send();
    valid.assertStatus(200);
    assert.equal(body(valid).revision, 1);
    const before = await readState(accountId, true);
    const auditsBefore = await db.from('audit_entries').where('account_id', accountId);
    const mutationsBefore = await db.from('planning_mutations').where('account_id', accountId);

    const wrongProject = await session(client.patch(route(`activities/${activity.id}`)), cookie)
      .json(
        input(1, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activity.id,
            changes: { projectId: otherProject.id },
          },
        })
      )
      .send();
    wrongProject.assertStatus(400);
    assert.equal(body(wrongProject).code, 'VALIDATION_ERROR');

    const unassignedProjectActivity = await session(
      client.patch(route(`activities/${activity.id}`)),
      cookie
    )
      .json(
        input(1, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activity.id,
            changes: { projectId: null },
          },
        })
      )
      .send();
    unassignedProjectActivity.assertStatus(400);
    assert.equal(body(unassignedProjectActivity).code, 'VALIDATION_ERROR');

    const wrongKind = await session(client.post(route('activities')), cookie)
      .json(
        input(1, {
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
      .send();
    wrongKind.assertStatus(400);
    assert.equal(body(wrongKind).code, 'VALIDATION_ERROR');
    assert.deepEqual(await readState(accountId, true), before);
    assert.deepEqual(await db.from('audit_entries').where('account_id', accountId), auditsBefore);
    assert.deepEqual(
      await db.from('planning_mutations').where('account_id', accountId),
      mutationsBefore
    );
    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(body(snapshot).revision, 1);
  });

  test('rejects invalid person and placeholder working patterns and placeholder engagement', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(accountId, true);
    const person = before.resources.find((row) => row.kind === 'person')!;
    const placeholder = before.resources.find((row) => row.kind === 'placeholder')!;
    const priorUpdatedAt = '2098-01-01T00:00:00.000Z';
    await db
      .from('resources')
      .where({ id: person.id, account_id: accountId })
      .update({ updated_at: priorUpdatedAt });
    const valid = await session(client.patch(route(`resources/${person.id}`)), cookie)
      .json(input(0, { operation: 'resource.update', id: person.id, changes: { role: 'Lead' } }))
      .send();
    valid.assertStatus(200);
    assert.equal(body(valid).revision, 1);
    const canonicalBeforeRefusals = await readState(accountId, true);
    const updatedPerson = canonicalBeforeRefusals.resources.find((row) => row.id === person.id)!;
    assert.isAbove(Date.parse(updatedPerson.updatedAt), Date.parse(priorUpdatedAt));
    const auditsBefore = await db.from('audit_entries').where('account_id', accountId);
    const mutationsBefore = await db.from('planning_mutations').where('account_id', accountId);

    const invalidCases = [
      { id: person.id, changes: { workingDays: [] } },
      { id: person.id, changes: { workingDays: [1, 2], halfDays: [3] } },
      { id: person.id, changes: { halfDays: [1, 1] } },
      { id: person.id, changes: { workingHoursPerDay: 0 } },
      { id: placeholder.id, changes: { engagement: 'supplementary' } },
      { id: placeholder.id, changes: { workingDays: [0, 6], halfDays: [6] } },
    ];
    for (const { id, changes } of invalidCases) {
      const refused = await session(client.patch(route(`resources/${id}`)), cookie)
        .json(input(1, { operation: 'resource.update', id, changes }))
        .send();
      refused.assertStatus(400);
      assert.equal(body(refused).code, 'VALIDATION_ERROR');
    }

    const changedKind = await session(client.patch(route(`resources/${person.id}`)), cookie)
      .json(
        input(1, { operation: 'resource.update', id: person.id, changes: { kind: 'placeholder' } })
      )
      .send();
    changedKind.assertStatus(400);
    assert.equal(body(changedKind).code, 'VALIDATION_ERROR');

    assert.deepEqual(await readState(accountId, true), canonicalBeforeRefusals);
    assert.deepEqual(await db.from('audit_entries').where('account_id', accountId), auditsBefore);
    assert.deepEqual(
      await db.from('planning_mutations').where('account_id', accountId),
      mutationsBefore
    );
    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(body(snapshot).revision, 1);
  });

  test('refuses converting a resource with loaded allocation or time off to external atomically', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const initial = await readState(accountId, true);
    const allocatedPerson = initial.resources.find(
      (resource) =>
        resource.kind === 'person' &&
        initial.allocations.some(
          (allocation) => allocation.resourceId === resource.id && allocation.hoursPerDay !== 0
        ) &&
        !initial.timeOff.some((entry) => entry.resourceId === resource.id)
    );
    assert.isDefined(allocatedPerson);
    const initialAudits = await db.from('audit_entries').where('account_id', accountId);
    const initialMutations = await db.from('planning_mutations').where('account_id', accountId);

    const allocationRefusal = await session(
      client.patch(route(`resources/${allocatedPerson!.id}`)),
      cookie
    )
      .json(
        input(0, {
          operation: 'resource.update',
          id: allocatedPerson!.id,
          changes: { kind: 'external' },
        })
      )
      .send();
    allocationRefusal.assertStatus(400);
    assert.equal(body(allocationRefusal).code, 'VALIDATION_ERROR');
    assert.deepEqual(await readState(accountId, true), initial);
    assert.deepEqual(await db.from('audit_entries').where('account_id', accountId), initialAudits);
    assert.deepEqual(
      await db.from('planning_mutations').where('account_id', accountId),
      initialMutations
    );
    const initialSnapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(body(initialSnapshot).revision, 0);

    const timeOffOnlyPersonId = randomUUID();
    const timeOffOnlyPerson = await session(client.post(route('resources')), cookie)
      .json(
        input(0, {
          operation: 'resource.create',
          id: timeOffOnlyPersonId,
          fields: {
            kind: 'person',
            name: 'Test resource',
            avatarUrl: allocatedPerson!.avatarUrl,
            role: 'Designer',
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
      .send();
    timeOffOnlyPerson.assertStatus(200);
    assert.equal(body(timeOffOnlyPerson).revision, 1);
    const createdTimeOff = await session(client.post(route('time-off')), cookie)
      .json(
        input(1, {
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
      .send();
    createdTimeOff.assertStatus(200);
    assert.equal(body(createdTimeOff).revision, 2);
    const beforeTimeOffRefusal = await readState(accountId, true);
    assert.equal(
      beforeTimeOffRefusal.allocations.some(
        (allocation) => allocation.resourceId === timeOffOnlyPersonId
      ),
      false
    );
    assert.equal(
      beforeTimeOffRefusal.timeOff.some((entry) => entry.resourceId === timeOffOnlyPersonId),
      true
    );
    const timeOffAudits = await db.from('audit_entries').where('account_id', accountId);
    const timeOffMutations = await db.from('planning_mutations').where('account_id', accountId);

    const timeOffRefusal = await session(
      client.patch(route(`resources/${timeOffOnlyPersonId}`)),
      cookie
    )
      .json(
        input(2, {
          operation: 'resource.update',
          id: timeOffOnlyPersonId,
          changes: { kind: 'external' },
        })
      )
      .send();
    timeOffRefusal.assertStatus(400);
    assert.equal(body(timeOffRefusal).code, 'VALIDATION_ERROR');
    assert.deepEqual(await readState(accountId, true), beforeTimeOffRefusal);
    assert.deepEqual(await db.from('audit_entries').where('account_id', accountId), timeOffAudits);
    assert.deepEqual(
      await db.from('planning_mutations').where('account_id', accountId),
      timeOffMutations
    );
    const timeOffSnapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(body(timeOffSnapshot).revision, 2);
  });

  test('rejects invalid allocation hours, dates, external work and external time off atomically', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(accountId, true);
    const baseAllocation = newAllocation(before);
    const external = before.resources.find((row) => row.kind === 'external')!;
    const placeholder = before.resources.find((row) => row.kind === 'placeholder')!;
    const otherProjectActivity = before.activities.find(
      (row) => row.kind === 'project' && row.projectId !== placeholder.projectId
    );
    assert.isDefined(otherProjectActivity);
    const validAllocation = await session(client.post(route('allocations')), cookie)
      .json(input(0, { operation: 'allocation.create', allocation: baseAllocation }))
      .send();
    validAllocation.assertStatus(200);
    assert.equal(body(validAllocation).revision, 1);
    const validTimeOff = await session(client.post(route('time-off')), cookie)
      .json(
        input(1, {
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
      .send();
    validTimeOff.assertStatus(200);
    assert.equal(body(validTimeOff).revision, 2);
    const canonicalBeforeRefusals = await readState(accountId, true);
    const auditsBefore = await db.from('audit_entries').where('account_id', accountId);
    const mutationsBefore = await db.from('planning_mutations').where('account_id', accountId);

    const invalidAllocations = [
      { ...baseAllocation, hoursPerDay: 25 },
      { ...baseAllocation, startDate: '2026-11-06', endDate: '2026-11-02' },
      { ...baseAllocation, startDate: '', endDate: '' },
      { ...baseAllocation, resourceId: external.id },
      {
        ...baseAllocation,
        resourceId: placeholder.id,
        activityId: otherProjectActivity!.id,
      },
    ];
    for (const allocation of invalidAllocations) {
      const refused = await session(client.post(route('allocations')), cookie)
        .json(input(2, { operation: 'allocation.create', allocation }))
        .send();
      refused.assertStatus(400);
      assert.equal(body(refused).code, 'VALIDATION_ERROR');
    }

    const storedAllocation = canonicalBeforeRefusals.allocations.find(
      (row) => row.id === baseAllocation.id
    )!;
    const excessiveUpdate = await session(
      client.patch(route(`allocations/${storedAllocation.id}`)),
      cookie
    )
      .json(
        input(2, {
          operation: 'allocation.update',
          id: storedAllocation.id,
          changes: { hoursPerDay: 99 },
        })
      )
      .send();
    excessiveUpdate.assertStatus(400);
    assert.equal(body(excessiveUpdate).code, 'VALIDATION_ERROR');

    const refusedUpdate = await session(
      client.patch(route(`allocations/${storedAllocation.id}`)),
      cookie
    )
      .json(
        input(2, {
          operation: 'allocation.update',
          id: storedAllocation.id,
          changes: { endDate: '2026-11-01' },
        })
      )
      .send();
    refusedUpdate.assertStatus(400);
    assert.equal(body(refusedUpdate).code, 'VALIDATION_ERROR');

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
    ];
    for (const timeOff of invalidTimeOff) {
      const refused = await session(client.post(route('time-off')), cookie)
        .json(input(2, { operation: 'timeOff.create', timeOff }))
        .send();
      refused.assertStatus(400);
      assert.equal(body(refused).code, 'VALIDATION_ERROR');
    }

    assert.deepEqual(await readState(accountId, true), canonicalBeforeRefusals);
    assert.deepEqual(await db.from('audit_entries').where('account_id', accountId), auditsBefore);
    assert.deepEqual(
      await db.from('planning_mutations').where('account_id', accountId),
      mutationsBefore
    );
    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(body(snapshot).revision, 2);
  });

  test('refuses empty company working days without changing settings', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(accountId, true);
    const auditsBefore = await db.from('audit_entries').where('account_id', accountId);
    const mutationsBefore = await db.from('planning_mutations').where('account_id', accountId);

    const invalidSettings = [{ workingDays: [] }, { workingDays: [1, 9] }, { color: '#7cd9e4' }];
    for (const changes of invalidSettings) {
      const refused = await session(client.patch(route('settings')), cookie)
        .json(input(0, { operation: 'settings.update', changes }))
        .send();
      refused.assertStatus(400);
      assert.equal(body(refused).code, 'VALIDATION_ERROR');
    }

    assert.deepEqual(await readState(accountId, true), before);
    assert.deepEqual(await db.from('audit_entries').where('account_id', accountId), auditsBefore);
    assert.deepEqual(
      await db.from('planning_mutations').where('account_id', accountId),
      mutationsBefore
    );
    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(body(snapshot).revision, 0);
  });

  test('refuses blank closure names without changing the stored closure', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const created = await session(client.post(route('closures')), cookie)
      .json(
        input(0, {
          operation: 'closure.create',
          id: randomUUID(),
          fields: { name: 'Winter break', startDate: '2026-12-24', endDate: '2026-12-25' },
        })
      )
      .send();
    created.assertStatus(200);
    const before = await readState(accountId, true);
    const closure = before.closures[0]!;
    const auditsBefore = await db.from('audit_entries').where('account_id', accountId);
    const mutationsBefore = await db.from('planning_mutations').where('account_id', accountId);

    const refusedUpdate = await session(client.patch(route(`closures/${closure.id}`)), cookie)
      .json(
        input(1, {
          operation: 'closure.update',
          id: closure.id,
          changes: { name: '  ' },
        })
      )
      .send();
    refusedUpdate.assertStatus(400);
    assert.equal(body(refusedUpdate).code, 'VALIDATION_ERROR');
    assert.deepEqual(await readState(accountId, true), before);
    assert.deepEqual(await db.from('audit_entries').where('account_id', accountId), auditsBefore);
    assert.deepEqual(
      await db.from('planning_mutations').where('account_id', accountId),
      mutationsBefore
    );
    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(body(snapshot).revision, 1);
  });
});

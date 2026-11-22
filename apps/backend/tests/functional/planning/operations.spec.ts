import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import db from '@adonisjs/lucid/services/db';
import { APP_DATA_KEYS, type AppData, type AppDataKey } from '@capacitylens/shared/types/entities';
import { readState } from '#tests/helpers/state_fixture';
import {
  companyId,
  configureAuth,
  newAllocation,
  planningUrl,
  resetPlanningFixture,
  session,
  signIn,
} from '#tests/functional/planning/helpers';
import { listCreatedAllocationIds } from '#tests/functional/planning/restoration_helpers';

/** Reads a success answer inside its `data` envelope and a refusal as it stands. */
const body = (response: { body(): unknown; status(): number }) =>
  (response.status() < 300 ? (response.body() as { data: unknown }).data : response.body()) as {
    code: string;
    revision: number;
  };
const route = (path: string) => `/api/companies/${companyId}/${path}`;
const input = (baseRevision: number, intent: Record<string, unknown>) => ({
  mutationId: randomUUID(),
  baseRevision,
  intent,
});

test.group('authenticated planning operations', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('Viewer writes and foreign references are refused', async ({ client, assert, cleanup }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie: viewerCookie } = await signIn(client, 'viewer');
    const allocation = newAllocation(data);
    const viewer = await session(client.post(route('planning/mutations')), viewerCookie)
      .json(input(0, { operation: 'allocation.create', allocation }))
      .send();
    viewer.assertStatus(403);
    assert.equal(body(viewer).code, 'AUTHORIZATION_DENIED');

    const { cookie } = await signIn(client);

    const allAccounts = await readState();
    const foreignResource = allAccounts.resources.find((row) => row.companyId === 'a-loft')!;
    const foreign = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(0, {
          operation: 'allocation.create',
          allocation: {
            ...allocation,
            resourceId: foreignResource.id,
          },
        })
      )
      .send();
    foreign.assertStatus(400);
    assert.equal(body(foreign).code, 'VALIDATION_ERROR');
    const current = await session(client.get(planningUrl), cookie).send();
    assert.equal(body(current).revision, 0);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0);
  });

  test('Editor creates public catalogue rows and updates their dependent family', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client, 'editor');
    const color = data.clients.find((row) => row.companyId === companyId && !row.builtin)!.color;
    const clientId = randomUUID();
    const projectId = randomUUID();
    const phaseId = randomUUID();
    const activityId = randomUUID();
    const disciplineId = randomUUID();
    const operations = [
      {
        entity: 'clients',
        id: clientId,
        fields: { name: 'Wayne Foundation', color },
      },
      {
        entity: 'projects',
        id: projectId,
        fields: { name: 'Gotham Renewal', color, clientId },
      },
      { entity: 'phases', id: phaseId, fields: { name: 'Discovery', projectId } },
      {
        entity: 'activities',
        id: activityId,
        fields: { name: 'Research', kind: 'project', projectId, phaseId },
      },
      {
        entity: 'disciplines',
        id: disciplineId,
        fields: { name: 'Strategy', color },
      },
    ];
    for (const [index, operation] of operations.entries()) {
      const response = await session(client.post(route('planning/mutations')), cookie)
        .json(
          input(index, {
            operation: 'catalogue.create',
            entity: {
              entity: operation.entity,
              id: operation.id,
              fields: operation.fields,
            },
          })
        )
        .send();
      response.assertStatus(200);
      assert.equal(body(response).revision, index + 1);
    }
    const updated = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(5, {
          operation: 'catalogue.update',
          entity: {
            entity: 'phases',
            id: phaseId,
            changes: { name: 'Planning' },
          },
        })
      )
      .send();
    updated.assertStatus(200);
    assert.equal(body(updated).revision, 6);
    const state = await readState(companyId, true);
    assert.equal(state.clients.find((row) => row.id === clientId)?.isPrivate, null);
    assert.equal(state.projects.find((row) => row.id === projectId)?.clientId, clientId);
    assert.equal(state.activities.find((row) => row.id === activityId)?.phaseId, phaseId);
    assert.equal(state.phases.find((row) => row.id === phaseId)?.name, 'Planning');
    // The server appends the new discipline after the company's highest sort order.
    const highest = Math.max(
      ...data.disciplines.filter((row) => row.companyId === companyId).map((row) => row.sortOrder)
    );
    assert.equal(state.disciplines.find((row) => row.id === disciplineId)?.sortOrder, highest + 1);
  });

  test('Editor creates a resource and patches its role without changing its capacity', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const original = data.resources.find(
      (row) => row.companyId === companyId && row.kind === 'person'
    )!;
    const { cookie } = await signIn(client, 'editor');
    const id = randomUUID();
    const fields = {
      kind: 'person',
      name: 'Dick Grayson',
      jobTitle: 'Designer',
      avatarUrl: null,
      disciplineId: original.disciplineId,
      employmentType: original.employmentType,
      engagement: original.engagement,
      workingHoursPerDay: original.workingHoursPerDay,
      workingDays: original.workingDays,
      halfDays: original.halfDays,
      projectId: null,
      color: original.color,
      isFavourite: null,
      firstAvailableDate: null,
      lastAvailableDate: null,
    };
    const created = await session(client.post(route('planning/mutations')), cookie)
      .json(input(0, { operation: 'resource.create', id, fields }))
      .send();
    created.assertStatus(200);
    const updated = await session(client.post(route('planning/mutations')), cookie)
      .json(input(1, { operation: 'resource.update', id, changes: { jobTitle: 'Lead Designer' } }))
      .send();
    updated.assertStatus(200);
    const state = await readState(companyId, true);
    const resource = state.resources.find((row) => row.id === id);
    assert.equal(resource?.jobTitle, 'Lead Designer');
    assert.equal(resource?.workingHoursPerDay, original.workingHoursPerDay);
    assert.deepEqual(resource?.workingDays, original.workingDays);
  });

  test('refuses to change an external resource working pattern without persisting or advancing revision', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const external = data.resources.find(
      (row) => row.companyId === companyId && row.kind === 'external'
    );
    assert.isDefined(external);
    const { cookie } = await signIn(client);
    const before = await readState(companyId, true);
    const changedDays = external!.workingDays.includes(0) ? [1, 2, 3, 4, 5] : [0, 1, 2, 3, 4];

    const refused = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(0, {
          operation: 'resource.update',
          id: external!.id,
          changes: { workingDays: changedDays },
        })
      )
      .send();

    refused.assertStatus(400);
    assert.equal(body(refused).code, 'VALIDATION_ERROR');
    assert.deepEqual(await readState(companyId, true), before);
    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(snapshot.body().data.revision, 0);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0);
  });

  test('an external resource refusal names the supplied reference field', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const data = await readState(companyId, true);
    const external = data.resources.find((row) => row.kind === 'external')!;
    for (const [field, value] of [
      ['disciplineId', data.disciplines[0]!.id],
      ['projectId', data.projects[0]!.id],
    ] as const) {
      const refused = await session(client.post(route('planning/mutations')), cookie)
        .json(
          input(0, { operation: 'resource.update', id: external.id, changes: { [field]: value } })
        )
        .send();
      refused.assertStatus(400);
      assert.deepEqual(refused.body(), {
        code: 'VALIDATION_ERROR',
        error: `${field} is not used by external resources.`,
      });
    }
  });

  test('refuses a reversed closure range without persisting or advancing revision', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const id = randomUUID();
    const before = await readState(companyId, true);
    const auditBefore = await db.from('audit_entries').where('company_id', companyId);
    const mutationsBefore = await db.from('planning_mutations').where('company_id', companyId);

    const refused = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(0, {
          operation: 'closure.create',
          id,
          fields: { name: 'Invalid range', startDate: '2026-12-31', endDate: '2026-01-01' },
        })
      )
      .send();

    refused.assertStatus(400);
    assert.equal(body(refused).code, 'VALIDATION_ERROR');
    assert.deepEqual(await readState(companyId, true), before);
    assert.isNull(await db.from('closures').where({ id, company_id: companyId }).first());
    assert.deepEqual(await db.from('audit_entries').where('company_id', companyId), auditBefore);
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId),
      mutationsBefore
    );
    const snapshot = await session(client.get(planningUrl), cookie).send();
    assert.equal(snapshot.body().data.revision, 0);
  });

  test('Editor preserves confidential values and cannot change privacy controls or notes', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie: ownerCookie } = await signIn(client);
    const clientId = randomUUID();
    const color = data.clients.find((row) => row.companyId === companyId && !row.builtin)!.color;
    const privateClient = await session(client.post(route('planning/mutations')), ownerCookie)
      .json(
        input(0, {
          operation: 'catalogue.create',
          entity: {
            entity: 'clients',
            id: clientId,
            fields: { name: 'Bruce Wayne', color, isPrivate: true, codeName: 'Boardroom' },
          },
        })
      )
      .send();
    privateClient.assertStatus(200);
    const timeOffId = randomUUID();
    const resourceId = data.resources.find(
      (row) => row.companyId === companyId && row.kind === 'person'
    )!.id;
    const timeOff = await session(client.post(route('planning/mutations')), ownerCookie)
      .json(
        input(1, {
          operation: 'timeOff.create',
          timeOff: {
            id: timeOffId,
            resourceId,
            startDate: '2026-11-02',
            endDate: '2026-11-02',
            type: 'holiday',
            note: 'Private note',
          },
        })
      )
      .send();
    timeOff.assertStatus(200);

    const { cookie } = await signIn(client, 'editor');
    const nameEdit = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(2, {
          operation: 'catalogue.update',
          entity: { entity: 'clients', id: clientId, changes: { name: 'Redacted echo', color } },
        })
      )
      .send();
    nameEdit.assertStatus(400);
    assert.equal(body(nameEdit).code, 'NO_CHANGE');
    const colourEdit = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(2, {
          operation: 'catalogue.update',
          entity: {
            entity: 'clients',
            id: clientId,
            changes: {
              color: data.clients.find((row) => row.companyId === companyId && row.color !== color)!
                .color,
            },
          },
        })
      )
      .send();
    colourEdit.assertStatus(200);
    const notePreserved = await session(client.post(route('planning/mutations')), cookie)
      .json(input(3, { operation: 'timeOff.update', id: timeOffId, changes: { type: 'sick' } }))
      .send();
    notePreserved.assertStatus(200);
    const privacyRefused = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(4, {
          operation: 'catalogue.update',
          entity: { entity: 'clients', id: clientId, changes: { isPrivate: false } },
        })
      )
      .send();
    privacyRefused.assertStatus(403);
    const noteRefused = await session(client.post(route('planning/mutations')), cookie)
      .json(input(4, { operation: 'timeOff.update', id: timeOffId, changes: { note: 'Read it' } }))
      .send();
    noteRefused.assertStatus(403);
    const state = await readState(companyId, true);
    assert.equal(state.clients.find((row) => row.id === clientId)?.name, 'Bruce Wayne');
    assert.equal(state.clients.find((row) => row.id === clientId)?.codeName, 'Boardroom');
    assert.equal(state.timeOff.find((row) => row.id === timeOffId)?.note, 'Private note');
  });

  test("a receipt's changes turn the read before the write into the read after it", async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client);
    type Read = { revision: number; data: AppData };
    type Changes = {
      upserts: Array<{ entity: AppDataKey; row: { id: string } }>;
      removed: Array<{ entity: AppDataKey; id: string }>;
    };
    const read = async () => {
      const response = await session(client.get(planningUrl), cookie).send();
      return (response.body() as { data: Read }).data;
    };
    // Row order is not part of the read, so both sides are compared by id.
    const byId = (rows: AppData) =>
      Object.fromEntries(
        APP_DATA_KEYS.map((entity) => [
          entity,
          [...(rows[entity] as Array<{ id: string }>)].sort((a, b) => a.id.localeCompare(b.id)),
        ])
      );
    const apply = (rows: AppData, changes: Changes) => {
      const next = structuredClone(rows) as unknown as Record<AppDataKey, Array<{ id: string }>>;
      for (const { entity, id } of changes.removed) {
        next[entity] = next[entity].filter((row) => row.id !== id);
      }
      for (const { entity, row } of changes.upserts) {
        next[entity] = [...next[entity].filter((existing) => existing.id !== row.id), row];
      }
      return next as unknown as AppData;
    };
    const allocation = newAllocation(data);
    let groupIds: string[] = [randomUUID()];
    const writes: Array<
      [string, (revision: number) => Promise<{ body(): unknown; status(): number }>]
    > = [
      [
        'create',
        (revision) =>
          session(client.post(route('planning/mutations')), cookie)
            .json(input(revision, { operation: 'allocation.create', allocation }))
            .send(),
      ],
      [
        'update',
        (revision) =>
          session(client.post(route('planning/mutations')), cookie)
            .json(
              input(revision, {
                operation: 'allocation.update',
                id: allocation.id,
                changes: { hoursPerDay: 3 },
              })
            )
            .send(),
      ],
      [
        'delete',
        (revision) =>
          session(client.post(route('planning/mutations')), cookie)
            .json(input(revision, { operation: 'allocation.delete', id: allocation.id }))
            .send(),
      ],
      [
        'group create',
        async (revision) => {
          const reply = await session(client.post(route('planning/mutations')), cookie)
            .json(
              input(revision, {
                operation: 'allocation.createGroup',
                allocation: { ...allocation, id: groupIds[0] },
                repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-09' },
              })
            )
            .send();
          // The server minted the later occurrence; the group delete below names it.
          groupIds = listCreatedAllocationIds((reply.body() as { data: unknown }).data);
          return reply;
        },
      ],
      [
        'group delete',
        (revision) =>
          session(client.post(route('planning/mutations')), cookie)
            .json(input(revision, { operation: 'allocation.deleteGroup', ids: groupIds }))
            .send(),
      ],
    ];
    for (const [name, write] of writes) {
      const before = await read();
      const reply = await write(before.revision);
      assert.equal(reply.status(), 200, name);
      const { changes, revision } = (reply.body() as { data: unknown }).data as {
        changes: Changes;
        revision: number;
      };
      assert.isNotEmpty([...changes.upserts, ...changes.removed], name);
      const after = await read();
      assert.equal(after.revision, revision, name);
      assert.deepEqual(byId(apply(before.data, changes)), byId(after.data), name);
    }
  });

  test('a repeated allocation commits its pattern as one series that deletes and restores as a group', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client);
    const allocation = newAllocation(data);
    const repeatGroup = (until: string) =>
      session(client.post(route('planning/mutations')), cookie)
        .json(
          input(0, {
            operation: 'allocation.createGroup',
            allocation,
            repeat: { pattern: { kind: 'weeks', interval: 1 }, until },
          })
        )
        .send();

    // Six calendar months after 2 November is 2 May.
    const tooLate = await repeatGroup('2027-05-03');
    tooLate.assertStatus(400);
    assert.equal(body(tooLate).code, 'VALIDATION_ERROR');

    // The client sends the first occurrence and the pattern; the server mints the later ids.
    const created = await repeatGroup('2026-11-23');
    created.assertStatus(200);
    const ids = listCreatedAllocationIds((created.body() as { data: unknown }).data);
    assert.lengthOf(ids, 4);
    assert.equal(ids[0], allocation.id);
    const rows = () =>
      readState(companyId, true).then((state) =>
        ids.map((id) => state.allocations.find((row) => row.id === id))
      );
    const saved = await rows();
    assert.deepEqual(
      saved.map((row) => row?.startDate),
      ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']
    );
    assert.isNotEmpty(saved[0]!.seriesId);
    assert.isTrue(saved.every((row) => row?.seriesId === saved[0]!.seriesId));

    // Undo deletes the minted ids as one group; redo restores that group.
    const undone = await session(client.post(route('planning/mutations')), cookie)
      .json(input(1, { operation: 'allocation.deleteGroup', ids }))
      .send();
    undone.assertStatus(200);
    assert.deepEqual(await rows(), [undefined, undefined, undefined, undefined]);
    const restorationGroupId = (
      (undone.body() as { data: unknown }).data as { restoration: { replacementGroupId: string } }
    ).restoration.replacementGroupId;
    const redone = await session(client.post(route('planning/mutations')), cookie)
      .json(input(2, { operation: 'planning.restoreGroup', restorationGroupId }))
      .send();
    redone.assertStatus(200);
    assert.deepEqual(await rows(), saved);
  });

  test('a series-tail delete resolves the selected and later occurrences on the server', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client);
    const allocation = newAllocation(data);
    const mutate = (revision: number, intent: Record<string, unknown>) =>
      session(client.post(route('planning/mutations')), cookie)
        .json(input(revision, intent))
        .send();
    const created = await mutate(0, {
      operation: 'allocation.createGroup',
      allocation,
      repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-23' },
    });
    created.assertStatus(200);
    const ids = listCreatedAllocationIds((created.body() as { data: unknown }).data);
    assert.lengthOf(ids, 4);
    const oneOff = { ...newAllocation(data), startDate: '2026-11-17', endDate: '2026-11-17' };
    const single = await mutate(1, { operation: 'allocation.create', allocation: oneOff });
    single.assertStatus(200);
    const present = () =>
      readState(companyId, true).then((state) =>
        [...ids, oneOff.id].map((id) => state.allocations.some((row) => row.id === id))
      );

    const refused = await mutate(2, {
      operation: 'allocation.delete',
      id: oneOff.id,
      scope: 'future',
    });
    refused.assertStatus(400);
    assert.equal(body(refused).code, 'VALIDATION_ERROR');

    // Only the selected id is sent; the server finds the later occurrences itself.
    const tail = await mutate(2, { operation: 'allocation.delete', id: ids[1], scope: 'future' });
    tail.assertStatus(200);
    assert.deepEqual(await present(), [true, false, false, false, true]);
    const restorationGroupId = (
      (tail.body() as { data: unknown }).data as { restoration: { replacementGroupId: string } }
    ).restoration.replacementGroupId;
    const restored = await mutate(3, { operation: 'planning.restoreGroup', restorationGroupId });
    restored.assertStatus(200);
    assert.deepEqual(await present(), [true, true, true, true, true]);
  });

  test('a repeated time off commits its pattern and deletes and restores as a group', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client, 'editor');
    const resourceId = data.resources.find(
      (row) => row.companyId === companyId && row.kind === 'person'
    )!.id;
    const timeOff = {
      id: randomUUID(),
      resourceId,
      startDate: '2026-11-02',
      endDate: '2026-11-03',
      type: 'holiday',
    };
    const repeatTimeOff = (until: string, occurrenceIds: string[]) =>
      session(client.post(route('planning/mutations')), cookie)
        .json(
          input(0, {
            operation: 'timeOff.repeat',
            timeOff,
            repeat: { pattern: { kind: 'weeks', interval: 2 }, until },
            occurrenceIds,
          })
        )
        .send();

    // Eleven calendar months after November end with October.
    const tooLate = await repeatTimeOff('2027-11-01', [randomUUID()]);
    tooLate.assertStatus(400);
    assert.equal(body(tooLate).code, 'VALIDATION_ERROR');

    const ids = [timeOff.id, randomUUID(), randomUUID()];
    const created = await repeatTimeOff('2026-11-30', ids.slice(1));
    created.assertStatus(200);
    const rows = () =>
      readState(companyId, true).then((state) =>
        ids.map((id) => state.timeOff.find((row) => row.id === id))
      );
    const saved = await rows();
    assert.deepEqual(
      saved.map((row) => [row?.startDate, row?.endDate]),
      [
        ['2026-11-02', '2026-11-03'],
        ['2026-11-16', '2026-11-17'],
        ['2026-11-30', '2026-12-01'],
      ]
    );
    assert.isTrue(saved.every((row) => row?.resourceId === resourceId && row.type === 'holiday'));

    // Undo deletes the minted ids as one group; redo restores that group.
    const undone = await session(client.post(route('planning/mutations')), cookie)
      .json(input(1, { operation: 'timeOff.deleteGroup', ids }))
      .send();
    undone.assertStatus(200);
    assert.deepEqual(await rows(), [undefined, undefined, undefined]);
    const restorationGroupId = (
      (undone.body() as { data: unknown }).data as { restoration: { replacementGroupId: string } }
    ).restoration.replacementGroupId;
    const redone = await session(client.post(route('planning/mutations')), cookie)
      .json(input(2, { operation: 'planning.restoreGroup', restorationGroupId }))
      .send();
    redone.assertStatus(200);
    assert.deepEqual(await rows(), saved);
  });

  test('allocation save replies carry the capacity advisory of the rows they wrote', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client);
    // Bruce works eight hours Monday to Friday and has nothing booked in November.
    const allocation = { ...newAllocation(data), hoursPerDay: 5 };
    const advisory = (response: { body(): unknown }) =>
      (response.body() as { data: { advisory?: unknown } }).data.advisory;

    // The saved row is not counted against itself.
    const created = await session(client.post(route('planning/mutations')), cookie)
      .json(input(0, { operation: 'allocation.create', allocation }))
      .send();
    created.assertStatus(200);
    assert.deepEqual(advisory(created), { overDays: 0, timeOffDays: 0 });

    // A copy on the same days adds five hours to five: ten is over eight on each of five days.
    const duplicated = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(1, {
          operation: 'allocation.duplicate',
          sourceAllocationId: allocation.id,
          occurrence: { id: randomUUID(), startDate: '2026-11-02', endDate: '2026-11-06' },
        })
      )
      .send();
    duplicated.assertStatus(200);
    assert.deepEqual(advisory(duplicated), { overDays: 5, timeOffDays: 0 });

    // Three plus five is exactly eight, which is not over capacity.
    const updated = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(2, { operation: 'allocation.update', id: allocation.id, changes: { hoursPerDay: 3 } })
      )
      .send();
    updated.assertStatus(200);
    assert.deepEqual(advisory(updated), { overDays: 0, timeOffDays: 0 });
    assert.notProperty((updated.body() as { data: unknown }).data, 'repeatAdvisory');

    const timeOff = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(3, {
          operation: 'timeOff.create',
          timeOff: {
            id: randomUUID(),
            resourceId: allocation.resourceId,
            startDate: '2026-12-02',
            endDate: '2026-12-02',
            type: 'holiday',
          },
        })
      )
      .send();
    timeOff.assertStatus(200);
    assert.notProperty((timeOff.body() as { data: unknown }).data, 'advisory');

    // Monthly from Monday 2 November: 2 November meets eight booked hours, 2 December is time off,
    // 2 January is a Saturday and 2 February is clear.
    const repeated = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(4, {
          operation: 'allocation.createGroup',
          allocation: {
            ...allocation,
            id: randomUUID(),
            endDate: '2026-11-02',
            hoursPerDay: 1,
          },
          repeat: { pattern: { kind: 'monthly-date' }, until: '2027-02-02' },
        })
      )
      .send();
    repeated.assertStatus(200);
    assert.deepEqual(
      ((repeated.body() as { data: unknown }).data as { repeatAdvisory?: unknown }).repeatAdvisory,
      {
        overCapacityAllocations: 1,
        timeOffAllocations: 1,
        nonEffectiveStartAllocations: 1,
      }
    );
    assert.notProperty((repeated.body() as { data: unknown }).data, 'advisory');
  });

  test('time-off repeat rolls back its first entry when the ids do not match; closure and settings commit with correct projection', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client, 'editor');
    const resourceId = data.resources.find(
      (row) => row.companyId === companyId && row.kind === 'person'
    )!.id;
    const firstId = randomUUID();
    // Weekly from 2 November to 9 November makes two occurrences, so one later id, not two.
    const repeat = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(0, {
          operation: 'timeOff.repeat',
          timeOff: {
            id: firstId,
            resourceId,
            startDate: '2026-11-02',
            endDate: '2026-11-02',
            type: 'holiday',
          },
          repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-09' },
          occurrenceIds: [randomUUID(), randomUUID()],
        })
      )
      .send();
    repeat.assertStatus(400);
    assert.equal(
      (repeat.body() as { error?: string }).error,
      'The occurrence identities do not match the repeat.'
    );
    const afterRepeat = await readState(companyId, true);
    assert.isFalse(afterRepeat.timeOff.some((row) => row.id === firstId));

    const closureId = randomUUID();
    const closure = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(0, {
          operation: 'closure.create',
          id: closureId,
          fields: { name: 'Gotham Founders Day', startDate: '2026-11-03', endDate: '2026-11-03' },
        })
      )
      .send();
    closure.assertStatus(200);
    assert.equal(body(closure).revision, 1);
    const setting = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(1, {
          operation: 'settings.update',
          changes: { timezone: 'Europe/London', weekStartsOn: 0 },
        })
      )
      .send();
    setting.assertStatus(200);
    assert.equal(body(setting).revision, 2);
    const read = await session(client.get(planningUrl), cookie).send();
    read.assertStatus(200);
    const snapshot = read.body().data as {
      revision: number;
      data: { companies: Array<{ id: string; weekStartsOn: number | null }> };
    };
    assert.equal(snapshot.revision, 2);
    assert.deepEqual(
      snapshot.data.companies.map(({ id, weekStartsOn }) => ({ id, weekStartsOn })),
      [{ id: companyId, weekStartsOn: 0 }]
    );
    const state = await readState(companyId, true);
    assert.equal(state.companies[0]?.weekStartsOn, 0);
    assert.equal(state.closures.find((row) => row.id === closureId)?.name, 'Gotham Founders Day');
  });

  test('a setting set back to empty commits and reads back empty', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const styled = await session(client.post(route('planning/mutations')), cookie)
      .json(input(0, { operation: 'settings.update', changes: { dateStyle: 'month-day' } }))
      .send();
    styled.assertStatus(200);
    const cleared = await session(client.post(route('planning/mutations')), cookie)
      .json(input(1, { operation: 'settings.update', changes: { dateStyle: null } }))
      .send();
    cleared.assertStatus(200);
    assert.equal(body(cleared).revision, 2);
    const state = await readState(companyId, true);
    assert.isNull(state.companies[0]?.dateStyle);
  });

  test('refuses phase reassignment that would invalidate its activities without committing effects', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(companyId, true);
    const phase = before.phases.find((row) => row.id === 'ph-disc')!;
    const target = before.projects.find((row) => row.id === 'p-brand')!;
    const refused = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(0, {
          operation: 'catalogue.update',
          entity: { entity: 'phases', id: phase.id, changes: { projectId: target.id } },
        })
      )
      .send();
    refused.assertStatus(400);
    assert.equal(body(refused).code, 'VALIDATION_ERROR');
    const retained = await session(client.post('/api/batch'), cookie)
      .json({
        ops: [
          { method: 'PUT', table: 'phases', id: phase.id, row: { ...phase, projectId: target.id } },
        ],
      })
      .send();
    retained.assertStatus(404);
    assert.deepEqual(await readState(companyId, true), before);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0);
    assert.lengthOf(await db.from('audit_entries').where('company_id', companyId), 0);
    const current = await session(client.get(planningUrl), cookie).send();
    assert.equal(body(current).revision, 0);
  });

  test('an edit carrying an out-of-date row timestamp is refused', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(companyId, true);
    // The browser sends the timestamp it read, so take the row from the planning read.
    const read = await session(client.get(planningUrl), cookie).send();
    const row = (read.body() as { data: { data: AppData } }).data.data.clients.find(
      (entry) => entry.companyId === companyId && !entry.builtin
    )!;
    const edit = (expectedUpdatedAt: string) =>
      session(client.post(route('planning/mutations')), cookie)
        .json({
          ...input(0, {
            operation: 'catalogue.update',
            entity: { entity: 'clients', id: row.id, changes: { name: 'Wayne Enterprises' } },
          }),
          expectedUpdatedAt,
        })
        .send();

    const stale = await edit('2000-01-01T00:00:00.000Z');
    stale.assertStatus(409);
    assert.equal(body(stale).code, 'STALE_REVISION');
    assert.deepEqual(await readState(companyId, true), before);
    const unchanged = await session(client.get(planningUrl), cookie).send();
    assert.equal(body(unchanged).revision, 0);

    const current = await edit(row.updatedAt);
    current.assertStatus(200);
    const after = await readState(companyId, true);
    assert.equal(after.clients.find((entry) => entry.id === row.id)?.name, 'Wayne Enterprises');
  });

  test('allows moving a phase without dependent activities', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const id = randomUUID();
    const created = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(0, {
          operation: 'catalogue.create',
          entity: {
            entity: 'phases',
            id,
            fields: { name: 'Planning', projectId: 'p-acme' },
          },
        })
      )
      .send();
    created.assertStatus(200);
    const moved = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(1, {
          operation: 'catalogue.update',
          entity: {
            entity: 'phases',
            id,
            changes: { projectId: 'p-brand' },
          },
        })
      )
      .send();
    moved.assertStatus(200);
    assert.equal(body(moved).revision, 2);
    const afterMove = await readState(companyId, true);
    assert.equal(afterMove.phases.find((row) => row.id === id)?.projectId, 'p-brand');
  });
  test('activity kind edits remove dependent attribution', async ({ client, assert, cleanup }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const data = await readState(companyId, true);
    const activityId = randomUUID();
    const created = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(0, {
          operation: 'catalogue.create',
          entity: {
            entity: 'activities',
            id: activityId,
            fields: {
              name: 'All projects planning',
              kind: 'allProjects',
              projectId: null,
              phaseId: null,
            },
          },
        })
      )
      .send();
    created.assertStatus(200);
    const allocation = { ...newAllocation(data), activityId, projectId: 'p-acme' };
    const allocated = await session(client.post(route('planning/mutations')), cookie)
      .json(input(1, { operation: 'allocation.create', allocation }))
      .send();
    allocated.assertStatus(200);
    const changed = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(2, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activityId,
            changes: { kind: 'internal' },
          },
        })
      )
      .send();
    changed.assertStatus(200);
    assert.equal(body(changed).revision, 3);
    const afterKindChange = await readState(companyId, true);
    assert.isNull(afterKindChange.allocations.find((row) => row.id === allocation.id)?.projectId);

    const auditBeforeNoop = await db.from('audit_entries').where('company_id', companyId);
    const markersBeforeNoop = await db.from('planning_mutations').where('company_id', companyId);
    const sameKindOnly = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(3, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activityId,
            changes: { kind: 'internal' },
          },
        })
      )
      .send();
    sameKindOnly.assertStatus(400);
    assert.equal(body(sameKindOnly).code, 'NO_CHANGE');
    assert.deepEqual(await readState(companyId, true), afterKindChange);
    assert.deepEqual(
      await db.from('audit_entries').where('company_id', companyId),
      auditBeforeNoop
    );
    assert.deepEqual(
      await db.from('planning_mutations').where('company_id', companyId),
      markersBeforeNoop
    );
    const afterNoop = await session(client.get(planningUrl), cookie).send();
    afterNoop.assertStatus(200);
    assert.equal(body(afterNoop).revision, 3);

    const sameKind = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(3, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activityId,
            changes: { kind: 'internal', name: 'Internal planning' },
          },
        })
      )
      .send();
    sameKind.assertStatus(200);
    const renamed = await session(client.post(route('planning/mutations')), cookie)
      .json(
        input(4, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activityId,
            changes: { name: 'Internal coordination' },
          },
        })
      )
      .send();
    renamed.assertStatus(200);
  });
});

import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import db from '@adonisjs/lucid/services/db';
import { addDaysISO } from '@capacitylens/shared/lib/dateMath';
import env from '#start/env';
import { updateSettings } from '#services/planning/writer';
import { readState } from '#tests/helpers/state_fixture';
import {
  companyId,
  planningUrl,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  loginAsMember,
  signIn,
  trusted,
  validationSentence,
} from '#tests/functional/planning/helpers';
import { PlanningOperationException } from '#exceptions/planning_operation_exception';
import { PlanningRevisionService } from '#services/planning_revision_service';

const planningRevisions = new PlanningRevisionService();

test.group('authenticated typed planning transactions', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('read returns current access, revision and confidential company rows', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await loginAsMember('editor');
    const hidden = await db
      .from('clients')
      .where({ company_id: companyId })
      .whereNull('builtin')
      .first();
    await db
      .from('clients')
      .where('id', hidden.id)
      .update({ name: 'Wayne secret', is_private: true, code_name: 'Nightwing' });
    const response = await session(client.get(planningUrl), cookie).send();
    response.assertStatus(200);
    assert.equal(response.body().data.companyId, companyId);
    assert.equal(response.body().data.revision, 0);
    assert.match(response.body().data.today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(response.body().data.access.actorId, userId);
    assert.equal(response.body().data.access.role, 'editor');
    assert.isTrue(response.body().data.access.canWrite);
    assert.notInclude(response.text(), 'Wayne secret');
    assert.isTrue(
      response
        .body()
        .data.data.clients.every((row: { companyId: string }) => row.companyId === companyId)
    );
    const foreign = await session(
      client.visit('api.planning.show', { companyId: 'a-loft' }),
      cookie
    ).send();
    foreign.assertStatus(403);
    assert.equal((foreign.body() as unknown as { code: string }).code, 'ACCOUNT_MEMBERSHIP_LOST');
    const anonymous = await trusted(client.get(planningUrl)).send();
    anonymous.assertStatus(401);
  });

  test('read carries capacity for the default or the requested window', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    // The default window and the horizon follow today, so the date is pinned.
    const pinned = env.get('CAPACITYLENS_FIXED_TODAY');
    cleanup(() => env.set('CAPACITYLENS_FIXED_TODAY', pinned ?? ''));
    env.set('CAPACITYLENS_FIXED_TODAY', '2026-06-03');
    const { cookie } = await loginAsMember('viewer');
    const data = await readState(companyId, false);

    const read = await session(client.get(planningUrl), cookie).send();
    read.assertStatus(200);
    const { capacity } = read.body().data;
    assert.deepEqual(capacity.window, { from: '2026-05-04', to: '2026-09-28' });
    assert.deepEqual(capacity.horizon, { from: '2026-06-03', to: '2026-08-23' });
    assert.sameMembers(
      Object.keys(capacity.resources),
      data.resources.filter((row) => row.kind !== 'external').map((row) => row.id)
    );
    const [first] = Object.values(capacity.resources) as Array<{
      window: { over: boolean[] };
      horizon: { over: boolean[] };
    }>;
    assert.lengthOf(first!.window.over, 148);
    assert.lengthOf(first!.horizon.over, 82);

    const requested = await session(
      client.get(planningUrl).qs({ from: '2026-01-05', to: '2026-01-11' }),
      cookie
    ).send();
    requested.assertStatus(200);
    assert.deepEqual(requested.body().data.capacity.window, {
      from: '2026-01-05',
      to: '2026-01-11',
    });
    assert.deepEqual(requested.body().data.capacity.horizon, capacity.horizon);
  });

  test('read capacity leaves deleted allocations and those of an archived activity out', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const pinned = env.get('CAPACITYLENS_FIXED_TODAY');
    cleanup(() => env.set('CAPACITYLENS_FIXED_TODAY', pinned ?? ''));
    env.set('CAPACITYLENS_FIXED_TODAY', '2026-06-03');
    const { cookie } = await loginAsMember();
    const stored = await readState(companyId, true);
    const { resourceId } = newAllocation(stored);
    // One allocation is deleted; the other is hidden by archiving its activity, because allocations
    // have no archive of their own.
    const [deletedActivity, archivedActivity] = stored.activities.filter(
      (row) => row.companyId === companyId && !row.archivedAt
    );
    assert.exists(archivedActivity);
    type Days = { available: number[]; over: boolean[] };
    const readWindow = async () => {
      const response = await session(client.get(planningUrl), cookie).send();
      response.assertStatus(200);
      const { capacity } = response.body().data;
      return {
        from: capacity.window.from as string,
        days: capacity.resources[resourceId] as { window: Days },
      };
    };
    const before = await readWindow();
    const openDays = before.days.window.over
      .map((over, index) => (!over && before.days.window.available[index]! > 0 ? index : -1))
      .filter((index) => index >= 0)
      .slice(0, 2);
    assert.lengthOf(openDays, 2);
    const ids: string[] = [];
    const activities = [deletedActivity!, archivedActivity!];
    for (const [revision, index] of openDays.entries()) {
      const date = addDaysISO(before.from, index);
      const allocation = {
        ...newAllocation(stored),
        resourceId,
        activityId: activities[revision]!.id,
        startDate: date,
        endDate: date,
        hoursPerDay: 24,
      };
      const created = await session(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json({
          mutationId: randomUUID(),
          baseRevision: revision,
          intent: { operation: 'allocation.create', allocation },
        })
        .send();
      created.assertStatus(200);
      ids.push(allocation.id);
    }
    const booked = await readWindow();
    assert.deepEqual(
      openDays.map((index) => booked.days.window.over[index]),
      [true, true]
    );

    const now = new Date().toISOString();
    await db.from('allocations').where('id', ids[0]!).update({ deleted_at: now });
    await db.from('activities').where('id', archivedActivity!.id).update({ archived_at: now });
    const after = await readWindow();
    assert.deepEqual(
      openDays.map((index) => after.days.window.over[index]),
      [false, false]
    );
  });

  test('read leaves the rows out only for the current ifRevision', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await loginAsMember('editor');
    await db.transaction((trx) => planningRevisions.advancePlanningRevision(trx, companyId));
    const read = (query: Record<string, string | number>) =>
      session(client.get(planningUrl).qs(query), cookie).send();

    const unchanged = await read({ ifRevision: 1 });
    unchanged.assertStatus(200);
    assert.equal(unchanged.body().data.content, 'unchanged');
    assert.equal(unchanged.body().data.revision, 1);
    assert.notProperty(unchanged.body().data, 'data');
    assert.property(unchanged.body().data, 'capacity');
    assert.equal(unchanged.body().data.access.role, 'editor');

    const fullQueries: Array<Record<string, number>> = [{ ifRevision: 0 }, { ifRevision: 2 }, {}];
    for (const query of fullQueries) {
      const full = await read(query);
      full.assertStatus(200);
      assert.equal(full.body().data.content, 'full', JSON.stringify(query));
      assert.isArray(full.body().data.data.clients, JSON.stringify(query));
    }
    for (const ifRevision of ['-1', '1.5', 'abc']) {
      const refused = await read({ ifRevision });
      refused.assertStatus(422);
      assert.isNotEmpty(refused.body().errors, ifRevision);
    }

    // A role change advances the revision, so the reader's old revision gets the full slice.
    await db.transaction(async (trx) => {
      await trx
        .from('memberships')
        .where({ scope_id: companyId, user_id: userId })
        .update({ role: 'viewer' });
      await planningRevisions.advancePlanningRevision(trx, companyId);
    });
    const afterRoleChange = await read({ ifRevision: 1 });
    afterRoleChange.assertStatus(200);
    assert.equal(afterRoleChange.body().data.content, 'full');
    assert.equal(afterRoleChange.body().data.access.role, 'viewer');
  });

  test('read refuses a capacity window that is reversed, one-sided or longer than 366 days', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await loginAsMember('viewer');
    const refusals: Array<[Record<string, string>, string]> = [
      [{ from: '2026-06-02', to: '2026-06-01' }, 'The to date must be on or after the from date.'],
      [{ from: '2026-01-01', to: '2027-01-02' }, 'The range may cover at most 366 days.'],
      // 2028 is a leap year: from the last day of 2027 to its last day is 367 days.
      [{ from: '2027-12-31', to: '2028-12-31' }, 'The range may cover at most 366 days.'],
      [{ from: '2026-06-01' }, 'Send both from and to, or neither.'],
      [{ to: '2026-06-01' }, 'Send both from and to, or neither.'],
      [{ from: '2026-02-30', to: '2026-03-01' }, 'The from field must be a datetime value'],
    ];
    for (const [query, error] of refusals) {
      const response = await session(client.get(planningUrl).qs(query), cookie).send();
      response.assertStatus(422);
      assert.equal(response.body().errors[0]?.message, error, JSON.stringify(query));
    }
    const longest = await session(
      client.get(planningUrl).qs({ from: '2026-01-01', to: '2027-01-01' }),
      cookie
    ).send();
    longest.assertStatus(200);
    const [resource] = Object.values(longest.body().data.capacity.resources) as Array<{
      window: { over: boolean[] };
    }>;
    assert.lengthOf(resource!.window.over, 366);
    const leapYear = await session(
      client.get(planningUrl).qs({ from: '2028-01-01', to: '2028-12-31' }),
      cookie
    ).send();
    leapYear.assertStatus(200);
    assert.deepEqual(leapYear.body().data.capacity.window, {
      from: '2028-01-01',
      to: '2028-12-31',
    });
  });

  test('create and move commit once, stale and duplicate identities never commit again', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await loginAsMember();
    const allocation = newAllocation(data);
    const mutationId = randomUUID();
    const input = {
      mutationId,
      baseRevision: 0,
      intent: { operation: 'allocation.create', allocation },
    };
    const created = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(input as never)
      .send();
    created.assertStatus(200);
    assert.equal(created.body().data.revision, 1);
    assert.equal(created.body().data.status, 'committed');
    const { changes, ...receipt } = created.body().data;
    assert.deepEqual(receipt, {
      status: 'committed',
      mutationId,
      revision: 1,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      history: { canUndo: false, canRedo: false },
      advisory: { overDays: 0, timeOffDays: 0 },
    });
    assert.deepEqual(
      changes.upserts.map((upsert: { entity: string; row: { id: string } }) => [
        upsert.entity,
        upsert.row.id,
      ]),
      [['allocations', allocation.id]]
    );
    assert.deepEqual(changes.removed, []);
    const read = await session(client.get(planningUrl), cookie).send();
    read.assertStatus(200);
    assert.equal(read.body().data.revision, 1);
    assert.isTrue(
      read.body().data.data.allocations.some((row: { id: string }) => row.id === allocation.id)
    );
    const duplicate = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(input as never)
      .send();
    duplicate.assertStatus(409);
    assert.equal((duplicate.body() as unknown as { code: string }).code, 'MUTATION_ID_REUSED');
    const stale = await session(client.visit('api.planning_mutations.store', { companyId }), cookie)
      .json({
        mutationId: randomUUID(),
        baseRevision: 0,
        intent: {
          operation: 'allocation.update',
          id: allocation.id,
          changes: { startDate: '2026-11-09', endDate: '2026-11-13' },
        },
      })
      .send();
    stale.assertStatus(409);
    assert.equal((stale.body() as unknown as { code: string }).code, 'STALE_REVISION');
    const moved = await session(client.visit('api.planning_mutations.store', { companyId }), cookie)
      .json({
        mutationId: randomUUID(),
        baseRevision: 1,
        intent: {
          operation: 'allocation.update',
          id: allocation.id,
          changes: { startDate: '2026-11-09', endDate: '2026-11-13' },
        },
      })
      .send();
    moved.assertStatus(200);
    assert.equal(moved.body().data.revision, 2);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 2);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      2
    );
  });

  test('the one mutation route commits each of the 38 planning operations', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(companyId, true);
    const { cookie } = await signIn(client);
    const color = data.clients.find((row) => row.companyId === companyId && !row.builtin)!.color;
    const resourceId = newAllocation(data).resourceId;
    const ids = {
      client: randomUUID(),
      project: randomUUID(),
      phase: randomUUID(),
      activity: randomUUID(),
      discipline: randomUUID(),
      resource: randomUUID(),
      allocation: randomUUID(),
      duplicate: randomUUID(),
      group: randomUUID(),
      timeOff: randomUUID(),
      repeatedTimeOff: randomUUID(),
      closure: randomUUID(),
    };
    const allocation = { ...newAllocation(data), id: ids.allocation };
    const timeOff = {
      resourceId,
      startDate: '2026-11-16',
      endDate: '2026-11-16',
      type: 'holiday',
    };
    let restorationGroupId = '';
    const operations: Array<() => Record<string, unknown>> = [
      ...(['clients', 'projects', 'phases', 'activities', 'disciplines'] as const).flatMap(
        (entity) => {
          const id = {
            clients: ids.client,
            projects: ids.project,
            phases: ids.phase,
            activities: ids.activity,
            disciplines: ids.discipline,
          }[entity];
          const fields = {
            clients: { name: 'Wayne Foundation', color },
            projects: { name: 'Gotham Renewal', color, clientId: ids.client },
            phases: { name: 'Discovery', projectId: ids.project },
            activities: {
              name: 'Research',
              kind: 'project',
              projectId: ids.project,
              phaseId: ids.phase,
            },
            disciplines: { name: 'Strategy', color, sortOrder: 8 },
          }[entity];
          return [
            () => ({ operation: 'catalogue.create', entity: { entity, id, fields } }),
            () => ({
              operation: 'catalogue.update',
              entity: { entity, id, changes: { name: `${fields.name} renamed` } },
            }),
          ];
        }
      ),
      ...(['clients', 'projects', 'activities'] as const).flatMap((entity) => {
        const id = { clients: ids.client, projects: ids.project, activities: ids.activity }[entity];
        return (['catalogue.archive', 'catalogue.restore'] as const).map((operation) => () => ({
          operation,
          entity: { entity, id },
        }));
      }),
      () => ({ operation: 'catalogue.delete', entity: { entity: 'phases', id: ids.phase } }),
      () => ({
        operation: 'catalogue.delete',
        entity: { entity: 'disciplines', id: ids.discipline },
      }),
      () => ({
        operation: 'resource.create',
        id: ids.resource,
        fields: {
          kind: 'person',
          name: 'Barbara Gordon',
          jobTitle: 'Analyst',
          avatarUrl: null,
          disciplineId: null,
          employmentType: 'permanent',
          engagement: 'studio',
          workingHoursPerDay: 8,
          workingDays: [1, 2, 3, 4, 5],
          halfDays: [],
          projectId: null,
          color,
          isFavourite: false,
          firstAvailableDate: null,
          lastAvailableDate: null,
        },
      }),
      () => ({ operation: 'resource.update', id: ids.resource, changes: { jobTitle: 'Lead' } }),
      () => ({ operation: 'resource.archive', id: ids.resource }),
      () => ({ operation: 'resource.restore', id: ids.resource }),
      () => ({ operation: 'allocation.create', allocation }),
      () => ({
        operation: 'allocation.update',
        id: ids.allocation,
        changes: { hoursPerDay: 4 },
      }),
      () => ({
        operation: 'allocation.duplicate',
        sourceAllocationId: ids.allocation,
        occurrence: { id: ids.duplicate, startDate: '2026-11-09', endDate: '2026-11-13' },
      }),
      () => ({
        operation: 'allocation.createGroup',
        allocation: {
          ...allocation,
          id: ids.group,
          startDate: '2026-11-23',
          endDate: '2026-11-23',
        },
        repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-30' },
      }),
      () => ({ operation: 'allocation.delete', id: ids.duplicate }),
      () => ({ operation: 'planning.restoreGroup', restorationGroupId }),
      () => ({ operation: 'allocation.deleteGroup', ids: [ids.duplicate] }),
      () => ({ operation: 'timeOff.create', timeOff: { ...timeOff, id: ids.timeOff } }),
      () => ({ operation: 'timeOff.update', id: ids.timeOff, changes: { type: 'sick' } }),
      () => ({
        operation: 'timeOff.repeat',
        timeOff: {
          ...timeOff,
          id: ids.repeatedTimeOff,
          startDate: '2026-11-17',
          endDate: '2026-11-17',
        },
        repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-24' },
        occurrenceIds: [randomUUID()],
      }),
      () => ({ operation: 'timeOff.delete', id: ids.timeOff }),
      () => ({ operation: 'timeOff.deleteGroup', ids: [ids.repeatedTimeOff] }),
      () => ({
        operation: 'closure.create',
        id: ids.closure,
        fields: { name: 'Wayne anniversary', startDate: '2026-12-25', endDate: '2026-12-25' },
      }),
      () => ({ operation: 'closure.update', id: ids.closure, changes: { name: 'Wayne closure' } }),
      () => ({ operation: 'closure.delete', id: ids.closure }),
      () => ({ operation: 'settings.update', changes: { dateStyle: 'month-day' } }),
    ];
    assert.lengthOf(operations, 38);
    for (const [revision, build] of operations.entries()) {
      const intent = build();
      const reply = await session(
        client.visit('api.planning_mutations.store', { companyId }),
        cookie
      )
        .json({ mutationId: randomUUID(), baseRevision: revision, intent } as never)
        .send();
      assert.equal(reply.status(), 200, `${String(intent.operation)}: ${reply.text()}`);
      assert.equal(reply.body().data.status, 'committed');
      restorationGroupId = reply.body().data.restoration?.replacementGroupId ?? restorationGroupId;
    }
  });

  test('settings service rejects a language change before writing in its transaction', async ({
    assert,
  }) => {
    // HTTP settings strip language; a different stored locale exposes the service's frozen-field rules.
    await db.from('companies').where('id', companyId).update({ language: 'fr' });
    const before = await readState(companyId, true);
    await assert.rejects(
      async () => {
        await db.transaction(async (trx) => {
          await updateSettings(
            trx,
            structuredClone(before),
            companyId,
            { language: 'en' },
            {
              role: 'owner',
              canWrite: true,
              canSeePrivateNames: true,
              canSeeTimeOffNote: true,
            }
          );
        });
      },
      PlanningOperationException,
      'Language, week start and time zone are set when the company is created and cannot be changed.'
    );
    assert.deepEqual(await readState(companyId, true), before);
  });

  test('duplicate endpoint copies source fields into a new dated allocation once', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await loginAsMember();
    const before = await readState(companyId, true);
    const source = before.allocations.find((row) => row.companyId === companyId)!;
    const id = randomUUID();
    const input = {
      mutationId: randomUUID(),
      baseRevision: 0,
      intent: {
        operation: 'allocation.duplicate',
        sourceAllocationId: source.id,
        occurrence: { id, startDate: '2026-11-09', endDate: '2026-11-13' },
      },
    };
    const response = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(input as never)
      .send();
    response.assertStatus(200);
    assert.equal(response.body().data.revision, 1);
    const after = await readState(companyId, true);
    const copy = after.allocations.find((row) => row.id === id)!;
    assert.isDefined(copy);
    for (const field of [
      'resourceId',
      'activityId',
      'projectId',
      'hoursPerDay',
      'status',
      'note',
      'task',
      'ignoreWorkingDays',
    ] as const) {
      assert.deepEqual(copy[field], source[field]);
    }
    assert.equal(copy.startDate, '2026-11-09');
    assert.equal(copy.endDate, '2026-11-13');
    assert.isNull(copy.seriesId);
    assert.deepEqual(
      after.allocations.find((row) => row.id === source.id),
      source
    );
    const replay = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(input as never)
      .send();
    replay.assertStatus(409);
    assert.equal((replay.body() as unknown as { code: string }).code, 'MUTATION_ID_REUSED');
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 1);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      1
    );
  });

  test("the planning read carries each person's stored avatar whatever the member link", async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await loginAsMember('viewer');
    const { userId: suspendedUserId } = await loginAsMember();
    const people = await db
      .from('resources')
      .where({ company_id: companyId, kind: 'person' })
      .whereNull('archived_at')
      .orderBy('id')
      .limit(3);
    assert.lengthOf(people, 3);
    const [linked, unlinked, suspendedLink] = people;
    const imageFor = (id: string) => `https://wayne.example/${id}.png`;
    for (const person of people) {
      await db
        .from('resources')
        .where('id', person.id)
        .update({ avatar_url: imageFor(person.id) });
    }
    const now = new Date().toISOString();
    for (const [memberId, resourceId] of [
      [userId, linked.id],
      [suspendedUserId, suspendedLink.id],
    ]) {
      await db.table('account_member_resources').insert({
        id: randomUUID(),
        created_at: now,
        updated_at: now,
        company_id: companyId,
        user_id: memberId,
        resource_id: resourceId,
        revision: randomUUID(),
      });
    }
    await db
      .from('memberships')
      .where({ scope_id: companyId, user_id: suspendedUserId })
      .update({ status: 'suspended' });
    const foreign = await db
      .from('resources')
      .where({ company_id: 'a-loft', kind: 'person' })
      .first();
    await db
      .from('resources')
      .where('id', foreign.id)
      .update({ avatar_url: imageFor(foreign.id) });

    const response = await session(client.get(planningUrl), cookie).send();
    response.assertStatus(200);
    const resources = response.body().data.data.resources as {
      id: string;
      avatarUrl: string | null;
    }[];
    for (const person of [linked, unlinked, suspendedLink]) {
      assert.equal(
        resources.find((row) => row.id === person.id)?.avatarUrl,
        imageFor(person.id),
        person.id
      );
    }
    assert.isUndefined(resources.find((row) => row.id === foreign.id));
  });

  test('occupied and missing entity targets use the validation transport mapping without effects', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await loginAsMember();
    const allocation = newAllocation(await readState(companyId, true));
    const created = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 0,
        intent: { operation: 'allocation.create', allocation },
      })
      .send();
    created.assertStatus(200);
    const before = await readState(companyId, true);
    const occupied = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 1,
        intent: { operation: 'allocation.create', allocation },
      })
      .send();
    occupied.assertStatus(422);
    assert.isString(validationSentence(occupied));
    const missingId = randomUUID();
    const missing = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 1,
        intent: {
          operation: 'allocation.update',
          id: missingId,
          changes: { hoursPerDay: 4 },
        },
      })
      .send();
    missing.assertStatus(422);
    assert.isString(validationSentence(missing));
    assert.deepEqual(await readState(companyId, true), before);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 1);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      1
    );
  });

  test('same-value update has no audit, commitment marker or revision advance', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await loginAsMember();
    const data = await readState(companyId, true);
    const allocation = data.allocations.find((row) => row.companyId === companyId)!;
    const before = await readState(companyId, true);
    const response = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 0,
        intent: {
          operation: 'allocation.update',
          id: allocation.id,
          changes: { hoursPerDay: allocation.hoursPerDay },
        },
      })
      .send();
    response.assertStatus(400);
    assert.equal((response.body() as unknown as { code: string }).code, 'NO_CHANGE');
    assert.deepEqual(await readState(companyId, true), before);
    assert.lengthOf(await db.from('planning_mutations').where('company_id', companyId), 0);
    assert.lengthOf(
      await db.from('audit_entries').where({ company_id: companyId, entity: 'planning' }),
      0
    );
    const current = await session(client.get(planningUrl), cookie).send();
    assert.equal(current.body().data.revision, 0);
  });
});

import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import { updateSettings, PlanningOperationError } from '#services/planning/writer';
import { readState } from '#tests/helpers/state_fixture';
import {
  accountId,
  planningUrl,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  signIn,
  trusted,
} from './helpers.js';

test.group('authenticated typed planning transactions', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('read returns current authority, revision and confidential company rows', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await signIn(client, 'editor');
    const hidden = await db
      .from('clients')
      .where({ account_id: accountId })
      .whereNull('builtin')
      .first();
    await db
      .from('clients')
      .where('id', hidden.id)
      .update({ name: 'Wayne secret', is_private: 'true', code_name: 'Nightwing' });
    const response = await session(client.get(planningUrl), cookie).send();
    response.assertStatus(200);
    assert.equal(response.body().accountId, accountId);
    assert.equal(response.body().revision, 0);
    assert.match(response.body().today, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(response.body().authority.actorId, userId);
    assert.equal(response.body().authority.role, 'editor');
    assert.isTrue(response.body().authority.canWrite);
    assert.notInclude(response.text(), 'Wayne secret');
    assert.isTrue(
      response
        .body()
        .data.clients.every((row: { accountId: string }) => row.accountId === accountId)
    );
    const foreign = await session(client.get('/api/accounts/a-loft/planning'), cookie).send();
    foreign.assertStatus(403);
    assert.equal(foreign.body().code, 'ACCOUNT_MEMBERSHIP_LOST');
    const anonymous = await trusted(client.get(planningUrl)).send();
    anonymous.assertStatus(401);
  });

  test('create and move commit once, stale and duplicate identities never commit again', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const data = await readState(accountId, true);
    const { cookie } = await signIn(client);
    const allocation = newAllocation(data);
    const mutationId = randomUUID();
    const input = {
      mutationId,
      baseRevision: 0,
      intent: { operation: 'allocation.create', allocation },
    };
    const created = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
      .json(input)
      .send();
    created.assertStatus(200);
    assert.equal(created.body().revision, 1);
    assert.equal(created.body().status, 'committed');
    assert.equal(created.body().projection.mode, 'patch');
    assert.equal(
      created
        .body()
        .projection.changed.upserts.find(
          (entry: { row: { id: string } }) => entry.row.id === allocation.id
        ).entity,
      'allocations'
    );
    const duplicate = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
      .json(input)
      .send();
    duplicate.assertStatus(409);
    assert.equal(duplicate.body().code, 'MUTATION_ID_REUSED');
    const stale = await session(
      client.patch(`/api/accounts/${accountId}/allocations/${allocation.id}`),
      cookie
    )
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
    assert.equal(stale.body().code, 'STALE_REVISION');
    const moved = await session(
      client.patch(`/api/accounts/${accountId}/allocations/${allocation.id}`),
      cookie
    )
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
    assert.equal(moved.body().revision, 2);
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 2);
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      2
    );
  });

  test('settings service rejects a language change before writing in its transaction', async ({
    assert,
  }) => {
    // HTTP settings strip language; a different stored locale exposes the service's frozen-field guard.
    await db.from('accounts').where('id', accountId).update({ language: 'fr' });
    const before = await readState(accountId, true);
    await assert.rejects(
      async () => {
        await db.transaction(async (trx) => {
          await updateSettings(
            trx,
            structuredClone(before),
            accountId,
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
      PlanningOperationError,
      'Language, week start and time zone are set when the company is created and cannot be changed.'
    );
    assert.deepEqual(await readState(accountId, true), before);
  });

  test('duplicate endpoint copies source fields into a new dated allocation once', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const before = await readState(accountId, true);
    const source = before.allocations.find((row) => row.accountId === accountId)!;
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
      client.post(`/api/accounts/${accountId}/allocations/${source.id}/duplicate`),
      cookie
    )
      .json(input)
      .send();
    response.assertStatus(200);
    assert.equal(response.body().revision, 1);
    const after = await readState(accountId, true);
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
      client.post(`/api/accounts/${accountId}/allocations/${source.id}/duplicate`),
      cookie
    )
      .json(input)
      .send();
    replay.assertStatus(409);
    assert.equal(replay.body().code, 'MUTATION_ID_REUSED');
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 1);
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      1
    );
  });

  test("the planning read carries each person's stored avatar whatever the member link", async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await signIn(client, 'viewer');
    const { userId: suspendedUserId } = await signIn(client);
    const people = await db
      .from('resources')
      .where({ account_id: accountId, kind: 'person' })
      .whereNull('archived_at')
      .whereNull('deleted_at')
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
        account_id: accountId,
        user_id: memberId,
        resource_id: resourceId,
        revision: randomUUID(),
      });
    }
    await db
      .from('memberships')
      .where({ scope_id: accountId, user_id: suspendedUserId })
      .update({ status: 'suspended' });
    const foreign = await db
      .from('resources')
      .where({ account_id: 'a-loft', kind: 'person' })
      .first();
    await db
      .from('resources')
      .where('id', foreign.id)
      .update({ avatar_url: imageFor(foreign.id) });

    const response = await session(client.get(planningUrl), cookie).send();
    response.assertStatus(200);
    const resources = response.body().data.resources as { id: string; avatarUrl: string | null }[];
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
    const { cookie } = await signIn(client);
    const allocation = newAllocation(await readState(accountId, true));
    const created = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
      .json({
        mutationId: randomUUID(),
        baseRevision: 0,
        intent: { operation: 'allocation.create', allocation },
      })
      .send();
    created.assertStatus(200);
    const before = await readState(accountId, true);
    const occupied = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
      .json({
        mutationId: randomUUID(),
        baseRevision: 1,
        intent: { operation: 'allocation.create', allocation },
      })
      .send();
    occupied.assertStatus(400);
    assert.equal(occupied.body().code, 'VALIDATION_ERROR');
    const missingId = randomUUID();
    const missing = await session(
      client.patch(`/api/accounts/${accountId}/allocations/${missingId}`),
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
    missing.assertStatus(400);
    assert.equal(missing.body().code, 'VALIDATION_ERROR');
    assert.deepEqual(await readState(accountId, true), before);
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 1);
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      1
    );
  });

  test('same-value update has no audit, commitment marker or revision advance', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const data = await readState(accountId, true);
    const allocation = data.allocations.find((row) => row.accountId === accountId)!;
    const before = await readState(accountId, true);
    const response = await session(
      client.patch(`/api/accounts/${accountId}/allocations/${allocation.id}`),
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
    assert.equal(response.body().code, 'NO_CHANGE');
    assert.deepEqual(await readState(accountId, true), before);
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 0);
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, entity: 'planning' }),
      0
    );
    const current = await session(client.get(planningUrl), cookie).send();
    assert.equal(current.body().revision, 0);
  });
});

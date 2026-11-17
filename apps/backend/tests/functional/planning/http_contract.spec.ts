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
    assert.deepEqual(created.body(), {
      status: 'committed',
      mutationId,
      revision: 1,
      restoration: { consumedGroupId: null, replacementGroupId: null },
    });
    const read = await session(client.get(planningUrl), cookie).send();
    read.assertStatus(200);
    assert.equal(read.body().revision, 1);
    assert.isTrue(
      read.body().data.allocations.some((row: { id: string }) => row.id === allocation.id)
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

  test('resource avatars include only active linked people with usable images in the company', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await signIn(client, 'viewer');
    const person = await db
      .from('resources')
      .where({ account_id: accountId, kind: 'person' })
      .whereNull('archived_at')
      .whereNull('deleted_at')
      .first();
    const imageUrl = 'https://wayne.example/avatar.png';
    await db.from('resources').where('id', person.id).update({ avatar_url: imageUrl });
    await db.table('account_member_resources').insert({
      id: randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      account_id: accountId,
      user_id: userId,
      resource_id: person.id,
      revision: randomUUID(),
    });
    const read = async () => {
      const response = await session(
        client.get(`/api/accounts/${accountId}/resource-avatars`),
        cookie
      ).send();
      response.assertStatus(200);
      return response.body();
    };
    const foreign = await db
      .from('resources')
      .where({ account_id: 'a-loft', kind: 'person' })
      .first();
    const { userId: foreignUserId } = await signIn(client);
    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: 'a-loft',
      user_id: foreignUserId,
      role: 'viewer',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    await db.from('resources').where('id', foreign.id).update({ avatar_url: imageUrl });
    await db.table('account_member_resources').insert({
      id: randomUUID(),
      account_id: 'a-loft',
      user_id: foreignUserId,
      resource_id: foreign.id,
      revision: randomUUID(),
      created_at: now,
      updated_at: now,
    });
    const unlinked = await db
      .from('resources')
      .where({ account_id: accountId, kind: 'person' })
      .whereNot('id', person.id)
      .first();
    await db.from('resources').where('id', unlinked.id).update({ avatar_url: imageUrl });
    assert.deepEqual(await read(), { avatars: [{ resourceId: person.id, imageUrl }] });
    for (const changes of [
      { archived_at: new Date().toISOString() },
      { deleted_at: new Date().toISOString() },
      { kind: 'placeholder' },
      { avatar_url: null },
      { avatar_url: 'javascript:alert(1)' },
    ]) {
      await db.from('resources').where('id', person.id).update(changes);
      // Kind changes clear links in a database trigger; restore the link to isolate the read filter.
      await db
        .from('account_member_resources')
        .where({ account_id: accountId, user_id: userId })
        .delete();
      await db.table('account_member_resources').insert({
        account_id: accountId,
        user_id: userId,
        id: randomUUID(),
        resource_id: person.id,
        revision: randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      assert.deepEqual(await read(), { avatars: [] });
      await db
        .from('resources')
        .where('id', person.id)
        .update({ archived_at: null, deleted_at: null, kind: 'person', avatar_url: imageUrl });
    }
    await db
      .from('memberships')
      .where({ scope_id: accountId, user_id: userId })
      .update({ status: 'suspended' });
    const { cookie: otherCookie } = await signIn(client);
    const suspended = await session(
      client.get(`/api/accounts/${accountId}/resource-avatars`),
      otherCookie
    ).send();
    suspended.assertStatus(200);
    assert.deepEqual(suspended.body(), { avatars: [] });
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

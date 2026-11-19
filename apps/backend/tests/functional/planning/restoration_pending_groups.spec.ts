import { fixtureSession } from '../../helpers/identities.js';
import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import { readState } from '#tests/helpers/state_fixture';
import { companyId, configureAuth, resetPlanningFixture, session, signIn } from './helpers.js';
import {
  send,
  deleteOne,
  createAllocations,
  currentRevision,
  group,
} from './restoration_helpers.js';

test.group('typed catalogue and time-off restoration', (suite) => {
  suite.setup(() => freshDatabase());
  suite.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('only an actual private-name change clears this company’s pending groups', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const [allocationId] = await createAllocations(client, cookie, 1);
    const deleted = await deleteOne(client, cookie, allocationId!, 1);
    deleted.assertStatus(200);
    const groupId = deleted.body().restoration.replacementGroupId;
    const before = await readState(companyId, true);
    const target = before.projects.find((row) => !row.isPrivate)!;
    const foreignGroup = randomUUID();
    await db.table('deleted_groups').insert({
      group_id: foreignGroup,
      company_id: 'a-loft',
      actor_id: 'other-actor',
      session_id: await fixtureSession('other-actor'),
      mutation_id: randomUUID(),
      created_at: new Date().toISOString(),
      consumed_at: null,
    });
    const settings = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      2,
      {
        operation: 'settings.update',
        changes: { dateStyle: 'month-day' },
      },
      randomUUID()
    );
    settings.assertStatus(200);
    assert.isDefined(await group(groupId));
    const ordinary = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      3,
      {
        operation: 'catalogue.update',
        entity: {
          entity: 'projects',
          id: target.id,
          changes: { name: 'Gotham review', codeName: target.codeName },
        },
      },
      randomUUID()
    );
    ordinary.assertStatus(200);
    assert.isDefined(await group(groupId));
    const changed = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      4,
      {
        operation: 'catalogue.update',
        entity: {
          entity: 'projects',
          id: target.id,
          changes: { isPrivate: true, codeName: 'Gotham confidential' },
        },
      },
      randomUUID()
    );
    changed.assertStatus(409);
    assert.equal(changed.body().code, 'RESTORATION_CONFIRMATION_REQUIRED');
    assert.equal(changed.body().restorableItemCount, 1);
    assert.isDefined(await group(groupId));
    const confirmed = await session(
      client.post(`/api/companies/${companyId}/planning/mutations`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 4,
        confirmedRestorationCount: 1,
        intent: {
          operation: 'catalogue.update',
          entity: {
            entity: 'projects',
            id: target.id,
            changes: { isPrivate: true, codeName: 'Gotham confidential' },
          },
        },
      })
      .send();
    confirmed.assertStatus(200);
    assert.isNull(await group(groupId));
    assert.isDefined(await group(foreignGroup));
    assert.isNull(await db.from('allocations').where('id', allocationId!).first());
  });

  test('only an actual activity-kind change clears pending groups', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const [allocationId] = await createAllocations(client, cookie, 1);
    const deleted = await deleteOne(client, cookie, allocationId!, 1);
    deleted.assertStatus(200);
    const groupId = deleted.body().restoration.replacementGroupId;
    const before = await readState(companyId, true);
    const activity = before.activities.find((row) => row.kind === 'internal')!;
    const renamed = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      2,
      {
        operation: 'catalogue.update',
        entity: {
          entity: 'activities',
          id: activity.id,
          changes: { kind: activity.kind, name: 'Gotham planning' },
        },
      },
      randomUUID()
    );
    renamed.assertStatus(200);
    assert.isDefined(await group(groupId));
    const changed = await send(
      client,
      cookie,
      `/api/companies/${companyId}/planning/mutations`,
      3,
      {
        operation: 'catalogue.update',
        entity: { entity: 'activities', id: activity.id, changes: { kind: 'repeatable' } },
      },
      randomUUID()
    );
    changed.assertStatus(409);
    assert.equal(changed.body().code, 'RESTORATION_CONFIRMATION_REQUIRED');
    assert.equal(changed.body().restorableItemCount, 1);
    assert.isDefined(await group(groupId));
    const confirmed = await session(
      client.post(`/api/companies/${companyId}/planning/mutations`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 3,
        confirmedRestorationCount: 1,
        intent: {
          operation: 'catalogue.update',
          entity: { entity: 'activities', id: activity.id, changes: { kind: 'repeatable' } },
        },
      })
      .send();
    confirmed.assertStatus(200);
    assert.isNull(await group(groupId));
    assert.isNull(await db.from('allocations').where('id', allocationId!).first());
  });

  test('cleanup counts pending deleted rows of live sign-ins, excludes links and consumed groups, and rejects stale consent', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie, userId } = await signIn(client);
    const [allocationId] = await createAllocations(client, cookie, 1);
    const deletion = await deleteOne(client, cookie, allocationId!, 1);
    deletion.assertStatus(200);
    const before = await readState(companyId, true);
    const target = before.projects.find((row) => !row.isPrivate)!;
    const retainedAllocation = await db.from('allocations').where('id', allocationId!).first();
    assert.isNotNull(retainedAllocation?.deleted_at);
    const other = randomUUID();
    const consumed = randomUUID();
    const otherRowIds = [randomUUID(), randomUUID()];
    const consumedRowId = randomUUID();
    for (const [id, consumedInstant] of [
      [other, null],
      [consumed, new Date().toISOString()],
    ] as const) {
      await db.table('deleted_groups').insert({
        group_id: id,
        company_id: companyId,
        actor_id: 'another-actor',
        session_id: await fixtureSession('another-actor'),
        mutation_id: randomUUID(),
        created_at: new Date().toISOString(),
        consumed_at: consumedInstant,
      });
      await db.table('deleted_rows').multiInsert([
        {
          group_id: id,
          entity: 'allocations',
          row_id: id === other ? otherRowIds[0]! : consumedRowId,
          payload_json: JSON.stringify({ kind: 'row' }),
        },
        {
          group_id: id,
          entity: 'allocations',
          row_id: id === other ? otherRowIds[1]! : randomUUID(),
          payload_json: JSON.stringify({ kind: 'row' }),
        },
        {
          group_id: id,
          entity: 'activities',
          row_id: randomUUID(),
          payload_json: JSON.stringify({ kind: 'link', parentId: 'gotham' }),
        },
      ]);
    }
    const retainedFixtureRow = (id: string, groupId: string) => ({
      ...retainedAllocation,
      id,
      deletion_group_id: groupId,
    });
    await db
      .table('allocations')
      .insert([
        ...otherRowIds.map((id) => retainedFixtureRow(id, other)),
        retainedFixtureRow(consumedRowId, consumed),
      ]);
    const mutationId = randomUUID();
    const intent = {
      operation: 'catalogue.update',
      entity: {
        entity: 'projects',
        id: target.id,
        changes: { isPrivate: true, codeName: 'Gotham confidential' },
      },
    };
    const request = (confirmedRestorationCount?: number, baseRevision = 2) =>
      session(client.post(`/api/companies/${companyId}/planning/mutations`), cookie)
        .json({
          mutationId,
          baseRevision,
          intent,
          ...(confirmedRestorationCount === undefined ? {} : { confirmedRestorationCount }),
        })
        .send();
    const refused = await request();
    refused.assertStatus(409);
    assert.equal(refused.body().restorableItemCount, 3);
    assert.deepEqual(await readState(companyId, true), before);
    assert.equal(await currentRevision(client, cookie), 2);
    assert.isNull(await db.from('planning_mutations').where('mutation_id', mutationId).first());
    // An expired sign-in's groups stop counting before pruning removes them, and neither changes
    // the planning revision.
    const otherGroup = await db.from('deleted_groups').where('group_id', other).first();
    await db
      .from('account_sessions')
      .where('id', otherGroup.session_id)
      .update({ expires_at: '2000-01-01T00:00:00.000Z' });
    const stale = await request(3);
    stale.assertStatus(409);
    assert.equal(stale.body().code, 'RESTORATION_CONFIRMATION_STALE');
    assert.equal(stale.body().restorableItemCount, 1);
    assert.deepEqual(await readState(companyId, true), before);
    const staleRevision = await request(1, 1);
    staleRevision.assertStatus(409);
    assert.equal(staleRevision.body().code, 'STALE_REVISION');
    assert.isUndefined(staleRevision.body().restorableItemCount);
    await db
      .from('memberships')
      .where({ scope_id: companyId, user_id: userId })
      .update({ role: 'viewer' });
    const forbidden = await request(1);
    forbidden.assertStatus(403);
    assert.isUndefined(forbidden.body().restorableItemCount);
    await db
      .from('memberships')
      .where({ scope_id: companyId, user_id: userId })
      .update({ role: 'owner' });
    const confirmed = await request(1);
    confirmed.assertStatus(200);
    assert.isNull(await group(deletion.body().restoration.replacementGroupId));
  });

  test('a failed privacy transaction retains its data and restoration group', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const { cookie } = await signIn(client);
    const [allocationId] = await createAllocations(client, cookie, 1);
    const deleted = await deleteOne(client, cookie, allocationId!, 1);
    deleted.assertStatus(200);
    const groupId = deleted.body().restoration.replacementGroupId;
    const before = await readState(companyId, true);
    const target = before.projects.find((row) => !row.isPrivate)!;
    await db.rawQuery(
      "CREATE TRIGGER reject_privacy_commit BEFORE INSERT ON planning_mutations BEGIN SELECT RAISE(ABORT, 'test rejection'); END"
    );
    try {
      const refused = await send(
        client,
        cookie,
        `/api/companies/${companyId}/planning/mutations`,
        2,
        {
          operation: 'catalogue.update',
          entity: {
            entity: 'projects',
            id: target.id,
            changes: { isPrivate: true, codeName: 'Gotham confidential' },
          },
        },
        randomUUID(),
        1
      );
      refused.assertStatus(500);
      assert.isDefined(await group(groupId));
      const afterRefusal = await readState(companyId, true);
      assert.equal(
        afterRefusal.projects.find((row) => row.id === target.id)?.codeName,
        target.codeName
      );
      assert.equal(await currentRevision(client, cookie), 2);
    } finally {
      await db.rawQuery('DROP TRIGGER reject_privacy_commit');
    }
  });
});

import { randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import { readState } from '#tests/helpers/state_fixture';
import {
  accountId,
  planningUrl,
  configureAuth,
  resetPlanningFixture,
  session,
  signIn,
  signInAgain,
} from './helpers.js';
import {
  note,
  deleteOne,
  restore,
  createAllocations,
  stored,
  currentRevision,
  markers,
  planningAudit,
  group,
  consumedAt,
} from './restoration_helpers.js';

test.group('session-bound allocation restoration', (suite) => {
  suite.setup(() => freshDatabase());
  suite.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('another session, actor or company cannot restore and the group stays usable', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const owner = await signIn(client);
    const [id] = await createAllocations(client, owner.cookie, 1);
    const deleted = await deleteOne(client, owner.cookie, id!, 1);
    deleted.assertStatus(200);
    const groupId = deleted.body().restoration.replacementGroupId;
    const editor = await signIn(client, 'editor');
    const otherSession = await signInAgain(client, owner.email);
    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: 'a-loft',
      user_id: owner.userId,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const loftRevision = await currentRevision(client, owner.cookie, 'a-loft');
    const loftBefore = await readState('a-loft', true);
    const studioBefore = await readState(accountId, true);
    const attempts = [
      await restore(client, editor.cookie, groupId, 2),
      await restore(client, otherSession, groupId, 2),
      await restore(client, owner.cookie, groupId, loftRevision, undefined, 'a-loft'),
    ];
    for (const refused of attempts) {
      refused.assertStatus(403);
      assert.equal(refused.body().code, 'AUTHORIZATION_DENIED');
    }
    assert.deepEqual(await readState(accountId, true), studioBefore);
    assert.deepEqual(await readState('a-loft', true), loftBefore);
    assert.isNull(await consumedAt(groupId));
    assert.equal(await currentRevision(client, owner.cookie), 2);
    assert.equal(await currentRevision(client, owner.cookie, 'a-loft'), loftRevision);
    assert.lengthOf(
      await db.from('planning_mutations').whereIn('account_id', [accountId, 'a-loft']),
      2
    );
    const restored = await restore(client, owner.cookie, groupId, 2);
    restored.assertStatus(200);
    assert.isDefined(await stored(id!));
  });

  test('signing out removes its groups; a later session is refused the old handle', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const owner = await signIn(client);
    const [id] = await createAllocations(client, owner.cookie, 1);
    const deleted = await deleteOne(client, owner.cookie, id!, 1);
    deleted.assertStatus(200);
    const groupId = deleted.body().restoration.replacementGroupId;
    assert.exists(await group(groupId));
    const signedOut = await session(client.post('/api/auth/sign-out'), owner.cookie).send();
    signedOut.assertStatus(200);
    assert.notExists(await group(groupId));
    assert.lengthOf(await db.from('deleted_rows').where('group_id', groupId), 0);
    const invalidated = await restore(client, owner.cookie, groupId, 2);
    invalidated.assertStatus(401);
    const later = await signInAgain(client, owner.email);
    const revision = await currentRevision(client, later);
    const before = await readState(accountId, true);
    const refused = await restore(client, later, groupId, revision);
    refused.assertStatus(403);
    assert.equal(refused.body().code, 'AUTHORIZATION_DENIED');
    assert.deepEqual(await readState(accountId, true), before);
    assert.isUndefined(await stored(id!));
  });

  test('lost-response lookup returns the handle only to its session and late duplicates never re-apply', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const owner = await signIn(client);
    const [id] = await createAllocations(client, owner.cookie, 1);
    const deleteId = randomUUID();
    const deleted = await deleteOne(client, owner.cookie, id!, 1, deleteId);
    deleted.assertStatus(200);
    const groupId = deleted.body().restoration.replacementGroupId;
    const lookup = () =>
      session(client.get(`${planningUrl}/mutations/${deleteId}`), owner.cookie).send();
    const committed = { status: 'committed', mutationId: deleteId, revision: 2 };
    for (const attempt of [await lookup(), await lookup()]) {
      attempt.assertStatus(200);
      assert.deepEqual(attempt.body(), { ...committed, restorationGroupId: groupId });
      assert.notInclude(attempt.text(), note);
    }
    const otherSession = await signInAgain(client, owner.email);
    const sameActor = await session(
      client.get(`${planningUrl}/mutations/${deleteId}`),
      otherSession
    ).send();
    assert.deepEqual(sameActor.body(), committed);
    const editor = await signIn(client, 'editor');
    const otherActor = await session(
      client.get(`${planningUrl}/mutations/${deleteId}`),
      editor.cookie
    ).send();
    assert.deepEqual(otherActor.body(), { status: 'unknown', mutationId: deleteId });

    const lateDelete = await deleteOne(client, owner.cookie, id!, 1, deleteId);
    lateDelete.assertStatus(409);
    assert.equal(lateDelete.body().code, 'MUTATION_ID_REUSED');
    assert.lengthOf(await db.from('deleted_groups'), 1);

    const restoreId = randomUUID();
    const restored = await restore(client, owner.cookie, groupId, 2, restoreId);
    restored.assertStatus(200);
    const consumed = await lookup();
    assert.deepEqual(consumed.body(), committed);
    const lateRestore = await restore(client, owner.cookie, groupId, 2, restoreId);
    lateRestore.assertStatus(409);
    assert.equal(lateRestore.body().code, 'MUTATION_ID_REUSED');
    assert.lengthOf(await db.from('allocations').where('id', id!), 1);
    assert.equal(await currentRevision(client, owner.cookie), 3);
    assert.lengthOf(await markers(), 3);
    assert.lengthOf(await planningAudit(), 3);
  });
});

import { createHash, randomUUID } from 'node:crypto';
import { test } from '@japa/runner';
import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import accountKit from 'adonisjs-account-kit/services/main';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { captureMail } from '../../helpers/identities.js';
import {
  accountId,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  signIn,
  signInAgain,
} from './helpers.js';
import { readState } from '#services/state_repository';

async function revision() {
  const row = await db.from('company_planning_revisions').where('account_id', accountId).first();
  return Number(row?.revision ?? 0);
}

async function deleteAllocation(client: ApiClient, cookie: string) {
  const data = await readState(accountId, true);
  const allocation = newAllocation(data);
  const baseRevision = await revision();
  const created = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
    .json({
      mutationId: randomUUID(),
      baseRevision,
      intent: { operation: 'allocation.create', allocation },
    })
    .send();
  created.assertStatus(200);
  const deleted = await session(
    client.post(`/api/accounts/${accountId}/allocations/${allocation.id}/delete`),
    cookie
  )
    .json({
      mutationId: randomUUID(),
      baseRevision: baseRevision + 1,
      intent: { operation: 'allocation.delete', id: allocation.id },
    })
    .send();
  deleted.assertStatus(200);
  return {
    allocationId: allocation.id,
    groupId: (deleted.body() as { restoration: { replacementGroupId: string } }).restoration
      .replacementGroupId,
  };
}

async function deleteExistingAllocation(client: ApiClient, cookie: string, allocationId: string) {
  const deleted = await session(
    client.post(`/api/accounts/${accountId}/allocations/${allocationId}/delete`),
    cookie
  )
    .json({
      mutationId: randomUUID(),
      baseRevision: await revision(),
      intent: { operation: 'allocation.delete', id: allocationId },
    })
    .send();
  deleted.assertStatus(200);
  return {
    allocationId,
    groupId: (deleted.body() as { restoration: { replacementGroupId: string } }).restoration
      .replacementGroupId,
  };
}

async function restoreAllocation(client: ApiClient, cookie: string, groupId: string) {
  return session(client.post(`/api/accounts/${accountId}/planning/restore-group`), cookie)
    .json({
      mutationId: randomUUID(),
      baseRevision: await revision(),
      intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
    })
    .send();
}

async function createActiveAllocation(client: ApiClient, cookie: string) {
  const data = await readState(accountId, true);
  const allocation = newAllocation(data);
  const baseRevision = await revision();
  const created = await session(client.post(`/api/accounts/${accountId}/allocations`), cookie)
    .json({
      mutationId: randomUUID(),
      baseRevision,
      intent: { operation: 'allocation.create', allocation },
    })
    .send();
  created.assertStatus(200);
  return allocation.id;
}

test.group('retained planning cleanup', (suite) => {
  suite.setup(() => freshDatabase());
  suite.each.setup(async () => {
    await resetPlanningFixture();
  });

  test('sign-out removes only that session’s pending retained rows and keeps its receipt', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const owner = await signIn(client);
    const first = await deleteAllocation(client, owner.cookie);
    const secondCookie = await signInAgain(client, owner.email);
    const second = await deleteAllocation(client, secondCookie);
    const activeId = await createActiveAllocation(client, owner.cookie);
    const firstMutation = await db
      .from('planning_mutations')
      .where('restoration_group_id', first.groupId)
      .first();

    const signedOut = await session(client.post('/api/auth/sign-out'), owner.cookie).send();
    signedOut.assertStatus(200);

    assert.isNull(await db.from('deleted_groups').where('group_id', first.groupId).first());
    assert.lengthOf(await db.from('deleted_rows').where('group_id', first.groupId), 0);
    assert.isNull(await db.from('allocations').where('id', first.allocationId).first());
    assert.exists(await db.from('deleted_groups').where('group_id', second.groupId).first());
    assert.exists(await db.from('allocations').where('id', second.allocationId).first());
    assert.exists(
      await db.from('planning_mutations').where('mutation_id', firstMutation!.mutation_id).first()
    );
    assert.exists(await db.from('allocations').where('id', activeId).first());
    const active = await db.from('allocations').where('id', activeId).first();
    assert.isNull(active.deleted_at);
    assert.isNull(active.deletion_group_id);
  });

  test('sign-out clears a consumed generation and the newer deletion without touching another session', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const owner = await signIn(client);
    const first = await deleteAllocation(client, owner.cookie);
    const undo = await restoreAllocation(client, owner.cookie, first.groupId);
    undo.assertStatus(200);
    const redone = await deleteExistingAllocation(client, owner.cookie, first.allocationId);
    const otherCookie = await signInAgain(client, owner.email);
    const other = await deleteAllocation(client, otherCookie);
    const receipts = await db
      .from('planning_mutations')
      .where('restoration_group_id', first.groupId)
      .select('mutation_id');

    const signedOut = await session(client.post('/api/auth/sign-out'), owner.cookie).send();
    signedOut.assertStatus(200);

    assert.isNull(await db.from('deleted_groups').where('group_id', first.groupId).first());
    assert.isNull(await db.from('deleted_groups').where('group_id', redone.groupId).first());
    assert.lengthOf(
      await db.from('deleted_rows').whereIn('group_id', [first.groupId, redone.groupId]),
      0
    );
    assert.isNull(await db.from('allocations').where('id', first.allocationId).first());
    assert.exists(await db.from('deleted_groups').where('group_id', other.groupId).first());
    assert.exists(await db.from('allocations').where('id', other.allocationId).first());
    assert.lengthOf(
      await db.from('planning_mutations').whereIn(
        'mutation_id',
        receipts.map((row) => row.mutation_id)
      ),
      receipts.length
    );
  });

  test('Account Kit expiry pruning removes expired-session retained rows only', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const owner = await signIn(client);
    const expired = await deleteAllocation(client, owner.cookie);
    const liveCookie = await signInAgain(client, owner.email);
    const live = await deleteAllocation(client, liveCookie);
    const activeId = await createActiveAllocation(client, liveCookie);
    const expiredGroup = await db.from('deleted_groups').where('group_id', expired.groupId).first();
    assert.exists(expiredGroup);
    await db
      .from('account_sessions')
      .where('id', expiredGroup!.session_id)
      .update({ expires_at: '2000-01-01T00:00:00.000Z' });

    const pruned = await accountKit.maintenance.prune();

    assert.equal(pruned.sessions, 1);
    assert.isNull(await db.from('deleted_groups').where('group_id', expired.groupId).first());
    assert.lengthOf(await db.from('deleted_rows').where('group_id', expired.groupId), 0);
    assert.isNull(await db.from('allocations').where('id', expired.allocationId).first());
    assert.exists(await db.from('deleted_groups').where('group_id', live.groupId).first());
    assert.exists(await db.from('allocations').where('id', live.allocationId).first());
    const active = await db.from('allocations').where('id', activeId).first();
    assert.exists(active);
    assert.isNull(active.deleted_at);
    assert.isNull(active.deletion_group_id);
  });

  test('password change clears pending rows from every session for the identity', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const owner = await signIn(client);
    const first = await deleteAllocation(client, owner.cookie);
    const secondCookie = await signInAgain(client, owner.email);
    const second = await deleteAllocation(client, secondCookie);
    const activeId = await createActiveAllocation(client, owner.cookie);

    const changed = await session(client.post('/api/auth/change-password'), owner.cookie)
      .json({ currentPassword: 'batman-secret-2026', newPassword: 'another-batman-2026' })
      .send();
    changed.assertStatus(200);

    for (const deletion of [first, second]) {
      assert.isNull(await db.from('deleted_groups').where('group_id', deletion.groupId).first());
      assert.lengthOf(await db.from('deleted_rows').where('group_id', deletion.groupId), 0);
      assert.isNull(await db.from('allocations').where('id', deletion.allocationId).first());
    }
    const active = await db.from('allocations').where('id', activeId).first();
    assert.exists(active);
    assert.isNull(active.deleted_at);
    assert.isNull(active.deletion_group_id);
  });

  test('password reset clears pending rows from every session for the identity', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const mail = captureMail(cleanup);
    const owner = await signIn(client);
    const first = await deleteAllocation(client, owner.cookie);
    const secondCookie = await signInAgain(client, owner.email);
    const second = await deleteAllocation(client, secondCookie);
    const activeId = await createActiveAllocation(client, owner.cookie);

    const requested = await client
      .post('/api/auth/request-reset')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: owner.email })
      .send();
    requested.assertStatus(200);
    const token = mail.tokenFor(owner.email);
    const reset = await client
      .post('/api/auth/reset-password')
      .header('sec-fetch-site', 'same-origin')
      .json({ token, newPassword: 'another-batman-2026' })
      .send();
    reset.assertStatus(200);

    for (const deletion of [first, second]) {
      assert.isNull(await db.from('deleted_groups').where('group_id', deletion.groupId).first());
      assert.lengthOf(await db.from('deleted_rows').where('group_id', deletion.groupId), 0);
      assert.isNull(await db.from('allocations').where('id', deletion.allocationId).first());
    }
    const active = await db.from('allocations').where('id', activeId).first();
    assert.exists(active);
    assert.isNull(active.deleted_at);
    assert.isNull(active.deletion_group_id);
  });

  test('Kit revoke, revokeOthers and revoke-current clean their own retained rows', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const owner = await signIn(client);
    const current = await deleteAllocation(client, owner.cookie);
    const otherCookie = await signInAgain(client, owner.email);
    const other = await deleteAllocation(client, otherCookie);
    const anotherCookie = await signInAgain(client, owner.email);
    const another = await deleteAllocation(client, anotherCookie);
    const currentGroup = await db.from('deleted_groups').where('group_id', current.groupId).first();
    const otherGroup = await db.from('deleted_groups').where('group_id', other.groupId).first();
    const currentHandle = `fixture-session-${randomUUID()}`;
    const user = await db.from('users').where('id', owner.userId).first();
    const credentialRevision = user.credentials_changed_at
      ? new Date(user.credentials_changed_at).toISOString()
      : null;
    const currentInput = {
      userId: owner.userId,
      revision: credentialRevision,
      sessionHandle: currentHandle,
    };
    await db
      .from('account_sessions')
      .where('id', currentGroup.session_id)
      .update({
        handle_hash: createHash('sha256').update(currentHandle).digest('hex'),
      });

    const revokedOther = await accountKit.authentication.sessions.revoke({
      current: currentInput,
      id: otherGroup.session_id,
    });
    assert.isFalse(revokedOther.current);
    assert.isNull(await db.from('deleted_groups').where('group_id', other.groupId).first());
    assert.isNull(await db.from('allocations').where('id', other.allocationId).first());
    assert.exists(await db.from('deleted_groups').where('group_id', current.groupId).first());
    assert.exists(await db.from('deleted_groups').where('group_id', another.groupId).first());

    const revokedOthers = await accountKit.authentication.sessions.revokeOthers({
      current: currentInput,
    });
    assert.equal(revokedOthers.count, 1);
    assert.isNull(await db.from('deleted_groups').where('group_id', another.groupId).first());
    assert.isNull(await db.from('allocations').where('id', another.allocationId).first());
    assert.exists(await db.from('deleted_groups').where('group_id', current.groupId).first());

    const revokedCurrent = await accountKit.authentication.sessions.revoke({
      current: currentInput,
      id: currentGroup.session_id,
    });
    assert.isTrue(revokedCurrent.current);
    assert.isNull(await db.from('deleted_groups').where('group_id', current.groupId).first());
    assert.isNull(await db.from('allocations').where('id', current.allocationId).first());
  });

  test('identity deletion cascades its sessions and retained rows without clearing another identity', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup);
    const owner = await signIn(client);
    const deletedWithIdentity = await deleteAllocation(client, owner.cookie);
    const editor = await signIn(client, 'editor');
    const retained = await deleteAllocation(client, editor.cookie);
    const ownerActive = await createActiveAllocation(client, editor.cookie);

    await db.from('users').where('id', owner.userId).delete();

    assert.isNull(
      await db.from('deleted_groups').where('group_id', deletedWithIdentity.groupId).first()
    );
    assert.lengthOf(
      await db.from('deleted_rows').where('group_id', deletedWithIdentity.groupId),
      0
    );
    assert.isNull(
      await db.from('allocations').where('id', deletedWithIdentity.allocationId).first()
    );
    assert.exists(await db.from('deleted_groups').where('group_id', retained.groupId).first());
    assert.exists(await db.from('allocations').where('id', retained.allocationId).first());
    const active = await db.from('allocations').where('id', ownerActive).first();
    assert.exists(active);
    assert.isNull(active.deleted_at);
    assert.isNull(active.deletion_group_id);
  });
});

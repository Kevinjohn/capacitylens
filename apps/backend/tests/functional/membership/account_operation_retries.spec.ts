import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import limiter from '@adonisjs/limiter/services/main';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { resetState } from '#tests/helpers/state_fixture';
import { asDataOwner, asLoggedInDataOwner } from '#tests/helpers/authenticated_data_fixture';
import { captureMail, clearIdentities } from '#tests/helpers/identities';
import {
  codeOf,
  companyId,
  operation,
  retryCompany,
  transferConfirmation,
} from '#tests/helpers/membership/account_operations';

/**
 * What the server does when the browser repeats an account operation after an unknown outcome,
 * with the same operation headers or a fresh pair (issue #2454).
 */
test.group('account operation retries', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await clearIdentities();
    await limiter.clear();
  });

  test('a repeated invitation with a fresh key is refused as pending and sends no second email', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup);
    const { owner } = await retryCompany(client);
    const invitee = 'diana.prince@wayne.example';
    const invite = (headers: Record<string, string>) =>
      asLoggedInDataOwner(client.visit('api.invitations.store'), owner.user)
        .headers(headers)
        .json({ companyId, email: invitee, role: 'editor' })
        .send();

    const first = await invite(operation(1));
    first.assertStatus(201);
    // The route ignores the operation headers: the same key, a fresh key and none answer alike,
    // refused by the pending invitation until the recipient throttle answers first.
    for (const headers of [operation(1), operation(2)]) {
      const repeat = await invite(headers);
      repeat.assertStatus(409);
      assert.equal(codeOf(repeat), 'E_ACCOUNT_KIT_INVITATION_PENDING');
    }
    const throttled = await invite({});
    throttled.assertStatus(429);
    assert.equal(codeOf(throttled), 'E_ACCOUNT_KIT_THROTTLED');
    assert.lengthOf(await db.from('account_invitations').where('email', invitee), 1);
    assert.equal(mail.count(invitee), 1);
    assert.lengthOf(await db.from('request_receipts'), 0, 'invitations record no receipt');
  });

  test('a repeated invitation revocation, with the same or a fresh key, is not found', async ({
    client,
    assert,
    cleanup,
  }) => {
    captureMail(cleanup);
    const { owner } = await retryCompany(client);
    const sent = await asLoggedInDataOwner(client.visit('api.invitations.store'), owner.user)
      .json({ companyId, email: 'diana.prince@wayne.example', role: 'editor' })
      .send();
    sent.assertStatus(201);
    const { id } = await db.from('account_invitations').firstOrFail();
    const revoke = (n: number) =>
      asLoggedInDataOwner(client.visit('api.invitations.destroy', { companyId, id }), owner.user)
        .headers(operation(n))
        .send();

    const revoked = await revoke(1);
    revoked.assertStatus(204);
    // The route records no receipt, so even the same key is answered afresh, never replayed.
    for (const n of [1, 2]) {
      const repeat = await revoke(n);
      repeat.assertStatus(404);
      assert.equal(codeOf(repeat), 'E_ACCOUNT_KIT_INVITATION_NOT_FOUND');
    }
    assert.lengthOf(await db.from('account_invitations'), 0);
    assert.lengthOf(await db.from('request_receipts'), 0, 'revocation records no receipt');
  });

  test('a repeated status change with a fresh key answers the same result without a second effect', async ({
    client,
    assert,
  }) => {
    const { owner, admin } = await retryCompany(client);
    const suspend = (n: number) =>
      asLoggedInDataOwner(
        client.visit('api.member_status.update', { companyId, userId: admin.id }),
        owner.user
      )
        .headers(operation(n))
        .json({ status: 'suspended' })
        .send();

    const first = await suspend(1);
    first.assertStatus(200);
    const repeat = await suspend(2);
    repeat.assertStatus(200);
    assert.deepEqual(repeat.body().data, first.body().data);
    assert.lengthOf(
      await db
        .from('audit_entries')
        .where({ action: 'member.status_changed', entity_id: admin.id }),
      1
    );
  });

  test('ownership transfer: a stored key with a new confirmation replays or runs, never conflicts', async ({
    client,
    assert,
  }) => {
    const { owner, admin } = await retryCompany(client);
    const transfer = (confirmationId: string) =>
      asDataOwner(client.visit('api.ownership_transfers.store', { companyId }), owner.cookie)
        .headers(operation(1))
        .json({ toUserId: admin.id, confirmationId })
        .send();

    // An attempt that fails before commit leaves no receipt, so the stored key runs afresh.
    const refused = await transfer('00000000-0000-4000-8000-000000000000');
    refused.assertStatus(403);
    assert.equal(codeOf(refused), 'PASSWORD_CONFIRMATION_REQUIRED');
    assert.lengthOf(await db.from('request_receipts'), 0);

    const firstProof = await transferConfirmation(client, owner.cookie, admin.id);
    firstProof.assertStatus(200);
    const committed = await transfer(firstProof.body().data.confirmationId);
    committed.assertStatus(200);

    // After a committed transfer whose answer was lost, the former Owner cannot obtain a new
    // confirmation; the stored key replays the receipt without reading the confirmation at all.
    const secondProof = await transferConfirmation(client, owner.cookie, admin.id);
    secondProof.assertStatus(403);
    assert.equal(codeOf(secondProof), 'PASSWORD_CONFIRMATION_REQUIRED');
    const replayed = await transfer('00000000-0000-4000-8000-000000000001');
    replayed.assertStatus(200);
    assert.deepEqual(replayed.body().data, committed.body().data);

    // A fresh key instead finds the caller is no longer Owner.
    const fresh = await asDataOwner(
      client.visit('api.ownership_transfers.store', { companyId }),
      owner.cookie
    )
      .headers(operation(2))
      .json({ toUserId: admin.id, confirmationId: firstProof.body().data.confirmationId })
      .send();
    fresh.assertStatus(403);
    assert.equal(codeOf(fresh), 'IDENTITY_AUTHORIZATION_DENIED');
    assert.lengthOf(await db.from('audit_entries').where('action', 'ownership.transferred'), 1);
  });
});

import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import User from '#models/user';
import limiter from '@adonisjs/limiter/services/main';
import { resetState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { asDataOwner, asLoggedInDataOwner } from '#tests/helpers/authenticated_data_fixture';
import { captureMail, clearIdentities, signIn, expectStatus } from '#tests/helpers/identities';
import {
  companyId,
  editor,
  newPassword,
  post,
  requestReset,
  inspect,
  company,
} from '#tests/helpers/auth/recovery';

test.group('password recovery', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await clearIdentities();
    await limiter.clear();
  });

  test('recovery is unavailable without mail and never reveals whether an address exists', async ({
    client,
    assert,
    cleanup,
  }) => {
    await company();
    await expectStatus(requestReset(client, editor), 404);
    // The request is validated first, so a malformed one is refused even without mail.
    await expectStatus(requestReset(client, 'not-an-email'), 422);
    const mail = captureMail(cleanup);
    for (const email of [editor, 'joker@wayne.example']) {
      const response = await requestReset(client, email);
      response.assertStatus(200);
      assert.deepEqual((response.body() as { data: unknown }).data, { ok: true });
    }
    assert.equal(mail.count(editor), 1);
    assert.equal(mail.count('joker@wayne.example'), 0);
  });

  test('every link route keeps its answers out of caches and referrers, refusals included', async ({
    client,
    assert,
  }) => {
    const token = 'x'.repeat(513);
    const refusals = [
      await client.visit('api.invitation_links.show', { token }).send(),
      await post(client.visit('api.invitation_acceptances.store', { token }), {}),
      await post(client.visit('api.password_resets.show'), {}),
      await post(client.visit('api.password_resets.update'), {}),
      await post(client.visit('api.email_verifications.show'), {}),
      await post(client.visit('api.email_verifications.update'), {}),
    ];
    for (const response of refusals) {
      response.assertStatus(422);
      assert.equal(response.header('cache-control'), 'no-store');
      assert.equal(response.header('referrer-policy'), 'no-referrer');
    }
  });

  test('a reset link survives inspection, ends every sign-in and works once', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup);
    const { editorId } = await company();
    const { cookie } = await signIn(client, editor);
    await requestReset(client, editor);
    const token = mail.tokenFor(editor);
    assert.isTrue(await inspect(client, token));
    assert.isTrue(await inspect(client, token), 'inspection does not spend the link');
    await expectStatus(
      post(client.visit('api.password_resets.update'), { token, newPassword: 'short' }),
      422
    );
    const reset = await post(client.visit('api.password_resets.update'), { token, newPassword });
    reset.assertStatus(200);
    assert.equal(reset.header('cache-control'), 'no-store');
    await expectStatus(asDataOwner(client.visit('api.session.show'), cookie).send(), 401);
    assert.lengthOf(await db.from('account_sessions').where('user_id', editorId), 0);
    await signIn(client, editor, newPassword);
    assert.isFalse(await inspect(client, token));
    const reused = await post(client.visit('api.password_resets.update'), { token, newPassword });
    reused.assertStatus(400);
    assert.equal((reused.body() as { code?: string }).code, 'E_INVALID_TOKEN');
    assert.isNotNull(
      await db
        .from('audit_entries')
        .where({ action: 'identity.credentials_changed', actor_id: editorId })
        .first()
    );
  });

  test('a role change leaves a pending reset link usable', async ({ client, cleanup }) => {
    const mail = captureMail(cleanup);
    const { ownerId, editorId } = await company();
    await requestReset(client, editor);
    const token = mail.tokenFor(editor);
    const ownerUser = await User.findOrFail(ownerId);
    const changed = await asLoggedInDataOwner(
      client.visit('api.members.update', { companyId, userId: editorId }),
      ownerUser
    )
      .headers({
        'x-account-operation-id': 'recovery-role-command-0001',
        'idempotency-key': 'recovery-role-idempotency-0001',
      })
      .json({ role: 'viewer' })
      .send();
    changed.assertStatus(200);
    await expectStatus(
      post(client.visit('api.password_resets.update'), { token, newPassword }),
      200
    );
    await signIn(client, editor, newPassword);
  });
});

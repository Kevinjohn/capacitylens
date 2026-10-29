import { test } from '@japa/runner';
import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import limiter from '@adonisjs/limiter/services/main';
import { resetState } from '#services/state_repository';
import { freshDatabase } from '../../helpers/fresh_database.js';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import {
  captureMail,
  clearIdentities,
  createIdentity,
  signIn,
  expectStatus,
} from '../../helpers/identities.js';

const accountId = 'a-studio';
const owner = 'bruce.wayne@wayne.example';
const editor = 'clark.kent@wayne.example';
const newPassword = 'recovered-password-2026';

const post = (client: ApiClient, path: string, body: object) =>
  client.post(path).header('sec-fetch-site', 'same-origin').json(body).send();

const requestReset = (client: ApiClient, email: string) =>
  post(client, '/api/auth/request-reset', { email });

const inspect = async (client: ApiClient, token: string) => {
  const response = await post(client, '/api/auth/inspect-reset', { token });
  response.assertStatus(200);
  return (response.body() as { valid: boolean }).valid;
};

async function company() {
  const ownerId = await createIdentity(owner, { name: 'Bruce Wayne' });
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', accountId);
  const editorId = await createIdentity(editor, { name: 'Clark Kent' });
  const now = new Date().toISOString();
  await db.table('memberships').insert({
    id: 'member-clark',
    account_id: accountId,
    user_id: editorId,
    role: 'editor',
    status: 'active',
    created_at: now,
    updated_at: now,
  });
  return editorId;
}

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
    const mail = captureMail(cleanup);
    for (const email of [editor, 'joker@wayne.example']) {
      const response = await requestReset(client, email);
      response.assertStatus(200);
      assert.deepEqual(response.body(), { ok: true });
    }
    assert.equal(mail.count(editor), 1);
    assert.equal(mail.count('joker@wayne.example'), 0);
  });

  test('a reset link survives inspection, ends every sign-in and works once', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup);
    const editorId = await company();
    const { cookie } = await signIn(client, editor);
    await requestReset(client, editor);
    const token = mail.tokenFor(editor);
    assert.isTrue(await inspect(client, token));
    assert.isTrue(await inspect(client, token), 'inspection does not spend the link');
    await expectStatus(
      post(client, '/api/auth/reset-password', { token, newPassword: 'short' }),
      400
    );
    const reset = await post(client, '/api/auth/reset-password', { token, newPassword });
    reset.assertStatus(200);
    assert.equal(reset.header('cache-control'), 'no-store');
    await expectStatus(asDataOwner(client.get('/api/auth/me'), cookie).send(), 401);
    assert.lengthOf(await db.from('account_sessions').where('user_id', editorId), 0);
    await signIn(client, editor, newPassword);
    assert.isFalse(await inspect(client, token));
    const reused = await post(client, '/api/auth/reset-password', { token, newPassword });
    reused.assertStatus(400);
    assert.equal((reused.body() as { code?: string }).code, 'INVALID_TOKEN');
    assert.isNotNull(
      await db
        .from('audit_entries')
        .where({ action: 'identity.credentials_changed', actor_id: editorId })
        .first()
    );
  });

  test('a role change leaves a pending reset link usable', async ({ client, cleanup }) => {
    const mail = captureMail(cleanup);
    const editorId = await company();
    await requestReset(client, editor);
    const token = mail.tokenFor(editor);
    const { cookie } = await signIn(client, owner);
    const changed = await asDataOwner(
      client.patch(`/api/accounts/${accountId}/members/${editorId}`),
      cookie
    )
      .headers({
        'x-account-command-id': 'recovery-role-command-0001',
        'idempotency-key': 'recovery-role-idempotency-0001',
      })
      .json({ role: 'viewer' })
      .send();
    changed.assertStatus(200);
    await expectStatus(post(client, '/api/auth/reset-password', { token, newPassword }), 200);
    await signIn(client, editor, newPassword);
  });
});

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
import { clearIdentities, createIdentity, signIn, expectStatus } from '../../helpers/identities.js';
import { requestBarrier } from '../../helpers/request_barrier.js';
import { masqueradeService } from '#services/auth/masquerade';

const email = 'bruce.wayne@wayne.example';
const password = 'batman-secret-2026';
const accountId = 'a-studio';

const accounts = (client: ApiClient, cookie: string) =>
  asDataOwner(client.get('/api/accounts'), cookie).send();
const planning = (client: ApiClient, cookie: string) =>
  asDataOwner(client.get(`/api/accounts/${accountId}/planning`), cookie).send();
const dismiss = (client: ApiClient, cookie: string) =>
  asDataOwner(client.put(`/api/accounts/${accountId}/getting-started`), cookie)
    .timeout({ response: 10000, deadline: 15000 })
    .json({ dismissed: true })
    .send();
const dismissals = () => db.from('account_getting_started_dismissals');

async function owner(options: { verified?: boolean; admitted?: boolean } = {}) {
  const userId = await createIdentity(email, { name: 'Bruce Wayne', password, ...options });
  await createFixtureCompanyForOwner(userId, 'Wayne Enterprises', accountId);
  return userId;
}

test.group('password sign-in and sessions', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await clearIdentities();
    await limiter.clear();
  });

  test('each sign-in is separate and sign-out ends only its own', async ({ client, assert }) => {
    const userId = await owner();
    const wrong = await client
      .post('/api/auth/sign-in')
      .header('sec-fetch-site', 'same-origin')
      .json({ email, password: 'not-the-password-2026' })
      .send();
    wrong.assertStatus(401);
    const laptop = await signIn(client, email, password);
    const phone = await signIn(client, 'Bruce.Wayne@Wayne.example', password);
    assert.equal(phone.userId, userId);
    assert.lengthOf(await db.from('account_sessions').where('user_id', userId), 2);
    const signedOut = await asDataOwner(client.post('/api/auth/sign-out'), laptop.cookie).send();
    signedOut.assertStatus(200);
    await expectStatus(accounts(client, laptop.cookie), 401);
    await expectStatus(accounts(client, phone.cookie), 200);
    assert.lengthOf(await db.from('account_sessions').where('user_id', userId), 1);
  });

  test('unconfirmed, unadmitted and disabled identities cannot reach company data', async ({
    client,
    assert,
  }) => {
    const userId = await owner({ verified: false });
    const unconfirmed = await signIn(client, email, password);
    const me = await asDataOwner(client.get('/api/auth/me'), unconfirmed.cookie).send();
    me.assertStatus(200);
    assert.isFalse(me.body().emailVerified);
    await expectStatus(planning(client, unconfirmed.cookie), 403);
    await expectStatus(dismiss(client, unconfirmed.cookie), 403);

    await db.from('users').where('id', userId).update({
      email_verified_at: new Date().toISOString(),
      unverified_email: null,
    });
    await expectStatus(planning(client, unconfirmed.cookie), 200);

    await db
      .from('account_admissions')
      .where('user_id', userId)
      .update({ approval_status: 'revoked' });
    await expectStatus(planning(client, unconfirmed.cookie), 403);
    const limited = await asDataOwner(client.get('/api/auth/me'), unconfirmed.cookie).send();
    assert.isFalse(limited.body().admission.admitted);

    await db
      .from('account_admissions')
      .where('user_id', userId)
      .update({ approval_status: 'approved' });
    await db.from('memberships').where('user_id', userId).update({ status: 'disabled' });
    await expectStatus(planning(client, unconfirmed.cookie), 403);
    assert.lengthOf(await dismissals(), 0);
  });

  test('a password change ends every sign-in and retires the old password', async ({
    client,
    assert,
  }) => {
    const userId = await owner();
    const laptop = await signIn(client, email, password);
    const phone = await signIn(client, email, password);
    const wrong = await asDataOwner(client.post('/api/auth/change-password'), laptop.cookie)
      .json({ currentPassword: 'not-the-password-2026', newPassword: 'another-batman-2026' })
      .send();
    wrong.assertStatus(403);
    assert.equal((wrong.body() as { code?: string }).code, 'CURRENT_PASSWORD_INCORRECT');
    await expectStatus(accounts(client, phone.cookie), 200);
    const changed = await asDataOwner(client.post('/api/auth/change-password'), laptop.cookie)
      .json({ currentPassword: password, newPassword: 'another-batman-2026' })
      .send();
    changed.assertStatus(200);
    assert.deepEqual(changed.body(), { ok: true, signedOut: true });
    await expectStatus(accounts(client, laptop.cookie), 401);
    await expectStatus(accounts(client, phone.cookie), 401);
    assert.lengthOf(await db.from('account_sessions').where('user_id', userId), 0);
    const old = await client
      .post('/api/auth/sign-in')
      .header('sec-fetch-site', 'same-origin')
      .json({ email, password })
      .send();
    old.assertStatus(401);
    await signIn(client, email, 'another-batman-2026');
    const stored = await db.from('users').where('id', userId).select('password').first();
    assert.match(String(stored?.password), /^\$(scrypt|argon2|bcrypt)/);
    assert.deepInclude(
      await db.from('audit_entries').where('action', 'identity.credentials_changed').first(),
      { account_id: accountId, actor_id: userId }
    );
  });

  test('an expired or unregistered sign-in is refused', async ({ client }) => {
    const userId = await owner();
    const expiring = await signIn(client, email, password);
    await db
      .from('account_sessions')
      .where('user_id', userId)
      .update({ expires_at: '2000-01-01T00:00:00.000Z' });
    await expectStatus(accounts(client, expiring.cookie), 401);
    const removed = await signIn(client, email, password);
    await db.from('account_sessions').where('user_id', userId).delete();
    await expectStatus(accounts(client, removed.cookie), 401);
  });

  test('a session revoked after request admission refuses the protected write', async ({
    client,
    assert,
  }) => {
    const userId = await owner();
    const { cookie } = await signIn(client, email, password);
    const service = await masqueradeService();
    const original = service.resolve.bind(service);
    const barrier = requestBarrier();
    service.resolve = async (request) => {
      const resolved = await original(request);
      if (request.request.url().endsWith('/getting-started')) await barrier.pause();
      return resolved;
    };
    const audits = await db.from('audit_entries');
    const revisions = await db.from('company_planning_revisions');
    const pending = dismiss(client, cookie);
    try {
      await barrier.entered();
      await db.from('account_sessions').where('user_id', userId).delete();
      barrier.release();
      const refused = await pending;
      refused.assertStatus(401);
      assert.lengthOf(await dismissals(), 0);
      assert.deepEqual(await db.from('audit_entries'), audits);
      assert.deepEqual(await db.from('company_planning_revisions'), revisions);
    } finally {
      barrier.release();
      service.resolve = original;
      await pending;
    }
  });

  test('a write that commits before a revocation stands, and the next one is refused', async ({
    client,
    assert,
  }) => {
    const userId = await owner();
    const { cookie } = await signIn(client, email, password);
    const [written, revoked] = await Promise.all([
      dismiss(client, cookie),
      db.from('account_sessions').where('user_id', userId).delete(),
    ]);
    if (written.status() === 200) assert.lengthOf(await dismissals(), 1);
    else {
      written.assertStatus(401);
      assert.lengthOf(await dismissals(), 0);
    }
    assert.equal(Number(revoked), 1);
    await expectStatus(dismiss(client, cookie), 401);
  });
});

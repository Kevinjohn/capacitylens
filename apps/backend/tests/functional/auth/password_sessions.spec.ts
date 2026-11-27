import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import User from '#models/user';
import limiter from '@adonisjs/limiter/services/main';
import { resetState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { asDataOwner, asLoggedInDataOwner } from '#tests/helpers/authenticated_data_fixture';
import { clearIdentities, signIn, expectStatus } from '#tests/helpers/identities';
import { requestBarrier } from '#tests/helpers/request_barrier';
import { masqueradeAdmission } from '#tests/helpers/masquerade_admission';
import {
  email,
  password,
  companyId,
  companies,
  planning,
  dismiss,
  dismissals,
  owner,
} from '#tests/helpers/auth/password_sessions';

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
      .visit('api.session.store')
      .header('sec-fetch-site', 'same-origin')
      .json({ email, password: 'not-the-password-2026' })
      .send();
    wrong.assertStatus(401);
    const laptop = await signIn(client, email, password);
    const phone = await signIn(client, 'Bruce.Wayne@Wayne.example', password);
    assert.equal(phone.userId, userId);
    assert.lengthOf(await db.from('account_sessions').where('user_id', userId), 2);
    const signedOut = await asDataOwner(client.visit('api.session.destroy'), laptop.cookie).send();
    signedOut.assertStatus(200);
    await expectStatus(companies(client, laptop.cookie), 401);
    await expectStatus(companies(client, phone.cookie), 200);
    assert.lengthOf(await db.from('account_sessions').where('user_id', userId), 1);
  });

  test('a late request cannot recreate its database session after sign-out', async ({
    client,
    assert,
  }) => {
    await owner();
    const { cookie } = await signIn(client, email, password);
    const session = await db.from('adonis_sessions').select('id').first();
    assert.isNotNull(session, 'sign-in creates a database-backed AdonisJS session');

    const service = await masqueradeAdmission();
    const original = service.resolve.bind(service);
    const barrier = requestBarrier();
    service.resolve = async (request) => {
      const resolved = await original(request);
      if (request.request.url().endsWith('/getting-started')) {
        request.session.put('lateSessionWrite', 'after-sign-out');
        const commit = request.session.commit.bind(request.session);
        request.session.commit = async () => {
          await barrier.pause();
          await commit();
        };
      }
      return resolved;
    };

    const pending = dismiss(client, cookie);
    try {
      // The real handler completes before session middleware attempts its database-store commit.
      await barrier.entered();
      const signedOut = await asDataOwner(client.visit('api.session.destroy'), cookie).send();
      signedOut.assertStatus(200);
      assert.isNull(
        await db.from('adonis_sessions').where('id', session!.id).first(),
        'sign-out removes the old framework session before the pending request resumes'
      );

      barrier.release();
      const late = await pending;
      assert.equal(
        late.status(),
        200,
        'the request was authorized before sign-out and reaches its response'
      );
      assert.isNull(
        await db.from('adonis_sessions').where('id', session!.id).first(),
        'the late framework-session write does not recreate the destroyed row'
      );
      await expectStatus(companies(client, cookie), 401);
    } finally {
      barrier.release();
      service.resolve = original;
      await pending;
    }
  });

  test('unconfirmed, unadmitted and disabled identities cannot reach company data', async ({
    client,
    assert,
  }) => {
    const userId = await owner({ verified: false });
    const unconfirmed = await signIn(client, email, password);
    const user = await User.findOrFail(userId);
    const me = await asLoggedInDataOwner(client.visit('api.session.show'), user).send();
    me.assertStatus(200);
    assert.isFalse(me.body().data.emailVerified);
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
    const limited = await asLoggedInDataOwner(client.visit('api.session.show'), user).send();
    assert.isFalse(limited.body().data.admission.admitted);

    await db
      .from('account_admissions')
      .where('user_id', userId)
      .update({ approval_status: 'approved' });
    await db.from('memberships').where('user_id', userId).update({ status: 'suspended' });
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
    const wrong = await asDataOwner(client.visit('api.password.update'), laptop.cookie)
      .json({ currentPassword: 'not-the-password-2026', newPassword: 'another-batman-2026' })
      .send();
    wrong.assertStatus(403);
    assert.equal((wrong.body() as { code?: string }).code, 'E_CURRENT_PASSWORD_INCORRECT');
    await expectStatus(companies(client, phone.cookie), 200);
    const changed = await asDataOwner(client.visit('api.password.update'), laptop.cookie)
      .json({ currentPassword: password, newPassword: 'another-batman-2026' })
      .send();
    changed.assertStatus(200);
    assert.deepEqual(changed.body().data, { ok: true, signedOut: true });
    await expectStatus(companies(client, laptop.cookie), 401);
    await expectStatus(companies(client, phone.cookie), 401);
    assert.lengthOf(await db.from('account_sessions').where('user_id', userId), 0);
    const old = await client
      .visit('api.session.store')
      .header('sec-fetch-site', 'same-origin')
      .json({ email, password })
      .send();
    old.assertStatus(401);
    await signIn(client, email, 'another-batman-2026');
    const stored = await db.from('users').where('id', userId).select('password').first();
    assert.match(String(stored?.password), /^\$(scrypt|argon2|bcrypt)/);
    assert.deepInclude(
      await db.from('audit_entries').where('action', 'identity.credentials_changed').first(),
      { company_id: companyId, actor_id: userId }
    );
  });

  test('a new sign-in is registered to expire after 14 idle days', async ({ client, assert }) => {
    const userId = await owner();
    const before = Date.now();
    const response = await client
      .visit('api.session.store')
      .header('sec-fetch-site', 'same-origin')
      .json({ email, password })
      .send();
    response.assertStatus(200);
    const session = await db.from('account_sessions').where('user_id', userId).firstOrFail();
    const idleDays = (new Date(session.expires_at).getTime() - before) / 86_400_000;
    assert.closeTo(idleDays, 14, 0.01);
    // The browser keeps the cookie exactly as long as the registry keeps the sign-in.
    assert.equal(response.cookie('adonis-session')?.maxAge, 14 * 86_400);
  });

  test('an expired or unregistered sign-in is refused', async ({ client }) => {
    const userId = await owner();
    const expiring = await signIn(client, email, password);
    await db
      .from('account_sessions')
      .where('user_id', userId)
      .update({ expires_at: '2000-01-01T00:00:00.000Z' });
    await expectStatus(companies(client, expiring.cookie), 401);
    const removed = await signIn(client, email, password);
    await db.from('account_sessions').where('user_id', userId).delete();
    await expectStatus(companies(client, removed.cookie), 401);
  });

  test('signing out with an idle-expired session removes its registry row', async ({
    client,
    assert,
  }) => {
    const userId = await owner();
    const { cookie } = await signIn(client, email, password);
    await db
      .from('account_sessions')
      .where('user_id', userId)
      .update({ expires_at: '2000-01-01T00:00:00.000Z' });
    const signedOut = await asDataOwner(client.visit('api.session.destroy'), cookie).send();
    signedOut.assertStatus(200);
    signedOut.assertBody({ data: { ok: true } });
    assert.lengthOf(await db.from('account_sessions').where('user_id', userId), 0);
  });

  test('a session revoked after request admission refuses the protected write', async ({
    client,
    assert,
  }) => {
    const userId = await owner();
    const { cookie } = await signIn(client, email, password);
    const service = await masqueradeAdmission();
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

import { test } from '@japa/runner';
import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import limiter from '@adonisjs/limiter/services/main';
import env from '#start/env';
import User, { FirstCompanyPendingError } from '#models/user';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { asDataOwner } from '../../helpers/authenticated_data_fixture.js';
import {
  bootstrapInvitation,
  createIdentity,
  rememberSessionCookie,
  signIn,
} from '../../helpers/identities.js';

const email = 'bruce.wayne@wayne.example';
const password = 'company-setup-password-2026';
const companyTables = [
  'accounts',
  'clients',
  'memberships',
  'company_planning_revisions',
  'audit_entries',
];

/** The fresh-install journey: the printed bootstrap link, accepted with a password. */
async function acceptBootstrap(client: ApiClient) {
  const token = await bootstrapInvitation(email);
  const preview = await client.get(`/api/invites/${token}/preview`).send();
  preview.assertStatus(200);
  const accepted = await client
    .post(`/api/invites/${token}/signup`)
    .header('sec-fetch-site', 'same-origin')
    .json({ name: 'Bruce Wayne', password })
    .send();
  accepted.assertStatus(201);
  rememberSessionCookie(accepted);
  return { token, cookie: accepted.cookie('adonis-session')!.value, accepted };
}

async function setUp(client: ApiClient, cookie: string, name = 'Wayne Enterprises') {
  return asDataOwner(client.post('/api/installation/company'), cookie).json({ name }).send();
}

test.group('authenticated first company setup', (group) => {
  group.each.setup(async () => {
    await freshDatabase();
    await limiter.clear();
  });

  test('the bootstrap invitation opens one atomic Owner company without restarting', async ({
    client,
    assert,
  }) => {
    const anonymous = await client.get('/api/auth/me').send();
    anonymous.assertStatus(401);
    assert.isTrue((anonymous.body() as { needsSetup?: boolean }).needsSetup);
    const { token, cookie, accepted } = await acceptBootstrap(client);
    const userId = (accepted.body() as { user: { id: string } }).user.id;
    const before = await asDataOwner(client.get('/api/auth/me'), cookie).send();
    assert.isTrue(before.body().emailVerified);
    assert.isTrue(before.body().admission.admitted);
    assert.isTrue(before.body().companySetupRequired);
    assert.lengthOf(await db.from('memberships'), 0, 'the bootstrap role grants nothing');
    const reused = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .json({ name: 'Bruce Wayne', password })
      .send();
    reused.assertStatus(400);
    const setup = await setUp(client, cookie, '  Wayne   Enterprises ');
    setup.assertStatus(201);
    const accountId = setup.body().accountId;
    assert.equal((await db.from('accounts').first())!.name, 'Wayne Enterprises');
    assert.deepInclude((await db.from('memberships').first())!, {
      account_id: accountId,
      user_id: userId,
      role: 'owner',
      status: 'active',
    });
    assert.equal((await db.from('clients').first())!.builtin, 'true');
    assert.equal((await db.from('company_planning_revisions').first())!.revision, 1);
    assert.deepInclude((await db.from('audit_entries').first())!, {
      actor_id: userId,
      action: 'company.initialized',
    });
    const state = await asDataOwner(client.get('/api/state').qs({ accountId }), cookie).send();
    state.assertStatus(200);
    assert.deepEqual(state.body().accounts[0].workingDays, [1, 2, 3, 4, 5]);
    const after = await asDataOwner(client.get('/api/auth/me'), cookie).send();
    assert.isFalse(after.body().companySetupRequired);
    const duplicate = await setUp(client, cookie, 'Stark Industries');
    duplicate.assertStatus(409);
    assert.lengthOf(await db.from('accounts'), 1);
  });

  test('ordinary registration cannot take the first identity, before or racing the bootstrap', async ({
    client,
    assert,
    cleanup,
  }) => {
    const prior = env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP');
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true);
    cleanup(() => env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', prior));
    const route = await client
      .post('/api/auth/sign-up')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: 'joker@wayne.example', password, name: 'Jack Napier' })
      .send();
    route.assertStatus(403);
    assert.equal((route.body() as { code?: string }).code, 'SIGN_UP_CLOSED');
    // Every creation path saves through the model inside the Kit transaction; a registration
    // leaves the address unconfirmed, which the model refuses before the company exists.
    const register = (address: string) =>
      db.transaction((trx) =>
        User.create({ email: address, password, unverifiedEmail: address }, { client: trx })
      );
    await assert.rejects(() => register('joker@wayne.example'), FirstCompanyPendingError);
    const token = await bootstrapInvitation(email);
    const [registered, accepted] = await Promise.allSettled([
      register('harley@wayne.example'),
      client
        .post(`/api/invites/${token}/signup`)
        .header('sec-fetch-site', 'same-origin')
        .json({ name: 'Bruce Wayne', password })
        .send(),
    ]);
    assert.equal(registered.status, 'rejected');
    assert.equal(accepted.status === 'fulfilled' && accepted.value.status(), 201);
    const identities = await db.from('users').select('email');
    assert.deepEqual(
      identities.map((row) => row.email),
      [email]
    );
  });

  test('refuses anonymous setup and malformed or owner-nominating payloads without writes', async ({
    client,
    assert,
  }) => {
    const anonymous = await client
      .post('/api/installation/company')
      .header('sec-fetch-site', 'same-origin')
      .json({ name: 'Wayne Enterprises' })
      .send();
    anonymous.assertStatus(401);
    const { cookie } = await acceptBootstrap(client);
    for (const body of [
      {},
      { name: '' },
      { name: 'x'.repeat(200) },
      { name: 'Wayne Enterprises', ownerId: 'someone-else' },
      ['Wayne Enterprises'],
    ]) {
      const result = await asDataOwner(client.post('/api/installation/company'), cookie)
        .json(body)
        .send();
      result.assertStatus(400);
    }
    for (const table of companyTables) assert.lengthOf(await db.from(table), 0);
  });

  test('concurrent requests create exactly one complete company', async ({ client, assert }) => {
    const { cookie } = await acceptBootstrap(client);
    const results = await Promise.all(
      ['Wayne Enterprises', 'Stark Industries'].map((name) => setUp(client, cookie, name))
    );
    assert.deepEqual(results.map((result) => result.status()).sort(), [201, 409]);
    for (const table of companyTables) assert.lengthOf(await db.from(table), 1);
  });

  test('audit failure rolls back the entire setup and permits a clean retry', async ({
    client,
    assert,
  }) => {
    const { cookie } = await acceptBootstrap(client);
    await db.rawQuery(
      "CREATE TRIGGER fail_setup_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'private detail'); END"
    );
    const failed = await setUp(client, cookie);
    failed.assertStatus(500);
    for (const table of companyTables) assert.lengthOf(await db.from(table), 0);
    await db.rawQuery('DROP TRIGGER fail_setup_audit');
    const retry = await setUp(client, cookie);
    retry.assertStatus(201);
  });

  test('a second identity closes browser setup rather than nominating an Owner', async ({
    client,
    assert,
  }) => {
    const { cookie } = await acceptBootstrap(client);
    await createIdentity('clark.kent@wayne.example', { name: 'Clark Kent' });
    const me = await asDataOwner(client.get('/api/auth/me'), cookie).send();
    assert.isFalse(me.body().companySetupRequired);
    const refused = await setUp(client, cookie);
    refused.assertStatus(409);
    assert.lengthOf(await db.from('accounts'), 0);
  });

  test('an unconfirmed or unadmitted identity cannot set up the company', async ({
    client,
    assert,
  }) => {
    await createIdentity(email, { password, verified: false });
    const unconfirmed = await signIn(client, email, password);
    const limited = await setUp(client, unconfirmed.cookie);
    limited.assertStatus(403);
    await db.from('users').delete();
    await db.from('account_admissions').delete();
    await createIdentity(email, { password, admitted: false });
    const unadmitted = await signIn(client, email, password);
    const pending = await setUp(client, unadmitted.cookie);
    pending.assertStatus(403);
    assert.equal((pending.body() as { code?: string }).code, 'ADMISSION_REQUIRED');
    assert.lengthOf(await db.from('accounts'), 0);
  });

  test('an existing company without membership and a revoked sign-in cannot claim setup', async ({
    client,
    assert,
  }) => {
    const { cookie } = await acceptBootstrap(client);
    const setup = await setUp(client, cookie);
    setup.assertStatus(201);
    await db.from('memberships').delete();
    const refused = await setUp(client, cookie, 'Stark Industries');
    refused.assertStatus(409);
    await db.from('account_sessions').delete();
    const revoked = await setUp(client, cookie, 'Stark Industries');
    revoked.assertStatus(401);
    assert.lengthOf(await db.from('accounts'), 1);
  });
});

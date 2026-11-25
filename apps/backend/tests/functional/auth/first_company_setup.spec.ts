import { test } from '@japa/runner';
import type { ApiClient } from '@japa/api-client';
import db from '@adonisjs/lucid/services/db';
import limiter from '@adonisjs/limiter/services/main';
import env from '#start/env';
import User from '#models/user';
import FirstCompanyPendingException from '#exceptions/first_company_pending_exception';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { asDataOwner } from '#tests/helpers/authenticated_data_fixture';
import {
  bootstrapInvitation,
  createIdentity,
  rememberSessionCookie,
  signIn,
} from '#tests/helpers/identities';

const email = 'bruce.wayne@wayne.example';
const password = 'company-setup-password-2026';
const companyTables = [
  'companies',
  'clients',
  'memberships',
  'company_planning_revisions',
  'audit_entries',
];

/** The fresh-install journey: the printed bootstrap link, accepted with a password. */
async function acceptBootstrap(client: ApiClient) {
  const token = await bootstrapInvitation(email);
  const preview = await client.visit('api.invitation_links.show', { token }).send();
  preview.assertStatus(200);
  const oversized = await client
    .visit('api.invitation_acceptances.store', { token })
    .header('sec-fetch-site', 'same-origin')
    .json({ name: '𐐀'.repeat(101), password })
    .send();
  oversized.assertStatus(422);
  const accepted = await client
    .visit('api.invitation_acceptances.store', { token })
    .header('sec-fetch-site', 'same-origin')
    .json({ name: '𐐀'.repeat(100), password })
    .send();
  accepted.assertStatus(201);
  rememberSessionCookie(accepted);
  return { token, cookie: accepted.cookie('adonis-session')!.value, accepted };
}

async function setUp(client: ApiClient, cookie: string, name = 'Wayne Enterprises') {
  return asDataOwner(client.visit('api.first_company_setup.store'), cookie)
    .json({ name, weekStartsOn: 1, timeZone: 'Etc/GMT' })
    .send();
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
    const anonymous = await client.visit('api.session.show').send();
    anonymous.assertStatus(401);
    assert.isTrue((anonymous.body() as { needsSetup?: boolean }).needsSetup);
    const { token, cookie, accepted } = await acceptBootstrap(client);
    const userId = (accepted.body().data as { user: { id: string } }).user.id;
    const before = await asDataOwner(client.visit('api.session.show'), cookie).send();
    assert.isTrue(before.body().data.emailVerified);
    assert.isTrue(before.body().data.admission.admitted);
    assert.isTrue(before.body().data.companySetupRequired);
    assert.lengthOf(await db.from('memberships'), 0, 'the bootstrap role grants nothing');
    const reused = await client
      .visit('api.invitation_acceptances.store', { token })
      .header('sec-fetch-site', 'same-origin')
      .json({ name: 'Bruce Wayne', password })
      .send();
    reused.assertStatus(400);
    const setup = await setUp(client, cookie, '  Wayne   Enterprises ');
    setup.assertStatus(201);
    const companyId = setup.body().data.companyId;
    assert.equal((await db.from('companies').first())!.name, 'Wayne Enterprises');
    assert.deepInclude((await db.from('memberships').first())!, {
      scope_id: companyId,
      user_id: userId,
      role: 'owner',
      status: 'active',
    });
    const clients = await db.from('clients');
    assert.lengthOf(clients, 1);
    assert.deepInclude(clients[0]!, {
      company_id: companyId,
      name: 'Internal',
      builtin: 1,
    });
    assert.equal((await db.from('company_planning_revisions').first())!.revision, 1);
    assert.deepInclude((await db.from('audit_entries').first())!, {
      actor_id: userId,
      action: 'company.initialized',
    });
    const state = await asDataOwner(
      client.visit('api.company_state.show').qs({ companyId }),
      cookie
    ).send();
    state.assertStatus(200);
    assert.deepEqual(state.body().data.companies[0].workingDays, [1, 2, 3, 4, 5]);
    const after = await asDataOwner(client.visit('api.session.show'), cookie).send();
    assert.isFalse(after.body().data.companySetupRequired);
    const duplicate = await setUp(client, cookie, 'Stark Industries');
    duplicate.assertStatus(409);
    assert.lengthOf(await db.from('companies'), 1);
  });

  test('a Sunday week start gives the first company Sunday through Thursday working days', async ({
    client,
    assert,
  }) => {
    const { cookie } = await acceptBootstrap(client);
    const setup = await asDataOwner(client.visit('api.first_company_setup.store'), cookie)
      .json({ name: 'Wayne Enterprises', weekStartsOn: 0 })
      .send();
    setup.assertStatus(201);
    const state = await asDataOwner(
      client.visit('api.company_state.show').qs({ companyId: setup.body().data.companyId }),
      cookie
    ).send();
    state.assertStatus(200);
    assert.deepEqual(state.body().data.companies[0].workingDays, [0, 1, 2, 3, 4]);
  });

  for (const choice of [
    { description: 'name-only caller', fields: {}, weekStart: 1, timezone: 'Etc/GMT' },
    {
      description: 'week-start-only caller',
      fields: { weekStartsOn: 0 },
      weekStart: 0,
      timezone: 'Etc/GMT',
    },
    {
      description: 'timezone-only caller',
      fields: { timeZone: 'America/New_York' },
      weekStart: 1,
      timezone: 'America/New_York',
    },
  ]) {
    test(`keeps omitted calendar fields compatible for a ${choice.description}`, async ({
      client,
      assert,
    }) => {
      const { cookie } = await acceptBootstrap(client);
      const result = await asDataOwner(client.visit('api.first_company_setup.store'), cookie)
        .json({ name: 'Wayne Enterprises', ...choice.fields } as never)
        .send();
      result.assertStatus(201);
      const company = await db.from('companies').first();
      assert.equal(company.week_starts_on, choice.weekStart);
      assert.equal(company.timezone, choice.timezone);
      for (const table of companyTables) assert.lengthOf(await db.from(table), 1);
    });
  }

  test('initial calendar choices are validated before any company rows and persisted atomically', async ({
    client,
    assert,
  }) => {
    const { cookie } = await acceptBootstrap(client);
    // Request validation refuses a malformed shape, and the setup rules a time zone they cannot
    // use, both with 422.
    for (const [extra, status] of [
      [{ weekStartsOn: 2, timeZone: 'Etc/GMT' }, 422],
      [{ weekStartsOn: 0, timeZone: 'Gotham/Invalid' }, 422],
      [{ weekStartsOn: null, timeZone: 'Etc/GMT' }, 422],
      [{ weekStartsOn: 1, timeZone: '+01:00' }, 422],
      [{ weekStartsOn: 1, timeZone: null }, 422],
      [{ weekStartsOn: 1, timeZone: '' }, 422],
      [{ weekStartsOn: '1', timeZone: 'Etc/GMT' }, 422],
    ] as const) {
      const refused = await asDataOwner(client.visit('api.first_company_setup.store'), cookie)
        // Deliberately outside the generated body type, to reach the server's refusal.
        .json({ name: 'Wayne Enterprises', ...extra } as never)
        .send();
      refused.assertStatus(status);
      for (const table of companyTables) assert.lengthOf(await db.from(table), 0);
    }
    const response = await asDataOwner(client.visit('api.first_company_setup.store'), cookie)
      .json({ name: 'Wayne Enterprises', weekStartsOn: 0, timeZone: 'America/New_York' })
      .send();
    response.assertStatus(201);
    const company = await db.from('companies').first();
    assert.equal(company.week_starts_on, '0');
    assert.equal(company.timezone, 'America/New_York');
  });

  test('ordinary sign-up cannot take the first identity, before or racing the bootstrap', async ({
    client,
    assert,
    cleanup,
  }) => {
    const prior = env.get('CAPACITYLENS_ALLOW_OPEN_SIGN_UP');
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGN_UP', true);
    cleanup(() => env.set('CAPACITYLENS_ALLOW_OPEN_SIGN_UP', prior));
    const route = await client
      .visit('api.new_account.store')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: 'joker@wayne.example', password, name: 'Jack Napier' })
      .send();
    route.assertStatus(403);
    assert.equal((route.body() as { code?: string }).code, 'SIGN_UP_CLOSED');
    // Every creation path saves through the model inside the Kit transaction; a sign-up
    // leaves the address unconfirmed, which the model refuses before the company exists.
    const signUp = (address: string) =>
      db.transaction((trx) =>
        User.create({ email: address, password, unverifiedEmail: address }, { client: trx })
      );
    await assert.rejects(() => signUp('joker@wayne.example'), FirstCompanyPendingException);
    const token = await bootstrapInvitation(email);
    const [signedUp, accepted] = await Promise.allSettled([
      signUp('harley@wayne.example'),
      client
        .visit('api.invitation_acceptances.store', { token })
        .header('sec-fetch-site', 'same-origin')
        .json({ name: 'Bruce Wayne', password })
        .send(),
    ]);
    assert.equal(signedUp.status, 'rejected');
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
      .visit('api.first_company_setup.store')
      .header('sec-fetch-site', 'same-origin')
      .json({ name: 'Wayne Enterprises' })
      .send();
    anonymous.assertStatus(401);
    const { cookie } = await acceptBootstrap(client);
    // Request validation refuses a malformed shape, and the name rule a name it cannot use, with 422.
    for (const [body, status] of [
      [{}, 422],
      [{ name: '' }, 422],
      [{ name: 'x'.repeat(200) }, 422],
      [{ name: 'Wayne Enterprises', ownerId: 'someone-else' }, 422],
      [['Wayne Enterprises'], 422],
    ] as const) {
      const result = await asDataOwner(client.visit('api.first_company_setup.store'), cookie)
        // Deliberately outside the generated body type, to reach the server's refusal.
        .json(body as never)
        .send();
      result.assertStatus(status);
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
    const me = await asDataOwner(client.visit('api.session.show'), cookie).send();
    assert.isFalse(me.body().data.companySetupRequired);
    const refused = await setUp(client, cookie);
    refused.assertStatus(409);
    assert.lengthOf(await db.from('companies'), 0);
  });

  test('an unconfirmed or unadmitted identity cannot set up the company', async ({
    client,
    assert,
  }) => {
    await createIdentity(email, { password, verified: false });
    const unconfirmed = await signIn(client, email, password);
    const limited = await setUp(client, unconfirmed.cookie);
    limited.assertStatus(403);
    await db.from('memberships').delete();
    await db.from('users').delete();
    await db.from('account_admissions').delete();
    await createIdentity(email, { password, admitted: false });
    const unadmitted = await signIn(client, email, password);
    const pending = await setUp(client, unadmitted.cookie);
    pending.assertStatus(403);
    assert.equal((pending.body() as { code?: string }).code, 'ADMISSION_REQUIRED');
    assert.lengthOf(await db.from('companies'), 0);
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
    assert.lengthOf(await db.from('companies'), 1);
  });
});

import { planningMutationValidator } from '#validators/planning';
import { signUpValidator } from '#validators/auth_requests';
import { AccountUserService } from '#services/account_kit/account_user_service';
import { test } from '@japa/runner';
import app from '@adonisjs/core/services/app';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { E_ACCOUNT_KIT_REGISTRATION_EMAIL_ALREADY_REGISTERED } from '@kevinjohn/adonisjs-account-kit/errors';
import limiter from '@adonisjs/limiter/services/main';
import env from '#start/env';
import { resetState } from '#tests/helpers/state_fixture';
import { createIdentity, clearIdentities, signIn } from '#tests/helpers/identities';
import {
  asLoggedInDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import User from '#models/user';

test.group('ordinary authentication request contracts', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await clearIdentities();
    await limiter.clear();
  });

  test('typed mutations retain imported colon identifiers while new rows remain UUID-only', async ({
    assert,
  }) => {
    const meta = {
      mutationId: crypto.randomUUID(),
      baseRevision: 0,
      params: { companyId: 'a-studio' },
    };
    const existing = await planningMutationValidator.validate({
      ...meta,
      intent: { operation: 'allocation.delete', id: 'legacy:allocation' },
    });
    assert.equal(existing.intent.operation, 'allocation.delete');
    const allocation = {
      id: crypto.randomUUID(),
      resourceId: 'legacy:resource',
      activityId: 'legacy:activity',
      startDate: '2026-10-26',
      endDate: '2026-10-26',
      hoursPerDay: 7.5,
      status: 'confirmed',
    };
    const created = await planningMutationValidator.validate({
      ...meta,
      intent: { operation: 'allocation.create', allocation },
    });
    assert.equal(created.intent.operation, 'allocation.create');
    await assert.rejects(() =>
      planningMutationValidator.validate({
        ...meta,
        intent: { operation: 'allocation.create', allocation: { ...allocation, id: 'legacy:new' } },
      })
    );
  });

  test('registration accepts 100 Unicode code points and refuses 101 at both boundaries', async ({
    assert,
  }) => {
    const input = {
      email: 'clark@wayne.example',
      password: 'krypton-password-2026',
      name: '𐐀'.repeat(100),
      headers: {},
    };
    const validated = await signUpValidator.validate(input);
    assert.equal(validated.name, input.name);
    const accountUsers = await app.container.make(AccountUserService);
    assert.equal(accountUsers.requireRegistrationDisplayName(input), input.name);
    await assert.rejects(() => signUpValidator.validate({ ...input, name: '𐐀'.repeat(101) }));
    assert.throws(() => accountUsers.requireRegistrationDisplayName({ name: '𐐀'.repeat(101) }));
  });

  test('sign-in refuses a malformed body with the framework 422 before authentication', async ({
    client,
    assert,
  }) => {
    for (const body of [
      [],
      { extra: true },
      { email: 'clark@wayne.example', password: '', extra: true },
      { email: 'invalid', password: '' },
      { email: 'clark@wayne.example', password: null },
      { password: 'secret' },
      { email: 'clark@wayne.example', password: 123 },
    ] as const) {
      const response = await client
        .post<string>('/api/v1/auth/sign-in')
        .header('sec-fetch-site', 'same-origin')
        .json(body)
        .send();
      response.assertStatus(422);
      assert.isNotEmpty((response.body() as { errors?: unknown[] }).errors);
    }
  });

  test('a string password reaches authentication without a sign-up length rule', async ({
    client,
    assert,
  }) => {
    const response = await client
      .visit('api.session.store')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: 'clark@wayne.example', password: '' })
      .send();
    response.assertStatus(401);
    assert.deepEqual(response.body(), { error: 'Invalid email or password.' });
  });

  test('sign-in normalizes email before authentication', async ({ client, assert }) => {
    const password = 'krypton-password-2026';
    const userId = await createIdentity('clark.kent@wayne.example', {
      name: 'Clark Kent',
      password,
    });
    const session = await signIn(client, '  Clark.Kent@Wayne.example  ', password);
    assert.equal(session.userId, userId);
  });

  test('admission query validates finite status and scalar cursor but ignores unrelated fields', async ({
    client,
    assert,
  }) => {
    const userId = await createIdentity('bruce.wayne@wayne.example', { name: 'Bruce Wayne' });
    await createFixtureCompanyForOwner(userId, 'Wayne Enterprises', 'a-studio');
    const owner = await User.findOrFail(userId);
    for (const query of [
      {},
      { status: 'pending' },
      { status: 'approved' },
      { status: 'rejected' },
      { status: 'revoked' },
      { extra: 'ignored' },
    ]) {
      const response = await asLoggedInDataOwner(
        client.visit('api.admission_requests.index').qs(query as never),
        owner
      ).send();
      assert.equal(response.status(), 200, JSON.stringify(query));
    }
    const emptyCursor = await asLoggedInDataOwner(
      client.visit('api.admission_requests.index').qs({ cursor: '' }),
      owner
    ).send();
    // The HTTP scalar shape is valid; the Kit refuses an empty opaque cursor.
    emptyCursor.assertStatus(422);
    for (const query of [
      'status=unknown',
      'status=',
      'status[]=pending',
      'cursor[]=x',
      `cursor=${'x'.repeat(513)}`,
    ]) {
      const response = await asLoggedInDataOwner(
        // A raw query string, so the malformed shapes reach the server as written.
        client.visit('api.admission_requests.index').unsafeQs(query),
        owner
      ).send();
      response.assertStatus(422);
      assert.isNotEmpty((response.body() as { errors?: unknown[] }).errors);
    }
  });

  test('sign-up keeps Unicode code-point passwords and trimmed names before the password rules', async ({
    client,
    assert,
  }) => {
    for (const password of ['a'.repeat(15), '😀'.repeat(15), '😀'.repeat(128)]) {
      const response = await client
        .visit('api.new_account.store')
        .header('sec-fetch-site', 'same-origin')
        .json({
          email: '  Clark.Kent@Wayne.example  ',
          password,
          name: '  Clark Kent  ',
        })
        .send();
      response.assertStatus(403);
      assert.deepEqual(response.body(), { error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' });
    }
  });

  test('open sign-up keeps the product 409 response for an existing email', async ({
    client,
    assert,
    cleanup,
  }) => {
    const userId = await createIdentity('bruce.wayne@wayne.example', { name: 'Bruce Wayne' });
    await createFixtureCompanyForOwner(userId, 'Wayne Enterprises', 'a-studio');
    const previousSignUp = env.get('CAPACITYLENS_ALLOW_OPEN_SIGN_UP');
    const originalRegister = accountKit.registration.register;
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGN_UP', true);
    accountKit.registration.register = async () => {
      throw new E_ACCOUNT_KIT_REGISTRATION_EMAIL_ALREADY_REGISTERED();
    };
    cleanup(() => {
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGN_UP', previousSignUp);
      accountKit.registration.register = originalRegister;
    });

    const response = await client
      .visit('api.new_account.store')
      .header('sec-fetch-site', 'same-origin')
      .json({
        email: 'clark.kent@wayne.example',
        password: 'account-password-2026',
        name: 'Clark Kent',
      })
      .send();

    response.assertStatus(409);
    assert.deepEqual(response.body(), {
      error: 'An account already uses this email. Sign in or reset your password.',
      code: 'EMAIL_IN_USE',
    });
  });

  test('sign-up refuses unknown fields and invalid details with the framework 422', async ({
    client,
    assert,
  }) => {
    for (const body of [
      { email: 'clark@wayne.example', password: 'a'.repeat(15), name: 'Clark Kent', extra: 1 },
      [],
      { email: 'clark@wayne.example', password: 'a'.repeat(15) },
      { email: 'invalid', password: 'a'.repeat(15), name: 'Clark Kent' },
      { email: 'clark@wayne.example', password: '😀'.repeat(14), name: 'Clark Kent' },
      { email: 'clark@wayne.example', password: '😀'.repeat(129), name: 'Clark Kent' },
      { email: 'clark@wayne.example', password: 'a'.repeat(15), name: '  ' },
    ] as const) {
      const response = await client
        .post<string>('/api/v1/auth/sign-up')
        .header('sec-fetch-site', 'same-origin')
        .json(body)
        .send();
      response.assertStatus(422);
      assert.isNotEmpty((response.body() as { errors?: unknown[] }).errors);
    }
  });
});

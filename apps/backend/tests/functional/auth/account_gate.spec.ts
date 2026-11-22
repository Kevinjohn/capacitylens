import { test } from '@japa/runner';
import router from '@adonisjs/core/services/router';
import type { ParsedNamedMiddleware } from '@adonisjs/core/types/http';
import db from '@adonisjs/lucid/services/db';
import { resetState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '../../helpers/fresh_database.js';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import { clearIdentities, createIdentity, signIn } from '../../helpers/identities.js';

const companyId = 'a-studio';
const owner = 'bruce.wayne@wayne.example';
const waiting = 'selina.kyle@wayne.example';

test.group('account gate', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await clearIdentities();
    const ownerId = await createIdentity(owner, { name: 'Bruce Wayne' });
    await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', companyId);
  });

  test('every route carries its reviewed account gate', ({ assert }) => {
    const routes = Object.values(router.toJSON()).flat();
    const access = Object.fromEntries(
      routes.map((route) => {
        const gate = [...route.middleware.all()].find(
          (entry): entry is ParsedNamedMiddleware =>
            typeof entry === 'object' && 'name' in entry && entry.name === 'accountGate'
        );
        return [`${route.methods.join(',')} ${route.pattern}`, gate ? gate.args.access : 'public'];
      })
    );
    assert.deepEqual(access, {
      'GET,HEAD /*': 'public',
      'POST /api/auth/change-password': 'public',
      'POST /api/auth/delete-account': 'public',
      'POST /api/auth/inspect-reset': 'public',
      'GET,HEAD /api/auth/me': 'public',
      'POST /api/auth/password-confirmation': 'public',
      'POST /api/auth/request-reset': 'public',
      'POST /api/auth/reset-password': 'public',
      'POST /api/auth/sign-in': 'public',
      'POST /api/auth/sign-out': 'public',
      'POST /api/auth/sign-up': 'public',
      'POST /api/auth/verification/complete': 'public',
      'POST /api/auth/verification/inspect': 'public',
      'POST /api/auth/verification/send': 'public',
      'GET,HEAD /api/health': 'public',
      'GET,HEAD /api/invites/:token/preview': 'public',
      'POST /api/invites/:token/signup': 'public',
      'GET,HEAD /api/masquerade': 'public',
      'GET,HEAD /health/live': 'public',
      'GET,HEAD /health/ready': 'public',
      'GET,HEAD /api/*': 'limited',
      'GET,HEAD /api/admission': 'limited',
      'POST /api/admission/:userId/approve': 'limited',
      'POST /api/admission/:userId/reject': 'limited',
      'POST /api/admission/:userId/revoke': 'limited',
      'POST /api/admission/request': 'limited',
      'GET,HEAD /api/admission/requests': 'limited',
      'POST /api/companies/:companyId/masquerade': 'limited',
      'DELETE /api/masquerade': 'limited',
      'POST /api/admission/complete': 'admitted',
      'GET,HEAD /api/companies': 'admitted',
      'POST /api/companies/:companyId/anonymise': 'admitted',
      'POST /api/companies/:companyId/example-data': 'admitted',
      'GET,HEAD /api/companies/:companyId/export': 'admitted',
      'GET,HEAD /api/companies/:companyId/getting-started': 'admitted',
      'PUT /api/companies/:companyId/getting-started': 'admitted',
      'GET,HEAD /api/companies/:companyId/invites': 'admitted',
      'DELETE /api/companies/:companyId/invites/:id': 'admitted',
      'POST /api/companies/:companyId/invites/:id/resend': 'admitted',
      'PUT /api/companies/:companyId/member-sign-in-tracking': 'admitted',
      'GET,HEAD /api/companies/:companyId/members': 'admitted',
      'PATCH /api/companies/:companyId/members/:userId': 'admitted',
      'DELETE /api/companies/:companyId/members/:userId/resource-link': 'admitted',
      'PUT /api/companies/:companyId/members/:userId/resource-link': 'admitted',
      'PATCH /api/companies/:companyId/members/:userId/status': 'admitted',
      'POST /api/companies/:companyId/ownership-transfer': 'admitted',
      'GET,HEAD /api/companies/:companyId/planning': 'admitted',
      'GET,HEAD /api/companies/:companyId/planning/archive': 'admitted',
      'POST /api/companies/:companyId/planning/mutations': 'admitted',
      'POST /api/companies/:companyId/planning/redo': 'admitted',
      'POST /api/companies/:companyId/planning/undo': 'admitted',
      'POST /api/companies/:companyId/resources/:id/anonymise': 'admitted',
      'GET,HEAD /api/diagnostics': 'admitted',
      'POST /api/installation/company': 'admitted',
      'POST /api/invites': 'admitted',
      'GET,HEAD /api/state': 'admitted',
      'POST /api/transfer/apply': 'admitted',
      'POST /api/transfer/preview': 'admitted',
    });
  });

  test('a request with no session is refused on admitted and limited routes', async ({
    client,
    assert,
  }) => {
    for (const path of [
      `/api/companies/${companyId}/planning`,
      '/api/companies',
      '/api/admission',
    ]) {
      const refused = await client.get(path).send();
      refused.assertStatus(401);
      assert.deepEqual(refused.body(), { error: 'Sign-in required.', code: 'SIGN_IN_REQUIRED' });
    }
    const unmatched = await client.get('/api/no-such-route').send();
    unmatched.assertStatus(401);
    assert.deepEqual(unmatched.body(), { error: 'Sign-in required.', code: 'SIGN_IN_REQUIRED' });
  });

  test('a signed-in person without admission is refused product routes before the handler and reaches the limited ones', async ({
    client,
    assert,
  }) => {
    await createIdentity(waiting, { name: 'Selina Kyle', admitted: false });
    const { cookie, cookieHeader } = await signIn(client, waiting);
    const get = (path: string) => client.get(path).header('cookie', cookieHeader).send();

    // Planning routes word the refusal their own way; the gate keeps each route's body.
    const planningRefusal = 'Company access needs admission.';
    const productRefusal = 'Your access to this company is waiting on admission.';
    for (const [path, error] of [
      [`/api/companies/${companyId}/planning`, planningRefusal],
      ['/api/companies', productRefusal],
      ['/api/state', productRefusal],
    ] as const) {
      const refused = await get(path);
      refused.assertStatus(403);
      const body = refused.body() as { code?: string; error?: string; decision?: unknown };
      assert.equal(body.code, 'ADMISSION_REQUIRED');
      assert.equal(body.error, error);
      assert.isObject(body.decision);
    }
    // The body is invalid; the gate answers before the handler reads it.
    const write = await asDataOwner(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({ unknown: true } as never)
      .send();
    write.assertStatus(403);
    assert.equal((write.body() as { code?: string }).code, 'ADMISSION_REQUIRED');
    assert.equal((write.body() as { error?: string }).error, planningRefusal);

    for (const [path, status] of [
      ['/api/admission', 200],
      ['/api/auth/me', 200],
      ['/api/no-such-route', 404],
    ] as const) {
      const reached = await get(path);
      reached.assertStatus(status);
    }
    const requested = await asDataOwner(
      client.visit('api.admission_requests.store'),
      cookie
    ).send();
    requested.assertStatus(200);
    // The remaining limited routes pass the gate; their handlers then refuse a person with no
    // authority, in their own words.
    const ownerRow = await db.from('users').where('email', owner).firstOrFail();
    const ownerId = String(ownerRow.id);
    const listed = await get('/api/admission/requests');
    listed.assertStatus(403);
    const limited = [listed];
    for (const name of [
      'api.admission_approvals.store',
      'api.admission_rejections.store',
      'api.admission_revocations.store',
    ] as const) {
      limited.push(await asDataOwner(client.visit(name, { userId: ownerId }), cookie).send());
    }
    limited.push(
      await asDataOwner(client.visit('api.masquerade.store', { companyId }), cookie)
        .json({ userId: ownerId } as never)
        .send(),
      await asDataOwner(client.visit('api.masquerade.destroy'), cookie).send()
    );
    for (const response of limited) {
      assert.notEqual(response.status(), 401);
      assert.notEqual((response.body() as { code?: string }).code, 'ADMISSION_REQUIRED');
    }
  });

  test('a session that lost its registry handle is refused', async ({ client, assert }) => {
    const { cookieHeader } = await signIn(client, owner);
    const allowed = await client.visit('api.companies.index').header('cookie', cookieHeader).send();
    allowed.assertStatus(200);
    const session = await db.from('adonis_sessions').firstOrFail();
    const data = String(session.data);
    assert.include(data, 'accountKitSession');
    await db
      .from('adonis_sessions')
      .where('id', session.id)
      .update({ data: data.replace('accountKitSession', 'retiredSessionHandle') });
    for (const path of ['/api/companies', '/api/admission']) {
      const refused = await client.get(path).header('cookie', cookieHeader).send();
      refused.assertStatus(401);
      assert.deepEqual(refused.body(), { error: 'Sign-in required.', code: 'SIGN_IN_REQUIRED' });
    }
  });
});

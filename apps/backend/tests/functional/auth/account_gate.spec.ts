import { test } from '@japa/runner';
import router from '@adonisjs/core/services/router';
import db from '@adonisjs/lucid/services/db';
import { classifiedRouteAccess, routeAccess } from '#services/auth/route_access';
import { resetState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '../../helpers/fresh_database.js';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import { clearIdentities, createIdentity, signIn } from '../../helpers/identities.js';

const accountId = 'a-studio';
const owner = 'bruce.wayne@wayne.example';
const waiting = 'selina.kyle@wayne.example';

test.group('account gate', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await clearIdentities();
    const ownerId = await createIdentity(owner, { name: 'Bruce Wayne' });
    await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', accountId);
  });

  test('every route is classified by name and only the non-API routes have none', ({ assert }) => {
    const routes = Object.values(router.toJSON()).flat();
    assert.isAbove(routes.length, 90);
    assert.deepEqual(
      routes.filter((route) => route.name === undefined).map((route) => route.pattern),
      ['/health/live', '/health/ready', '/*']
    );
    assert.deepEqual(
      routes.filter((route) => route.name && classifiedRouteAccess(route.name) === undefined),
      []
    );
  });

  test('a route name in no set is unclassified and gets the strictest check', ({ assert }) => {
    assert.isUndefined(classifiedRouteAccess('api.lexcorp.secrets'));
    assert.equal(routeAccess('api.lexcorp.secrets'), 'admitted');
    assert.equal(routeAccess(undefined), 'public');
  });

  test('a request with no session is refused on admitted and limited routes', async ({
    client,
    assert,
  }) => {
    for (const path of [`/api/accounts/${accountId}/planning`, '/api/accounts', '/api/admission']) {
      const refused = await client.get(path).send();
      refused.assertStatus(401);
      assert.deepEqual(refused.body(), { error: 'Sign-in required.' });
    }
    const unmatched = await client.get('/api/no-such-route').send();
    unmatched.assertStatus(401);
    assert.deepEqual(unmatched.body(), { error: 'Sign-in required.' });
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
      [`/api/accounts/${accountId}/planning`, planningRefusal],
      ['/api/accounts', productRefusal],
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
    const write = await asDataOwner(client.post(`/api/accounts/${accountId}/clients`), cookie)
      .json({ unknown: true })
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
    const requested = await asDataOwner(client.post('/api/admission/request'), cookie).send();
    requested.assertStatus(200);
    // The remaining limited routes pass the gate; their handlers then refuse a person with no
    // authority, in their own words.
    const ownerRow = await db.from('users').where('email', owner).firstOrFail();
    const ownerId = String(ownerRow.id);
    const listed = await get('/api/admission/requests');
    listed.assertStatus(403);
    const limited = [listed];
    for (const action of ['approve', 'reject', 'revoke']) {
      limited.push(
        await asDataOwner(client.post(`/api/admission/${ownerId}/${action}`), cookie).send()
      );
    }
    limited.push(
      await asDataOwner(client.post(`/api/accounts/${accountId}/masquerade`), cookie)
        .json({ userId: ownerId })
        .send(),
      await asDataOwner(client.delete('/api/masquerade'), cookie).send()
    );
    for (const response of limited) {
      assert.notEqual(response.status(), 401);
      assert.notEqual((response.body() as { code?: string }).code, 'ADMISSION_REQUIRED');
    }
  });

  test('a session that lost its registry handle is refused', async ({ client, assert }) => {
    const { cookieHeader } = await signIn(client, owner);
    const allowed = await client.get('/api/accounts').header('cookie', cookieHeader).send();
    allowed.assertStatus(200);
    const session = await db.from('adonis_sessions').firstOrFail();
    const data = String(session.data);
    assert.include(data, 'accountKitSession');
    await db
      .from('adonis_sessions')
      .where('id', session.id)
      .update({ data: data.replace('accountKitSession', 'retiredSessionHandle') });
    for (const path of ['/api/accounts', '/api/admission']) {
      const refused = await client.get(path).header('cookie', cookieHeader).send();
      refused.assertStatus(401);
      assert.deepEqual(refused.body(), { error: 'Sign-in required.' });
    }
  });
});

import { test } from '@japa/runner';
import { readFile } from 'node:fs/promises';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { replaceWithSeed } from '#tests/helpers/state_fixture';
import { APP_DATA_KEYS, type AppData } from '@capacitylens/shared/types/entities';
import { fillNullableFields } from '@capacitylens/shared/types/nullableFields';
import { resetAuthenticatedClient } from '#tests/helpers/authenticated_data_fixture';
import db from '@adonisjs/lucid/services/db';

const fixture = JSON.parse(
  await readFile(new URL('../../fixtures-main-responses.json', import.meta.url), 'utf8')
) as {
  responses: Array<{
    method: 'GET' | 'POST';
    path: string;
    status: number;
    body: unknown;
    headers: Record<string, string>;
  }>;
};

test.group('read path', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(() => replaceWithSeed());
  for (const expected of fixture.responses.filter(
    (entry) => !['/api/state', '/api/auth/me'].includes(entry.path)
  )) {
    test(`${expected.method} ${expected.path} matches the main response`, async ({
      client,
      assert,
    }) => {
      if (
        expected.path.startsWith('/api/state?') ||
        ['/api/companies', '/api/diagnostics'].includes(expected.path)
      )
        client = await resetAuthenticatedClient(client, true);
      const response =
        expected.method === 'POST'
          ? await client.post(expected.path).json({ seed: true })
          : await client.get(expected.path);
      assert.equal(response.status(), expected.status);
      const lastMigration =
        expected.path === '/api/diagnostics'
          ? await db.from('adonis_schema').select('name').orderBy('id', 'desc').first()
          : null;
      if (expected.path === '/api/diagnostics') assert.isString(lastMigration?.name);
      const expectedBody =
        expected.path === '/api/diagnostics'
          ? {
              server: {
                connectivity: 'ok',
                database: { status: 'ok' },
                schema: { migration: lastMigration?.name ?? null },
                backup: { newestSnapshotAt: null },
              },
            }
          : expected.path.startsWith('/api/state')
            ? (() => {
                const body = structuredClone(expected.body) as AppData;
                for (const key of APP_DATA_KEYS)
                  for (const row of body[key]) fillNullableFields(key, row);
                // The recorded fixture has no private rows, so each display name is the name.
                for (const row of [...body.clients, ...body.projects]) row.displayName = row.name;
                return body;
              })()
            : expected.body;
      // Main recorded unwrapped bodies; a success now answers inside `data`, health excepted.
      const wrapped = expected.status < 300 && expected.path !== '/api/health';
      assert.deepEqual(response.body(), wrapped ? { data: expectedBody } : expectedBody);
      for (const header of [
        'content-security-policy',
        'cross-origin-opener-policy',
        'cross-origin-resource-policy',
        'referrer-policy',
        'x-content-type-options',
        'x-frame-options',
      ])
        if (expected.headers[header] !== undefined)
          assert.equal(response.header(header), expected.headers[header]);
    });
  }

  test('refuses anonymous state, then reports a real signed-in identity', async ({
    client,
    assert,
  }) => {
    const state = await client.visit('api.company_state.show');
    state.assertStatus(401);
    client = await resetAuthenticatedClient(client, true);
    const identity = await client.visit('api.session.show');
    identity.assertStatus(200);
    assert.equal(identity.body().data.user.email, 'bruce.wayne@wayne.example');
  });

  test('exposes liveness and readiness', async ({ client, assert }) => {
    const live = await client.get('/health/live');
    const ready = await client.get('/health/ready');
    assert.deepEqual(live.body(), { ok: true });
    assert.isTrue(ready.body().isHealthy);
    assert.equal(ready.body().status, 'ok');
    assert.lengthOf(ready.body().checks, 1);
    assert.equal(ready.body().checks[0].name, 'Database health check (sqlite)');
  });
});

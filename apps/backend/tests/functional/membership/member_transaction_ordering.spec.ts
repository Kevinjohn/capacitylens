import { test } from '@japa/runner';
import type { ApiClient } from '@japa/api-client';
import { randomUUID } from 'node:crypto';
import db from '@adonisjs/lucid/services/db';
import access from '#config/access_control';
import { masqueradeService } from '#services/auth/masquerade';
import { resetState } from '#services/state_repository';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { clearIdentities, createIdentity, expectStatus, signIn } from '../../helpers/identities.js';
import { insertMembership, membership } from '../../helpers/memberships.js';
import { requestBarrier } from '../../helpers/request_barrier.js';

const accountId = 'a-studio';
const memberPath = (userId: string) => `/api/accounts/${accountId}/members/${userId}`;

/** An Owner, an Admin and an Editor of one company; the Owner and the Admin are signed in. */
async function team(client: ApiClient) {
  const ownerId = await createIdentity('bruce.wayne@wayne.example', { name: 'Bruce Wayne' });
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', accountId);
  const adminId = await createIdentity('diana.prince@wayne.example', { name: 'Diana Prince' });
  const editorId = await createIdentity('clark.kent@wayne.example', { name: 'Clark Kent' });
  await insertMembership(accountId, adminId, 'admin');
  await insertMembership(accountId, editorId, 'editor');
  const owner = await signIn(client, 'bruce.wayne@wayne.example');
  const admin = await signIn(client, 'diana.prince@wayne.example');
  return { adminId, editorId, ownerCookie: owner.cookie, adminCookie: admin.cookie };
}

function commandHeaders() {
  const id = randomUUID();
  return { 'x-account-command-id': `member-command-${id}`, 'idempotency-key': `member-key-${id}` };
}

function setRole(
  client: ApiClient,
  cookie: string,
  userId: string,
  role: string,
  headers = commandHeaders()
) {
  return asDataOwner(client.patch(memberPath(userId)), cookie)
    .headers(headers)
    .json({ role })
    .send();
}

/** Every company row a role command can change. */
async function snapshot() {
  return {
    memberships: await db.from('company_memberships').where('scope_id', accountId).orderBy('id'),
    revision: await db.from('company_planning_revisions').where('account_id', accountId).first(),
    audits: await db.from('audit_entries').where('account_id', accountId).orderBy('id'),
    receipts: await db.from('command_results').where('account_id', accountId).orderBy('id'),
  };
}

/** Pauses the role request for `userId` after request admission, before its transaction. */
async function pauseRoleRequest(userId: string) {
  const service = await masqueradeService();
  const original = service.resolve.bind(service);
  const barrier = requestBarrier();
  service.resolve = async (request) => {
    const resolved = await original(request);
    if (request.request.url().endsWith(memberPath(userId))) await barrier.pause();
    return resolved;
  };
  return {
    barrier,
    restore: () => {
      service.resolve = original;
    },
  };
}

test.group('member command transaction ordering', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await clearIdentities();
  });

  test('P04: a sign-out after request admission refuses the role command', async ({
    client,
    assert,
  }) => {
    const { editorId, ownerCookie } = await team(client);
    const before = await snapshot();
    const { barrier, restore } = await pauseRoleRequest(editorId);
    const pending = setRole(client, ownerCookie, editorId, 'viewer');
    try {
      await barrier.entered();
      const signedOut = await asDataOwner(client.post('/api/auth/sign-out'), ownerCookie).send();
      signedOut.assertStatus(200);
      barrier.release();
      await expectStatus(pending, 401);
      assert.deepEqual(await snapshot(), before);
    } finally {
      barrier.release();
      restore();
      await pending;
    }
  });

  test('P05a: an Admin demoted while the command waits is refused', async ({ client, assert }) => {
    const { adminId, editorId, ownerCookie, adminCookie } = await team(client);
    const { barrier, restore } = await pauseRoleRequest(editorId);
    const pending = setRole(client, adminCookie, editorId, 'viewer');
    try {
      await barrier.entered();
      await expectStatus(setRole(client, ownerCookie, adminId, 'viewer'), 200);
      const demoted = await snapshot();
      barrier.release();
      await expectStatus(pending, 403);
      assert.deepEqual(await snapshot(), demoted);
    } finally {
      barrier.release();
      restore();
      await pending;
    }
  });

  test('P05b: a demoted Admin cannot replay a completed command receipt', async ({
    client,
    assert,
  }) => {
    const { adminId, editorId, ownerCookie, adminCookie } = await team(client);
    const headers = commandHeaders();
    const completed = await setRole(client, adminCookie, editorId, 'viewer', headers);
    completed.assertStatus(200);
    await expectStatus(setRole(client, ownerCookie, adminId, 'viewer'), 200);
    const demoted = await snapshot();
    const replay = await setRole(client, adminCookie, editorId, 'viewer', headers);
    replay.assertStatus(403);
    assert.notProperty(replay.body(), 'userId');
    assert.deepEqual(await snapshot(), demoted);
    await expectStatus(asDataOwner(client.get('/api/auth/me'), adminCookie).send(), 200);
  });

  test('P08: a package call without the request transaction meets the shared nesting guard', async ({
    client,
    assert,
  }) => {
    const { editorId, ownerCookie } = await team(client);
    const before = await snapshot();
    const original = access.memberships.changeRole.bind(access.memberships);
    const knex = db.connection().getWriteClient();
    // SQL text only; bindings are never recorded.
    const statements: string[] = [];
    const observe = (query: { sql: string }) => statements.push(query.sql);
    let mark = -1;
    let captured: unknown;
    access.memberships.changeRole = async (input) => {
      if (mark < 0 && input.userId === editorId) {
        mark = statements.length;
        try {
          return await original({ ...input, trx: undefined });
        } catch (error) {
          captured = error;
          throw error;
        }
      }
      return original(input);
    };
    knex.on('query', observe);
    try {
      const failed = await setRole(client, ownerCookie, editorId, 'viewer');
      failed.assertStatus(500);
      assert.deepEqual(failed.body(), { error: 'Internal server error.' });
    } finally {
      knex.off('query', observe);
      access.memberships.changeRole = original;
    }
    assert.equal(
      captured instanceof Error ? captured.message : undefined,
      'Account kit transactions cannot be nested; use the trx you were given'
    );
    const isBegin = (sql: string) => /^\s*BEGIN\b/i.test(sql);
    const operationBegin = statements.slice(0, mark).findLastIndex(isBegin);
    assert.isAtLeast(operationBegin, 0, 'the role operation opened its transaction');
    assert.isTrue(
      statements
        .slice(operationBegin, mark)
        .some((sql) => sql.includes('account_transaction_lock')),
      'the role operation took the shared lock'
    );
    assert.isFalse(statements.slice(mark).some(isBegin), 'no second transaction began');
    assert.deepEqual(await snapshot(), before);
    await expectStatus(setRole(client, ownerCookie, editorId, 'viewer'), 200);
    assert.include(await membership(accountId, editorId), { role: 'viewer' });
  });
});

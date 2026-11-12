import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { readMemberDirectory } from '#services/membership/member_directory';
import { resetState } from '#tests/helpers/state_fixture';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import { createIdentity, signUpAndIn } from '../../helpers/identities.js';
import { freshDatabase } from '../../helpers/fresh_database.js';

const accountId = 'member-directory-storage';
const ownerEmail = 'bruce.wayne@wayne.example';
const memberEmail = 'clark.kent@wayne.example';
const password = 'batman-secret-2026';
const now = '2026-10-20T12:00:00.000Z';

interface CorruptionCase {
  label: string;
  invalidValue: string;
  guardMessage: string;
  column: 'role' | 'status';
  validValue: string;
}

const corruptions: CorruptionCase[] = [
  {
    label: 'membership role',
    invalidValue: 'invalid-role-sentinel',
    guardMessage: 'Membership has an invalid role.',
    column: 'role',
    validValue: 'editor',
  },
  {
    label: 'membership status',
    invalidValue: 'invalid-status-sentinel',
    guardMessage: 'Membership has an invalid status.',
    column: 'status',
    validValue: 'active',
  },
];

async function identityId(email: string) {
  const user = await db.from('users').where('email', email).select('id').first();
  if (!user) throw new Error(`Missing member-directory fixture identity: ${email}`);
  return String(user.id);
}

function readDirectoryMemberEntry(body: unknown, userId: string) {
  if (
    typeof body !== 'object' ||
    body === null ||
    Array.isArray(body) ||
    !('members' in body) ||
    !Array.isArray(body.members)
  ) {
    throw new Error('Member directory response is missing its member list.');
  }
  return body.members.find(
    (member: unknown): member is Record<string, unknown> =>
      typeof member === 'object' &&
      member !== null &&
      !Array.isArray(member) &&
      'userId' in member &&
      member.userId === userId
  );
}

async function createFixture(client: Parameters<typeof signUpAndIn>[0]) {
  const owner = await signUpAndIn(client, { email: ownerEmail, password, name: 'Bruce Wayne' });
  owner.assertStatus(200);
  const ownerCookie = owner.cookie('adonis-session')?.value;
  if (!ownerCookie) throw new Error('Owner sign-in did not create a session cookie.');
  const ownerId = await identityId(ownerEmail);
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', accountId);
  const memberId = await createIdentity(memberEmail, { name: 'Clark Kent', password });
  await db.transaction(async (trx) => {
    await trx.table('memberships').insert({
      scope_id: accountId,
      user_id: memberId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
  });
  const contextResponse = await asDataOwner(client.get('/api/masquerade'), ownerCookie).send();
  contextResponse.assertStatus(200);
  const contextBody: unknown = contextResponse.body();
  const contextToken =
    typeof contextBody === 'object' &&
    contextBody !== null &&
    !Array.isArray(contextBody) &&
    'contextToken' in contextBody
      ? contextBody.contextToken
      : undefined;
  if (typeof contextToken !== 'string' || !contextToken) {
    throw new Error('Owner masquerade context did not include a request token.');
  }
  return { ownerCookie, ownerId, memberId, contextToken };
}

interface OwnerGetInput {
  client: Parameters<typeof signUpAndIn>[0];
  path: string;
  ownerCookie: string;
  contextToken: string;
}

function ownerGet({ client, path, ownerCookie, contextToken }: OwnerGetInput) {
  return client
    .get(path)
    .setup((prepared) => {
      prepared.withCookie('adonis-session', ownerCookie);
    })
    .header('sec-fetch-site', 'same-origin')
    .header('X-Masquerade-Context', contextToken);
}

async function writeCorruption(corruption: CorruptionCase, memberId: string) {
  await db.transaction(async (trx) => {
    await trx
      .from('memberships')
      .where({ scope_id: accountId, user_id: memberId })
      .update({ [corruption.column]: corruption.invalidValue });
  });
}

async function readProductState() {
  return {
    memberships: await db.from('memberships').where('scope_id', accountId).orderBy('id'),
    settings: await db.from('company_settings').where('account_id', accountId).orderBy('key'),
    revision: await db
      .from('company_planning_revisions')
      .where('account_id', accountId)
      .orderBy('account_id'),
    audit: await db.from('audit_entries').where('account_id', accountId).orderBy('id'),
    receipts: await db.from('request_receipts').where('scope_id', accountId).orderBy('id'),
  };
}

test.group('member directory malformed storage', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await db.from('account_admissions').delete();
    await db.from('account_invitations').delete();
    await db.from('adonis_sessions').delete();
    await db.from('memberships').delete();
    await db.from('users').delete();
  });

  test('guards corrupted company rows at the service and authenticated HTTP boundary', async ({
    client,
    assert,
  }) => {
    const { ownerCookie, ownerId, memberId, contextToken } = await createFixture(client);
    const path = `/api/accounts/${accountId}/members`;
    const baseline = await ownerGet({ client, path, ownerCookie, contextToken }).send();
    baseline.assertStatus(200);
    assert.deepInclude(readDirectoryMemberEntry(baseline.body(), memberId), {
      userId: memberId,
      role: 'editor',
      status: 'active',
      manage: true,
    });

    for (const corruption of corruptions) {
      await writeCorruption(corruption, memberId);
      const beforeRead = await readProductState();
      await assert.rejects(
        () =>
          db.transaction((trx) =>
            readMemberDirectory(trx, accountId, { actorId: ownerId, role: 'owner' })
          ),
        Error,
        new RegExp('^' + corruption.guardMessage.replace('.', '\\.') + '$'),
        `${corruption.label} must reach its own service guard`
      );
      const failed = await ownerGet({ client, path, ownerCookie, contextToken }).send();
      failed.assertStatus(500);
      assert.deepEqual(failed.body(), { error: 'Internal server error.' });
      assert.notInclude(JSON.stringify(failed.body()), corruption.invalidValue);
      assert.notInclude(JSON.stringify(failed.body()), 'stack');
      assert.deepEqual(
        await readProductState(),
        beforeRead,
        `${corruption.label} read must not repair or write product state`
      );

      await db.transaction(async (trx) => {
        await trx
          .from('memberships')
          .where({ scope_id: accountId, user_id: memberId })
          .update({ [corruption.column]: corruption.validValue });
      });
      const restored = await ownerGet({ client, path, ownerCookie, contextToken }).send();
      restored.assertStatus(200);
      assert.deepInclude(readDirectoryMemberEntry(restored.body(), memberId), {
        userId: memberId,
        role: 'editor',
        status: 'active',
        manage: true,
      });
    }
  });

  test('ignores malformed rows from another company', async ({ client, assert }) => {
    const { ownerCookie, ownerId, contextToken } = await createFixture(client);
    const otherAccountId = 'member-directory-storage-other';
    await createFixtureCompanyForOwner(ownerId, 'Daily Planet', otherAccountId);
    const foreignMemberId = await createIdentity('lex.luthor@dailyplanet.example', {
      name: 'Lex Luthor',
    });
    await db.transaction(async (trx) => {
      await trx.table('memberships').insert({
        scope_id: otherAccountId,
        user_id: foreignMemberId,
        role: 'foreign-invalid-role-sentinel',
        status: 'foreign-invalid-status-sentinel',
        created_at: now,
        updated_at: now,
      });
    });

    const path = `/api/accounts/${accountId}/members`;
    const isolated = await ownerGet({ client, path, ownerCookie, contextToken }).send();
    isolated.assertStatus(200);
    assert.notInclude(JSON.stringify(isolated.body()), foreignMemberId);
    assert.notInclude(JSON.stringify(isolated.body()), 'foreign-invalid-role-sentinel');
    assert.notInclude(JSON.stringify(isolated.body()), 'foreign-invalid-status-sentinel');
  });
});

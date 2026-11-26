import { test } from '@japa/runner';
import app from '@adonisjs/core/services/app';
import db from '@adonisjs/lucid/services/db';
import { MemberDirectoryService } from '#services/membership/member_directory_service';
import { resetState } from '#tests/helpers/state_fixture';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture';
import { createIdentity, signUpAndIn } from '#tests/helpers/identities';
import { freshDatabase } from '#tests/helpers/fresh_database';

const companyId = 'member-directory-storage';
const ownerEmail = 'bruce.wayne@wayne.example';
const memberEmail = 'clark.kent@wayne.example';
const password = 'batman-secret-2026';
const now = '2026-10-20T12:00:00.000Z';

interface CorruptionCase {
  label: string;
  invalidValue: string;
  checkMessage: string;
  column: 'role' | 'status';
  validValue: string;
}

const corruptions: CorruptionCase[] = [
  {
    label: 'membership role',
    invalidValue: 'invalid-role-sentinel',
    checkMessage: 'Membership has an invalid role.',
    column: 'role',
    validValue: 'editor',
  },
  {
    label: 'membership status',
    invalidValue: 'invalid-status-sentinel',
    checkMessage: 'Membership has an invalid status.',
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
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', companyId);
  const memberId = await createIdentity(memberEmail, { name: 'Clark Kent', password });
  await db.transaction(async (trx) => {
    await trx.table('memberships').insert({
      scope_id: companyId,
      user_id: memberId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
  });
  const contextResponse = await asDataOwner(
    client.visit('api.masquerade.show'),
    ownerCookie
  ).send();
  contextResponse.assertStatus(200);
  const contextBody: unknown = contextResponse.body()!.data;
  const masqueradeToken =
    typeof contextBody === 'object' &&
    contextBody !== null &&
    !Array.isArray(contextBody) &&
    'masqueradeToken' in contextBody
      ? contextBody.masqueradeToken
      : undefined;
  if (typeof masqueradeToken !== 'string' || !masqueradeToken) {
    throw new Error('Owner masquerade context did not include a request token.');
  }
  return { ownerCookie, ownerId, memberId, masqueradeToken };
}

interface OwnerGetInput {
  client: Parameters<typeof signUpAndIn>[0];
  ownerCookie: string;
  masqueradeToken: string;
}

function ownerGet({ client, ownerCookie, masqueradeToken }: OwnerGetInput) {
  return client
    .visit('api.members.index', { companyId })
    .setup((prepared) => {
      prepared.withCookie('adonis-session', ownerCookie);
    })
    .header('sec-fetch-site', 'same-origin')
    .header('X-Masquerade-Context', masqueradeToken);
}

async function writeCorruption(corruption: CorruptionCase, memberId: string) {
  await db.transaction(async (trx) => {
    await trx
      .from('memberships')
      .where({ scope_id: companyId, user_id: memberId })
      .update({ [corruption.column]: corruption.invalidValue });
  });
}

async function readProductState() {
  return {
    memberships: await db.from('memberships').where('scope_id', companyId).orderBy('id'),
    settings: await db.from('company_settings').where('company_id', companyId).orderBy('key'),
    revision: await db
      .from('company_planning_revisions')
      .where('company_id', companyId)
      .orderBy('company_id'),
    audit: await db.from('audit_entries').where('company_id', companyId).orderBy('id'),
    receipts: await db.from('request_receipts').where('scope_id', companyId).orderBy('id'),
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

  test('rejects corrupted company rows at the service and authenticated HTTP boundary', async ({
    client,
    assert,
  }) => {
    const { ownerCookie, ownerId, memberId, masqueradeToken } = await createFixture(client);
    const baseline = await ownerGet({ client, ownerCookie, masqueradeToken }).send();
    baseline.assertStatus(200);
    assert.deepInclude(
      readDirectoryMemberEntry((baseline.body() as { data: unknown }).data, memberId),
      {
        userId: memberId,
        role: 'editor',
        status: 'active',
        manage: true,
      }
    );

    const memberDirectory = await app.container.make(MemberDirectoryService);
    for (const corruption of corruptions) {
      await writeCorruption(corruption, memberId);
      const beforeRead = await readProductState();
      await assert.rejects(
        () =>
          db.transaction((trx) =>
            memberDirectory.read(trx, companyId, { actorId: ownerId, role: 'owner' })
          ),
        Error,
        new RegExp('^' + corruption.checkMessage.replace('.', '\\.') + '$'),
        `${corruption.label} must reach its own service check`
      );
      const failed = await ownerGet({ client, ownerCookie, masqueradeToken }).send();
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
          .where({ scope_id: companyId, user_id: memberId })
          .update({ [corruption.column]: corruption.validValue });
      });
      const restored = await ownerGet({ client, ownerCookie, masqueradeToken }).send();
      restored.assertStatus(200);
      assert.deepInclude(
        readDirectoryMemberEntry((restored.body() as { data: unknown }).data, memberId),
        {
          userId: memberId,
          role: 'editor',
          status: 'active',
          manage: true,
        }
      );
    }
  });

  test('ignores malformed rows from another company', async ({ client, assert }) => {
    const { ownerCookie, ownerId, masqueradeToken } = await createFixture(client);
    const otherCompanyId = 'member-directory-storage-other';
    await createFixtureCompanyForOwner(ownerId, 'Daily Planet', otherCompanyId);
    const foreignMemberId = await createIdentity('lex.luthor@dailyplanet.example', {
      name: 'Lex Luthor',
    });
    await db.transaction(async (trx) => {
      await trx.table('memberships').insert({
        scope_id: otherCompanyId,
        user_id: foreignMemberId,
        role: 'foreign-invalid-role-sentinel',
        status: 'foreign-invalid-status-sentinel',
        created_at: now,
        updated_at: now,
      });
    });

    const isolated = await ownerGet({ client, ownerCookie, masqueradeToken }).send();
    isolated.assertStatus(200);
    assert.notInclude(JSON.stringify((isolated.body() as { data: unknown }).data), foreignMemberId);
    assert.notInclude(
      JSON.stringify((isolated.body() as { data: unknown }).data),
      'foreign-invalid-role-sentinel'
    );
    assert.notInclude(
      JSON.stringify((isolated.body() as { data: unknown }).data),
      'foreign-invalid-status-sentinel'
    );
  });
});

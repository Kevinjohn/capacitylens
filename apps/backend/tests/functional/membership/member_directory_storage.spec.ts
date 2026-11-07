import { test } from '@japa/runner';
import type { Assert } from '@japa/assert';
import db from '@adonisjs/lucid/services/db';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readMemberDirectory } from '#services/membership/member_directory';
import { resetState } from '#services/state_repository';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import { createIdentity, signUpAndIn } from '../../helpers/identities.js';
import { freshDatabase } from '../../helpers/fresh_database.js';

const accountId = 'member-directory-storage';
const ownerEmail = 'bruce.wayne@wayne.example';
const memberEmail = 'clark.kent@wayne.example';
const otherOwnerEmail = 'diana.prince@wayne.example';
const password = 'batman-secret-2026';
const now = '2026-10-20T12:00:00.000Z';

interface CorruptionCase {
  label: string;
  invalidValue: string;
  guardMessage: string;
  table: 'company_memberships' | 'account_access_restrictions';
  column: 'role' | 'status';
  restrictionOnly: boolean;
  validValue: string;
}

const corruptions: CorruptionCase[] = [
  {
    label: 'membership role',
    invalidValue: 'invalid-role-sentinel',
    guardMessage: 'Membership has an invalid role.',
    table: 'company_memberships',
    column: 'role',
    restrictionOnly: false,
    validValue: 'editor',
  },
  {
    label: 'membership status',
    invalidValue: 'invalid-status-sentinel',
    guardMessage: 'Membership has an invalid status.',
    table: 'company_memberships',
    column: 'status',
    restrictionOnly: false,
    validValue: 'active',
  },
  {
    label: 'restriction-only role',
    invalidValue: 'broken',
    guardMessage: 'Access restriction has an invalid role.',
    table: 'account_access_restrictions',
    column: 'role',
    restrictionOnly: true,
    validValue: 'viewer',
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
    await trx.table('company_memberships').insert({
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

async function evictIdleSqliteHandle(assert: Assert) {
  const connection = db.manager.get('sqlite')?.connection;
  if (!connection?.client || !connection.pool) {
    throw new Error(
      'The dedicated SQLite test connection is not available for fixture corruption.'
    );
  }
  const knexClient = connection.client;
  const pool = connection.pool;
  assert.equal(connection.config.pool?.max, 1);
  assert.equal(pool.numUsed(), 0, 'the only SQLite connection must be idle before file patching');
  const native = await knexClient.client.acquireConnection();
  try {
    native.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    await knexClient.client.releaseConnection(native);
  }
  assert.equal(pool.numFree(), 1, 'the only SQLite handle is idle in the logical pool');
  assert.equal(pool.numUsed(), 0);
  // The test needs the database file offline while keeping Account Kit's logical client intact.
  native.close();
}

async function writeCorruption(corruption: CorruptionCase, memberId: string, assert: Assert) {
  const restrictionPrincipalId = corruption.restrictionOnly
    ? await createIdentity(otherOwnerEmail, { name: 'Diana Prince' })
    : undefined;
  if (corruption.restrictionOnly) {
    if (!restrictionPrincipalId) throw new Error('Restriction fixture principal was not created.');
    await db.transaction(async (trx) => {
      await trx.table('account_access_restrictions').insert({
        id: 'member-directory-storage-restriction',
        account_id: accountId,
        principal_id: restrictionPrincipalId,
        verified_email: `corrupt-${otherOwnerEmail}`,
        role: corruption.validValue,
        created_at: now,
      });
    });
    await corruptRestrictionRoleOnDisk(
      assert,
      restrictionPrincipalId,
      `corrupt-${otherOwnerEmail}`
    );
    return;
  }
  await db.transaction(async (trx) => {
    await trx
      .from(corruption.table)
      .where({ scope_id: accountId, user_id: memberId })
      .update({ [corruption.column]: corruption.invalidValue });
  });
}

async function corruptRestrictionRoleOnDisk(assert: Assert, principalId: string, email: string) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Offline fixture corruption is restricted to the test environment.');
  }
  const databasePath = process.env.CAPACITYLENS_DB;
  if (!databasePath || databasePath === ':memory:') {
    throw new Error('Offline corruption requires the dedicated file-backed test database.');
  }
  const row = await db
    .from('account_access_restrictions')
    .where({ principal_id: principalId, verified_email: email })
    .select('role')
    .first();
  if (row?.role !== 'viewer')
    throw new Error('The restriction fixture must begin with a valid role.');
  const schema = await db.rawQuery(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'account_access_restrictions'"
  );
  if (!String(schema[0]?.sql).toLowerCase().includes('check')) {
    throw new Error('The restriction role CHECK constraint is missing from the fixture database.');
  }
  const pragma = await db.rawQuery('PRAGMA ignore_check_constraints');
  if (Number(pragma[0]?.ignore_check_constraints) !== 0) {
    throw new Error('SQLite CHECK constraints must remain enabled during fixture corruption.');
  }
  await assert.rejects(
    () =>
      db.transaction(async (trx) => {
        await trx
          .from('account_access_restrictions')
          .where({ principal_id: principalId, verified_email: email })
          .update({ role: 'broken' });
      }),
    Error,
    /CHECK constraint failed/i,
    'SQLite must reject an invalid restriction role while CHECK constraints are enabled'
  );

  await evictIdleSqliteHandle(assert);
  const path = resolve(databasePath);
  const contents = readFileSync(path);
  const validBytes = Buffer.from(`${email}viewer`);
  const matches: number[] = [];
  let offset = contents.indexOf(validBytes);
  while (offset !== -1) {
    matches.push(offset);
    offset = contents.indexOf(validBytes, offset + 1);
  }
  if (matches.length !== 1) {
    throw new Error(`Expected one exact restriction fixture byte sequence, got ${matches.length}.`);
  }
  contents.write('broken', matches[0] + validBytes.length - 'viewer'.length, 'ascii');
  writeFileSync(path, contents);

  const corrupted = await db
    .from('account_access_restrictions')
    .where({ principal_id: principalId, verified_email: email })
    .select('role')
    .first();
  if (corrupted?.role !== 'broken') throw new Error('Offline fixture corruption did not persist.');
  const restoredSchema = await db.rawQuery(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'account_access_restrictions'"
  );
  assert.deepEqual(
    restoredSchema,
    schema,
    'offline corruption must preserve the exact table schema'
  );
  const restoredPragma = await db.rawQuery('PRAGMA ignore_check_constraints');
  if (Number(restoredPragma[0]?.ignore_check_constraints) !== 0) {
    throw new Error('SQLite CHECK constraints were not active after fixture corruption.');
  }
  await assert.rejects(
    () =>
      db.transaction(async (trx) => {
        await trx
          .from('account_access_restrictions')
          .where({ principal_id: principalId, verified_email: email })
          .update({ role: 'broken' });
      }),
    Error,
    /CHECK constraint failed/i,
    'SQLite must continue rejecting invalid roles after offline fixture corruption'
  );
}

async function readProductState() {
  return {
    memberships: await db.from('company_memberships').where('scope_id', accountId).orderBy('id'),
    restrictions: await db
      .from('account_access_restrictions')
      .where('account_id', accountId)
      .orderBy('id'),
    settings: await db.from('company_settings').where('account_id', accountId).orderBy('key'),
    revision: await db
      .from('company_planning_revisions')
      .where('account_id', accountId)
      .orderBy('account_id'),
    audit: await db.from('audit_entries').where('account_id', accountId).orderBy('id'),
    receipts: await db.from('command_results').where('account_id', accountId).orderBy('id'),
  };
}

test.group('member directory malformed storage', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await db.from('account_admissions').delete();
    await db.from('account_invitations').delete();
    await db.from('adonis_sessions').delete();
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
      membershipPresent: true,
    });

    for (const corruption of corruptions) {
      await writeCorruption(corruption, memberId, assert);
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

      const restrictionPrincipalId = corruption.restrictionOnly
        ? await identityId(otherOwnerEmail)
        : undefined;
      await db.transaction(async (trx) => {
        if (corruption.restrictionOnly) {
          if (!restrictionPrincipalId) {
            throw new Error('Restriction fixture principal was not created.');
          }
          await trx
            .from('account_access_restrictions')
            .where({ account_id: accountId, principal_id: restrictionPrincipalId })
            .update({ role: corruption.validValue });
          return;
        }
        await trx
          .from(corruption.table)
          .where({ scope_id: accountId, user_id: memberId })
          .update({ [corruption.column]: corruption.validValue });
      });
      const restored = await ownerGet({ client, path, ownerCookie, contextToken }).send();
      restored.assertStatus(200);
      assert.deepInclude(readDirectoryMemberEntry(restored.body(), memberId), {
        userId: memberId,
        role: 'editor',
        status: 'active',
        membershipPresent: true,
      });
    }
  });

  test('ignores malformed rows from another company and skips overlapping restrictions', async ({
    client,
    assert,
  }) => {
    const { ownerCookie, ownerId, memberId, contextToken } = await createFixture(client);
    const otherAccountId = 'member-directory-storage-other';
    await createFixtureCompanyForOwner(ownerId, 'Daily Planet', otherAccountId);
    const foreignMemberId = await createIdentity('lex.luthor@dailyplanet.example', {
      name: 'Lex Luthor',
    });
    const foreignRestrictedId = await createIdentity('arthur.curry@dailyplanet.example', {
      name: 'Arthur Curry',
    });
    await db.transaction(async (trx) => {
      await trx.table('company_memberships').insert({
        scope_id: otherAccountId,
        user_id: foreignMemberId,
        role: 'foreign-invalid-role-sentinel',
        status: 'foreign-invalid-status-sentinel',
        created_at: now,
        updated_at: now,
      });
      await trx.table('account_access_restrictions').insert({
        id: 'member-directory-storage-foreign-restriction',
        account_id: otherAccountId,
        principal_id: foreignRestrictedId,
        verified_email: 'foreign-restriction-role@dailyplanet.example',
        role: 'viewer',
        created_at: now,
      });
    });
    await corruptRestrictionRoleOnDisk(
      assert,
      foreignRestrictedId,
      'foreign-restriction-role@dailyplanet.example'
    );

    const path = `/api/accounts/${accountId}/members`;
    const isolated = await ownerGet({ client, path, ownerCookie, contextToken }).send();
    isolated.assertStatus(200);
    assert.notInclude(JSON.stringify(isolated.body()), foreignMemberId);
    assert.notInclude(JSON.stringify(isolated.body()), 'foreign-invalid-role-sentinel');
    assert.notInclude(JSON.stringify(isolated.body()), 'foreign-invalid-status-sentinel');
    assert.notInclude(
      JSON.stringify(isolated.body()),
      'foreign-restriction-role@dailyplanet.example'
    );

    await db.transaction(async (trx) => {
      await trx.table('account_access_restrictions').insert({
        id: 'member-directory-storage-overlap',
        account_id: accountId,
        principal_id: memberId,
        verified_email: `overlap-${memberEmail}`,
        role: 'viewer',
        created_at: now,
      });
    });
    await corruptRestrictionRoleOnDisk(assert, memberId, `overlap-${memberEmail}`);

    const overlapping = await ownerGet({ client, path, ownerCookie, contextToken }).send();
    overlapping.assertStatus(200);
    assert.deepInclude(readDirectoryMemberEntry(overlapping.body(), memberId), {
      userId: memberId,
      role: 'editor',
      status: 'active',
      accessDisabled: true,
      membershipPresent: true,
    });
    assert.notInclude(JSON.stringify(overlapping.body()), 'broken');
  });
});

import { test } from '@japa/runner';
import type { ApiClient } from '@japa/api-client';
import { randomUUID } from 'node:crypto';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import access from '#config/access_control';
import { resetState } from '#services/state_repository';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import { createIdentity, expectStatus, signIn, signUpAndIn } from '../../helpers/identities.js';
import { insertMembership, membership } from '../../helpers/memberships.js';

const password = 'batman-secret-2026';

const signed = asDataOwner;

async function userId(email: string) {
  const user = await db.from('users').where('email', email).first();
  if (!user) throw new Error(`Missing test principal: ${email}`);
  return String(user.id);
}

const accountId = 'a-studio';

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
  return { ownerId, adminId, editorId, ownerCookie: owner.cookie, adminCookie: admin.cookie };
}

function commandHeaders() {
  const id = randomUUID();
  return { 'x-account-command-id': `member-command-${id}`, 'idempotency-key': `member-key-${id}` };
}

const memberUrl = (memberId: string) => `/api/accounts/${accountId}/members/${memberId}`;

function setRole(
  client: ApiClient,
  cookie: string,
  memberId: string,
  role: string,
  headers = commandHeaders()
) {
  return signed(client.patch(memberUrl(memberId)), cookie)
    .headers(headers)
    .json({ role })
    .send();
}

function setStatus(client: ApiClient, cookie: string, memberId: string, status: string) {
  return signed(client.patch(`${memberUrl(memberId)}/status`), cookie)
    .headers(commandHeaders())
    .json({ status })
    .send();
}

function restriction(memberId: string) {
  return db
    .from('account_access_restrictions')
    .where({ account_id: accountId, principal_id: memberId })
    .first();
}

async function restrict(memberId: string, role: string) {
  await db.table('account_access_restrictions').insert({
    id: randomUUID(),
    account_id: accountId,
    principal_id: memberId,
    verified_email: null,
    role,
    created_at: new Date().toISOString(),
  });
}

/** Every row a role command can change. */
async function snapshot(memberId: string) {
  return {
    membership: await membership(accountId, memberId),
    restriction: await restriction(memberId),
    revision: await db.from('company_planning_revisions').where('account_id', accountId).first(),
    audits: await db.from('audit_entries').where('account_id', accountId).orderBy('id'),
    receipts: await db.from('command_results').where('account_id', accountId).orderBy('id'),
  };
}

function roleAudits(memberId: string) {
  return db
    .from('audit_entries')
    .where({ account_id: accountId, action: 'member.role_changed', entity_id: memberId });
}

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

test.group('company member administration', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await db.from('account_admissions').delete();
    await db.from('account_invitations').delete();
    await db.from('adonis_sessions').delete();
    await db.from('users').delete();
  });

  test('role command replays its semantic result, binds payload and keeps recovery links', async ({
    client,
    assert,
  }) => {
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      password,
      name: 'Bruce Wayne',
    });
    owner.assertStatus(200);
    const ownerCookie = owner.cookie('adonis-session')!.value;
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    );
    const setupRevision = await db
      .from('company_planning_revisions')
      .where('account_id', 'a-studio')
      .first();
    assert.equal(Number(setupRevision?.revision), 1);
    const editor = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    });
    editor.assertStatus(200);
    const editorId = await userId('clark.kent@wayne.example');
    const now = new Date().toISOString();
    await db.table('company_memberships').insert({
      scope_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    // Enable Access restores the restriction's role, so the role change must carry it along.
    await restrict(editorId, 'editor');
    await db.table('password_reset_tokens').insert({
      tokenable_id: editorId,
      email: 'clark.kent@wayne.example',
      hash: 'a'.repeat(64),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      created_at: now,
    });
    const path = `/api/accounts/a-studio/members/${editorId}`;
    const identity = {
      'x-account-command-id': 'member-role-command-0001',
      'idempotency-key': 'member-role-idempotency-0001',
    };
    const requestRole = (role: string) =>
      signed(client.patch(path), ownerCookie).headers(identity).json({ role }).send();
    const changed = await requestRole('admin');
    changed.assertStatus(200);
    assert.deepEqual(changed.body(), { userId: editorId, role: 'admin' });
    const carried = await restriction(editorId);
    assert.equal(carried?.role, 'admin');
    const receipt = await db
      .from('command_results')
      .where('command_id', identity['x-account-command-id'])
      .first();
    assert.equal(receipt.account_id, 'a-studio');
    assert.equal(
      receipt.operation,
      `semantic:change-member-role:actor:${await userId('bruce.wayne@wayne.example')}`
    );
    assert.deepEqual(JSON.parse(receipt.result), changed.body());
    const changedRevision = await db
      .from('company_planning_revisions')
      .where('account_id', 'a-studio')
      .first();
    assert.equal(Number(changedRevision?.revision), 2);
    assert.isNotNull(
      await db.from('password_reset_tokens').where('tokenable_id', editorId).first(),
      'a role change never cancels identity recovery'
    );
    const replay = await requestRole('admin');
    replay.assertStatus(200);
    assert.deepEqual(replay.body(), changed.body());
    const mismatch = await requestRole('viewer');
    mismatch.assertStatus(409);
    assert.equal((mismatch.body() as { code: string }).code, 'IDEMPOTENCY_CONFLICT');
    const audits = await db
      .from('audit_entries')
      .where({ account_id: 'a-studio', action: 'member.role_changed', entity_id: editorId });
    assert.lengthOf(audits, 1);
    const unchanged = await signed(client.patch(path), ownerCookie)
      .headers({
        'x-account-command-id': 'member-role-command-noop-0001',
        'idempotency-key': 'member-role-idempotency-noop-0001',
      })
      .json({ role: 'admin' })
      .send();
    unchanged.assertStatus(200);
    const unchangedRevision = await db
      .from('company_planning_revisions')
      .where('account_id', 'a-studio')
      .first();
    assert.equal(Number(unchangedRevision?.revision), 2);
    const ownerId = await userId('bruce.wayne@wayne.example');
    const refused = await signed(
      client.patch(`/api/accounts/a-studio/members/${ownerId}`),
      ownerCookie
    )
      .json({ role: 'viewer' })
      .send();
    refused.assertStatus(403);
    assert.equal((refused.body() as { code: string }).code, 'FORBIDDEN');
  });

  test('invalid member inputs and unknown fields are rejected without side effects', async ({
    client,
    assert,
  }) => {
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      password,
      name: 'Bruce Wayne',
    });
    owner.assertStatus(200);
    const ownerCookie = owner.cookie('adonis-session')!.value;
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    );
    const editor = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    });
    editor.assertStatus(200);
    const editorId = await userId('clark.kent@wayne.example');
    const now = new Date().toISOString();
    await db.table('company_memberships').insert({
      scope_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    const memberPath = `/api/accounts/a-studio/members/${editorId}`;
    const requests = [
      {
        name: 'invalid role',
        send: () => signed(client.patch(memberPath), ownerCookie).json({ role: 'operator' }).send(),
        error: 'Invalid member role.',
      },
      {
        name: 'unknown role field',
        send: () =>
          signed(client.patch(memberPath), ownerCookie).json({ role: 'admin', extra: true }).send(),
        error: 'Invalid member role.',
      },
      {
        name: 'invalid status',
        send: () =>
          signed(client.patch(`${memberPath}/status`), ownerCookie)
            .json({ status: 'removed' })
            .send(),
        error: 'Invalid member status.',
      },
      {
        name: 'unknown status field',
        send: () =>
          signed(client.patch(`${memberPath}/status`), ownerCookie)
            .json({ status: 'disabled', extra: true })
            .send(),
        error: 'Invalid member status.',
      },
      {
        name: 'invalid tracking value',
        send: () =>
          signed(client.put('/api/accounts/a-studio/member-sign-in-tracking'), ownerCookie)
            .json({ enabled: 'true' })
            .send(),
        error: 'enabled must be a Boolean.',
      },
      {
        name: 'unknown tracking field',
        send: () =>
          signed(client.put('/api/accounts/a-studio/member-sign-in-tracking'), ownerCookie)
            .json({ enabled: true, extra: true })
            .send(),
        error: 'enabled must be a Boolean.',
      },
    ];

    const receipts = await db.from('command_results').where('account_id', 'a-studio').orderBy('id');
    for (const request of requests) {
      const response = await request.send();
      response.assertStatus(400);
      assert.deepEqual(response.body(), { error: request.error }, request.name);
    }

    const member = await db
      .from('company_memberships')
      .where({ scope_id: 'a-studio', user_id: editorId })
      .first();
    assert.include(member, { role: 'editor', status: 'active' });
    const revision = await db
      .from('company_planning_revisions')
      .where('account_id', 'a-studio')
      .first();
    assert.equal(Number(revision?.revision), 1);
    assert.isNull(
      await db
        .from('company_settings')
        .where({ account_id: 'a-studio', key: 'member-sign-in-tracking' })
        .first()
    );
    assert.lengthOf(await db.from('audit_entries').where('account_id', 'a-studio'), 0);
    assert.deepEqual(
      await db.from('command_results').where('account_id', 'a-studio').orderBy('id'),
      receipts
    );
  });

  test('an authorized Admin receives input refusal for direct Owner assignment, but cannot edit the Owner', async ({
    client,
    assert,
  }) => {
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      password,
      name: 'Bruce Wayne',
    });
    owner.assertStatus(200);
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    );
    const admin = await signUpAndIn(client, {
      email: 'diana.prince@wayne.example',
      password,
      name: 'Diana Prince',
    });
    admin.assertStatus(200);
    const editor = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    });
    editor.assertStatus(200);
    const ownerId = await userId('bruce.wayne@wayne.example');
    const adminId = await userId('diana.prince@wayne.example');
    const editorId = await userId('clark.kent@wayne.example');
    const now = new Date().toISOString();
    await db.table('company_memberships').insert([
      {
        scope_id: 'a-studio',
        user_id: adminId,
        role: 'admin',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        scope_id: 'a-studio',
        user_id: editorId,
        role: 'editor',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ]);
    const adminCookie = admin.cookie('adonis-session')!.value;
    const invalidPromotion = await signed(
      client.patch(`/api/accounts/a-studio/members/${editorId}`),
      adminCookie
    )
      .json({ role: 'owner' })
      .send();
    invalidPromotion.assertStatus(400);
    assert.equal((invalidPromotion.body() as { code: string }).code, 'OWNER_TRANSFER_REQUIRED');
    const ownerDemotion = await signed(
      client.patch(`/api/accounts/a-studio/members/${ownerId}`),
      adminCookie
    )
      .json({ role: 'editor' })
      .send();
    ownerDemotion.assertStatus(403);
    const unauthorized = await signed(
      client.patch(`/api/accounts/a-studio/members/${editorId}`),
      editor.cookie('adonis-session')!.value
    )
      .json({ role: 'owner' })
      .send();
    unauthorized.assertStatus(403);
    const unchangedMember = await db
      .from('company_memberships')
      .where({ scope_id: 'a-studio', user_id: editorId })
      .first();
    assert.equal(unchangedMember.role, 'editor');
    assert.lengthOf(await db.from('audit_entries').where({ action: 'member.role_changed' }), 0);
  });

  test('a stale but valid Admin session cannot create another company', async ({
    client,
    assert,
  }) => {
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      password,
      name: 'Bruce Wayne',
    });
    owner.assertStatus(200);
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    );
    const admin = await signUpAndIn(client, {
      email: 'diana.prince@wayne.example',
      password,
      name: 'Diana Prince',
    });
    admin.assertStatus(200);
    const adminId = await userId('diana.prince@wayne.example');
    const now = new Date().toISOString();
    await db.table('company_memberships').insert({
      scope_id: 'a-studio',
      user_id: adminId,
      role: 'admin',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 16 * 60 * 1000;
      const cookie = admin.cookie('adonis-session')!.value;
      const current = await signed(client.get('/api/auth/me'), cookie).send();
      current.assertStatus(200);
      assert.isFalse(current.body().canCreateAccount);
      const second = await signed(client.post('/api/orgs'), cookie)
        .json({ id: 'a-loft', name: 'Stark Industries' })
        .send();
      second.assertStatus(404);
      assert.isNull(await db.from('accounts').where('id', 'a-loft').first());
    } finally {
      Date.now = realNow;
    }
  });

  test('a self role command is refused, including the same role', async ({ client, assert }) => {
    const { adminId, adminCookie } = await team(client);
    const before = await snapshot(adminId);
    for (const role of ['admin', 'viewer']) {
      const refused = await setRole(client, adminCookie, adminId, role);
      refused.assertStatus(403);
      assert.equal((refused.body() as { code: string }).code, 'FORBIDDEN', role);
    }
    assert.deepEqual(await snapshot(adminId), before);
  });

  test('an Admin changes the role of a peer Admin', async ({ client, assert }) => {
    const { adminCookie } = await team(client);
    const peerId = await createIdentity('arthur.curry@wayne.example', { name: 'Arthur Curry' });
    await insertMembership(accountId, peerId, 'admin');
    const changed = await setRole(client, adminCookie, peerId, 'editor');
    changed.assertStatus(200);
    assert.include(await membership(accountId, peerId), { role: 'editor' });
    assert.lengthOf(await roleAudits(peerId), 1);
  });

  test('an Admin cannot change, archive or remove the Owner', async ({ client, assert }) => {
    const { ownerId, adminCookie } = await team(client);
    const before = await snapshot(ownerId);
    await expectStatus(setRole(client, adminCookie, ownerId, 'editor'), 403);
    await expectStatus(setStatus(client, adminCookie, ownerId, 'archived'), 403);
    await expectStatus(signed(client.delete(memberUrl(ownerId)), adminCookie).send(), 403);
    assert.deepEqual(await snapshot(ownerId), before);
  });

  test('only an active member changes role', async ({ client, assert }) => {
    const { editorId, ownerCookie } = await team(client);
    await db
      .from('company_memberships')
      .where({ scope_id: accountId, user_id: editorId })
      .update({ status: 'suspended' });
    const before = await snapshot(editorId);
    const refused = await setRole(client, ownerCookie, editorId, 'viewer');
    refused.assertStatus(403);
    assert.equal((refused.body() as { code: string }).code, 'FORBIDDEN');
    assert.deepEqual(await snapshot(editorId), before);
  });

  test('a same-role command writes no audit and no revision', async ({ client, assert }) => {
    const { editorId, ownerCookie } = await team(client);
    const before = await snapshot(editorId);
    const unchanged = await setRole(client, ownerCookie, editorId, 'editor');
    unchanged.assertStatus(200);
    assert.deepEqual(unchanged.body(), { userId: editorId, role: 'editor' });
    const after = await snapshot(editorId);
    assert.deepEqual(after.membership, before.membership);
    assert.deepEqual(after.revision, before.revision);
    assert.deepEqual(after.audits, before.audits);
  });

  test('disabling access adds a restriction and keeps the membership active', async ({
    client,
    assert,
  }) => {
    const { editorId, ownerCookie } = await team(client);
    const disabled = await setStatus(client, ownerCookie, editorId, 'disabled');
    disabled.assertStatus(200);
    assert.deepEqual(disabled.body(), { userId: editorId, status: 'active', accessDisabled: true });
    assert.include(await membership(accountId, editorId), { status: 'active' });
    assert.include(await restriction(editorId), { role: 'editor' });
  });

  test('archive and restore keep the access restriction', async ({ client, assert }) => {
    const { editorId, ownerCookie } = await team(client);
    await expectStatus(setStatus(client, ownerCookie, editorId, 'disabled'), 200);
    await expectStatus(setStatus(client, ownerCookie, editorId, 'archived'), 200);
    assert.include(await membership(accountId, editorId), { status: 'suspended' });
    const restored = await setStatus(client, ownerCookie, editorId, 'active');
    restored.assertStatus(200);
    assert.deepEqual(restored.body(), { userId: editorId, status: 'active', accessDisabled: true });
    assert.include(await membership(accountId, editorId), { status: 'active' });
    assert.isNotNull(await restriction(editorId));
  });

  test('a removed member cannot rejoin on their own', async ({ client, assert }) => {
    const { editorId, ownerCookie } = await team(client);
    await expectStatus(signed(client.delete(memberUrl(editorId)), ownerCookie).send(), 204);
    const editor = await signIn(client, 'clark.kent@wayne.example');
    const rejoin = await signed(client.post('/api/admission/complete'), editor.cookie)
      .json({})
      .send();
    rejoin.assertStatus(403);
    assert.isNull(await membership(accountId, editorId));
  });

  test('enabling access restores a removed member with the saved role', async ({
    client,
    assert,
  }) => {
    const { editorId, ownerCookie } = await team(client);
    await expectStatus(signed(client.delete(memberUrl(editorId)), ownerCookie).send(), 204);
    const enabled = await signed(
      client.post(`${memberUrl(editorId)}/enable-access`),
      ownerCookie
    ).send();
    enabled.assertStatus(200);
    // The identity's invitation evidence is Viewer; the restriction saved Editor.
    assert.include(await membership(accountId, editorId), { role: 'editor', status: 'active' });
  });

  test('P02: an audit failure after the role and revision writes rolls everything back', async ({
    client,
    assert,
  }) => {
    const { editorId, ownerCookie } = await team(client);
    await restrict(editorId, 'editor');
    const before = await snapshot(editorId);
    const headers = commandHeaders();
    const target = `scope_id = ${quote(accountId)} AND user_id = ${quote(editorId)}`;
    await db.rawQuery(`CREATE TRIGGER p02_audit_fault BEFORE INSERT ON audit_entries
      WHEN NEW.action = 'member.role_changed' AND NEW.account_id = ${quote(accountId)}
        AND NEW.entity_id = ${quote(editorId)}
      BEGIN
        SELECT RAISE(ABORT, 'composition audit prerequisites missing') WHERE NOT (
          (SELECT role FROM company_memberships WHERE ${target}) = 'admin'
          AND (SELECT role FROM account_access_restrictions WHERE account_id = ${quote(accountId)}
            AND principal_id = ${quote(editorId)}) = 'admin'
          AND (SELECT revision FROM company_planning_revisions
            WHERE account_id = ${quote(accountId)}) = ${Number(before.revision.revision) + 1}
          AND EXISTS (SELECT 1 FROM command_results
            WHERE command_id = ${quote(headers['x-account-command-id'])} AND result = 'null')
        );
        SELECT RAISE(ABORT, 'composition audit failure');
      END`);
    const knex = db.connection().getWriteClient();
    const failures: { code?: string; message: string }[] = [];
    const observe = (error: { code?: string; message: string }) => failures.push(error);
    knex.on('query-error', observe);
    try {
      const failed = await setRole(client, ownerCookie, editorId, 'admin', headers);
      failed.assertStatus(500);
      assert.deepEqual(failed.body(), { error: 'Internal server error.' });
    } finally {
      knex.off('query-error', observe);
      await db.rawQuery('DROP TRIGGER IF EXISTS p02_audit_fault');
    }
    assert.isTrue(
      failures.some(
        (error) =>
          error.code === 'SQLITE_CONSTRAINT_TRIGGER' &&
          error.message.includes('composition audit failure')
      ),
      'the audit failure sentinel was raised'
    );
    assert.isFalse(
      failures.some((error) => error.message.includes('prerequisites missing')),
      'the trigger saw every earlier write'
    );
    assert.deepEqual(await snapshot(editorId), before);
    const retried = await setRole(client, ownerCookie, editorId, 'admin', headers);
    retried.assertStatus(200);
    assert.include(await membership(accountId, editorId), { role: 'admin' });
    assert.lengthOf(await roleAudits(editorId), 1);
  });

  test('P03: a receipt completion failure after every effect rolls everything back', async ({
    client,
    assert,
  }) => {
    const { editorId, ownerCookie } = await team(client);
    await restrict(editorId, 'editor');
    const before = await snapshot(editorId);
    const headers = commandHeaders();
    const commandId = quote(headers['x-account-command-id']);
    const expected = quote(JSON.stringify({ userId: editorId, role: 'admin' }));
    await db.rawQuery(`CREATE TRIGGER p03_receipt_fault BEFORE UPDATE ON command_results
      WHEN OLD.command_id = ${commandId}
      BEGIN
        SELECT RAISE(ABORT, 'composition receipt prerequisites missing') WHERE NOT (
          (SELECT role FROM company_memberships WHERE scope_id = ${quote(accountId)}
            AND user_id = ${quote(editorId)}) = 'admin'
          AND (SELECT role FROM account_access_restrictions WHERE account_id = ${quote(accountId)}
            AND principal_id = ${quote(editorId)}) = 'admin'
          AND (SELECT revision FROM company_planning_revisions
            WHERE account_id = ${quote(accountId)}) = ${Number(before.revision.revision) + 1}
          AND (SELECT count(*) FROM audit_entries WHERE action = 'member.role_changed'
            AND account_id = ${quote(accountId)} AND entity_id = ${quote(editorId)}) = 1
          AND OLD.result = 'null'
          AND NEW.result = ${expected}
        );
        SELECT RAISE(ABORT, 'composition receipt completion failure');
      END`);
    const knex = db.connection().getWriteClient();
    const failures: { code?: string; message: string }[] = [];
    const observe = (error: { code?: string; message: string }) => failures.push(error);
    knex.on('query-error', observe);
    try {
      const failed = await setRole(client, ownerCookie, editorId, 'admin', headers);
      failed.assertStatus(500);
      assert.deepEqual(failed.body(), { error: 'Internal server error.' });
    } finally {
      knex.off('query-error', observe);
      await db.rawQuery('DROP TRIGGER IF EXISTS p03_receipt_fault');
    }
    assert.isTrue(
      failures.some(
        (error) =>
          error.code === 'SQLITE_CONSTRAINT_TRIGGER' &&
          error.message.includes('composition receipt completion failure')
      ),
      'the receipt failure sentinel was raised'
    );
    assert.isFalse(
      failures.some((error) => error.message.includes('prerequisites missing')),
      'the trigger saw every earlier write'
    );
    assert.deepEqual(await snapshot(editorId), before);
    const retried = await setRole(client, ownerCookie, editorId, 'admin', headers);
    retried.assertStatus(200);
    const receipt = await db
      .from('command_results')
      .where('command_id', headers['x-account-command-id'])
      .first();
    assert.deepEqual(JSON.parse(receipt.result), { userId: editorId, role: 'admin' });
  });

  test('P07: a commit failure reports the committed change and the replay returns its receipt', async ({
    client,
    assert,
  }) => {
    const { editorId, ownerCookie } = await team(client);
    await restrict(editorId, 'editor');
    const before = await snapshot(editorId);
    const headers = commandHeaders();
    const original = access.memberships.changeRole.bind(access.memberships);
    const sentinel = Object.assign(new Error('P07'), { code: 'SQLITE_BUSY' });
    let armed = false;
    let listenerRuns = 0;
    access.memberships.changeRole = async (input) => {
      if (!armed && input.userId === editorId && input.role === 'admin') {
        armed = true;
        input.trx!.on('commit', () => {
          listenerRuns += 1;
          throw sentinel;
        });
      }
      return original(input);
    };
    try {
      const failed = await setRole(client, ownerCookie, editorId, 'admin', headers);
      failed.assertStatus(500);
      // The Kit masks every 5xx as OPERATION_FAILED; `committed` marks the post-commit failure.
      assert.include(failed.body(), { code: 'E_ACCOUNT_KIT_OPERATION_FAILED', committed: true });
    } finally {
      access.memberships.changeRole = original;
    }
    assert.equal(listenerRuns, 1);
    const committed = await snapshot(editorId);
    assert.equal(committed.membership.role, 'admin');
    assert.equal(committed.restriction?.role, 'admin');
    assert.equal(Number(committed.revision.revision), Number(before.revision.revision) + 1);
    assert.lengthOf(await roleAudits(editorId), 1);
    const receipt = await db
      .from('command_results')
      .where('command_id', headers['x-account-command-id'])
      .first();
    assert.deepEqual(JSON.parse(receipt.result), { userId: editorId, role: 'admin' });

    let invocations = 0;
    access.memberships.changeRole = async (input) => {
      invocations += 1;
      return original(input);
    };
    const knex = db.connection().getWriteClient();
    let receiptUpdates = 0;
    const observe = (query: { sql: string }) => {
      if (/^update\s+\W?command_results/i.test(query.sql)) receiptUpdates += 1;
    };
    knex.on('query', observe);
    try {
      const replay = await setRole(client, ownerCookie, editorId, 'admin', headers);
      replay.assertStatus(200);
      assert.deepEqual(replay.body(), { userId: editorId, role: 'admin' });
    } finally {
      knex.off('query', observe);
      access.memberships.changeRole = original;
    }
    assert.equal(invocations, 0);
    assert.equal(receiptUpdates, 0);
    assert.deepEqual(await snapshot(editorId), committed);
  });
});

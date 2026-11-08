import { test } from '@japa/runner';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import { resetState } from '#services/state_repository';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import { signUpAndIn } from '../../helpers/identities.js';

const password = 'batman-secret-2026';

const signed = asDataOwner;

async function userId(email: string) {
  const user = await db.from('users').where('email', email).first();
  if (!user) throw new Error(`Missing test principal: ${email}`);
  return String(user.id);
}

test.group('company member administration', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await db.from('account_admissions').delete();
    await db.from('account_invitations').delete();
    await db.from('adonis_sessions').delete();
    await db.from('memberships').delete();
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
    await db.table('memberships').insert({
      scope_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
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
    assert.deepEqual(mismatch.body(), {
      error: 'Command identity already used.',
      code: 'IDEMPOTENCY_CONFLICT',
    });
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
  });

  test('one actor can reuse command identities across operations and replay each result', async ({
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
    const ownerId = await userId('bruce.wayne@wayne.example');
    await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio');
    const editor = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    });
    editor.assertStatus(200);
    const editorId = await userId('clark.kent@wayne.example');
    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const path = `/api/accounts/a-studio/members/${editorId}`;
    const identity = {
      'x-account-command-id': 'member-shared-command-0001',
      'idempotency-key': 'member-shared-key-0001',
    };
    const role = () =>
      signed(client.patch(path), ownerCookie).headers(identity).json({ role: 'admin' }).send();
    const status = () =>
      signed(client.patch(`${path}/status`), ownerCookie)
        .headers(identity)
        .json({ status: 'suspended' })
        .send();
    const changedRole = await role();
    changedRole.assertStatus(200);
    assert.deepEqual(changedRole.body(), { userId: editorId, role: 'admin' });
    const changedStatus = await status();
    changedStatus.assertStatus(200);
    assert.deepEqual(changedStatus.body(), {
      userId: editorId,
      status: 'suspended',
    });
    const member = await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: editorId })
      .first();
    assert.include(member, { role: 'admin', status: 'suspended' });
    // Replays retain the original results even after the underlying state changes.
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: editorId })
      .update({ role: 'viewer', status: 'active' });
    const replayRole = await role();
    replayRole.assertStatus(200);
    assert.deepEqual(replayRole.body(), changedRole.body());
    const replayStatus = await status();
    replayStatus.assertStatus(200);
    assert.deepEqual(replayStatus.body(), changedStatus.body());
    const replayedMember = await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: editorId })
      .first();
    assert.include(replayedMember, { role: 'viewer', status: 'active' });
    assert.lengthOf(
      await db
        .from('audit_entries')
        .where({ account_id: 'a-studio' })
        .whereIn('action', ['member.role_changed', 'member.status_changed']),
      2
    );
    const receipts = await db
      .from('idempotency_receipts')
      .where({ scope_id: 'a-studio', command_id: identity['x-account-command-id'] });
    assert.sameMembers(
      receipts.map((row) => row.operation),
      [
        JSON.stringify(['change-member-role', ownerId]),
        JSON.stringify(['change-member-status', ownerId]),
      ]
    );
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
    await db.table('memberships').insert({
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
            .json({ status: 'suspended', extra: true })
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

    const receipts = await db
      .from('idempotency_receipts')
      .where('scope_id', 'a-studio')
      .orderBy('id');
    for (const request of requests) {
      const response = await request.send();
      response.assertStatus(400);
      assert.deepEqual(response.body(), { error: request.error }, request.name);
    }

    const member = await db
      .from('memberships')
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
      await db.from('idempotency_receipts').where('scope_id', 'a-studio').orderBy('id'),
      receipts
    );
  });

  test('an authorized Admin receives input refusal for direct Owner assignment, but cannot edit the Owner or themselves', async ({
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
    await db.table('memberships').insert([
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
    // The package refuses self-management, so an Admin cannot change their own role.
    const selfDemotion = await signed(
      client.patch(`/api/accounts/a-studio/members/${adminId}`),
      adminCookie
    )
      .json({ role: 'editor' })
      .send();
    selfDemotion.assertStatus(403);
    const unchangedAdmin = await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: adminId })
      .first();
    assert.equal(unchangedAdmin.role, 'admin');
    const unauthorized = await signed(
      client.patch(`/api/accounts/a-studio/members/${editorId}`),
      editor.cookie('adonis-session')!.value
    )
      .json({ role: 'owner' })
      .send();
    unauthorized.assertStatus(403);
    const unchangedMember = await db
      .from('memberships')
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
    await db.table('memberships').insert({
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
});

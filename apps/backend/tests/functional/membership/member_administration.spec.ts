import { test } from '@japa/runner';
import { password, userIdByEmail } from '#tests/helpers/membership/members';
import { freshDatabase } from '#tests/helpers/fresh_database';
import db from '@adonisjs/lucid/services/db';
import { resetState } from '#tests/helpers/state_fixture';
import {
  asDataOwner,
  asLoggedInDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture';
import { signUpAndIn } from '#tests/helpers/identities';
import User from '#models/user';

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

  test('role operation replays its semantic result, binds payload and keeps recovery links', async ({
    client,
    assert,
  }) => {
    const owner = await signUpAndIn(client, {
      email: 'bruce.wayne@wayne.example',
      password,
      name: 'Bruce Wayne',
    });
    owner.assertStatus(200);
    const ownerUser = await User.findOrFail(await userIdByEmail('bruce.wayne@wayne.example'));
    await createFixtureCompanyForOwner(
      await userIdByEmail('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    );
    const setupRevision = await db
      .from('company_planning_revisions')
      .where('company_id', 'a-studio')
      .first();
    assert.equal(Number(setupRevision?.revision), 1);
    const editor = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    });
    editor.assertStatus(200);
    const editorId = await userIdByEmail('clark.kent@wayne.example');
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
    const target = { companyId: 'a-studio', userId: editorId };
    const identity = {
      'x-account-operation-id': 'member-role-command-0001',
      'idempotency-key': 'member-role-idempotency-0001',
    };
    const requestRole = (role: 'admin' | 'viewer') =>
      asLoggedInDataOwner(client.visit('api.members.update', target), ownerUser)
        .headers(identity)
        .json({ role })
        .send();
    const changed = await requestRole('admin');
    changed.assertStatus(200);
    assert.deepEqual((changed.body() as { data: unknown }).data, {
      userId: editorId,
      role: 'admin',
    });
    const changedRevision = await db
      .from('company_planning_revisions')
      .where('company_id', 'a-studio')
      .first();
    assert.equal(Number(changedRevision?.revision), 2);
    assert.isNotNull(
      await db.from('password_reset_tokens').where('tokenable_id', editorId).first(),
      'a role change never cancels identity recovery'
    );
    const replay = await requestRole('admin');
    replay.assertStatus(200);
    assert.deepEqual(
      (replay.body() as { data: unknown }).data,
      (changed.body() as { data: unknown }).data
    );
    const mismatch = await requestRole('viewer');
    mismatch.assertStatus(409);
    assert.deepEqual(mismatch.body(), {
      error: 'Operation id already used.',
      code: 'E_IDEMPOTENCY_CONFLICT',
    });
    const audits = await db
      .from('audit_entries')
      .where({ company_id: 'a-studio', action: 'member.role_changed', entity_id: editorId });
    assert.lengthOf(audits, 1);
    const unchanged = await asLoggedInDataOwner(
      client.visit('api.members.update', target),
      ownerUser
    )
      .headers({
        'x-account-operation-id': 'member-role-command-noop-0001',
        'idempotency-key': 'member-role-idempotency-noop-0001',
      })
      .json({ role: 'admin' })
      .send();
    unchanged.assertStatus(200);
    const unchangedRevision = await db
      .from('company_planning_revisions')
      .where('company_id', 'a-studio')
      .first();
    assert.equal(Number(unchangedRevision?.revision), 2);
    const ownerId = await userIdByEmail('bruce.wayne@wayne.example');
    const refused = await asLoggedInDataOwner(
      client.visit('api.members.update', { companyId: 'a-studio', userId: ownerId }),
      ownerUser
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
    const ownerUser = await User.findOrFail(await userIdByEmail('bruce.wayne@wayne.example'));
    const ownerId = await userIdByEmail('bruce.wayne@wayne.example');
    await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio');
    const editor = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    });
    editor.assertStatus(200);
    const editorId = await userIdByEmail('clark.kent@wayne.example');
    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const target = { companyId: 'a-studio', userId: editorId };
    const identity = {
      'x-account-operation-id': 'member-shared-command-0001',
      'idempotency-key': 'member-shared-key-0001',
    };
    const role = () =>
      asLoggedInDataOwner(client.visit('api.members.update', target), ownerUser)
        .headers(identity)
        .json({ role: 'admin' })
        .send();
    const status = () =>
      asLoggedInDataOwner(client.visit('api.member_status.update', target), ownerUser)
        .headers(identity)
        .json({ status: 'suspended' })
        .send();
    const changedRole = await role();
    changedRole.assertStatus(200);
    assert.deepEqual((changedRole.body() as { data: unknown }).data, {
      userId: editorId,
      role: 'admin',
    });
    const changedStatus = await status();
    changedStatus.assertStatus(200);
    assert.deepEqual(changedStatus.body().data, {
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
    assert.deepEqual(
      (replayRole.body() as { data: unknown }).data,
      (changedRole.body() as { data: unknown }).data
    );
    const replayStatus = await status();
    replayStatus.assertStatus(200);
    assert.deepEqual(replayStatus.body().data, changedStatus.body().data);
    const replayedMember = await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: editorId })
      .first();
    assert.include(replayedMember, { role: 'viewer', status: 'active' });
    assert.lengthOf(
      await db
        .from('audit_entries')
        .where({ company_id: 'a-studio' })
        .whereIn('action', ['member.role_changed', 'member.status_changed']),
      2
    );
    const receipts = await db
      .from('request_receipts')
      .where({ scope_id: 'a-studio', command_id: identity['x-account-operation-id'] });
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
    const ownerUser = await User.findOrFail(await userIdByEmail('bruce.wayne@wayne.example'));
    await createFixtureCompanyForOwner(
      await userIdByEmail('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    );
    const editor = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    });
    editor.assertStatus(200);
    const editorId = await userIdByEmail('clark.kent@wayne.example');
    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: 'a-studio',
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    const target = { companyId: 'a-studio', userId: editorId };
    const requests = [
      {
        name: 'invalid role',
        send: () =>
          asLoggedInDataOwner(client.visit('api.members.update', target), ownerUser)
            // Deliberately outside the generated body type, to reach the server's refusal.
            .json({ role: 'operator' } as never)
            .send(),
      },
      {
        name: 'unknown role field',
        send: () =>
          asLoggedInDataOwner(client.visit('api.members.update', target), ownerUser)
            // Deliberately outside the generated body type, to reach the server's refusal.
            .json({ role: 'admin', extra: true } as never)
            .send(),
      },
      {
        name: 'invalid status',
        send: () =>
          asLoggedInDataOwner(client.visit('api.member_status.update', target), ownerUser)
            // Deliberately outside the generated body type, to reach the server's refusal.
            .json({ status: 'removed' } as never)
            .send(),
      },
      {
        name: 'unknown status field',
        send: () =>
          asLoggedInDataOwner(client.visit('api.member_status.update', target), ownerUser)
            // Deliberately outside the generated body type, to reach the server's refusal.
            .json({ status: 'suspended', extra: true } as never)
            .send(),
      },
      {
        name: 'invalid tracking value',
        send: () =>
          asLoggedInDataOwner(
            client.visit('api.member_sign_in_tracking.update', { companyId: 'a-studio' }),
            ownerUser
          )
            .json({ enabled: 'true' })
            .send(),
      },
      {
        name: 'unknown tracking field',
        send: () =>
          asLoggedInDataOwner(
            client.visit('api.member_sign_in_tracking.update', { companyId: 'a-studio' }),
            ownerUser
          )
            .json({ enabled: true, extra: true } as never)
            .send(),
      },
    ];

    const receipts = await db.from('request_receipts').where('scope_id', 'a-studio').orderBy('id');
    for (const request of requests) {
      const response = await request.send();
      response.assertStatus(422);
      assert.isNotEmpty((response.body() as { errors?: unknown[] }).errors, request.name);
    }

    const member = await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: editorId })
      .first();
    assert.include(member, { role: 'editor', status: 'active' });
    const revision = await db
      .from('company_planning_revisions')
      .where('company_id', 'a-studio')
      .first();
    assert.equal(Number(revision?.revision), 1);
    assert.isNull(
      await db
        .from('company_settings')
        .where({ company_id: 'a-studio', key: 'member-sign-in-tracking' })
        .first()
    );
    assert.lengthOf(await db.from('audit_entries').where('company_id', 'a-studio'), 0);
    assert.deepEqual(
      await db.from('request_receipts').where('scope_id', 'a-studio').orderBy('id'),
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
      await userIdByEmail('bruce.wayne@wayne.example'),
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
    const ownerId = await userIdByEmail('bruce.wayne@wayne.example');
    const adminId = await userIdByEmail('diana.prince@wayne.example');
    const editorId = await userIdByEmail('clark.kent@wayne.example');
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
    const adminUser = await User.findOrFail(await userIdByEmail('diana.prince@wayne.example'));
    const invalidPromotion = await asLoggedInDataOwner(
      client.visit('api.members.update', { companyId: 'a-studio', userId: editorId }),
      adminUser
    )
      .json({ role: 'owner' })
      .send();
    invalidPromotion.assertStatus(400);
    assert.equal(
      (invalidPromotion.body() as unknown as { code: string }).code,
      'E_OWNER_TRANSFER_REQUIRED'
    );
    const ownerDemotion = await asLoggedInDataOwner(
      client.visit('api.members.update', { companyId: 'a-studio', userId: ownerId }),
      adminUser
    )
      .json({ role: 'editor' })
      .send();
    ownerDemotion.assertStatus(403);
    // The package refuses self-management, so an Admin cannot change their own role.
    const selfDemotion = await asLoggedInDataOwner(
      client.visit('api.members.update', { companyId: 'a-studio', userId: adminId }),
      adminUser
    )
      .json({ role: 'editor' })
      .send();
    selfDemotion.assertStatus(403);
    const unchangedAdmin = await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: adminId })
      .first();
    assert.equal(unchangedAdmin.role, 'admin');
    const unauthorized = await asLoggedInDataOwner(
      client.visit('api.members.update', { companyId: 'a-studio', userId: editorId }),
      await User.findOrFail(editorId)
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
      await userIdByEmail('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    );
    const admin = await signUpAndIn(client, {
      email: 'diana.prince@wayne.example',
      password,
      name: 'Diana Prince',
    });
    admin.assertStatus(200);
    const adminId = await userIdByEmail('diana.prince@wayne.example');
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
      const current = await asDataOwner(client.visit('api.session.show'), cookie).send();
      current.assertStatus(200);
      const second = await asDataOwner(client.visit('api.first_company_setup.store'), cookie)
        .json({ name: 'Stark Industries' })
        .send();
      second.assertStatus(409);
      second.assertBodyContains({ code: 'COMPANY_SETUP_UNAVAILABLE' });
      assert.deepEqual(await db.from('companies').select('id'), [{ id: 'a-studio' }]);
    } finally {
      Date.now = realNow;
    }
  });
});

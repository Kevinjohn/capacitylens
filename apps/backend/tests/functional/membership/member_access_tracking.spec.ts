import { test } from '@japa/runner';
import { password, userIdByEmail } from '#tests/helpers/membership/members';
import { freshDatabase } from '#tests/helpers/fresh_database';
import db from '@adonisjs/lucid/services/db';
import { seed } from '@capacitylens/shared/data/seed';
import { buildInternalClient } from '@capacitylens/shared/data/internalClient';
import { insertProductRows } from '#tests/helpers/product_rows';
import { resetState } from '#tests/helpers/state_fixture';
import {
  asLoggedInDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture';
import { signUpAndIn } from '#tests/helpers/identities';
import User from '#models/user';

test.group('company member access and tracking', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await db.from('account_admissions').delete();
    await db.from('account_invitations').delete();
    await db.from('adonis_sessions').delete();
    await db.from('memberships').delete();
    await db.from('users').delete();
  });

  test('an existing company prevents sole-user setup even without memberships', async ({
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
    await db.from('memberships').delete();
    const response = await asLoggedInDataOwner(
      client.visit('api.first_company_setup.store'),
      await User.findOrFail(await userIdByEmail('bruce.wayne@wayne.example'))
    )
      .json({ name: 'Stark Industries' })
      .send();
    response.assertStatus(409);
    response.assertBodyContains({ code: 'COMPANY_SETUP_UNAVAILABLE' });
    assert.deepEqual(await db.from('companies').select('id'), [{ id: 'a-studio' }]);
  });

  test('suspension blocks the company until restored and clears the sign-in confirmation', async ({
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
    const editorUser = await User.findOrFail(await userIdByEmail('clark.kent@wayne.example'));
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
    const initial = await asLoggedInDataOwner(
      client.visit('api.members.index', { companyId: 'a-studio' }),
      ownerUser
    ).send();
    initial.assertStatus(200);
    assert.isFalse(initial.body().data.signInTrackingEnabled);
    assert.isNull(
      initial.body().data.members.find((member: { userId: string }) => member.userId === editorId)!
        .signInConfirmed
    );
    const enabled = await asLoggedInDataOwner(
      client.visit('api.member_sign_in_tracking.update', { companyId: 'a-studio' }),
      ownerUser
    )
      .json({ enabled: true })
      .send();
    enabled.assertStatus(200);
    const signedIn = await client
      .visit('api.session.store')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: 'clark.kent@wayne.example', password })
      .send();
    signedIn.assertStatus(200);
    const observed = await asLoggedInDataOwner(
      client.visit('api.members.index', { companyId: 'a-studio' }),
      ownerUser
    ).send();
    observed.assertStatus(200);
    assert.isTrue(
      observed.body().data.members.find((member: { userId: string }) => member.userId === editorId)!
        .signInConfirmed
    );
    const editorMember = { companyId: 'a-studio', userId: editorId };
    const suspended = await asLoggedInDataOwner(
      client.visit('api.member_status.update', editorMember),
      ownerUser
    )
      .json({ status: 'suspended' })
      .send();
    suspended.assertStatus(200);
    const blocked = await asLoggedInDataOwner(
      client.visit('api.planning.show', { companyId: 'a-studio' }),
      editorUser
    ).send();
    blocked.assertStatus(403);
    const restored = await asLoggedInDataOwner(
      client.visit('api.member_status.update', editorMember),
      ownerUser
    )
      .json({ status: 'active' })
      .send();
    restored.assertStatus(200);
    const allowed = await asLoggedInDataOwner(
      client.visit('api.planning.show', { companyId: 'a-studio' }),
      editorUser
    ).send();
    allowed.assertStatus(200);
    const after = await asLoggedInDataOwner(
      client.visit('api.members.index', { companyId: 'a-studio' }),
      ownerUser
    ).send();
    after.assertStatus(200);
    assert.isFalse(
      after.body().data.members.find((member: { userId: string }) => member.userId === editorId)!
        .signInConfirmed
    );
  });

  test('global sign-in does not confirm tracking in a company that suspended the member', async ({
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
    const now = new Date().toISOString();
    const otherCompany = { ...seed().companies[0]!, id: 'a-loft', name: 'Stark Industries' };
    await insertProductRows('companies', [otherCompany]);
    await insertProductRows('clients', [buildInternalClient('a-loft', now)]);
    const ownerMembership = await db.from('memberships').where({ scope_id: 'a-studio' }).first();
    assert.isNotNull(ownerMembership);
    await db.table('memberships').insert({
      scope_id: 'a-loft',
      user_id: ownerMembership.user_id,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    const editor = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    });
    editor.assertStatus(200);
    const editorId = await userIdByEmail('clark.kent@wayne.example');
    await db.table('memberships').insert(
      ['a-studio', 'a-loft'].map((companyId) => ({
        scope_id: companyId,
        user_id: editorId,
        role: 'editor',
        status: 'active',
        created_at: now,
        updated_at: now,
      }))
    );
    for (const companyId of ['a-studio', 'a-loft']) {
      const enabled = await asLoggedInDataOwner(
        client.visit('api.member_sign_in_tracking.update', { companyId }),
        ownerUser
      )
        .json({ enabled: true })
        .send();
      enabled.assertStatus(200);
    }
    const suspended = await asLoggedInDataOwner(
      client.visit('api.member_status.update', { companyId: 'a-studio', userId: editorId }),
      ownerUser
    )
      .json({ status: 'suspended' })
      .send();
    suspended.assertStatus(200);
    const signedIn = await client
      .visit('api.session.store')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: 'clark.kent@wayne.example', password })
      .send();
    signedIn.assertStatus(200);
    const observations = await db
      .from('company_settings')
      .where('key', `member-sign-in:${editorId}`)
      .select('company_id');
    assert.deepEqual(
      observations.map((row) => row.company_id),
      ['a-loft']
    );
  });

  test('an Admin cannot create another company once the first company exists', async ({
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
    const admin = await signUpAndIn(client, {
      email: 'diana.prince@wayne.example',
      password,
      name: 'Diana Prince',
    });
    admin.assertStatus(200);
    const adminUser = await User.findOrFail(await userIdByEmail('diana.prince@wayne.example'));
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
    const available = await asLoggedInDataOwner(client.visit('api.session.show'), adminUser).send();
    available.assertStatus(200);
    const refusedWhileActive = await asLoggedInDataOwner(
      client.visit('api.first_company_setup.store'),
      adminUser
    )
      .json({ name: 'Stark Industries' })
      .send();
    refusedWhileActive.assertStatus(409);
    refusedWhileActive.assertBodyContains({ code: 'COMPANY_SETUP_UNAVAILABLE' });
    assert.deepEqual(await db.from('companies').select('id'), [{ id: 'a-studio' }]);
    const suspended = await asLoggedInDataOwner(
      client.visit('api.member_status.update', { companyId: 'a-studio', userId: adminId }),
      ownerUser
    )
      .json({ status: 'suspended' })
      .send();
    suspended.assertStatus(200);
    const unavailable = await asLoggedInDataOwner(
      client.visit('api.session.show'),
      adminUser
    ).send();
    unavailable.assertStatus(200);
    const refused = await asLoggedInDataOwner(
      client.visit('api.first_company_setup.store'),
      ownerUser
    )
      .json({ name: 'Stark Industries' })
      .send();
    refused.assertStatus(409);
    refused.assertBodyContains({ code: 'COMPANY_SETUP_UNAVAILABLE' });
    assert.deepEqual(await db.from('companies').select('id'), [{ id: 'a-studio' }]);
  });
});

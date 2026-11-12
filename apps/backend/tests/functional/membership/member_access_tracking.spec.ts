import { test } from '@japa/runner';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import { seed } from '@capacitylens/shared/data/seed';
import { buildInternalClient } from '@capacitylens/shared/data/internalClient';
import { encodeRow } from '#services/state_repository';
import { resetState } from '#tests/helpers/state_fixture';
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
    const editorCookie = editor.cookie('adonis-session')!.value;
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
    const directoryPath = '/api/accounts/a-studio/members';
    const initial = await signed(client.get(directoryPath), ownerCookie).send();
    initial.assertStatus(200);
    assert.isFalse(initial.body().signInTrackingEnabled);
    assert.isNull(
      initial.body().members.find((member: { userId: string }) => member.userId === editorId)
        .signInConfirmed
    );
    const enabled = await signed(
      client.put('/api/accounts/a-studio/member-sign-in-tracking'),
      ownerCookie
    )
      .json({ enabled: true })
      .send();
    enabled.assertStatus(200);
    const signedIn = await client
      .post('/api/auth/sign-in')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: 'clark.kent@wayne.example', password })
      .send();
    signedIn.assertStatus(200);
    const observed = await signed(client.get(directoryPath), ownerCookie).send();
    observed.assertStatus(200);
    assert.isTrue(
      observed.body().members.find((member: { userId: string }) => member.userId === editorId)
        .signInConfirmed
    );
    const statusPath = `/api/accounts/a-studio/members/${editorId}/status`;
    const planningPath = '/api/accounts/a-studio/planning';
    const suspended = await signed(client.patch(statusPath), ownerCookie)
      .json({ status: 'suspended' })
      .send();
    suspended.assertStatus(200);
    const blocked = await signed(client.get(planningPath), editorCookie).send();
    blocked.assertStatus(403);
    const restored = await signed(client.patch(statusPath), ownerCookie)
      .json({ status: 'active' })
      .send();
    restored.assertStatus(200);
    const allowed = await signed(client.get(planningPath), editorCookie).send();
    allowed.assertStatus(200);
    const after = await signed(client.get(directoryPath), ownerCookie).send();
    after.assertStatus(200);
    assert.isFalse(
      after.body().members.find((member: { userId: string }) => member.userId === editorId)
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
    const ownerCookie = owner.cookie('adonis-session')!.value;
    await createFixtureCompanyForOwner(
      await userId('bruce.wayne@wayne.example'),
      'Wayne Enterprises',
      'a-studio'
    );
    const now = new Date().toISOString();
    const otherCompany = { ...seed().accounts[0]!, id: 'a-loft', name: 'Stark Industries' };
    await db.table('accounts').insert(encodeRow('accounts', otherCompany));
    await db
      .table('clients')
      .insert(encodeRow('clients', { ...buildInternalClient('a-loft', now) }));
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
    const editorId = await userId('clark.kent@wayne.example');
    await db.table('memberships').insert(
      ['a-studio', 'a-loft'].map((accountId) => ({
        scope_id: accountId,
        user_id: editorId,
        role: 'editor',
        status: 'active',
        created_at: now,
        updated_at: now,
      }))
    );
    for (const accountId of ['a-studio', 'a-loft']) {
      const enabled = await signed(
        client.put(`/api/accounts/${accountId}/member-sign-in-tracking`),
        ownerCookie
      )
        .json({ enabled: true })
        .send();
      enabled.assertStatus(200);
    }
    const suspended = await signed(
      client.patch(`/api/accounts/a-studio/members/${editorId}/status`),
      ownerCookie
    )
      .json({ status: 'suspended' })
      .send();
    suspended.assertStatus(200);
    const signedIn = await client
      .post('/api/auth/sign-in')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: 'clark.kent@wayne.example', password })
      .send();
    signedIn.assertStatus(200);
    const observations = await db
      .from('company_settings')
      .where('key', `member-sign-in:${editorId}`)
      .select('account_id');
    assert.deepEqual(
      observations.map((row) => row.account_id),
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
    const ownerCookie = owner.cookie('adonis-session')!.value;
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
    const adminCookie = admin.cookie('adonis-session')!.value;
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
    const available = await signed(client.get('/api/auth/me'), adminCookie).send();
    available.assertStatus(200);
    const refusedWhileActive = await signed(client.post('/api/orgs'), adminCookie)
      .json({ id: 'a-loft', name: 'Stark Industries' })
      .send();
    refusedWhileActive.assertStatus(404);
    assert.isNull(await db.from('accounts').where('id', 'a-loft').first());
    const suspended = await signed(
      client.patch(`/api/accounts/a-studio/members/${adminId}/status`),
      ownerCookie
    )
      .json({ status: 'suspended' })
      .send();
    suspended.assertStatus(200);
    const unavailable = await signed(client.get('/api/auth/me'), adminCookie).send();
    unavailable.assertStatus(200);
    const refused = await signed(client.post('/api/orgs'), ownerCookie)
      .json({ id: 'a-loft', name: 'Stark Industries' })
      .send();
    refused.assertStatus(404);
    assert.isNull(await db.from('accounts').where('id', 'a-loft').first());
  });
});

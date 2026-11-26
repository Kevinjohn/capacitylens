import { test } from '@japa/runner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import db from '@adonisjs/lucid/services/db';
import { resetState } from '#tests/helpers/state_fixture';
import { signUpAndIn } from '#tests/helpers/identities';
import { asDataOwner } from '#tests/helpers/authenticated_data_fixture';

const password = 'batman-secret-2026';

const signed = asDataOwner;

async function userId(email: string) {
  const user = await db.from('users').where('email', email).first();
  if (!user) throw new Error(`Missing test user: ${email}`);
  return String(user.id);
}

async function observation(companyId: string, targetUserId: string) {
  return db
    .from('company_settings')
    .where({ company_id: companyId, key: `member-sign-in:${targetUserId}` })
    .first();
}

test.group('member sign-in tracking lifecycle', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await db.from('account_admissions').delete();
    await db.from('account_invitations').delete();
    await db.from('adonis_sessions').delete();
    await db.from('memberships').delete();
    await db.from('users').delete();
  });

  test('keeps observations off by default, and scopes fresh windows by company', async ({
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
    const now = new Date().toISOString();
    await db.table('companies').insert([
      {
        id: 'a-studio',
        name: 'Wayne Enterprises',
        color: '#6366f1',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'a-loft',
        name: 'Stark Industries',
        color: '#6366f1',
        created_at: now,
        updated_at: now,
      },
    ]);
    await db.table('memberships').insert([
      {
        scope_id: 'a-studio',
        user_id: await userId('bruce.wayne@wayne.example'),
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        scope_id: 'a-loft',
        user_id: await userId('bruce.wayne@wayne.example'),
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ]);

    const member = await signUpAndIn(client, {
      email: 'clark.kent@wayne.example',
      password,
      name: 'Clark Kent',
    });
    member.assertStatus(200);
    const memberId = await userId('clark.kent@wayne.example');
    await db.table('memberships').insert([
      {
        scope_id: 'a-studio',
        user_id: memberId,
        role: 'viewer',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        scope_id: 'a-loft',
        user_id: memberId,
        role: 'viewer',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ]);

    const signIn = () =>
      client
        .visit('api.session.store')
        .header('sec-fetch-site', 'same-origin')
        .json({ email: 'clark.kent@wayne.example', password })
        .send();
    const offSignIn = await signIn();
    offSignIn.assertStatus(200);
    assert.isNull(await observation('a-studio', memberId));
    assert.isNull(await observation('a-loft', memberId));

    const trackingPath = (companyId: string) =>
      `/api/v1/companies/${companyId}/member-sign-in-tracking`;
    const enableStudio = await signed(client.put(trackingPath('a-studio')), ownerCookie)
      .json({ enabled: true })
      .send();
    enableStudio.assertStatus(200);
    const firstWindow = await db
      .from('company_settings')
      .where({ company_id: 'a-studio', key: 'member-sign-in-tracking' })
      .first();
    assert.isNotNull(await observation('a-studio', await userId('bruce.wayne@wayne.example')));
    assert.isNull(await observation('a-loft', memberId));

    const observedStudio = await signIn();
    observedStudio.assertStatus(200);
    assert.isNotNull(await observation('a-studio', memberId));
    assert.isNull(await observation('a-loft', memberId));
    const repeatedEnable = await signed(client.put(trackingPath('a-studio')), ownerCookie)
      .json({ enabled: true })
      .send();
    repeatedEnable.assertStatus(200);
    const repeatedWindow = await db
      .from('company_settings')
      .where({ company_id: 'a-studio', key: 'member-sign-in-tracking' })
      .first();
    assert.equal(repeatedWindow.created_at, firstWindow.created_at);
    assert.isNotNull(await observation('a-studio', memberId));

    const enableLoft = await signed(client.put(trackingPath('a-loft')), ownerCookie)
      .json({ enabled: true })
      .send();
    enableLoft.assertStatus(200);
    const observedBoth = await signIn();
    observedBoth.assertStatus(200);
    assert.isNotNull(await observation('a-studio', memberId));
    assert.isNotNull(await observation('a-loft', memberId));

    const disableStudio = await signed(client.put(trackingPath('a-studio')), ownerCookie)
      .json({ enabled: false })
      .send();
    disableStudio.assertStatus(200);
    assert.isNull(await observation('a-studio', memberId));
    assert.isNull(
      await db
        .from('company_settings')
        .where({ company_id: 'a-studio', key: 'member-sign-in-tracking' })
        .first()
    );
    assert.isNotNull(await observation('a-loft', memberId));
    const disabledSignIn = await signIn();
    disabledSignIn.assertStatus(200);
    assert.isNull(await observation('a-studio', memberId));
    assert.isNotNull(await observation('a-loft', memberId));

    const reenabledStudio = await signed(client.put(trackingPath('a-studio')), ownerCookie)
      .json({ enabled: true })
      .send();
    reenabledStudio.assertStatus(200);
    assert.isNull(await observation('a-studio', memberId));
    assert.isNotNull(await observation('a-studio', await userId('bruce.wayne@wayne.example')));
    assert.isNotNull(await observation('a-loft', memberId));
    const beforeRevoke = await signIn();
    beforeRevoke.assertStatus(200);
    assert.isNotNull(await observation('a-studio', memberId));
    assert.isNotNull(await observation('a-loft', memberId));
  });
});

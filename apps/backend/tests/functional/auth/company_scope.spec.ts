import { test } from '@japa/runner';
import router from '@adonisjs/core/services/router';
import db from '@adonisjs/lucid/services/db';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { resetState } from '#tests/helpers/state_fixture';
import { createFixtureCompanyForOwner } from '../../helpers/authenticated_data_fixture.js';
import { signUpAndIn } from '../../helpers/identities.js';

const password = 'batman-secret-2026';

/** Signs in an Owner of `a-studio` and a second admitted person, returning the second's session. */
async function outsider(client: any) {
  const owner = await signUpAndIn(client, {
    email: 'bruce.wayne@wayne.example',
    password,
    name: 'Bruce Wayne',
  });
  owner.assertStatus(200);
  const ownerId = String((owner.body().data as { user: { id: string } }).user.id);
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', 'a-studio');
  const other = await signUpAndIn(client, {
    email: 'selina.kyle@gotham.example',
    password,
    name: 'Selina Kyle',
  });
  other.assertStatus(200);
  return {
    cookie: other.cookie('adonis-session')!.value,
    userId: String((other.body().data as { user: { id: string } }).user.id),
  };
}

async function refusals(client: any, cookie: string) {
  const status = await client
    .visit('api.masquerade.show')
    .withCookie('adonis-session', cookie)
    .send();
  status.assertStatus(200);
  const company = await client
    .visit('api.getting_started.update', { companyId: 'a-studio' })
    .header('sec-fetch-site', 'same-origin')
    .header('X-Masquerade-Context', (status.body().data as { contextToken: string }).contextToken)
    .withCookie('adonis-session', cookie)
    .json({ dismissed: true })
    .send();
  const planning = await client
    .visit('api.planning.show', { companyId: 'a-studio' })
    .withCookie('adonis-session', cookie)
    .send();
  return { company, planning };
}

test.group('company scope middleware', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await db.from('account_admissions').delete();
    await db.from('adonis_sessions').delete();
    await db.from('memberships').delete();
    await db.from('users').delete();
  });

  test('refuses a non-member and a suspended member with the route’s usual refusal', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await outsider(client);
    const expectRefused = async () => {
      const { company, planning } = await refusals(client, cookie);
      company.assertStatus(403);
      assert.deepEqual(company.body(), { error: 'Forbidden.', code: 'IDENTITY_AUTHORITY_DENIED' });
      planning.assertStatus(403);
      assert.deepEqual(planning.body(), {
        error: 'Company membership is unavailable.',
        code: 'ACCOUNT_MEMBERSHIP_LOST',
      });
    };
    await expectRefused();

    const now = new Date().toISOString();
    await db.table('memberships').insert({
      scope_id: 'a-studio',
      user_id: userId,
      role: 'admin',
      status: 'suspended',
      created_at: now,
      updated_at: now,
    });
    await expectRefused();
    assert.notExists(
      await db.from('account_getting_started_dismissals').where('company_id', 'a-studio').first()
    );
  });

  test('every route with a company id in its path carries the company scope', ({ assert }) => {
    const unscoped = Object.values(router.toJSON())
      .flat()
      .filter((route) => route.pattern.includes(':companyId'))
      .filter(
        (route) =>
          ![...route.middleware.all()].some(
            (entry) => typeof entry === 'object' && 'name' in entry && entry.name === 'companyScope'
          )
      )
      .map((route) => `${route.methods.join(',')} ${route.pattern}`);
    assert.deepEqual(unscoped, []);
  });
});
